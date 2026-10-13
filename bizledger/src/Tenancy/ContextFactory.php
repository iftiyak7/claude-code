<?php
/**
 * Builds the per-request BusinessContext.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tenancy;

use BizLedger\Database\Database;
use BizLedger\Security\Permissions;
use BizLedger\Support\Json;
use BizLedger\Support\PermissionException;

/**
 * Resolves membership → role → effective permissions → branch.
 *
 * This is the single gate for tenant isolation: if a user is not an active
 * member of an active business, no context exists and no service can run.
 */
final class ContextFactory {

	private Database $db;
	private Permissions $permissions;

	public function __construct( Database $db, Permissions $permissions ) {
		$this->db          = $db;
		$this->permissions = $permissions;
	}

	/**
	 * @throws PermissionException When the user may not access the business/branch.
	 */
	public function forUser( int $user_id, int $business_id, int $branch_id = 0 ): BusinessContext {
		if ( $user_id <= 0 ) {
			throw new PermissionException( 'Please log in.' );
		}
		$bt = $this->db->table( 'businesses' );
		$mt = $this->db->table( 'business_users' );

		if ( $business_id <= 0 ) {
			// Fall back to the user's first business.
			$business_id = (int) $this->db->value(
				"SELECT m.business_id FROM {$mt} m JOIN {$bt} b ON b.id = m.business_id WHERE m.user_id = %d AND m.status = 'active' AND b.status = 'active' AND b.deleted_at IS NULL ORDER BY m.id LIMIT 1",
				array( $user_id )
			);
		}
		$business = $business_id > 0 ? $this->db->row( "SELECT * FROM {$bt} WHERE id = %d AND status = 'active' AND deleted_at IS NULL", array( $business_id ) ) : null;
		$member   = $business ? $this->db->row( "SELECT * FROM {$mt} WHERE business_id = %d AND user_id = %d AND status = 'active'", array( $business_id, $user_id ) ) : null;
		if ( null === $business || null === $member ) {
			throw new PermissionException( 'You do not have access to this business.' );
		}

		$branches = array_map( 'intval', Json::decode( $member['branch_ids'] ?? null ) );
		$branch   = $this->resolveBranch( $business_id, $branch_id, $branches, (int) $member['default_branch_id'] );

		$perms = $this->permissions->resolve(
			(string) $member['role'],
			array_map( 'strval', Json::decode( $member['grants'] ?? null ) ),
			array_map( 'strval', Json::decode( $member['denies'] ?? null ) )
		);
		return new BusinessContext( $business, $branch, $user_id, (string) $member['role'], $perms, $branches );
	}

	/**
	 * Record last activity (throttled to once per 5 minutes).
	 */
	public function touch( BusinessContext $ctx, string $now ): void {
		$mt = $this->db->table( 'business_users' );
		$this->db->execute(
			"UPDATE {$mt} SET last_seen_at = %s WHERE business_id = %d AND user_id = %d AND (last_seen_at IS NULL OR last_seen_at < %s)",
			array( $now, $ctx->business_id, $ctx->user_id, gmdate( 'Y-m-d H:i:s', strtotime( $now . ' UTC' ) - 300 ) )
		);
	}

	/**
	 * @param array<int,int> $allowed Allowed branch ids (empty = all).
	 */
	private function resolveBranch( int $business_id, int $requested, array $allowed, int $default ): int {
		$t      = $this->db->table( 'branches' );
		$active = array_map( 'intval', $this->db->column( "SELECT id FROM {$t} WHERE business_id = %d AND status = 'active' AND deleted_at IS NULL ORDER BY is_default DESC, id", array( $business_id ) ) );
		$usable = $allowed ? array_values( array_intersect( $active, $allowed ) ) : $active;
		if ( array() === $usable ) {
			throw new PermissionException( 'You do not have access to any active branch.' );
		}
		if ( $requested > 0 ) {
			if ( ! in_array( $requested, $usable, true ) ) {
				throw new PermissionException( 'You do not have access to this branch.' );
			}
			return $requested;
		}
		return in_array( $default, $usable, true ) ? $default : $usable[0];
	}
}
