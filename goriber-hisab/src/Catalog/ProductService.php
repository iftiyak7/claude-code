<?php
/**
 * Products and variants.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Catalog;

use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Inventory\StockService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\NotFoundException;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Product catalogue.
 */
final class ProductService extends Service {

	public const TYPES = array( 'standard', 'service' );

	private StockService $stock;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, StockService $stock, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->stock = $stock;
		$this->audit = $audit;
	}

	/**
	 * Paged list with on-hand quantity for the current branch.
	 *
	 * @param array<string,mixed> $args search, category_id, brand_id, status, type, page, per_page, orderby.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args = array() ): array {
		$ctx->authorize( 'products.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args, 500 );
		$pt = $this->db->table( 'products' );
		$st = $this->db->table( 'stock_levels' );
		$ct = $this->db->table( 'categories' );
		$ut = $this->db->table( 'units' );

		$where  = array( 'p.business_id = %d', 'p.deleted_at IS NULL' );
		$params = array( $ctx->business_id );
		$status = $args['status'] ?? 'active';
		if ( in_array( $status, array( 'active', 'inactive' ), true ) ) {
			$where[]  = 'p.status = %s';
			$params[] = $status;
		}
		if ( ! empty( $args['search'] ) ) {
			$term     = Text::line( $args['search'] );
			$like     = '%' . $this->db->escapeLike( $term ) . '%';
			$where[]  = '(p.name LIKE %s OR p.sku = %s OR p.barcode = %s OR p.sku LIKE %s)';
			array_push( $params, $like, $term, $term, $like );
		}
		foreach ( array( 'category_id', 'brand_id', 'supplier_id' ) as $f ) {
			if ( ! empty( $args[ $f ] ) ) {
				$where[]  = "p.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( ! empty( $args['type'] ) && in_array( $args['type'], self::TYPES, true ) ) {
			$where[]  = 'p.type = %s';
			$params[] = $args['type'];
		}
		$order = array(
			'name'    => 'p.name ASC',
			'newest'  => 'p.id DESC',
			'price'   => 'p.selling_price ASC',
			'sku'     => 'p.sku ASC',
		)[ $args['orderby'] ?? 'name' ] ?? 'p.name ASC';

		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} p WHERE {$w}", $params );
		$rows  = $this->db->rows(
			"SELECT p.*, c.name AS category_name, u.short_name AS unit_name, u.allow_decimal AS unit_decimal,
				(SELECT COALESCE(SUM(s.qty),0) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id AND s.branch_id = %d) AS stock_qty
			FROM {$pt} p
			LEFT JOIN {$ct} c ON c.id = p.category_id
			LEFT JOIN {$ut} u ON u.id = p.unit_id
			WHERE {$w} ORDER BY {$order} LIMIT %d OFFSET %d",
			array_merge( array( $ctx->branch_id ), $params, array( $per_page, $offset ) )
		);
		$items = array_map( fn( array $r ) => $this->present( $ctx, $r ), $rows );
		return $this->paged( $items, $total, $page, $per_page );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'products.view' );
		$row              = $this->findScoped( $ctx, 'products', $id, 'Product' );
		$ut               = $this->db->table( 'units' );
		$unit             = (int) $row['unit_id'] ? $this->db->row( "SELECT short_name, allow_decimal FROM {$ut} WHERE id = %d", array( (int) $row['unit_id'] ) ) : null;
		$row['unit_name']    = $unit['short_name'] ?? '';
		$row['unit_decimal'] = $unit['allow_decimal'] ?? 0;
		$product          = $this->present( $ctx, $row );
		$product['stock'] = $this->stockByBranch( $ctx, $id );
		$product['stock_qty'] = Decimal::toString( Decimal::sum( array_map( static fn( $s ) => Decimal::of( $s['qty'] ), array_filter( $product['stock'], static fn( $s ) => (int) $s['branch_id'] === $ctx->branch_id ) ) ) );
		$product['variants']  = $this->variants( $ctx, $id );
		return $product;
	}

	/**
	 * Exact lookup by barcode or SKU (product or variant). Used by scanners.
	 *
	 * @return array<string,mixed>
	 * @throws NotFoundException When nothing matches.
	 */
	public function findByCode( BusinessContext $ctx, string $code ): array {
		$ctx->authorize( 'products.view' );
		$code = Text::line( $code, 80 );
		if ( '' === $code ) {
			throw new NotFoundException( 'Product not found.' );
		}
		$pt = $this->db->table( 'products' );
		$vt = $this->db->table( 'product_variants' );
		$id = $this->db->value(
			"SELECT id FROM {$pt} WHERE business_id = %d AND deleted_at IS NULL AND status = 'active' AND (barcode = %s OR sku = %s) LIMIT 1",
			array( $ctx->business_id, $code, $code )
		);
		if ( $id ) {
			return array( 'product' => $this->get( $ctx, (int) $id ), 'variant' => null );
		}
		$variant = $this->db->row(
			"SELECT * FROM {$vt} WHERE business_id = %d AND deleted_at IS NULL AND (barcode = %s OR sku = %s) LIMIT 1",
			array( $ctx->business_id, $code, $code )
		);
		if ( $variant ) {
			return array( 'product' => $this->get( $ctx, (int) $variant['product_id'] ), 'variant' => $this->presentVariant( $ctx, $variant ) );
		}
		throw new NotFoundException( 'No product matches this code.' );
	}

	/**
	 * @param array<string,mixed> $data Product fields + opening_qty, opening_cost.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'products.create' );
		$clean = $this->validate( $ctx, $data );
		$now   = $this->now();

		$opening_qty  = $this->decimalField( $data, 'opening_qty' );
		$opening_cost = isset( $data['opening_cost'] ) && '' !== $data['opening_cost'] ? $this->decimalField( $data, 'opening_cost' ) : Decimal::of( $clean['purchase_price'] );
		if ( $opening_qty < 0 ) {
			throw ValidationException::field( 'opening_qty', 'Opening stock cannot be negative.' );
		}

		$id = $this->db->transaction(
			function () use ( $ctx, $clean, $now, $opening_qty, $opening_cost, $data ) {
				$id = $this->db->insert(
					$this->db->table( 'products' ),
					array_merge(
						$clean,
						array(
							'business_id' => $ctx->business_id,
							'created_by'  => $ctx->user_id,
							'updated_by'  => $ctx->user_id,
							'created_at'  => $now,
							'updated_at'  => $now,
						)
					)
				);
				if ( '' === $clean['barcode'] && Text::bool( $data['auto_barcode'] ?? false ) ) {
					$this->db->update( $this->db->table( 'products' ), array( 'barcode' => self::internalBarcode( $id ) ), array( 'id' => $id ) );
				}
				if ( $opening_qty > 0 && (int) $clean['track_stock'] ) {
					$this->stock->opening( $ctx, $id, 0, $opening_qty, $opening_cost, Text::date( $data['opening_date'] ?? null ), $clean['name'] );
				}
				$this->audit->log( $ctx, 'create', 'product', $id, 'Product created: ' . $clean['name'] );
				return $id;
			}
		);
		$this->events->dispatch( 'goriber_hisab/product/created', $ctx, $id );
		return $this->get( $ctx, $id );
	}

	/**
	 * @param array<string,mixed> $data Fields.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $id, array $data ): array {
		$ctx->authorize( 'products.edit' );
		$before = $this->findScoped( $ctx, 'products', $id, 'Product' );
		if ( ! $ctx->can( 'products.cost' ) ) {
			unset( $data['purchase_price'] );
		}
		$clean = $this->validate( $ctx, array_merge( $before, $data ), $id );
		if ( (int) $before['track_stock'] && ! (int) $clean['track_stock'] ) {
			$qty = $this->totalQty( $ctx, $id );
			if ( 0 !== $qty ) {
				throw ValidationException::field( 'track_stock', 'Stock tracking can only be turned off when stock is zero.' );
			}
		}
		$clean['updated_by'] = $ctx->user_id;
		$clean['updated_at'] = $this->now();
		$this->db->transaction(
			function () use ( $ctx, $id, $clean, $before ) {
				$this->db->update( $this->db->table( 'products' ), $clean, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
				$this->audit->log( $ctx, 'update', 'product', $id, 'Product updated: ' . $clean['name'], AuditLogger::diff( $before, $clean ) );
			}
		);
		return $this->get( $ctx, $id );
	}

	/**
	 * Soft delete. History (sales, movements) keeps the name snapshot.
	 */
	public function delete( BusinessContext $ctx, int $id ): void {
		$ctx->authorize( 'products.delete' );
		$row = $this->findScoped( $ctx, 'products', $id, 'Product' );
		if ( 0 !== $this->totalQty( $ctx, $id ) ) {
			throw new ConflictException( 'This product still has stock. Adjust stock to zero or mark it inactive instead.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $id, $row ) {
				$this->db->update( $this->db->table( 'products' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
				$this->audit->log( $ctx, 'delete', 'product', $id, 'Product deleted: ' . $row['name'] );
			}
		);
	}

	/* ------------------------------------------------------------------ Variants */

	/**
	 * @return array<int,array<string,mixed>>
	 */
	public function variants( BusinessContext $ctx, int $product_id ): array {
		$vt   = $this->db->table( 'product_variants' );
		$st   = $this->db->table( 'stock_levels' );
		$rows = $this->db->rows(
			"SELECT v.*, (SELECT COALESCE(SUM(s.qty),0) FROM {$st} s WHERE s.business_id = v.business_id AND s.product_id = v.product_id AND s.variant_id = v.id AND s.branch_id = %d) AS stock_qty
			FROM {$vt} v WHERE v.business_id = %d AND v.product_id = %d AND v.deleted_at IS NULL ORDER BY v.id",
			array( $ctx->branch_id, $ctx->business_id, $product_id )
		);
		return array_map( fn( $r ) => $this->presentVariant( $ctx, $r ), $rows );
	}

	/**
	 * @param array<string,mixed> $data name, sku, barcode, attributes{size,color,weight}, purchase_price, selling_price, opening_qty.
	 * @return array<string,mixed>
	 */
	public function saveVariant( BusinessContext $ctx, int $product_id, array $data, int $variant_id = 0 ): array {
		$ctx->authorize( $variant_id ? 'products.edit' : 'products.create' );
		$product = $this->findScoped( $ctx, 'products', $product_id, 'Product' );
		$vt      = $this->db->table( 'product_variants' );
		$attrs   = array();
		foreach ( (array) ( $data['attributes'] ?? array() ) as $k => $v ) {
			$k = Text::key( $k, 30 );
			if ( '' !== $k ) {
				$attrs[ $k ] = Text::line( $v, 60 );
			}
		}
		$name = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			$name = implode( ' / ', array_filter( $attrs ) );
		}
		if ( '' === $name ) {
			throw ValidationException::field( 'name', 'Give the variant a name or attributes (size, colour…).' );
		}
		$sku     = Text::line( $data['sku'] ?? '', 80 );
		$barcode = Text::line( $data['barcode'] ?? '', 80 );
		$this->assertUniqueCodes( $ctx, $sku, $barcode, $product_id, $variant_id );
		$row = array(
			'name'           => $name,
			'sku'            => $sku,
			'barcode'        => $barcode,
			'attributes'     => Json::encode( $attrs ),
			'purchase_price' => Decimal::toString( isset( $data['purchase_price'] ) && '' !== $data['purchase_price'] ? $this->decimalField( $data, 'purchase_price' ) : Decimal::of( $product['purchase_price'] ) ),
			'selling_price'  => Decimal::toString( isset( $data['selling_price'] ) && '' !== $data['selling_price'] ? $this->decimalField( $data, 'selling_price' ) : Decimal::of( $product['selling_price'] ) ),
			'status'         => 'active',
			'updated_by'     => $ctx->user_id,
			'updated_at'     => $this->now(),
		);

		return $this->db->transaction(
			function () use ( $ctx, $product, $product_id, $variant_id, $row, $vt, $data ) {
				if ( $variant_id ) {
					$this->findScoped( $ctx, 'product_variants', $variant_id, 'Variant' );
					$this->db->update( $vt, $row, array( 'id' => $variant_id, 'business_id' => $ctx->business_id ) );
				} else {
					$variant_id = $this->db->insert(
						$vt,
						array_merge(
							$row,
							array(
								'business_id' => $ctx->business_id,
								'product_id'  => $product_id,
								'created_by'  => $ctx->user_id,
								'created_at'  => $this->now(),
							)
						)
					);
					$this->db->update( $this->db->table( 'products' ), array( 'has_variants' => 1 ), array( 'id' => $product_id ) );
					$qty = $this->decimalField( $data, 'opening_qty' );
					if ( $qty > 0 && (int) $product['track_stock'] ) {
						$this->stock->opening( $ctx, $product_id, $variant_id, $qty, Decimal::of( $row['purchase_price'] ), null, $product['name'] . ' - ' . $row['name'] );
					}
				}
				$this->audit->log( $ctx, 'save', 'variant', $variant_id, 'Variant saved: ' . $product['name'] . ' - ' . $row['name'] );
				$v = $this->db->row( "SELECT * FROM {$vt} WHERE id = %d", array( $variant_id ) );
				return $this->presentVariant( $ctx, (array) $v );
			}
		);
	}

	public function deleteVariant( BusinessContext $ctx, int $product_id, int $variant_id ): void {
		$ctx->authorize( 'products.delete' );
		$this->findScoped( $ctx, 'product_variants', $variant_id, 'Variant' );
		$st  = $this->db->table( 'stock_levels' );
		$qty = Decimal::of( $this->db->value( "SELECT COALESCE(SUM(qty),0) FROM {$st} WHERE business_id = %d AND product_id = %d AND variant_id = %d", array( $ctx->business_id, $product_id, $variant_id ) ) );
		if ( 0 !== $qty ) {
			throw new ConflictException( 'This variant still has stock.' );
		}
		$this->db->update( $this->db->table( 'product_variants' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $variant_id, 'business_id' => $ctx->business_id ) );
		$this->audit->log( $ctx, 'delete', 'variant', $variant_id, 'Variant deleted' );
	}

	/**
	 * Validate that a product (and optional variant) can be sold/purchased.
	 *
	 * @return array{product:array<string,mixed>,variant:array<string,mixed>|null}
	 * @throws ValidationException When invalid.
	 */
	public function requireForTransaction( BusinessContext $ctx, int $product_id, int $variant_id, string $field ): array {
		$pt      = $this->db->table( 'products' );
		$product = $product_id > 0 ? $this->db->row( "SELECT * FROM {$pt} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $product_id, $ctx->business_id ) ) : null;
		if ( null === $product ) {
			throw ValidationException::field( $field, 'Select a valid product.' );
		}
		$variant = null;
		if ( $variant_id > 0 ) {
			$vt      = $this->db->table( 'product_variants' );
			$variant = $this->db->row( "SELECT * FROM {$vt} WHERE id = %d AND product_id = %d AND business_id = %d AND deleted_at IS NULL", array( $variant_id, $product_id, $ctx->business_id ) );
			if ( null === $variant ) {
				throw ValidationException::field( $field, 'Select a valid variant.' );
			}
		} elseif ( (int) $product['has_variants'] ) {
			$vt    = $this->db->table( 'product_variants' );
			$count = (int) $this->db->value( "SELECT COUNT(*) FROM {$vt} WHERE product_id = %d AND business_id = %d AND deleted_at IS NULL", array( $product_id, $ctx->business_id ) );
			if ( $count > 0 ) {
				throw ValidationException::field( $field, sprintf( 'Choose a variant of %s.', $product['name'] ) );
			}
		}
		return array( 'product' => $product, 'variant' => $variant );
	}

	/**
	 * EAN-13 style internal barcode ("2" prefix = in-store use).
	 */
	public static function internalBarcode( int $id ): string {
		$body = '2' . str_pad( (string) $id, 11, '0', STR_PAD_LEFT );
		$sum  = 0;
		for ( $i = 0; $i < 12; $i++ ) {
			$sum += (int) $body[ $i ] * ( 0 === $i % 2 ? 1 : 3 );
		}
		return $body . ( ( 10 - $sum % 10 ) % 10 );
	}

	/* ------------------------------------------------------------------ Internals */

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed> Row values.
	 */
	private function validate( BusinessContext $ctx, array $data, int $id = 0 ): array {
		$errors = array();
		$name   = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			$errors['name'] = 'Product name is required.';
		}
		$type = in_array( $data['type'] ?? 'standard', self::TYPES, true ) ? (string) ( $data['type'] ?? 'standard' ) : 'standard';
		$sku  = Text::line( $data['sku'] ?? '', 80 );
		$bar  = Text::line( $data['barcode'] ?? '', 80 );

		$money = array();
		foreach ( array( 'purchase_price', 'selling_price', 'wholesale_price', 'min_selling_price', 'min_stock' ) as $f ) {
			try {
				$money[ $f ] = Decimal::of( $data[ $f ] ?? 0 );
				if ( $money[ $f ] < 0 ) {
					$errors[ $f ] = 'Cannot be negative.';
				}
			} catch ( \InvalidArgumentException $e ) {
				$errors[ $f ] = 'Enter a valid number.';
				$money[ $f ]  = 0;
			}
		}
		if ( $money['min_selling_price'] > 0 && $money['selling_price'] < $money['min_selling_price'] ) {
			$errors['selling_price'] = 'Selling price is below the minimum selling price.';
		}

		$refs = array(
			'category_id' => 'categories',
			'brand_id'    => 'brands',
			'unit_id'     => 'units',
			'tax_rate_id' => 'tax_rates',
			'supplier_id' => 'contacts',
		);
		$ids  = array();
		foreach ( $refs as $field => $table ) {
			$ids[ $field ] = max( 0, (int) ( $data[ $field ] ?? 0 ) );
			if ( $ids[ $field ] > 0 ) {
				$t      = $this->db->table( $table );
				$exists = $this->db->value( "SELECT id FROM {$t} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $ids[ $field ], $ctx->business_id ) );
				if ( ! $exists ) {
					$errors[ $field ] = 'Invalid selection.';
				}
			}
		}

		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$this->assertUniqueCodes( $ctx, $sku, $bar, $id, 0 );

		$attrs = array();
		foreach ( (array) Json::decode( $data['attributes'] ?? null ) as $k => $v ) {
			$k = Text::key( $k, 30 );
			if ( '' !== $k && is_scalar( $v ) ) {
				$attrs[ $k ] = Text::line( $v, 100 );
			}
		}
		$track = 'service' === $type ? 0 : ( Text::bool( $data['track_stock'] ?? true ) ? 1 : 0 );

		return array(
			'type'              => $type,
			'name'              => $name,
			'sku'               => $sku,
			'barcode'           => $bar,
			'category_id'       => $ids['category_id'],
			'brand_id'          => $ids['brand_id'],
			'unit_id'           => $ids['unit_id'],
			'tax_rate_id'       => $ids['tax_rate_id'],
			'supplier_id'       => $ids['supplier_id'],
			'purchase_price'    => Decimal::toString( $money['purchase_price'] ),
			'selling_price'     => Decimal::toString( $money['selling_price'] ),
			'wholesale_price'   => Decimal::toString( $money['wholesale_price'] ),
			'min_selling_price' => Decimal::toString( $money['min_selling_price'] ),
			'min_stock'         => Decimal::toString( $money['min_stock'] ),
			'track_stock'       => $track,
			'track_batch'       => Text::bool( $data['track_batch'] ?? false ) ? 1 : 0,
			'track_expiry'      => Text::bool( $data['track_expiry'] ?? false ) ? 1 : 0,
			'track_serial'      => Text::bool( $data['track_serial'] ?? false ) ? 1 : 0,
			'image_id'          => max( 0, (int) ( $data['image_id'] ?? 0 ) ),
			'description'       => Text::multiline( $data['description'] ?? '' ),
			'attributes'        => $attrs ? Json::encode( $attrs ) : null,
			'status'            => 'inactive' === ( $data['status'] ?? 'active' ) ? 'inactive' : 'active',
		);
	}

	private function assertUniqueCodes( BusinessContext $ctx, string $sku, string $barcode, int $product_id, int $variant_id ): void {
		$pt     = $this->db->table( 'products' );
		$vt     = $this->db->table( 'product_variants' );
		$errors = array();
		foreach ( array( 'sku' => $sku, 'barcode' => $barcode ) as $field => $code ) {
			if ( '' === $code ) {
				continue;
			}
			$p = $this->db->value( "SELECT id FROM {$pt} WHERE business_id = %d AND deleted_at IS NULL AND {$field} = %s AND id <> %d", array( $ctx->business_id, $code, $variant_id ? 0 : $product_id ) );
			$v = $this->db->value( "SELECT id FROM {$vt} WHERE business_id = %d AND deleted_at IS NULL AND {$field} = %s AND id <> %d", array( $ctx->business_id, $code, $variant_id ) );
			if ( $p || $v ) {
				$errors[ $field ] = sprintf( 'This %s is already used by another product.', 'sku' === $field ? 'SKU' : 'barcode' );
			}
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 */
	private function decimalField( array $data, string $field ): int {
		try {
			return Decimal::of( $data[ $field ] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			throw ValidationException::field( $field, 'Enter a valid number.' );
		}
	}

	private function totalQty( BusinessContext $ctx, int $product_id ): int {
		$st = $this->db->table( 'stock_levels' );
		return Decimal::of( $this->db->value( "SELECT COALESCE(SUM(qty),0) FROM {$st} WHERE business_id = %d AND product_id = %d", array( $ctx->business_id, $product_id ) ) );
	}

	/**
	 * @return array<int,array<string,mixed>>
	 */
	private function stockByBranch( BusinessContext $ctx, int $product_id ): array {
		$st   = $this->db->table( 'stock_levels' );
		$bt   = $this->db->table( 'branches' );
		$rows = $this->db->rows(
			"SELECT s.branch_id, b.name AS branch_name, s.variant_id, s.qty, s.value, s.avg_cost FROM {$st} s LEFT JOIN {$bt} b ON b.id = s.branch_id WHERE s.business_id = %d AND s.product_id = %d ORDER BY s.branch_id, s.variant_id",
			array( $ctx->business_id, $product_id )
		);
		if ( ! $ctx->can( 'products.cost' ) ) {
			foreach ( $rows as &$r ) {
				$r['value']    = null;
				$r['avg_cost'] = null;
			}
		}
		return $rows;
	}

	/**
	 * @param array<string,mixed> $row DB row.
	 * @return array<string,mixed>
	 */
	private function present( BusinessContext $ctx, array $row ): array {
		$row['id']           = (int) $row['id'];
		$row['track_stock']  = (bool) (int) $row['track_stock'];
		$row['has_variants'] = (bool) (int) $row['has_variants'];
		$row['attributes']   = Json::decode( $row['attributes'] ?? null );
		foreach ( array( 'category_id', 'brand_id', 'unit_id', 'tax_rate_id', 'supplier_id', 'image_id' ) as $f ) {
			$row[ $f ] = (int) $row[ $f ];
		}
		if ( isset( $row['stock_qty'] ) ) {
			$row['stock_qty'] = Decimal::toString( Decimal::of( $row['stock_qty'] ) );
			$row['is_low']    = $row['track_stock'] && Decimal::of( $row['stock_qty'] ) <= Decimal::of( $row['min_stock'] );
		}
		if ( array_key_exists( 'unit_decimal', $row ) ) {
			$row['unit_decimal'] = (bool) (int) $row['unit_decimal'];
		}
		$row['image_url'] = $row['image_id'] && function_exists( 'wp_get_attachment_image_url' ) ? (string) wp_get_attachment_image_url( $row['image_id'], 'thumbnail' ) : '';
		if ( ! $ctx->can( 'products.cost' ) ) {
			$row['purchase_price'] = null;
		}
		unset( $row['deleted_at'], $row['deleted_by'] );
		return $row;
	}

	/**
	 * @param array<string,mixed> $row Variant row.
	 * @return array<string,mixed>
	 */
	private function presentVariant( BusinessContext $ctx, array $row ): array {
		$row['id']         = (int) $row['id'];
		$row['product_id'] = (int) $row['product_id'];
		$row['attributes'] = Json::decode( $row['attributes'] ?? null );
		if ( isset( $row['stock_qty'] ) ) {
			$row['stock_qty'] = Decimal::toString( Decimal::of( $row['stock_qty'] ) );
		}
		if ( ! $ctx->can( 'products.cost' ) ) {
			$row['purchase_price'] = null;
		}
		unset( $row['deleted_at'], $row['deleted_by'] );
		return $row;
	}
}
