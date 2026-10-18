<?php
/**
 * Shop staff who do not log in: salespeople picked at the POS ("who sold
 * this?") on a shared device, and the shop's own delivery men for local
 * delivery. Logins (MemberService) stay for people who use the app themselves.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Team;

use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Salespeople and delivery men.
 */
final class WorkerService extends Service {

	public const ROLES = array( 'seller', 'rider' );

	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->audit = $audit;
	}

	/**
	 * @param array<string,mixed> $args role, all (include inactive).
	 * @return array<int,array<string,mixed>>
	 */
	public function list( BusinessContext $ctx, array $args = array() ): array {
		$t      = $this->db->table( 'workers' );
		$where  = 'business_id = %d AND deleted_at IS NULL';
		$params = array( $ctx->business_id );
		$role   = (string) ( $args['role'] ?? '' );
		if ( in_array( $role, self::ROLES, true ) ) {
			$where   .= ' AND role = %s';
			$params[] = $role;
		}
		if ( empty( $args['all'] ) ) {
			$where .= " AND status = 'active'";
		}
		return array_map( array( $this, 'present' ), $this->db->rows( "SELECT * FROM {$t} WHERE {$where} ORDER BY status, name", $params ) );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		return $this->present( $this->findScoped( $ctx, 'workers', $id, 'Staff member' ) );
	}

	/**
	 * Active worker of a role, or null.
	 *
	 * @return array<string,mixed>|null
	 */
	public function find( BusinessContext $ctx, int $id, string $role ): ?array {
		if ( $id <= 0 ) {
			return null;
		}
		$t   = $this->db->table( 'workers' );
		$row = $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d AND role = %s AND status = 'active' AND deleted_at IS NULL", array( $id, $ctx->business_id, $role ) );
		return $row ? $this->present( $row ) : null;
	}

	/**
	 * Names by id (for lists and reports), inactive ones included.
	 *
	 * @param array<int,int> $ids Ids.
	 * @return array<int,string>
	 */
	public function names( BusinessContext $ctx, array $ids ): array {
		$ids = array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
		if ( ! $ids ) {
			return array();
		}
		$t   = $this->db->table( 'workers' );
		$out = array();
		foreach ( $this->db->rows( "SELECT id, name FROM {$t} WHERE business_id = %d AND id IN " . $this->inList( $ids ), array_merge( array( $ctx->business_id ), $ids ) ) as $r ) {
			$out[ (int) $r['id'] ] = (string) $r['name'];
		}
		return $out;
	}

	/**
	 * @param array<string,mixed> $data role, name, phone, fee, status.
	 * @return array<string,mixed>
	 */
	public function save( BusinessContext $ctx, array $data, int $id = 0 ): array {
		$old  = $id ? $this->findScoped( $ctx, 'workers', $id, 'Staff member' ) : null;
		$role = (string) ( $old['role'] ?? ( $data['role'] ?? '' ) );
		if ( ! in_array( $role, self::ROLES, true ) ) {
			throw ValidationException::field( 'role', 'Choose salesperson or delivery man.' );
		}
		$this->authorizeRole( $ctx, $role );
		$name = Text::line( $data['name'] ?? ( $old['name'] ?? '' ), 100 );
		if ( '' === $name ) {
			throw ValidationException::field( 'name', 'Enter a name.' );
		}
		$fee = Decimal::of( $data['fee'] ?? ( $old['fee'] ?? 0 ) );
		if ( $fee < 0 ) {
			throw ValidationException::field( 'fee', 'Cannot be negative.' );
		}
		$row = array(
			'role'       => $role,
			'name'       => $name,
			'phone'      => Text::phone( $data['phone'] ?? ( $old['phone'] ?? '' ) ),
			'fee'        => Decimal::toString( $fee ),
			'status'     => 'inactive' === ( $data['status'] ?? ( $old['status'] ?? 'active' ) ) ? 'inactive' : 'active',
			'updated_at' => $this->now(),
			'updated_by' => $ctx->user_id,
		);
		$t = $this->db->table( 'workers' );
		if ( $old ) {
			$this->db->update( $t, $row, array( 'id' => $id ) );
			$this->audit->log( $ctx, 'update', 'member', $id, 'Staff ' . $name . ' updated' );
		} else {
			$id = $this->db->insert(
				$t,
				$row + array(
					'business_id' => $ctx->business_id,
					'created_at'  => $this->now(),
					'created_by'  => $ctx->user_id,
				)
			);
			$this->audit->log( $ctx, 'create', 'member', $id, ( 'rider' === $role ? 'Delivery man ' : 'Salesperson ' ) . $name . ' added' );
		}
		return $this->get( $ctx, $id );
	}

	public function delete( BusinessContext $ctx, int $id ): void {
		$row = $this->findScoped( $ctx, 'workers', $id, 'Staff member' );
		$this->authorizeRole( $ctx, (string) $row['role'] );
		// Sales and orders keep pointing at the person, so only hide them.
		$this->db->update(
			$this->db->table( 'workers' ),
			array(
				'deleted_at' => $this->now(),
				'deleted_by' => $ctx->user_id,
			),
			array( 'id' => $id )
		);
		$this->audit->log( $ctx, 'delete', 'member', $id, 'Staff ' . $row['name'] . ' removed' );
	}

	/** Salespeople are managed with users; delivery men also by whoever runs online orders. */
	private function authorizeRole( BusinessContext $ctx, string $role ): void {
		if ( ! $ctx->can( 'users.manage' ) && ! ( 'rider' === $role && $ctx->can( 'orders.manage' ) ) ) {
			throw new PermissionException( 'You do not have permission to manage staff.' );
		}
	}

	/**
	 * @param array<string,mixed> $r Row.
	 * @return array<string,mixed>
	 */
	private function present( array $r ): array {
		return array(
			'id'     => (int) $r['id'],
			'role'   => (string) $r['role'],
			'name'   => (string) $r['name'],
			'phone'  => (string) $r['phone'],
			'fee'    => Decimal::toString( Decimal::of( $r['fee'] ) ),
			'status' => (string) $r['status'],
		);
	}
}
