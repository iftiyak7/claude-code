<?php
/**
 * Perpetual inventory.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Inventory;

use GoriberHisab\Accounting\JournalService;
use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * The only writer of stock_levels and stock_movements.
 *
 * Costing is weighted average per branch + product + variant:
 *  - in():  value += given value; qty += q
 *  - out(): cost = q × avg (or the whole remaining value when emptying)
 *
 * Every change records a movement with before/after quantities so the
 * history always explains the current level.
 */
final class StockService extends Service {

	private SettingsService $settings;
	private JournalService $journal;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, SettingsService $settings, JournalService $journal, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
		$this->journal  = $journal;
		$this->audit    = $audit;
	}

	/**
	 * Add stock.
	 *
	 * @param array{product_id:int,variant_id?:int,qty:int,value:int} $item  Scaled qty and total value.
	 * @param array<string,mixed>                                      $meta  type, date, reference_type, reference_id, reference_no, note, branch_id.
	 * @return array{qty_after:int,value:int}
	 */
	public function in( BusinessContext $ctx, array $item, array $meta ): array {
		if ( $item['qty'] <= 0 ) {
			throw new \LogicException( 'Stock in requires a positive quantity.' );
		}
		return $this->db->transaction(
			function () use ( $ctx, $item, $meta ) {
				$branch = (int) ( $meta['branch_id'] ?? $ctx->branch_id );
				$level  = $this->lock( $ctx, $branch, (int) $item['product_id'], (int) ( $item['variant_id'] ?? 0 ) );
				$qty    = Decimal::of( $level['qty'] );
				$value  = Decimal::of( $level['value'] );
				$avg    = Decimal::of( $level['avg_cost'] );

				$new_qty   = $qty + $item['qty'];
				$new_value = $value + $item['value'];
				$unit      = Decimal::div( $item['value'], $item['qty'] );
				$new_avg   = $new_qty > 0 ? Decimal::div( $new_value, $new_qty ) : ( $avg > 0 ? $avg : $unit );

				$this->save( $level, $new_qty, $new_value, $new_avg );
				$this->record( $ctx, $branch, $item, $meta, $item['qty'], $unit, $item['value'], $qty, $new_qty );
				$this->events->dispatch( 'goriber_hisab/stock/changed', $ctx, (int) $item['product_id'], $new_qty, $branch );

				return array(
					'qty_after' => $new_qty,
					'value'     => $item['value'],
				);
			}
		);
	}

	/**
	 * Remove stock.
	 *
	 * @param array{product_id:int,variant_id?:int,qty:int,value?:int} $item Optional explicit value (voids).
	 * @param array<string,mixed>                                         $meta See in().
	 * @return array{cost:int,variance:int,unit_cost:int,qty_after:int}
	 *         cost = value taken off the inventory account;
	 *         variance = requested explicit value − cost (to post to adjustments).
	 * @throws ValidationException When stock is insufficient and negatives are not allowed.
	 */
	public function out( BusinessContext $ctx, array $item, array $meta ): array {
		if ( $item['qty'] <= 0 ) {
			throw new \LogicException( 'Stock out requires a positive quantity.' );
		}
		return $this->db->transaction(
			function () use ( $ctx, $item, $meta ) {
				$branch = (int) ( $meta['branch_id'] ?? $ctx->branch_id );
				$level  = $this->lock( $ctx, $branch, (int) $item['product_id'], (int) ( $item['variant_id'] ?? 0 ) );
				$qty    = Decimal::of( $level['qty'] );
				$value  = Decimal::of( $level['value'] );
				$avg    = Decimal::of( $level['avg_cost'] );

				$new_qty = $qty - $item['qty'];
				if ( $new_qty < 0 && ! $this->settings->all( $ctx )['inventory.allow_negative'] ) {
					$name = (string) ( $meta['product_name'] ?? ( '#' . $item['product_id'] ) );
					throw ValidationException::field(
						(string) ( $meta['field'] ?? 'items' ),
						sprintf( 'Not enough stock for %1$s: available %2$s, required %3$s.', $name, Decimal::toString( $qty, 2 ), Decimal::toString( $item['qty'], 2 ) )
					);
				}

				$requested = isset( $item['value'] ) ? (int) $item['value'] : null;
				if ( 0 === $new_qty ) {
					$cost = $value; // Emptying: take exactly what is left.
				} elseif ( null !== $requested && $new_qty > 0 ) {
					$cost = $requested;
				} else {
					$cost = Decimal::mul( $item['qty'], $avg );
				}
				$variance  = null !== $requested ? $requested - $cost : 0;
				$new_value = $value - $cost;
				if ( $new_qty < 0 ) {
					$new_value = Decimal::mul( $new_qty, $avg );
					$cost      = $value - $new_value;
					$variance  = null !== $requested ? $requested - $cost : 0;
				}
				$new_avg = $new_qty > 0 ? Decimal::div( $new_value, $new_qty ) : $avg;

				$this->save( $level, $new_qty, $new_value, $new_avg );
				$unit = Decimal::div( $cost, $item['qty'] );
				$this->record( $ctx, $branch, $item, $meta, -$item['qty'], $unit, -$cost, $qty, $new_qty );

				$this->events->dispatch( 'goriber_hisab/stock/changed', $ctx, (int) $item['product_id'], $new_qty, $branch );
				$this->checkLow( $ctx, (int) $item['product_id'], $qty, $new_qty, $branch );

				return array(
					'cost'      => $cost,
					'variance'  => $variance,
					'unit_cost' => $unit,
					'qty_after' => $new_qty,
				);
			}
		);
	}

	/* ------------------------------------------------------------------ Recipes */

	/**
	 * Recipe of a product made at the moment of sale: the size's own recipe,
	 * else the product's general one. Quantities are per 1 unit sold.
	 *
	 * @return array<int,array{product_id:int,variant_id:int,qty:int,name:string}>
	 */
	public function recipe( BusinessContext $ctx, int $product_id, int $variant_id = 0 ): array {
		$rt   = $this->db->table( 'product_recipes' );
		$pt   = $this->db->table( 'products' );
		$vt   = $this->db->table( 'product_variants' );
		$rows = $this->db->rows(
			"SELECT r.variant_id AS for_variant, r.component_id, r.component_variant_id, r.qty, p.name, v.name AS variant_name
			FROM {$rt} r LEFT JOIN {$pt} p ON p.id = r.component_id LEFT JOIN {$vt} v ON v.id = r.component_variant_id
			WHERE r.business_id = %d AND r.product_id = %d AND r.variant_id IN (0, %d) ORDER BY r.sort_order, r.id",
			array( $ctx->business_id, $product_id, $variant_id )
		);
		$own = array_filter( $rows, static fn( $r ) => $variant_id > 0 && (int) $r['for_variant'] === $variant_id );
		$use = $own ? $own : array_filter( $rows, static fn( $r ) => 0 === (int) $r['for_variant'] );
		$out = array();
		foreach ( $use as $r ) {
			$out[] = array(
				'product_id' => (int) $r['component_id'],
				'variant_id' => (int) $r['component_variant_id'],
				'qty'        => Decimal::of( $r['qty'] ),
				'name'       => trim( (string) $r['name'] . ( $r['variant_name'] ? ' - ' . $r['variant_name'] : '' ) ),
			);
		}
		return $out;
	}

	/**
	 * Take the ingredients of $qty units of a recipe product out of stock.
	 * Their real (average purchase) cost becomes the cost of the sale line.
	 *
	 * @param array<int,array<string,mixed>> $recipe From recipe().
	 * @param array<string,mixed>            $meta   See out(); product_name is the sold product.
	 * @return array{cost:int,components:array<int,array<string,mixed>>}
	 */
	public function consumeRecipe( BusinessContext $ctx, array $recipe, int $qty, array $meta ): array {
		$cost       = 0;
		$components = array();
		foreach ( $recipe as $c ) {
			$need = Decimal::mul( $c['qty'], $qty );
			if ( $need <= 0 ) {
				continue;
			}
			$res = $this->out(
				$ctx,
				array( 'product_id' => $c['product_id'], 'variant_id' => $c['variant_id'], 'qty' => $need ),
				array_merge( $meta, array( 'product_name' => $c['name'], 'note' => trim( 'Used in ' . ( $meta['product_name'] ?? '' ) ) ) )
			);
			$cost        += $res['cost'];
			$components[] = array(
				'product_id' => $c['product_id'],
				'variant_id' => $c['variant_id'],
				'name'       => $c['name'],
				'qty'        => Decimal::toString( $need ),
				'cost'       => Decimal::toString( $res['cost'] ),
			);
		}
		return array( 'cost' => $cost, 'components' => $components );
	}

	/**
	 * Share of used ingredients for part of a line (returns): qty and cost
	 * scaled by $part / $whole, with the cost shares adding up to $cost.
	 *
	 * @param array<int,array<string,mixed>> $components Stored components.
	 * @return array<int,array<string,mixed>>
	 */
	public static function shareComponents( array $components, int $part, int $whole, int $cost ): array {
		$out  = array();
		$left = $cost;
		$n    = count( $components );
		foreach ( array_values( $components ) as $i => $c ) {
			$qty  = $whole > 0 ? (int) round( Decimal::of( $c['qty'] ) * $part / $whole ) : 0;
			$val  = $i === $n - 1 ? $left : ( $whole > 0 ? (int) round( Decimal::of( $c['cost'] ) * $part / $whole ) : 0 );
			$left -= $val;
			$out[] = array_merge( $c, array( 'qty' => Decimal::toString( $qty ), 'cost' => Decimal::toString( $val ) ) );
		}
		return $out;
	}

	/**
	 * Move stored ingredients back in (void/return) or out again (undoing that).
	 *
	 * @param array<int,array<string,mixed>> $components Stored components.
	 * @param string                         $direction  in|out.
	 * @return int Variance (out only): stored value − value taken off.
	 */
	public function moveComponents( BusinessContext $ctx, array $components, string $direction, array $meta ): int {
		$variance = 0;
		foreach ( $components as $c ) {
			$qty = Decimal::of( $c['qty'] );
			if ( $qty <= 0 ) {
				continue;
			}
			$item = array( 'product_id' => (int) $c['product_id'], 'variant_id' => (int) $c['variant_id'], 'qty' => $qty, 'value' => Decimal::of( $c['cost'] ) );
			$m    = array_merge( $meta, array( 'product_name' => (string) $c['name'] ) );
			if ( 'in' === $direction ) {
				$this->in( $ctx, $item, $m );
			} else {
				$variance += $this->out( $ctx, $item, $m )['variance'];
			}
		}
		return $variance;
	}

	/**
	 * How many units of each recipe product the ingredients in stock can make.
	 *
	 * @param int[] $product_ids Products to check.
	 * @return array<int,string> product_id => qty (only products with a recipe).
	 */
	public function makeable( BusinessContext $ctx, array $product_ids, int $branch_id = 0 ): array {
		$product_ids = array_values( array_filter( array_map( 'intval', $product_ids ) ) );
		if ( ! $product_ids ) {
			return array();
		}
		$branch = $branch_id ?: $ctx->branch_id;
		$rt     = $this->db->table( 'product_recipes' );
		$st     = $this->db->table( 'stock_levels' );
		$in     = implode( ',', $product_ids );
		$rows   = $this->db->rows(
			"SELECT r.product_id, r.qty, COALESCE((SELECT SUM(s.qty) FROM {$st} s WHERE s.business_id = r.business_id AND s.product_id = r.component_id AND s.variant_id = r.component_variant_id AND s.branch_id = %d),0) AS have
			FROM {$rt} r WHERE r.business_id = %d AND r.variant_id = 0 AND r.product_id IN ({$in})",
			array( $branch, $ctx->business_id )
		);
		$can = array();
		foreach ( $rows as $r ) {
			$need = Decimal::of( $r['qty'] );
			$have = max( 0, Decimal::of( $r['have'] ) );
			$n    = $need > 0 ? intdiv( $have, $need ) : 0;
			$pid  = (int) $r['product_id'];
			$can[ $pid ] = isset( $can[ $pid ] ) ? min( $can[ $pid ], $n ) : $n;
		}
		return array_map( static fn( $n ) => (string) $n, $can );
	}

	/**
	 * Stock lights: red (about to run out), yellow (getting low), green (fine).
	 * Red = at or below the shop's red mark or the product's own minimum;
	 * yellow = at or below the yellow mark; everything above is green.
	 *
	 * @param array<string,mixed> $args level (red|yellow|green), search, branch_id, limit.
	 * @return array{marks:array{red:string,yellow:string},counts:array<string,int>,items:array<int,array<string,mixed>>}
	 */
	public function lights( BusinessContext $ctx, array $args = array() ): array {
		if ( ! $ctx->can( 'inventory.view' ) && ! $ctx->can( 'products.view' ) && ! $ctx->can( 'dashboard.view' ) ) {
			throw new \GoriberHisab\Support\PermissionException( 'You do not have access to stock.' );
		}
		$s      = $this->settings->all( $ctx );
		$red    = Decimal::of( max( 0, (int) $s['inventory.stock_red'] ) );
		$yellow = Decimal::of( max( (int) $s['inventory.stock_red'], (int) $s['inventory.stock_yellow'] ) );
		$branch = (int) ( $args['branch_id'] ?? 0 );
		$pt     = $this->db->table( 'products' );
		$st     = $this->db->table( 'stock_levels' );
		$ut     = $this->db->table( 'units' );
		$scope  = $branch > 0 && $ctx->canAccessBranch( $branch ) ? ' AND s.branch_id = ' . $branch : '';
		$where  = "p.business_id = %d AND p.deleted_at IS NULL AND p.track_stock = 1 AND p.status = 'active'";
		$params = array( $ctx->business_id );
		$search = Text::line( $args['search'] ?? '', 100 );
		if ( '' !== $search ) {
			$where   .= ' AND (p.name LIKE %s OR p.sku LIKE %s OR p.barcode LIKE %s)';
			$like     = '%' . $this->db->escapeLike( $search ) . '%';
			$params   = array_merge( $params, array( $like, $like, $like ) );
		}
		$rows = $this->db->rows(
			"SELECT p.id, p.name, p.sku, p.min_stock, p.image_id, u.short_name AS unit,
				COALESCE((SELECT SUM(s.qty) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id{$scope}),0) AS qty
			FROM {$pt} p LEFT JOIN {$ut} u ON u.id = p.unit_id WHERE {$where} ORDER BY qty ASC, p.name",
			$params
		);
		$counts = array( 'red' => 0, 'yellow' => 0, 'green' => 0 );
		$want   = (string) ( $args['level'] ?? '' );
		$limit  = max( 1, min( 2000, (int) ( $args['limit'] ?? 500 ) ) );
		$items  = array();
		foreach ( $rows as $r ) {
			$qty   = Decimal::of( $r['qty'] );
			$min   = Decimal::of( $r['min_stock'] );
			$level = ( $qty <= $red || ( $min > 0 && $qty <= $min ) ) ? 'red' : ( $qty <= $yellow ? 'yellow' : 'green' );
			++$counts[ $level ];
			if ( ( '' === $want || $want === $level ) && count( $items ) < $limit ) {
				$items[] = array(
					'id'        => (int) $r['id'],
					'name'      => (string) $r['name'],
					'sku'       => (string) $r['sku'],
					'unit'      => (string) ( $r['unit'] ?? '' ),
					'qty'       => Decimal::toString( $qty ),
					'min_stock' => Decimal::toString( $min ),
					'level'     => $level,
				);
			}
		}
		return array(
			'marks'  => array(
				'red'    => Decimal::toString( $red ),
				'yellow' => Decimal::toString( $yellow ),
			),
			'counts' => $counts,
			'items'  => $items,
		);
	}

	/**
	 * A stock adjustment as booked: what kind it is, the movement behind it, and
	 * what can still be done with it.
	 *
	 * @return array<string,mixed>
	 */
	public function adjustmentInfo( BusinessContext $ctx, int $entry_id ): array {
		$ctx->authorize( 'inventory.view' );
		$et    = $this->db->table( 'journal_entries' );
		$lt    = $this->db->table( 'journal_lines' );
		$at    = $this->db->table( 'accounts' );
		$entry = $this->db->row( "SELECT * FROM {$et} WHERE id = %d AND business_id = %d", array( $entry_id, $ctx->business_id ) );
		if ( null === $entry || 'stock_adjustment' !== $entry['source'] ) {
			throw new \GoriberHisab\Support\NotFoundException( 'Stock adjustment not found.' );
		}
		$lines = $this->db->rows( "SELECT l.*, a.system_key FROM {$lt} l JOIN {$at} a ON a.id = l.account_id WHERE l.entry_id = %d AND l.business_id = %d", array( $entry_id, $ctx->business_id ) );
		$kind  = 'loss';
		foreach ( $lines as $l ) {
			if ( Decimal::of( $l['credit'] ) > 0 && 'opening_balance' === $l['system_key'] ) {
				$kind = 'opening';
			} elseif ( Decimal::of( $l['credit'] ) > 0 && 'inventory_adjustment' === $l['system_key'] ) {
				$kind = 'gain';
			}
		}
		$mv = $this->movementFor( $ctx, $entry );
		return array(
			'id'         => (int) $entry['id'],
			'date'       => (string) $entry['entry_date'],
			'memo'       => (string) $entry['memo'],
			'amount'     => Decimal::toString( Decimal::of( $entry['total'] ) ),
			'kind'       => $kind,
			'product_id' => (int) $entry['source_id'],
			'qty'        => $mv ? Decimal::toString( Decimal::of( $mv['qty'] ) ) : null,
			'voided'     => (bool) (int) $entry['is_reversed'] || (bool) (int) $entry['is_reversal'],
		);
	}

	/**
	 * Stock that was really already in the shop (forgot the opening stock):
	 * book it to opening balance instead of profit — or the other way round.
	 *
	 * @return array<string,mixed>
	 */
	public function reclassifyAdjustment( BusinessContext $ctx, int $entry_id, string $to ): array {
		$ctx->authorize( 'inventory.adjust' );
		$info = $this->adjustmentInfo( $ctx, $entry_id );
		if ( $info['voided'] ) {
			throw new ConflictException( 'This adjustment was cancelled.' );
		}
		if ( 'loss' === $info['kind'] ) {
			throw new ConflictException( 'Only a stock increase can be changed this way.' );
		}
		$this->assertOpenPeriod( $ctx, $info['date'] );
		$to = 'opening' === $to ? 'opening' : 'gain';
		if ( $to === $info['kind'] ) {
			return $info;
		}
		$at   = $this->db->table( 'accounts' );
		$lt   = $this->db->table( 'journal_lines' );
		$from = (int) $this->db->value( "SELECT id FROM {$at} WHERE business_id = %d AND system_key = %s", array( $ctx->business_id, 'opening' === $to ? 'inventory_adjustment' : 'opening_balance' ) );
		$into = (int) $this->db->value( "SELECT id FROM {$at} WHERE business_id = %d AND system_key = %s", array( $ctx->business_id, 'opening' === $to ? 'opening_balance' : 'inventory_adjustment' ) );
		$this->db->execute( "UPDATE {$lt} SET account_id = %d WHERE entry_id = %d AND business_id = %d AND account_id = %d AND credit > 0", array( $into, $entry_id, $ctx->business_id, $from ) );
		$this->audit->log( $ctx, 'update', 'stock', $info['product_id'], 'opening' === $to ? 'Stock adjustment #' . $entry_id . ' booked as stock already in hand (not profit)' : 'Stock adjustment #' . $entry_id . ' booked as a stock gain' );
		return $this->adjustmentInfo( $ctx, $entry_id );
	}

	/**
	 * Cancel an adjustment: the stock goes back and the entry is reversed.
	 *
	 * @return array<string,mixed>
	 */
	public function voidAdjustment( BusinessContext $ctx, int $entry_id ): array {
		$ctx->authorize( 'inventory.adjust' );
		$info = $this->adjustmentInfo( $ctx, $entry_id );
		if ( $info['voided'] ) {
			throw new ConflictException( 'This adjustment was already cancelled.' );
		}
		$et    = $this->db->table( 'journal_entries' );
		$entry = (array) $this->db->row( "SELECT * FROM {$et} WHERE id = %d", array( $entry_id ) );
		$mv    = $this->movementFor( $ctx, $entry );
		if ( null === $mv ) {
			throw new ConflictException( 'The stock movement of this adjustment was not found, so it cannot be cancelled automatically. Make an opposite stock adjustment instead.' );
		}
		$qty   = Decimal::of( $mv['qty'] );
		$value = Decimal::of( $entry['total'] );
		$this->db->transaction(
			function () use ( $ctx, $mv, $qty, $value, $entry_id, $info ) {
				$meta = array(
					'type'           => 'adjustment',
					'reference_type' => 'adjustment_void',
					'reference_id'   => $entry_id,
					'note'           => 'Cancelled stock adjustment #' . $entry_id,
					'branch_id'      => (int) $mv['branch_id'],
					'field'          => 'qty',
				);
				$item = array( 'product_id' => (int) $mv['product_id'], 'variant_id' => (int) $mv['variant_id'], 'qty' => abs( $qty ), 'value' => $value );
				if ( $qty > 0 ) {
					$this->out( $ctx, $item, $meta );
				} else {
					$this->in( $ctx, $item, $meta );
				}
				$this->journal->reverseOne( $ctx, $entry_id, 'Cancelled: ' . $info['memo'] );
				$this->audit->log( $ctx, 'void', 'stock', $info['product_id'], 'Stock adjustment #' . $entry_id . ' cancelled' );
			}
		);
		return $this->adjustmentInfo( $ctx, $entry_id );
	}

	/**
	 * The stock movement an adjustment entry made (linked since 1.19; older ones
	 * matched by product, date and value).
	 *
	 * @param array<string,mixed> $entry Journal entry row.
	 * @return array<string,mixed>|null
	 */
	private function movementFor( BusinessContext $ctx, array $entry ): ?array {
		$mt  = $this->db->table( 'stock_movements' );
		$row = $this->db->row( "SELECT * FROM {$mt} WHERE business_id = %d AND reference_type = 'adjustment' AND reference_id = %d ORDER BY id DESC LIMIT 1", array( $ctx->business_id, (int) $entry['id'] ) );
		if ( $row ) {
			return $row;
		}
		$value = Decimal::toString( Decimal::of( $entry['total'] ) );
		$rows  = $this->db->rows(
			"SELECT * FROM {$mt} WHERE business_id = %d AND product_id = %d AND reference_type = 'adjustment' AND reference_id = 0 AND movement_date = %s ORDER BY id DESC",
			array( $ctx->business_id, (int) $entry['source_id'], (string) $entry['entry_date'] )
		);
		foreach ( $rows as $r ) {
			if ( Decimal::toString( Decimal::of( $r['value'] ) ) === $value || Decimal::toString( abs( Decimal::of( $r['value'] ) ) ) === $value ) {
				return $r;
			}
		}
		return null;
	}

	private function assertOpenPeriod( BusinessContext $ctx, string $date ): void {
		$lock = (string) ( $this->settings->all( $ctx )['accounting.lock_date'] ?? '' );
		if ( '' !== $lock && $date <= $lock ) {
			throw new ConflictException( 'The books are locked for this date.' );
		}
	}

	/**
	 * Current average cost (for previews/sale line costing).
	 */
	public function averageCost( BusinessContext $ctx, int $product_id, int $variant_id = 0, ?int $branch_id = null ): int {
		$t   = $this->db->table( 'stock_levels' );
		$avg = $this->db->value(
			"SELECT avg_cost FROM {$t} WHERE business_id = %d AND branch_id = %d AND product_id = %d AND variant_id = %d",
			array( $ctx->business_id, $branch_id ?? $ctx->branch_id, $product_id, $variant_id )
		);
		return Decimal::of( $avg );
	}

	/**
	 * Quantity on hand.
	 */
	public function onHand( BusinessContext $ctx, int $product_id, int $variant_id = 0, ?int $branch_id = null ): int {
		$t = $this->db->table( 'stock_levels' );
		return Decimal::of(
			$this->db->value(
				"SELECT qty FROM {$t} WHERE business_id = %d AND branch_id = %d AND product_id = %d AND variant_id = %d",
				array( $ctx->business_id, $branch_id ?? $ctx->branch_id, $product_id, $variant_id )
			)
		);
	}

	/**
	 * Opening stock: Dr Inventory / Cr Opening Balance Equity.
	 */
	public function opening( BusinessContext $ctx, int $product_id, int $variant_id, int $qty, int $unit_cost, ?string $date = null, string $name = '' ): void {
		if ( $qty <= 0 ) {
			return;
		}
		$date  = $date ?? $this->today( $ctx );
		$value = Decimal::round( Decimal::mul( $qty, $unit_cost ), $ctx->decimals() );
		$this->db->transaction(
			function () use ( $ctx, $product_id, $variant_id, $qty, $value, $date, $name ) {
				$this->in(
					$ctx,
					array(
						'product_id' => $product_id,
						'variant_id' => $variant_id,
						'qty'        => $qty,
						'value'      => $value,
					),
					array(
						'type'           => 'opening',
						'date'           => $date,
						'reference_type' => 'product',
						'reference_id'   => $product_id,
						'note'           => 'Opening stock',
					)
				);
				$this->journal->post(
					$ctx,
					array(
						'date'      => $date,
						'source'    => 'opening_stock',
						'source_id' => $product_id,
						'memo'      => 'Opening stock ' . $name,
					),
					array(
						array( 'account' => 'inventory', 'debit' => $value ),
						array( 'account' => 'opening_balance', 'credit' => $value ),
					)
				);
			}
		);
	}

	/**
	 * Manual stock adjustment (count correction, damage, gift…).
	 *
	 * @param array<string,mixed> $data product_id, variant_id, mode ('set'|'add'|'remove'), qty, unit_cost (for increases), reason, date.
	 * @return array<string,mixed> The resulting stock level.
	 */
	public function adjust( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'inventory.adjust' );
		$product_id = (int) ( $data['product_id'] ?? 0 );
		$variant_id = (int) ( $data['variant_id'] ?? 0 );
		$pt         = $this->db->table( 'products' );
		$product    = $this->db->row( "SELECT * FROM {$pt} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $product_id, $ctx->business_id ) );
		if ( null === $product ) {
			throw ValidationException::field( 'product_id', 'Select a product.' );
		}
		if ( ! (int) $product['track_stock'] ) {
			throw ValidationException::field( 'product_id', 'Stock is not tracked for this product.' );
		}
		$mode = in_array( $data['mode'] ?? '', array( 'set', 'add', 'remove', 'opening' ), true ) ? $data['mode'] : 'add';
		// "opening": stock the shop already had (not bought now, not a gain) — booked to opening
		// balance equity like a product's opening stock, so it never shows up as profit.
		$opening = 'opening' === $mode;
		if ( $opening ) {
			$mode = 'add';
		}
		try {
			$qty = Decimal::of( $data['qty'] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			throw ValidationException::field( 'qty', 'Enter a valid quantity.' );
		}
		if ( $qty < 0 || ( 'set' !== $mode && 0 === $qty ) ) {
			throw ValidationException::field( 'qty', 'Enter a quantity greater than zero.' );
		}
		$date   = Text::date( $data['date'] ?? null ) ?? $this->today( $ctx );
		$reason = Text::line( $data['reason'] ?? '', 191 );
		if ( '' === $reason && $opening ) {
			$reason = 'Stock already in hand';
		}
		if ( '' === $reason ) {
			throw ValidationException::field( 'reason', 'Please give a reason for the adjustment.' );
		}

		return $this->db->transaction(
			function () use ( $ctx, $product, $product_id, $variant_id, $mode, $qty, $data, $date, $reason, $opening ) {
				$current = $this->onHand( $ctx, $product_id, $variant_id );
				$delta   = 'set' === $mode ? $qty - $current : ( 'add' === $mode ? $qty : -$qty );
				if ( 0 === $delta ) {
					throw ValidationException::field( 'qty', 'The stock is already at this quantity.' );
				}
				$meta = array(
					'type'           => 'adjustment',
					'date'           => $date,
					'reference_type' => 'adjustment',
					'reference_id'   => 0,
					'note'           => $reason,
					'product_name'   => $product['name'],
					'field'          => 'qty',
				);
				if ( $delta > 0 ) {
					$avg  = $this->averageCost( $ctx, $product_id, $variant_id );
					$unit = isset( $data['unit_cost'] ) && '' !== $data['unit_cost'] ? Decimal::of( $data['unit_cost'] ) : ( $avg > 0 ? $avg : Decimal::of( $product['purchase_price'] ) );
					if ( $unit < 0 ) {
						throw ValidationException::field( 'unit_cost', 'Cost cannot be negative.' );
					}
					$value = Decimal::round( Decimal::mul( $delta, $unit ), $ctx->decimals() );
					$this->in( $ctx, array( 'product_id' => $product_id, 'variant_id' => $variant_id, 'qty' => $delta, 'value' => $value ), $meta );
					$lines = array(
						array( 'account' => 'inventory', 'debit' => $value ),
						array( 'account' => $opening ? 'opening_balance' : 'inventory_adjustment', 'credit' => $value ),
					);
				} else {
					$res   = $this->out( $ctx, array( 'product_id' => $product_id, 'variant_id' => $variant_id, 'qty' => -$delta ), $meta );
					$value = $res['cost'];
					$lines = array(
						array( 'account' => 'inventory_adjustment', 'debit' => $value ),
						array( 'account' => 'inventory', 'credit' => $value ),
					);
				}
				$entry = $this->journal->post(
					$ctx,
					array(
						'date'      => $date,
						'source'    => 'stock_adjustment',
						'source_id' => $product_id,
						'memo'      => 'Stock adjustment: ' . $product['name'] . ' (' . $reason . ')',
					),
					$lines
				);
				$mt  = $this->db->table( 'stock_movements' );
				$mid = (int) $this->db->value( "SELECT MAX(id) FROM {$mt} WHERE business_id = %d AND product_id = %d AND variant_id = %d AND reference_type = 'adjustment' AND reference_id = 0", array( $ctx->business_id, $product_id, $variant_id ) );
				if ( $mid ) {
					$this->db->update( $mt, array( 'reference_id' => $entry ), array( 'id' => $mid ) );
				}
				$this->audit->log(
					$ctx,
					'adjust',
					'stock',
					$product_id,
					sprintf( 'Stock adjusted for %s by %s (%s)', $product['name'], Decimal::toString( $delta, 2 ), $reason ),
					array( 'delta' => Decimal::toString( $delta ), 'journal_entry' => $entry )
				);
				return $this->level( $ctx, $product_id, $variant_id );
			}
		);
	}

	/**
	 * One stock level row.
	 *
	 * @return array<string,mixed>
	 */
	public function level( BusinessContext $ctx, int $product_id, int $variant_id = 0, ?int $branch_id = null ): array {
		$t   = $this->db->table( 'stock_levels' );
		$row = $this->db->row(
			"SELECT * FROM {$t} WHERE business_id = %d AND branch_id = %d AND product_id = %d AND variant_id = %d",
			array( $ctx->business_id, $branch_id ?? $ctx->branch_id, $product_id, $variant_id )
		);
		return $row ?? array(
			'product_id' => $product_id,
			'variant_id' => $variant_id,
			'branch_id'  => $branch_id ?? $ctx->branch_id,
			'qty'        => '0',
			'value'      => '0',
			'avg_cost'   => '0',
		);
	}

	/**
	 * Paged stock list.
	 *
	 * @param array<string,mixed> $args search, category_id, low (bool), branch_id ('all' for consolidated), page, per_page.
	 * @return array<string,mixed>
	 */
	public function levels( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'inventory.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$pt = $this->db->table( 'products' );
		$st = $this->db->table( 'stock_levels' );

		$branch_cond   = '';
		$branch_params = array();
		if ( 'all' !== ( $args['branch_id'] ?? '' ) ) {
			$branch_cond     = ' AND s.branch_id = %d';
			$branch_params[] = (int) ( $args['branch_id'] ?? $ctx->branch_id ) ?: $ctx->branch_id;
		}
		$qty_sql   = "COALESCE((SELECT SUM(s.qty) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id{$branch_cond}),0)";
		$value_sql = "COALESCE((SELECT SUM(s.value) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id{$branch_cond}),0)";

		$where  = array( 'p.business_id = %d', 'p.deleted_at IS NULL', 'p.track_stock = 1' );
		$params = array( $ctx->business_id );
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(p.name LIKE %s OR p.sku LIKE %s OR p.barcode LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		if ( ! empty( $args['category_id'] ) ) {
			$where[]  = 'p.category_id = %d';
			$params[] = (int) $args['category_id'];
		}
		if ( ! empty( $args['low'] ) ) {
			$where[] = "{$qty_sql} <= p.min_stock";
			$params  = array_merge( $params, $branch_params );
		}
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$pt} p WHERE {$w}", $params );
		$rows  = $this->db->rows(
			"SELECT p.id AS product_id, p.name, p.sku, p.barcode, p.min_stock, p.selling_price, {$qty_sql} AS qty, {$value_sql} AS value
			FROM {$pt} p WHERE {$w} ORDER BY p.name LIMIT %d OFFSET %d",
			array_merge( $branch_params, $branch_params, $params, array( $per_page, $offset ) )
		);
		$show_cost = $ctx->can( 'products.cost' );
		foreach ( $rows as &$r ) {
			$qty  = Decimal::of( $r['qty'] );
			$val  = Decimal::of( $r['value'] );
			$r['qty']       = Decimal::toString( $qty );
			$r['value']     = $show_cost ? Decimal::toString( $val ) : null;
			$r['avg_cost']  = $show_cost ? Decimal::toString( $qty > 0 ? Decimal::div( $val, $qty ) : 0 ) : null;
			$r['is_low']    = $qty <= Decimal::of( $r['min_stock'] );
		}
		return $this->paged( $rows, $total, $page, $per_page );
	}

	/**
	 * Paged stock movement history.
	 *
	 * @param array<string,mixed> $args product_id, type, from, to, branch_id, page, per_page.
	 * @return array<string,mixed>
	 */
	public function movements( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'inventory.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$mt     = $this->db->table( 'stock_movements' );
		$pt     = $this->db->table( 'products' );
		$where  = array( 'm.business_id = %d' );
		$params = array( $ctx->business_id );
		if ( ! empty( $args['product_id'] ) ) {
			$where[]  = 'm.product_id = %d';
			$params[] = (int) $args['product_id'];
		}
		if ( ! empty( $args['type'] ) ) {
			$where[]  = 'm.movement_type = %s';
			$params[] = Text::key( $args['type'] );
		}
		if ( ! empty( $args['branch_id'] ) ) {
			$where[]  = 'm.branch_id = %d';
			$params[] = (int) $args['branch_id'];
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 'm.movement_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 'm.movement_date <= %s';
			$params[] = $to;
		}
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$mt} m WHERE {$w}", $params );
		$rows  = $this->db->rows(
			"SELECT m.*, p.name AS product_name, p.sku FROM {$mt} m LEFT JOIN {$pt} p ON p.id = m.product_id WHERE {$w} ORDER BY m.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		if ( ! $ctx->can( 'products.cost' ) ) {
			foreach ( $rows as &$r ) {
				$r['unit_cost'] = null;
				$r['value']     = null;
			}
		}
		return $this->paged( $rows, $total, $page, $per_page );
	}

	/**
	 * Lock (or create) the stock level row.
	 *
	 * @return array<string,mixed>
	 */
	private function lock( BusinessContext $ctx, int $branch_id, int $product_id, int $variant_id ): array {
		$t   = $this->db->table( 'stock_levels' );
		$sql = "SELECT * FROM {$t} WHERE business_id = %d AND branch_id = %d AND product_id = %d AND variant_id = %d" . $this->db->forUpdate();
		$row = $this->db->row( $sql, array( $ctx->business_id, $branch_id, $product_id, $variant_id ) );
		if ( null === $row ) {
			$this->db->insert(
				$t,
				array(
					'business_id' => $ctx->business_id,
					'branch_id'   => $branch_id,
					'product_id'  => $product_id,
					'variant_id'  => $variant_id,
					'qty'         => '0',
					'value'       => '0',
					'avg_cost'    => '0',
					'updated_at'  => $this->now(),
				)
			);
			$row = $this->db->row( $sql, array( $ctx->business_id, $branch_id, $product_id, $variant_id ) );
		}
		return (array) $row;
	}

	/**
	 * @param array<string,mixed> $level Locked row.
	 */
	private function save( array $level, int $qty, int $value, int $avg ): void {
		$this->db->update(
			$this->db->table( 'stock_levels' ),
			array(
				'qty'        => Decimal::toString( $qty ),
				'value'      => Decimal::toString( $value ),
				'avg_cost'   => Decimal::toString( $avg ),
				'updated_at' => $this->now(),
			),
			array( 'id' => (int) $level['id'] )
		);
	}

	/**
	 * @param array<string,mixed> $item Item.
	 * @param array<string,mixed> $meta Meta.
	 */
	private function record( BusinessContext $ctx, int $branch, array $item, array $meta, int $qty, int $unit, int $value, int $before, int $after ): void {
		$this->db->insert(
			$this->db->table( 'stock_movements' ),
			array(
				'business_id'    => $ctx->business_id,
				'branch_id'      => $branch,
				'product_id'     => (int) $item['product_id'],
				'variant_id'     => (int) ( $item['variant_id'] ?? 0 ),
				'movement_type'  => Text::key( $meta['type'] ?? 'adjustment', 30 ),
				'movement_date'  => Text::date( $meta['date'] ?? null ) ?? $this->today( $ctx ),
				'qty'            => Decimal::toString( $qty ),
				'unit_cost'      => Decimal::toString( $unit ),
				'value'          => Decimal::toString( $value ),
				'qty_before'     => Decimal::toString( $before ),
				'qty_after'      => Decimal::toString( $after ),
				'reference_type' => Text::key( $meta['reference_type'] ?? '', 30 ),
				'reference_id'   => (int) ( $meta['reference_id'] ?? 0 ),
				'reference_no'   => Text::line( $meta['reference_no'] ?? '', 60 ),
				'note'           => Text::line( $meta['note'] ?? '', 255 ),
				'created_by'     => $ctx->user_id,
				'created_at'     => $this->now(),
			)
		);
	}

	private function checkLow( BusinessContext $ctx, int $product_id, int $before, int $after, int $branch ): void {
		$pt  = $this->db->table( 'products' );
		$row = $this->db->row( "SELECT id, name, min_stock FROM {$pt} WHERE id = %d AND business_id = %d", array( $product_id, $ctx->business_id ) );
		if ( null === $row ) {
			return;
		}
		$min = Decimal::of( $row['min_stock'] );
		if ( $min > 0 && $after <= $min && $before > $min ) {
			$this->events->dispatch( 'goriber_hisab/stock/low', $ctx, $row, $after, $branch );
		}
	}
}
