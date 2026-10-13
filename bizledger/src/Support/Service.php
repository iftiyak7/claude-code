<?php
/**
 * Base for domain services.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Support;

use BizLedger\Database\Database;
use BizLedger\Tenancy\BusinessContext;

/**
 * Shared plumbing: database, clock, events, and tenant-scoped lookups.
 */
abstract class Service {

	protected Database $db;
	protected Clock $clock;
	protected Events $events;

	public function __construct( Database $db, Clock $clock, Events $events ) {
		$this->db     = $db;
		$this->clock  = $clock;
		$this->events = $events;
	}

	/**
	 * Fetch a business-scoped row or throw 404.
	 *
	 * @return array<string,mixed>
	 * @throws NotFoundException When missing or deleted.
	 */
	protected function findScoped( BusinessContext $ctx, string $table, int $id, string $label = 'Record', bool $with_deleted = false ): array {
		$t   = $this->db->table( $table );
		$sql = "SELECT * FROM {$t} WHERE id = %d AND business_id = %d";
		if ( ! $with_deleted && $this->hasSoftDelete( $table ) ) {
			$sql .= ' AND deleted_at IS NULL';
		}
		$row = $id > 0 ? $this->db->row( $sql, array( $id, $ctx->business_id ) ) : null;
		if ( null === $row ) {
			throw new NotFoundException( sprintf( '%s not found.', $label ) );
		}
		return $row;
	}

	protected function hasSoftDelete( string $table ): bool {
		static $cache = array();
		if ( ! isset( $cache[ $table ] ) ) {
			$tables          = \BizLedger\Database\Schema::tables();
			$cache[ $table ] = isset( $tables[ $table ]['columns']['deleted_at'] );
		}
		return $cache[ $table ];
	}

	protected function now(): string {
		return $this->clock->mysql();
	}

	protected function today( BusinessContext $ctx ): string {
		return $this->clock->today( $ctx->timezone() );
	}

	/**
	 * Standard pagination arguments.
	 *
	 * @param array<string,mixed> $args Raw.
	 * @return array{0:int,1:int,2:int} page, per_page, offset
	 */
	protected function paging( array $args, int $max = 200 ): array {
		$page     = max( 1, (int) ( $args['page'] ?? 1 ) );
		$per_page = max( 1, min( $max, (int) ( $args['per_page'] ?? 25 ) ) );
		return array( $page, $per_page, ( $page - 1 ) * $per_page );
	}

	/**
	 * Wrap list results in a standard envelope.
	 *
	 * @param array<int,array<string,mixed>> $items Rows.
	 * @return array{items:array<int,array<string,mixed>>,total:int,page:int,per_page:int,pages:int}
	 */
	protected function paged( array $items, int $total, int $page, int $per_page ): array {
		return array(
			'items'    => $items,
			'total'    => $total,
			'page'     => $page,
			'per_page' => $per_page,
			'pages'    => (int) ceil( $total / max( 1, $per_page ) ),
		);
	}

	/**
	 * "IN (%d,%d,…)" placeholder list.
	 *
	 * @param array<int,mixed> $values Values.
	 */
	protected function inList( array $values, string $ph = '%d' ): string {
		return '(' . implode( ',', array_fill( 0, max( 1, count( $values ) ), $ph ) ) . ')';
	}
}
