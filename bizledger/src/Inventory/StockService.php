<?php
/**
 * Perpetual inventory.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Inventory;

use BizLedger\Accounting\JournalService;
use BizLedger\Audit\AuditLogger;
use BizLedger\Database\Database;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

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
				$this->events->dispatch( 'bizledger/stock/changed', $ctx, (int) $item['product_id'], $new_qty, $branch );

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

				$this->events->dispatch( 'bizledger/stock/changed', $ctx, (int) $item['product_id'], $new_qty, $branch );
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
		$mode = in_array( $data['mode'] ?? '', array( 'set', 'add', 'remove' ), true ) ? $data['mode'] : 'add';
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
		if ( '' === $reason ) {
			throw ValidationException::field( 'reason', 'Please give a reason for the adjustment.' );
		}

		return $this->db->transaction(
			function () use ( $ctx, $product, $product_id, $variant_id, $mode, $qty, $data, $date, $reason ) {
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
						array( 'account' => 'inventory_adjustment', 'credit' => $value ),
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
			$this->events->dispatch( 'bizledger/stock/low', $ctx, $row, $after, $branch );
		}
	}
}
