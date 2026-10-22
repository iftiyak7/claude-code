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
		$items = $this->withRecipes( $ctx, array_map( fn( array $r ) => $this->present( $ctx, $r ), $rows ) );
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
		return $this->withRecipes( $ctx, array( $product ) )[0];
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

	/* ------------------------------------------------------------------ Recipes */

	/**
	 * Recipe(s) of a product: what goes into 1 unit, per size (variant_id 0 = all sizes).
	 *
	 * @return array{product_id:int,recipes:array<int,array<string,mixed>>,make_qty:?string}
	 */
	public function recipe( BusinessContext $ctx, int $product_id ): array {
		$ctx->authorize( 'products.view' );
		$product = $this->findScoped( $ctx, 'products', $product_id, 'Product' );
		$rt      = $this->db->table( 'product_recipes' );
		$pt      = $this->db->table( 'products' );
		$vt      = $this->db->table( 'product_variants' );
		$st      = $this->db->table( 'stock_levels' );
		$ut      = $this->db->table( 'units' );
		$rows    = $this->db->rows(
			"SELECT r.variant_id, r.component_id, r.component_variant_id, r.qty, p.name, p.purchase_price, v.name AS variant_name, v.purchase_price AS variant_price, u.short_name AS unit,
				(SELECT s.avg_cost FROM {$st} s WHERE s.business_id = r.business_id AND s.product_id = r.component_id AND s.variant_id = r.component_variant_id AND s.branch_id = %d) AS avg_cost,
				(SELECT COALESCE(SUM(s.qty),0) FROM {$st} s WHERE s.business_id = r.business_id AND s.product_id = r.component_id AND s.variant_id = r.component_variant_id AND s.branch_id = %d) AS stock_qty
			FROM {$rt} r LEFT JOIN {$pt} p ON p.id = r.component_id LEFT JOIN {$vt} v ON v.id = r.component_variant_id LEFT JOIN {$ut} u ON u.id = p.unit_id
			WHERE r.business_id = %d AND r.product_id = %d ORDER BY r.variant_id, r.sort_order, r.id",
			array( $ctx->branch_id, $ctx->branch_id, $ctx->business_id, $product_id )
		);
		$see_cost = $ctx->can( 'products.cost' );
		$recipes  = array();
		foreach ( $rows as $r ) {
			$qty  = Decimal::of( $r['qty'] );
			$avg  = Decimal::of( $r['avg_cost'] ?? 0 );
			$unit = $avg > 0 ? $avg : Decimal::of( (int) $r['component_variant_id'] && null !== $r['variant_price'] ? $r['variant_price'] : $r['purchase_price'] );
			$vid  = (int) $r['variant_id'];
			if ( ! isset( $recipes[ $vid ] ) ) {
				$recipes[ $vid ] = array( 'variant_id' => $vid, 'items' => array(), 'cost' => 0, 'cost_source' => 'ingredients' );
			}
			if ( $unit <= 0 ) {
				$recipes[ $vid ]['cost_source'] = 'unknown'; // No stock bought yet and no purchase price.
			}
			$cost                       = Decimal::mul( $qty, $unit );
			$recipes[ $vid ]['cost']   += $cost;
			$recipes[ $vid ]['items'][] = array(
				'product_id' => (int) $r['component_id'],
				'variant_id' => (int) $r['component_variant_id'],
				'name'       => trim( (string) $r['name'] . ( $r['variant_name'] ? ' - ' . $r['variant_name'] : '' ) ),
				'unit'       => (string) ( $r['unit'] ?? '' ),
				'qty'        => Decimal::toString( $qty ),
				'stock_qty'  => Decimal::toString( Decimal::of( $r['stock_qty'] ) ),
				'unit_cost'  => $see_cost ? Decimal::toString( $unit ) : null,
				'cost'       => $see_cost ? Decimal::toString( $cost ) : null,
			);
		}
		foreach ( $recipes as &$rec ) {
			if ( 'unknown' === $rec['cost_source'] && $rec['variant_id'] > 0 ) {
				// Until the loose stock has a cost, the packed bottles' own average shows what one costs.
				$packed = Decimal::of( $this->db->value( "SELECT avg_cost FROM {$st} WHERE business_id = %d AND product_id = %d AND variant_id = %d AND branch_id = %d", array( $ctx->business_id, $product_id, $rec['variant_id'], $ctx->branch_id ) ) ?? 0 );
				if ( $packed <= 0 ) {
					$packed = Decimal::of( $this->db->value( "SELECT purchase_price FROM {$vt} WHERE id = %d", array( $rec['variant_id'] ) ) ?? 0 );
				}
				if ( $packed > 0 ) {
					$rec['cost']        = $packed;
					$rec['cost_source'] = 'packed';
				}
			}
			$rec['cost'] = $see_cost && 'unknown' !== $rec['cost_source'] ? Decimal::toString( $rec['cost'] ) : null;
		}
		unset( $rec );
		$make = $this->stock->makeable( $ctx, array( $product_id ) );
		return array(
			'product_id' => $product_id,
			'name'       => (string) $product['name'],
			// pack = packed ahead, own stock (packed units sell first); sale = made when sold.
			'mode'       => (int) $product['track_stock'] ? 'pack' : 'sale',
			'recipes'    => array_values( $recipes ),
			'make_qty'   => $make[ $product_id ] ?? null,
		);
	}

	/**
	 * Replace the recipe of a product (or one of its sizes).
	 * A product with a recipe keeps no stock of its own: it is made when sold.
	 *
	 * @param array<string,mixed> $data variant_id, items[{product_id,variant_id,qty}].
	 * @return array<string,mixed> See recipe().
	 */
	public function saveRecipe( BusinessContext $ctx, int $product_id, array $data ): array {
		$ctx->authorize( 'products.edit' );
		$product    = $this->findScoped( $ctx, 'products', $product_id, 'Product' );
		$variant_id = (int) ( $data['variant_id'] ?? 0 );
		if ( 'service' === $product['type'] ) {
			throw ValidationException::field( 'items', 'A service cannot have a recipe.' );
		}
		if ( $variant_id > 0 ) {
			$vt = $this->db->table( 'product_variants' );
			if ( ! $this->db->value( "SELECT id FROM {$vt} WHERE id = %d AND product_id = %d AND business_id = %d AND deleted_at IS NULL", array( $variant_id, $product_id, $ctx->business_id ) ) ) {
				throw ValidationException::field( 'variant_id', 'Select a valid variant.' );
			}
		}
		$rt     = $this->db->table( 'product_recipes' );
		$pt     = $this->db->table( 'products' );
		$items  = array();
		$errors = array();
		$seen   = array();
		$self   = false;
		foreach ( array_values( (array) ( $data['items'] ?? array() ) ) as $i => $c ) {
			$cid = (int) ( $c['product_id'] ?? 0 );
			$cvid = (int) ( $c['variant_id'] ?? 0 );
			if ( $cid <= 0 ) {
				continue;
			}
			try {
				$qty = Decimal::of( $c['qty'] ?? 0 );
			} catch ( \InvalidArgumentException $e ) {
				$qty = 0;
			}
			if ( $qty <= 0 ) {
				$errors[ "items.{$i}.qty" ] = 'Enter how much is used.';
				continue;
			}
			if ( $cid === $product_id ) {
				// A size packed from the product's own loose stock (honey 500 g from the loose kg).
				if ( $variant_id > 0 && 0 === $cvid ) {
					$self = true;
					if ( ! isset( $seen[ $cid . ':0' ] ) ) {
						$seen[ $cid . ':0' ] = count( $items );
						$items[]             = array( 'component_id' => $cid, 'component_variant_id' => 0, 'qty' => $qty );
					}
					continue;
				}
				$errors[ "items.{$i}.product_id" ] = 'A product cannot be made from itself.';
				continue;
			}
			$comp = $this->db->row( "SELECT id, name, type, track_stock, has_variants FROM {$pt} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $cid, $ctx->business_id ) );
			if ( null === $comp ) {
				$errors[ "items.{$i}.product_id" ] = 'Select a valid product.';
				continue;
			}
			// Products made when sold keep no stock and are refused below; packed-ahead ones are plain stock.
			if ( ! (int) $comp['track_stock'] ) {
				$errors[ "items.{$i}.product_id" ] = 'This product does not keep stock, so it cannot be an ingredient.';
				continue;
			}
			try {
				$this->requireForTransaction( $ctx, $cid, $cvid, "items.{$i}.product_id" );
			} catch ( ValidationException $e ) {
				$errors = array_merge( $errors, $e->errors() );
				continue;
			}
			$key = $cid . ':' . $cvid;
			if ( isset( $seen[ $key ] ) ) {
				$items[ $seen[ $key ] ]['qty'] += $qty;
				continue;
			}
			$seen[ $key ] = count( $items );
			$items[]      = array( 'component_id' => $cid, 'component_variant_id' => $cvid, 'qty' => $qty );
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$had  = (int) $this->db->value( "SELECT COUNT(*) FROM {$rt} WHERE business_id = %d AND product_id = %d", array( $ctx->business_id, $product_id ) ) > 0;
		$mode = (string) ( $data['mode'] ?? ( $had && (int) $product['track_stock'] ? 'pack' : 'sale' ) );
		$mode = 'pack' === $mode ? 'pack' : 'sale';
		if ( $self ) {
			$mode = 'pack'; // Packed from its own loose stock: that stock has to stay counted.
		}
		if ( $items && 'sale' === $mode && (int) $product['track_stock'] && 0 !== $this->totalQty( $ctx, $product_id ) ) {
			throw ValidationException::field( 'mode', 'This product still has packed stock. Choose "I pack some ahead", or set its stock to zero first.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $product_id, $variant_id, $items, $rt, $product, $mode ) {
				$this->db->execute( "DELETE FROM {$rt} WHERE business_id = %d AND product_id = %d AND variant_id = %d", array( $ctx->business_id, $product_id, $variant_id ) );
				foreach ( $items as $n => $c ) {
					$this->db->insert(
						$rt,
						array(
							'business_id'          => $ctx->business_id,
							'product_id'           => $product_id,
							'variant_id'           => $variant_id,
							'component_id'         => $c['component_id'],
							'component_variant_id' => $c['component_variant_id'],
							'qty'                  => Decimal::toString( $c['qty'] ),
							'sort_order'           => $n,
						)
					);
				}
				$track = 'pack' === $mode ? 1 : 0;
				if ( $items && (int) $product['track_stock'] !== $track ) {
					$this->db->update( $this->db->table( 'products' ), array( 'track_stock' => $track, 'updated_at' => $this->now(), 'updated_by' => $ctx->user_id ), array( 'id' => $product_id, 'business_id' => $ctx->business_id ) );
				}
				$this->audit->log( $ctx, 'update', 'product', $product_id, ( $items ? 'Recipe saved: ' : 'Recipe removed: ' ) . $product['name'] );
			}
		);
		$saved = $this->recipe( $ctx, $product_id );
		// Keep the reference purchase price in line with what the ingredients cost today.
		foreach ( $saved['recipes'] as $r ) {
			if ( (int) $r['variant_id'] === $variant_id && 'ingredients' === $r['cost_source'] && Decimal::of( $r['cost'] ?? 0 ) > 0 ) {
				$table = $variant_id ? 'product_variants' : 'products';
				$id    = $variant_id ? $variant_id : $product_id;
				$this->db->update( $this->db->table( $table ), array( 'purchase_price' => $r['cost'] ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
			}
		}
		return $saved;
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
		$vt = $this->db->table( 'product_variants' );
		$this->db->update( $vt, array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $variant_id, 'business_id' => $ctx->business_id ) );
		// Last size gone: the product sells as one item again.
		if ( ! (int) $this->db->value( "SELECT COUNT(*) FROM {$vt} WHERE business_id = %d AND product_id = %d AND deleted_at IS NULL", array( $ctx->business_id, $product_id ) ) ) {
			$this->db->update( $this->db->table( 'products' ), array( 'has_variants' => 0 ), array( 'id' => $product_id, 'business_id' => $ctx->business_id ) );
		}
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
		} elseif ( (int) $product['has_variants'] && ! $this->packsFromOwnLoose( $ctx, $product_id ) ) {
			$vt    = $this->db->table( 'product_variants' );
			$count = (int) $this->db->value( "SELECT COUNT(*) FROM {$vt} WHERE product_id = %d AND business_id = %d AND deleted_at IS NULL", array( $product_id, $ctx->business_id ) );
			if ( $count > 0 ) {
				throw ValidationException::field( $field, sprintf( 'Choose a variant of %s.', $product['name'] ) );
			}
		}
		return array( 'product' => $product, 'variant' => $variant );
	}

	/**
	 * Give every product and variant without a barcode its own in-store code.
	 *
	 * @param int[] $ids Limit to these products (empty = whole catalogue).
	 * @return array{products:int,variants:int}
	 */
	public function generateBarcodes( BusinessContext $ctx, array $ids = array() ): array {
		$ctx->authorize( 'products.edit' );
		$pt   = $this->db->table( 'products' );
		$vt   = $this->db->table( 'product_variants' );
		$ids  = array_values( array_filter( array_map( 'intval', $ids ) ) );
		$only = $ids ? ' AND product_id IN (' . implode( ',', $ids ) . ')' : '';
		$done = array( 'products' => 0, 'variants' => 0 );
		$this->db->transaction(
			function () use ( $ctx, $pt, $vt, $ids, $only, &$done ) {
				$pids = $this->db->rows(
					"SELECT id FROM {$pt} WHERE business_id = %d AND deleted_at IS NULL AND (barcode IS NULL OR barcode = '')" . ( $ids ? ' AND id IN (' . implode( ',', $ids ) . ')' : '' ),
					array( $ctx->business_id )
				);
				foreach ( $pids as $r ) {
					$this->db->update( $pt, array( 'barcode' => self::internalBarcode( (int) $r['id'] ) ), array( 'id' => (int) $r['id'], 'business_id' => $ctx->business_id ) );
					++$done['products'];
				}
				$vids = $this->db->rows(
					"SELECT id FROM {$vt} WHERE business_id = %d AND deleted_at IS NULL AND (barcode IS NULL OR barcode = ''){$only}",
					array( $ctx->business_id )
				);
				foreach ( $vids as $r ) {
					$this->db->update( $vt, array( 'barcode' => self::internalBarcode( (int) $r['id'], '29' ) ), array( 'id' => (int) $r['id'], 'business_id' => $ctx->business_id ) );
					++$done['variants'];
				}
				if ( $done['products'] || $done['variants'] ) {
					$this->audit->log( $ctx, 'update', 'product', 0, sprintf( 'Barcodes generated for %d products and %d variants', $done['products'], $done['variants'] ) );
				}
			}
		);
		return $done;
	}

	/**
	 * What to print on labels: one row per product, or per variant when it has them.
	 *
	 * @param int[] $ids Product ids.
	 * @return array<int,array<string,mixed>>
	 */
	public function labelItems( BusinessContext $ctx, array $ids ): array {
		$ctx->authorize( 'products.view' );
		$ids = array_slice( array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) ), 0, 300 );
		if ( ! $ids ) {
			return array();
		}
		$pt    = $this->db->table( 'products' );
		$vt    = $this->db->table( 'product_variants' );
		$in    = implode( ',', $ids );
		$rows  = $this->db->rows( "SELECT id, name, sku, barcode, selling_price, has_variants FROM {$pt} WHERE business_id = %d AND deleted_at IS NULL AND id IN ({$in})", array( $ctx->business_id ) );
		$vars  = $this->db->rows( "SELECT id, product_id, name, sku, barcode, selling_price FROM {$vt} WHERE business_id = %d AND deleted_at IS NULL AND product_id IN ({$in}) ORDER BY id", array( $ctx->business_id ) );
		$by    = array();
		foreach ( $vars as $v ) {
			$by[ (int) $v['product_id'] ][] = $v;
		}
		$order = array_flip( $ids );
		usort( $rows, static fn( $a, $b ) => $order[ (int) $a['id'] ] <=> $order[ (int) $b['id'] ] );
		$out = array();
		foreach ( $rows as $p ) {
			$pid = (int) $p['id'];
			if ( ! empty( $by[ $pid ] ) ) {
				foreach ( $by[ $pid ] as $v ) {
					$price = Decimal::of( $v['selling_price'] ?? 0 ) > 0 ? $v['selling_price'] : $p['selling_price'];
					$out[] = array(
						'product_id' => $pid,
						'variant_id' => (int) $v['id'],
						'name'       => $p['name'] . ' — ' . $v['name'],
						'code'       => (string) ( $v['barcode'] ?: $v['sku'] ?: '' ),
						'price'      => Decimal::toString( Decimal::of( $price ) ),
					);
				}
				continue;
			}
			$out[] = array(
				'product_id' => $pid,
				'variant_id' => 0,
				'name'       => $p['name'],
				'code'       => (string) ( $p['barcode'] ?: $p['sku'] ?: '' ),
				'price'      => Decimal::toString( Decimal::of( $p['selling_price'] ) ),
			);
		}
		return $out;
	}

	/**
	 * EAN-13 style internal barcode ("2" prefix = in-store use; "29" for variants).
	 */
	public static function internalBarcode( int $id, string $prefix = '2' ): string {
		$body = $prefix . str_pad( (string) $id, 12 - strlen( $prefix ), '0', STR_PAD_LEFT );
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

	/**
	 * Sizes of this product are packed from its own loose (size-less) stock.
	 */
	private function packsFromOwnLoose( BusinessContext $ctx, int $product_id ): bool {
		$rt = $this->db->table( 'product_recipes' );
		return (int) $this->db->value( "SELECT COUNT(*) FROM {$rt} WHERE business_id = %d AND product_id = %d AND component_id = %d AND component_variant_id = 0", array( $ctx->business_id, $product_id, $product_id ) ) > 0;
	}

	/**
	 * Mark recipe products and how many the ingredients in stock can make.
	 *
	 * @param array<int,array<string,mixed>> $items Presented products.
	 * @return array<int,array<string,mixed>>
	 */
	private function withRecipes( BusinessContext $ctx, array $items ): array {
		$ids = array_map( static fn( $p ) => (int) $p['id'], $items );
		$has = array();
		if ( $ids ) {
			$rt  = $this->db->table( 'product_recipes' );
			$has = array_flip( array_map( 'intval', $this->db->column( "SELECT DISTINCT product_id FROM {$rt} WHERE business_id = %d AND product_id IN (" . implode( ',', $ids ) . ')', array( $ctx->business_id ) ) ) );
		}
		$make  = $has ? $this->stock->makeable( $ctx, array_keys( $has ) ) : array();
		$loose = $has ? array_flip( array_map( 'intval', $this->db->column( "SELECT DISTINCT product_id FROM {$rt} WHERE business_id = %d AND component_id = product_id AND product_id IN (" . implode( ',', array_keys( $has ) ) . ')', array( $ctx->business_id ) ) ) ) : array();
		foreach ( $items as &$p ) {
			$p['has_recipe'] = isset( $has[ (int) $p['id'] ] );
			$p['make_qty']   = $make[ (int) $p['id'] ] ?? null;
			// Sizes packed from the product's own loose stock: that loose stock can be sold too.
			$p['loose_base'] = isset( $loose[ (int) $p['id'] ] );
			$p['loose_qty']  = $p['loose_base'] ? Decimal::toString( $this->stock->onHand( $ctx, (int) $p['id'], 0 ) ) : null;
		}
		unset( $p );
		return $items;
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
