<?php
/**
 * Categories, brands and units.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Catalog;

use BizLedger\Audit\AuditLogger;
use BizLedger\Database\Database;
use BizLedger\Support\Clock;
use BizLedger\Support\ConflictException;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Simple named lookups shared by the product catalogue.
 */
final class TaxonomyService extends Service {

	/**
	 * kind => [table, product column].
	 */
	private const KINDS = array(
		'categories' => array( 'categories', 'category_id' ),
		'brands'     => array( 'brands', 'brand_id' ),
		'units'      => array( 'units', 'unit_id' ),
	);

	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->audit = $audit;
	}

	public static function valid( string $kind ): bool {
		return isset( self::KINDS[ $kind ] );
	}

	/**
	 * @return array<int,array<string,mixed>>
	 */
	public function list( BusinessContext $ctx, string $kind ): array {
		$ctx->authorize( 'products.view' );
		list( $table, $col ) = self::KINDS[ $kind ];
		$t                   = $this->db->table( $table );
		$pt                  = $this->db->table( 'products' );
		return $this->db->rows(
			"SELECT x.*, (SELECT COUNT(*) FROM {$pt} p WHERE p.business_id = x.business_id AND p.{$col} = x.id AND p.deleted_at IS NULL) AS product_count
			FROM {$t} x WHERE x.business_id = %d AND x.deleted_at IS NULL ORDER BY x.name",
			array( $ctx->business_id )
		);
	}

	/**
	 * @param array<string,mixed> $data name, parent_id (categories), short_name/allow_decimal (units).
	 * @return array<string,mixed>
	 */
	public function save( BusinessContext $ctx, string $kind, array $data, int $id = 0 ): array {
		$ctx->authorize( $id ? 'products.edit' : 'products.create' );
		list( $table ) = self::KINDS[ $kind ];
		$t             = $this->db->table( $table );
		$name          = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			throw ValidationException::field( 'name', 'Name is required.' );
		}
		$dup = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND name = %s AND deleted_at IS NULL AND id <> %d", array( $ctx->business_id, $name, $id ) );
		if ( $dup ) {
			throw ValidationException::field( 'name', 'This name already exists.' );
		}
		$row = array(
			'name'       => $name,
			'status'     => 'active',
			'updated_by' => $ctx->user_id,
			'updated_at' => $this->now(),
		);
		if ( 'categories' === $kind ) {
			$parent = max( 0, (int) ( $data['parent_id'] ?? 0 ) );
			if ( $parent && ( $parent === $id || ! $this->db->value( "SELECT id FROM {$t} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $parent, $ctx->business_id ) ) ) ) {
				throw ValidationException::field( 'parent_id', 'Invalid parent category.' );
			}
			$row['parent_id'] = $parent;
		}
		if ( 'units' === $kind ) {
			$row['short_name']    = Text::line( $data['short_name'] ?? $name, 20 );
			$row['allow_decimal'] = Text::bool( $data['allow_decimal'] ?? false ) ? 1 : 0;
		}
		if ( $id ) {
			$this->findScoped( $ctx, $table, $id, 'Item' );
			$this->db->update( $t, $row, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		} else {
			$id = $this->db->insert( $t, array_merge( $row, array( 'business_id' => $ctx->business_id, 'created_by' => $ctx->user_id, 'created_at' => $this->now() ) ) );
		}
		$this->audit->log( $ctx, 'save', rtrim( $kind, 's' ), $id, ucfirst( rtrim( $kind, 's' ) ) . ' saved: ' . $name );
		return (array) $this->db->row( "SELECT * FROM {$t} WHERE id = %d", array( $id ) );
	}

	public function delete( BusinessContext $ctx, string $kind, int $id ): void {
		$ctx->authorize( 'products.delete' );
		list( $table, $col ) = self::KINDS[ $kind ];
		$this->findScoped( $ctx, $table, $id, 'Item' );
		$pt   = $this->db->table( 'products' );
		$used = (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} WHERE business_id = %d AND {$col} = %d AND deleted_at IS NULL", array( $ctx->business_id, $id ) );
		if ( $used ) {
			throw new ConflictException( sprintf( 'In use by %d product(s). Reassign them first.', $used ) );
		}
		$this->db->update( $this->db->table( $table ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		$this->audit->log( $ctx, 'delete', rtrim( $kind, 's' ), $id, ucfirst( rtrim( $kind, 's' ) ) . ' deleted' );
	}

	/**
	 * Seed default units for a new business.
	 */
	public function seedUnits( int $business_id, int $user_id ): void {
		$t   = $this->db->table( 'units' );
		$now = $this->now();
		foreach ( array( array( 'Piece', 'pcs', 0 ), array( 'Kilogram', 'kg', 1 ), array( 'Gram', 'g', 1 ), array( 'Litre', 'L', 1 ), array( 'Metre', 'm', 1 ), array( 'Box', 'box', 0 ), array( 'Dozen', 'dz', 0 ) ) as $u ) {
			$this->db->insert( $t, array( 'business_id' => $business_id, 'name' => $u[0], 'short_name' => $u[1], 'allow_decimal' => $u[2], 'status' => 'active', 'created_by' => $user_id, 'updated_by' => $user_id, 'created_at' => $now, 'updated_at' => $now ) );
		}
	}
}
