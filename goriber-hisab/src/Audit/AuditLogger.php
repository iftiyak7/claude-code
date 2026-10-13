<?php
/**
 * Audit trail.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Audit;

use GoriberHisab\Database\Database;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Text;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Append-only record of who did what, when.
 *
 * Writes happen inside the caller's transaction so an action and its audit
 * row commit (or roll back) together.
 */
final class AuditLogger {

	private Database $db;
	private Clock $clock;

	/**
	 * Optional resolver for the per-business "log IP" privacy setting.
	 *
	 * @var callable(int):bool|null
	 */
	private $ip_policy;

	public function __construct( Database $db, Clock $clock ) {
		$this->db    = $db;
		$this->clock = $clock;
	}

	/**
	 * @param callable(int):bool $policy Business id => whether to store IP/UA.
	 */
	public function setIpPolicy( callable $policy ): void {
		$this->ip_policy = $policy;
	}

	/**
	 * @param array<string,mixed> $changes Diff or context data.
	 */
	public function log( BusinessContext $ctx, string $action, string $object_type, int $object_id, string $summary, array $changes = array() ): void {
		$log_ip = null === $this->ip_policy || ( $this->ip_policy )( $ctx->business_id );
		$this->db->insert(
			$this->db->table( 'audit_logs' ),
			array(
				'business_id' => $ctx->business_id,
				'branch_id'   => $ctx->branch_id,
				'user_id'     => $ctx->user_id,
				'action'      => Text::key( $action, 40 ),
				'object_type' => Text::key( $object_type, 40 ),
				'object_id'   => $object_id,
				'summary'     => Text::line( $summary, 255 ),
				'changes'     => $changes ? Json::encode( $changes ) : null,
				'ip_address'  => $log_ip ? substr( $ctx->ip, 0, 45 ) : '',
				'user_agent'  => $log_ip ? Text::line( $ctx->user_agent, 255 ) : '',
				'created_at'  => $this->clock->mysql(),
			)
		);
	}

	/**
	 * Field-level diff between two rows (only scalar columns that changed).
	 *
	 * @param array<string,mixed> $before Old row.
	 * @param array<string,mixed> $after  New row.
	 * @return array<string,array{0:mixed,1:mixed}>
	 */
	public static function diff( array $before, array $after ): array {
		$ignore = array( 'updated_at', 'updated_by', 'created_at', 'created_by' );
		$diff   = array();
		foreach ( $after as $key => $value ) {
			if ( in_array( $key, $ignore, true ) || ! array_key_exists( $key, $before ) ) {
				continue;
			}
			if ( (string) $before[ $key ] !== (string) $value ) {
				$diff[ $key ] = array( $before[ $key ], $value );
			}
		}
		return $diff;
	}

	/**
	 * Paged audit log query.
	 *
	 * @param array<string,mixed> $filters user_id, object_type, object_id, action, from, to, page, per_page.
	 * @return array<string,mixed>
	 */
	public function search( BusinessContext $ctx, array $filters ): array {
		$ctx->authorize( 'audit.view' );
		$t      = $this->db->table( 'audit_logs' );
		$where  = array( 'business_id = %d' );
		$params = array( $ctx->business_id );
		foreach ( array( 'user_id' => '%d', 'object_id' => '%d' ) as $f => $ph ) {
			if ( ! empty( $filters[ $f ] ) ) {
				$where[]  = "{$f} = {$ph}";
				$params[] = (int) $filters[ $f ];
			}
		}
		foreach ( array( 'object_type', 'action' ) as $f ) {
			if ( ! empty( $filters[ $f ] ) ) {
				$where[]  = "{$f} = %s";
				$params[] = Text::key( $filters[ $f ] );
			}
		}
		if ( $from = Text::date( $filters['from'] ?? null ) ) {
			$where[]  = 'created_at >= %s';
			$params[] = $from . ' 00:00:00';
		}
		if ( $to = Text::date( $filters['to'] ?? null ) ) {
			$where[]  = 'created_at <= %s';
			$params[] = $to . ' 23:59:59';
		}
		$page     = max( 1, (int) ( $filters['page'] ?? 1 ) );
		$per_page = max( 1, min( 200, (int) ( $filters['per_page'] ?? 50 ) ) );
		$w        = implode( ' AND ', $where );
		$total    = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE {$w}", $params );
		$items    = $this->db->rows( "SELECT * FROM {$t} WHERE {$w} ORDER BY id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, ( $page - 1 ) * $per_page ) ) );
		foreach ( $items as &$item ) {
			$item['changes'] = Json::decode( $item['changes'] );
		}
		return array(
			'items'    => $items,
			'total'    => $total,
			'page'     => $page,
			'per_page' => $per_page,
			'pages'    => (int) ceil( $total / $per_page ),
		);
	}
}
