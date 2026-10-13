<?php
/**
 * Builds the per-request BusinessContext.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Tenancy;

use GoriberHisab\Database\Database;
use GoriberHisab\Security\Permissions;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\SubscriptionException;

/**
 * Resolves membership → role → effective permissions → branch.
 *
 * This is the single gate for tenant isolation: if a user is not an active
 * member of an active business, no context exists and no service can run.
 */
final class ContextFactory {

	private Database $db;
	private Permissions $permissions;

	/**
	 * Business row → subscription state (see PlatformService::subscription()).
	 *
	 * @var (callable(array<string,mixed>):array<string,mixed>)|null
	 */
	private $subscription = null;

	/**
	 * User id → true when the user bypasses subscription checks (site owner).
	 *
	 * @var (callable(int):bool)|null
	 */
	private $exempt = null;

	/**
	 * @param callable(array<string,mixed>):array<string,mixed> $subscription Subscription resolver.
	 * @param callable(int):bool                                $exempt       Users exempt from the check.
	 */
	public function setSubscriptionPolicy( callable $subscription, callable $exempt ): void {
		$this->subscription = $subscription;
		$this->exempt       = $exempt;
	}

	public function __construct( Database $db, Permissions $permissions ) {
		$this->db          = $db;
		$this->permissions = $permissions;
	}

	/**
	 * @param bool $allow_expired Resolve even when the subscription ran out (renewal screens).
	 * @throws PermissionException   When the user may not access the business/branch.
	 * @throws SubscriptionException When the business's subscription has run out.
	 */
	public function forUser( int $user_id, int $business_id, int $branch_id = 0, bool $allow_expired = false ): BusinessContext {
		if ( $user_id <= 0 ) {
			throw new PermissionException( 'Please log in.' );
		}
		$bt = $this->db->table( 'businesses' );
		$mt = $this->db->table( 'business_users' );

		if ( $business_id <= 0 ) {
			// Fall back to the user's first business.
			$business_id = (int) $this->db->value(
				"SELECT m.business_id FROM {$mt} m JOIN {$bt} b ON b.id = m.business_id WHERE m.user_id = %d AND m.status = 'active' AND b.status IN ('active','suspended','pending') AND b.deleted_at IS NULL ORDER BY m.id LIMIT 1",
				array( $user_id )
			);
		}
		$business = $business_id > 0 ? $this->db->row( "SELECT * FROM {$bt} WHERE id = %d AND status IN ('active','suspended','pending') AND deleted_at IS NULL", array( $business_id ) ) : null;
		$member   = $business ? $this->db->row( "SELECT * FROM {$mt} WHERE business_id = %d AND user_id = %d AND status = 'active'", array( $business_id, $user_id ) ) : null;
		if ( null === $business || null === $member ) {
			throw new PermissionException( 'You do not have access to this business.' );
		}

		$sub = null;
		if ( null !== $this->subscription ) {
			$sub = ( $this->subscription )( $business );
			if ( in_array( $sub['status'], array( 'expired', 'suspended', 'pending' ), true ) && ! $allow_expired && ! ( $this->exempt )( $user_id ) ) {
				$messages = array(
					'suspended' => 'This shop has been suspended. Please contact support.',
					'pending'   => 'Your shop is waiting for approval.',
					'expired'   => 'Your subscription has expired. Please renew to continue.',
				);
				throw new SubscriptionException(
					$messages[ $sub['status'] ],
					$sub + array( 'business_name' => (string) $business['name'], 'business_id' => (int) $business['id'] )
				);
			}
		} elseif ( 'active' !== $business['status'] ) {
			throw new PermissionException( 'You do not have access to this business.' );
		}

		$branches = array_map( 'intval', Json::decode( $member['branch_ids'] ?? null ) );
		$branch   = $this->resolveBranch( $business_id, $branch_id, $branches, (int) $member['default_branch_id'] );

		$perms = $this->permissions->resolve(
			(string) $member['role'],
			array_map( 'strval', Json::decode( $member['grants'] ?? null ) ),
			array_map( 'strval', Json::decode( $member['denies'] ?? null ) )
		);
		$ctx               = new BusinessContext( $business, $branch, $user_id, (string) $member['role'], $perms, $branches );
		$ctx->subscription = $sub;
		return $ctx;
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
