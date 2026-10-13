<?php
/**
 * Business members (multi-user access).
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tenancy;

use BizLedger\Audit\AuditLogger;
use BizLedger\Database\Database;
use BizLedger\Security\Permissions;
use BizLedger\Support\Clock;
use BizLedger\Support\ConflictException;
use BizLedger\Support\Events;
use BizLedger\Support\Json;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;

/**
 * Who can use a business and with which role / permission overrides.
 */
final class MemberService extends Service {

	private Permissions $permissions;
	private UserDirectory $users;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, Permissions $permissions, UserDirectory $users, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->permissions = $permissions;
		$this->users       = $users;
		$this->audit       = $audit;
	}

	/**
	 * @return array<int,array<string,mixed>>
	 */
	public function list( BusinessContext $ctx ): array {
		$ctx->authorize( 'users.manage' );
		$t    = $this->db->table( 'business_users' );
		$rows = $this->db->rows( "SELECT * FROM {$t} WHERE business_id = %d AND status <> 'removed' ORDER BY id", array( $ctx->business_id ) );
		return array_map( array( $this, 'present' ), $rows );
	}

	/**
	 * Add a member by existing user id, or by email (creating a login if needed).
	 *
	 * @param array<string,mixed> $data user_id | email (+ name, login), role, grants[], denies[], branch_ids[], default_branch_id.
	 * @return array<string,mixed>
	 */
	public function add( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'users.manage' );
		$user_id = (int) ( $data['user_id'] ?? 0 );
		if ( ! $user_id ) {
			$email = Text::email( $data['email'] ?? '' );
			if ( '' === $email ) {
				throw ValidationException::field( 'email', 'Enter a valid email address.' );
			}
			$user_id = $this->users->findByEmail( $email );
			if ( ! $user_id ) {
				$name = Text::line( $data['name'] ?? '' );
				if ( '' === $name ) {
					throw ValidationException::field( 'name', 'Enter the person\'s name.' );
				}
				$user_id = $this->users->create( $email, $name, Text::key( $data['login'] ?? '', 60 ) );
			}
		} elseif ( null === $this->users->get( $user_id ) ) {
			throw ValidationException::field( 'user_id', 'User not found.' );
		}

		$t        = $this->db->table( 'business_users' );
		$existing = $this->db->row( "SELECT * FROM {$t} WHERE business_id = %d AND user_id = %d", array( $ctx->business_id, $user_id ) );
		if ( $existing && 'removed' !== $existing['status'] ) {
			throw ValidationException::field( 'email', 'This person is already a member of the business.' );
		}
		$clean = $this->validate( $ctx, $data );
		if ( 'owner' === $clean['role'] && 'owner' !== $ctx->role ) {
			throw ValidationException::field( 'role', 'Only an owner can add another owner.' );
		}
		$now = $this->now();
		if ( $existing ) {
			$this->db->update( $t, array_merge( $clean, array( 'status' => 'active', 'updated_by' => $ctx->user_id, 'updated_at' => $now ) ), array( 'id' => (int) $existing['id'] ) );
			$id = (int) $existing['id'];
		} else {
			$id = $this->db->insert( $t, array_merge( $clean, array( 'business_id' => $ctx->business_id, 'user_id' => $user_id, 'status' => 'active', 'created_by' => $ctx->user_id, 'updated_by' => $ctx->user_id, 'created_at' => $now, 'updated_at' => $now ) ) );
		}
		$this->audit->log( $ctx, 'create', 'member', $id, sprintf( 'User #%d added as %s', $user_id, $clean['role'] ) );
		$this->events->dispatch( 'bizledger/member/added', $ctx, $user_id, $clean['role'] );
		return $this->present( (array) $this->db->row( "SELECT * FROM {$t} WHERE id = %d", array( $id ) ) );
	}

	/**
	 * @param array<string,mixed> $data role, grants, denies, branch_ids, default_branch_id, status (active|suspended).
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $member_id, array $data ): array {
		$ctx->authorize( 'users.manage' );
		$t      = $this->db->table( 'business_users' );
		$before = $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d", array( $member_id, $ctx->business_id ) );
		if ( null === $before ) {
			throw new \BizLedger\Support\NotFoundException( 'Member not found.' );
		}
		$this->guardOwner( $ctx, $before, $data );
		$clean = $this->validate( $ctx, array_merge( $this->present( $before ), $data ) );
		if ( isset( $data['status'] ) && in_array( $data['status'], array( 'active', 'suspended' ), true ) ) {
			$clean['status'] = $data['status'];
		}
		$clean['updated_by'] = $ctx->user_id;
		$clean['updated_at'] = $this->now();
		$this->db->update( $t, $clean, array( 'id' => $member_id ) );
		$this->audit->log( $ctx, 'update', 'member', $member_id, sprintf( 'Permissions changed for user #%d', (int) $before['user_id'] ), AuditLogger::diff( $before, $clean ) );
		return $this->present( (array) $this->db->row( "SELECT * FROM {$t} WHERE id = %d", array( $member_id ) ) );
	}

	public function remove( BusinessContext $ctx, int $member_id ): void {
		$ctx->authorize( 'users.manage' );
		$t      = $this->db->table( 'business_users' );
		$member = $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d", array( $member_id, $ctx->business_id ) );
		if ( null === $member ) {
			throw new \BizLedger\Support\NotFoundException( 'Member not found.' );
		}
		$this->guardOwner( $ctx, $member, array( 'status' => 'removed' ) );
		if ( (int) $member['user_id'] === $ctx->user_id ) {
			throw new ConflictException( 'You cannot remove yourself.' );
		}
		$this->db->update( $t, array( 'status' => 'removed', 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ), array( 'id' => $member_id ) );
		$this->audit->log( $ctx, 'delete', 'member', $member_id, sprintf( 'User #%d removed from business', (int) $member['user_id'] ) );
	}

	/**
	 * Owners can only be changed by owners, and the last owner can't be demoted.
	 *
	 * @param array<string,mixed> $member Row.
	 * @param array<string,mixed> $data   Changes.
	 */
	private function guardOwner( BusinessContext $ctx, array $member, array $data ): void {
		if ( 'owner' !== $member['role'] ) {
			if ( 'owner' === ( $data['role'] ?? '' ) && 'owner' !== $ctx->role ) {
				throw ValidationException::field( 'role', 'Only an owner can grant the owner role.' );
			}
			return;
		}
		if ( 'owner' !== $ctx->role ) {
			throw new \BizLedger\Support\PermissionException( 'Only an owner can change another owner.' );
		}
		$demoting = ( isset( $data['role'] ) && 'owner' !== $data['role'] ) || in_array( $data['status'] ?? 'active', array( 'suspended', 'removed' ), true );
		if ( $demoting ) {
			$t      = $this->db->table( 'business_users' );
			$owners = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND role = 'owner' AND status = 'active'", array( $ctx->business_id ) );
			if ( $owners <= 1 ) {
				throw new ConflictException( 'A business must keep at least one active owner.' );
			}
		}
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function validate( BusinessContext $ctx, array $data ): array {
		$roles = $this->permissions->roles();
		$role  = (string) ( $data['role'] ?? 'staff' );
		if ( ! isset( $roles[ $role ] ) ) {
			throw ValidationException::field( 'role', 'Choose a valid role.' );
		}
		$valid  = $this->permissions->all();
		$grants = array_values( array_intersect( array_map( 'strval', (array) ( $data['grants'] ?? array() ) ), $valid ) );
		$denies = array_values( array_intersect( array_map( 'strval', (array) ( $data['denies'] ?? array() ) ), $valid ) );
		$bt     = $this->db->table( 'branches' );
		$valid_branches = array_map( 'intval', $this->db->column( "SELECT id FROM {$bt} WHERE business_id = %d AND deleted_at IS NULL", array( $ctx->business_id ) ) );
		$branches       = array_values( array_intersect( array_map( 'intval', (array) ( $data['branch_ids'] ?? array() ) ), $valid_branches ) );
		$default        = (int) ( $data['default_branch_id'] ?? 0 );
		if ( ! in_array( $default, $valid_branches, true ) || ( $branches && ! in_array( $default, $branches, true ) ) ) {
			$default = $branches ? $branches[0] : (int) $this->db->value( "SELECT id FROM {$bt} WHERE business_id = %d AND is_default = 1", array( $ctx->business_id ) );
		}
		return array(
			'role'              => $role,
			'grants'            => Json::encode( $grants ),
			'denies'            => Json::encode( $denies ),
			'branch_ids'        => Json::encode( $branches ),
			'default_branch_id' => $default,
		);
	}

	/**
	 * @param array<string,mixed> $row Membership row.
	 * @return array<string,mixed>
	 */
	private function present( array $row ): array {
		$user = $this->users->get( (int) $row['user_id'] );
		return array(
			'id'                => (int) $row['id'],
			'user_id'           => (int) $row['user_id'],
			'name'              => $user['name'] ?? '',
			'email'             => $user['email'] ?? '',
			'role'              => $row['role'],
			'grants'            => Json::decode( $row['grants'] ?? null ),
			'denies'            => Json::decode( $row['denies'] ?? null ),
			'branch_ids'        => array_map( 'intval', Json::decode( $row['branch_ids'] ?? null ) ),
			'default_branch_id' => (int) $row['default_branch_id'],
			'status'            => $row['status'],
			'last_seen_at'      => $row['last_seen_at'] ?? null,
			'permissions'       => $this->permissions->resolve( (string) $row['role'], Json::decode( $row['grants'] ?? null ), Json::decode( $row['denies'] ?? null ) ),
		);
	}
}
