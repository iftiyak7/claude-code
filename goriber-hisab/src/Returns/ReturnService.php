<?php
/**
 * Sales and purchase returns.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Returns;

use GoriberHisab\Accounting\JournalService;
use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Inventory\StockService;
use GoriberHisab\Numbering\NumberingService;
use GoriberHisab\Payments\PaymentService;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Returns against a specific sale or purchase.
 *
 * Sales return:
 *   Dr Sales Returns (net) + Dr Output Tax (tax) / Cr Receivable (customer)
 *   Dr Inventory / Cr COGS at the cost the goods left with
 *   optional refund: Dr Receivable / Cr cash  (payment "out" to customer)
 * Purchase return:
 *   Dr Payable (supplier) / Cr Inventory (current average cost)
 *     + Cr Input Tax (recoverable tax) ± Inventory Adjustments (cost variance)
 *   optional refund: Dr cash / Cr Payable  (payment "in" from supplier)
 *
 * Returned value per unit is pro-rata of the original line's net and tax, so
 * discounts given on the invoice are honoured; returning the last unit takes
 * exactly the remainder, so a fully returned line reverses to the cent.
 */
final class ReturnService extends Service {

	private SettingsService $settings;
	private StockService $stock;
	private JournalService $journal;
	private PaymentService $payments;
	private NumberingService $numbers;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, SettingsService $settings, StockService $stock, JournalService $journal, PaymentService $payments, NumberingService $numbers, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
		$this->stock    = $stock;
		$this->journal  = $journal;
		$this->payments = $payments;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
	}

	/**
	 * @param array<string,mixed> $data document_id, return_date, items[{item_id, qty}], refund_amount, refund_account_id, reason, uuid.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, string $type, array $data ): array {
		$type = 'purchase' === $type ? 'purchase' : 'sale';
		$ctx->authorize( 'sale' === $type ? 'sales.return' : 'purchases.return' );
		$rt   = $this->db->table( 'returns' );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		if ( $uuid ) {
			$existing = $this->db->value( "SELECT id FROM {$rt} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->get( $ctx, (int) $existing );
			}
		}

		$doc_table  = 'sale' === $type ? 'sales' : 'purchases';
		$item_table = 'sale' === $type ? 'sale_items' : 'purchase_items';
		$fk         = 'sale' === $type ? 'sale_id' : 'purchase_id';
		$doc        = $this->findScoped( $ctx, $doc_table, (int) ( $data['document_id'] ?? 0 ), 'sale' === $type ? 'Sale' : 'Purchase' );
		if ( 'completed' !== $doc['status'] ) {
			throw ValidationException::field( 'document_id', 'Only completed documents can be returned.' );
		}
		$contact_id = (int) ( 'sale' === $type ? $doc['customer_id'] : $doc['supplier_id'] );
		$date       = Text::date( $data['return_date'] ?? null ) ?? $this->today( $ctx );
		$doc_date   = (string) ( 'sale' === $type ? $doc['sale_date'] : $doc['purchase_date'] );
		if ( $date < $doc_date ) {
			throw ValidationException::field( 'return_date', 'Return date cannot be before the original document date.' );
		}

		$it        = $this->db->table( $item_table );
		$doc_items = array();
		foreach ( $this->db->rows( "SELECT * FROM {$it} WHERE {$fk} = %d AND business_id = %d", array( (int) $doc['id'], $ctx->business_id ) ) as $row ) {
			$doc_items[ (int) $row['id'] ] = $row;
		}

		$errors = array();
		$lines  = array();
		$ri     = $this->db->table( 'return_items' );
		foreach ( array_values( (array) ( $data['items'] ?? array() ) ) as $i => $req ) {
			$item_id = (int) ( $req['item_id'] ?? 0 );
			if ( ! isset( $doc_items[ $item_id ] ) ) {
				$errors[ "items.{$i}.item_id" ] = 'This item is not on the original document.';
				continue;
			}
			$item = $doc_items[ $item_id ];
			try {
				$qty = Decimal::of( $req['qty'] ?? 0 );
			} catch ( \InvalidArgumentException $e ) {
				$qty = 0;
			}
			if ( $qty <= 0 ) {
				continue;
			}
			$sold      = Decimal::of( $item['qty'] );
			$returned  = Decimal::of( $item['returned_qty'] );
			$remaining = $sold - $returned;
			if ( $qty > $remaining ) {
				$errors[ "items.{$i}.qty" ] = sprintf( 'Only %1$s of %2$s can be returned.', Decimal::toString( $remaining, 2 ), $item['name'] );
				continue;
			}
			// Amounts already returned for this line.
			$prev = $this->db->row(
				"SELECT COALESCE(SUM(x.net_amount),0) AS net, COALESCE(SUM(x.tax_amount),0) AS tax, COALESCE(SUM(x.cost_amount),0) AS cost
				FROM {$ri} x JOIN {$rt} r ON r.id = x.return_id WHERE x.business_id = %d AND x.document_item_id = %d AND r.return_type = %s AND r.status = 'completed'",
				array( $ctx->business_id, $item_id, $type )
			);
			$full_net  = Decimal::of( $item['net_amount'] );
			$full_tax  = Decimal::of( $item['tax_amount'] );
			$full_cost = 'sale' === $type ? Decimal::of( $item['cost_amount'] ) : 0;
			if ( $qty === $remaining ) {
				$net  = $full_net - Decimal::of( $prev['net'] ?? 0 );
				$tax  = $full_tax - Decimal::of( $prev['tax'] ?? 0 );
				$cost = $full_cost - Decimal::of( $prev['cost'] ?? 0 );
			} else {
				$net  = Decimal::round( Decimal::div( Decimal::mul( $full_net, $qty ), $sold ), $ctx->decimals() );
				$tax  = Decimal::round( Decimal::div( Decimal::mul( $full_tax, $qty ), $sold ), $ctx->decimals() );
				$cost = Decimal::div( Decimal::mul( $full_cost, $qty ), $sold );
			}
			$lines[] = array(
				'item'       => $item,
				'qty'        => $qty,
				'net'        => $net,
				'tax'        => $tax,
				'cost'       => $cost,
				'unit_price' => Decimal::of( $item['unit_price'] ),
			);
		}
		if ( ! $errors && array() === $lines ) {
			$errors['items'] = 'Enter a quantity for at least one item.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		$subtotal = Decimal::sum( array_column( $lines, 'net' ) );
		$tax      = Decimal::sum( array_column( $lines, 'tax' ) );
		$total    = $subtotal + $tax;
		try {
			// Walk-in returns default to a full refund; named parties default to credit.
			$given  = isset( $data['refund_amount'] ) && '' !== $data['refund_amount'];
			$refund = $given ? Decimal::round( Decimal::of( $data['refund_amount'] ), $ctx->decimals() ) : ( 0 === $contact_id ? $total : 0 );
		} catch ( \InvalidArgumentException $e ) {
			throw ValidationException::field( 'refund_amount', 'Enter a valid amount.' );
		}
		if ( $refund < 0 || $refund > $total ) {
			throw ValidationException::field( 'refund_amount', 'Refund must be between zero and the return total.' );
		}
		// Credit that is not refunded reduces what the party owes; for a
		// walk-in (no contact) the whole value has to be refunded.
		if ( 0 === $contact_id && $refund !== $total ) {
			throw ValidationException::field( 'refund_amount', 'Returns without a customer/supplier must be fully refunded.' );
		}

		$id = $this->db->transaction(
			function () use ( $ctx, $type, $data, $doc, $contact_id, $date, $lines, $subtotal, $tax, $total, $refund, $uuid, $rt, $ri, $it ) {
				$number = $this->numbers->next( $ctx, 'sale' === $type ? 'sale_return' : 'purchase_return', $date );
				$id     = $this->db->insert(
					$rt,
					array(
						'uuid'              => $uuid,
						'business_id'       => $ctx->business_id,
						'branch_id'         => $ctx->branch_id,
						'number'            => $number,
						'return_type'       => $type,
						'document_id'       => (int) $doc['id'],
						'contact_id'        => $contact_id,
						'return_date'       => $date,
						'subtotal'          => Decimal::toString( $subtotal ),
						'tax_amount'        => Decimal::toString( $tax ),
						'total'             => Decimal::toString( $total ),
						'cost_amount'       => '0',
						'refund_amount'     => Decimal::toString( $refund ),
						'refund_account_id' => 0,
						'reason'            => Text::multiline( $data['reason'] ?? '', 1000 ),
						'status'            => 'completed',
						'created_by'        => $ctx->user_id,
						'updated_by'        => $ctx->user_id,
						'created_at'        => $this->now(),
						'updated_at'        => $this->now(),
					)
				);

				$pt         = $this->db->table( 'products' );
				$stock_cost = 0;
				$variance   = 0;
				foreach ( $lines as $line ) {
					$item  = $line['item'];
					$track = (int) $this->db->value( "SELECT track_stock FROM {$pt} WHERE id = %d", array( (int) $item['product_id'] ) );
					$cost  = $line['cost'];
					$meta  = array(
						'type'           => $type . '_return',
						'date'           => $date,
						'reference_type' => 'return',
						'reference_id'   => $id,
						'reference_no'   => $number,
						'product_name'   => $item['name'],
					);
					$used = 'sale' === $type ? Json::decode( $item['components'] ?? null ) : array();
					$back = array();
					if ( $used ) {
						// Made from a recipe: its share of the ingredients goes back on the shelf.
						$back = StockService::shareComponents( $used, $line['qty'], Decimal::of( $item['qty'] ), $cost );
						$this->stock->moveComponents( $ctx, $back, 'in', $meta );
					} elseif ( $track ) {
						if ( 'sale' === $type ) {
							$this->stock->in( $ctx, array( 'product_id' => (int) $item['product_id'], 'variant_id' => (int) $item['variant_id'], 'qty' => $line['qty'], 'value' => $cost ), $meta );
						} else {
							$res  = $this->stock->out( $ctx, array( 'product_id' => (int) $item['product_id'], 'variant_id' => (int) $item['variant_id'], 'qty' => $line['qty'] ), $meta );
							$cost = $res['cost'];
						}
					} elseif ( 'purchase' === $type ) {
						$cost = 0;
					}
					$stock_cost += $cost;
					$this->db->insert(
						$ri,
						array(
							'business_id'      => $ctx->business_id,
							'return_id'        => $id,
							'document_item_id' => (int) $item['id'],
							'product_id'       => (int) $item['product_id'],
							'variant_id'       => (int) $item['variant_id'],
							'name'             => $item['name'],
							'qty'              => Decimal::toString( $line['qty'] ),
							'unit_price'       => Decimal::toString( $line['unit_price'] ),
							'net_amount'       => Decimal::toString( $line['net'] ),
							'tax_amount'       => Decimal::toString( $line['tax'] ),
							'total'            => Decimal::toString( $line['net'] + $line['tax'] ),
							'unit_cost'        => Decimal::toString( Decimal::div( $cost, $line['qty'] ) ),
							'cost_amount'      => Decimal::toString( $cost ),
							'components'       => $back ? Json::encode( $back ) : null,
						)
					);
					$this->db->execute( "UPDATE {$it} SET returned_qty = returned_qty + %s WHERE id = %d", array( Decimal::toString( $line['qty'] ), (int) $item['id'] ) );
				}
				$this->db->update( $rt, array( 'cost_amount' => Decimal::toString( $stock_cost ) ), array( 'id' => $id ) );

				if ( 'sale' === $type ) {
					$journal = array(
						array( 'account' => 'sales_returns', 'debit' => $subtotal ),
						array( 'account' => 'tax_output', 'debit' => $tax ),
						array( 'account' => 'receivable', 'credit' => $total, 'contact_id' => $contact_id ),
						array( 'account' => 'inventory', 'debit' => $stock_cost ),
						array( 'account' => 'cogs', 'credit' => $stock_cost ),
					);
				} else {
					$recoverable = (bool) $this->settings->all( $ctx )['tax.purchase_recoverable'];
					// What the supplier credits vs. what leaves inventory.
					$credit_value = $subtotal + ( $recoverable ? 0 : $tax );
					$non_stock    = $this->nonStockValue( $ctx, $lines );
					$variance     = $credit_value - $non_stock - $stock_cost;
					$journal      = array(
						array( 'account' => 'payable', 'debit' => $total, 'contact_id' => $contact_id ),
						array( 'account' => 'inventory', 'credit' => $stock_cost ),
						array( 'account' => 'cogs', 'credit' => $non_stock ),
						array( 'account' => 'tax_input', 'credit' => $recoverable ? $tax : 0 ),
						array( 'account' => 'inventory_adjustment', 'credit' => $variance ),
					);
				}
				$this->journal->post(
					$ctx,
					array(
						'date'         => $date,
						'source'       => 'return',
						'source_id'    => $id,
						'reference_no' => $number,
						'memo'         => ( 'sale' === $type ? 'Sales return ' : 'Purchase return ' ) . $number . ' against ' . $doc['number'],
					),
					$journal
				);

				if ( $refund > 0 ) {
					$pid = $this->payments->record(
						$ctx,
						array(
							'direction'     => 'sale' === $type ? 'out' : 'in',
							'party'         => 'sale' === $type ? 'customer' : 'supplier',
							'contact_id'    => $contact_id,
							'account_id'    => (int) ( $data['refund_account_id'] ?? 0 ) ?: $this->defaultRefundAccount( $ctx ),
							'amount_scaled' => $refund,
							'date'          => $date,
							'source'        => 'sale' === $type ? 'sale_return' : 'purchase_return',
							'source_id'     => $id,
							'field'         => 'refund_account_id',
							'memo'          => 'Refund for ' . $number,
							'allocations'   => array(),
						)
					);
					$pay = $this->db->row( 'SELECT account_id FROM ' . $this->db->table( 'payments' ) . ' WHERE id = %d', array( $pid ) );
					$this->db->update( $rt, array( 'refund_account_id' => (int) $pay['account_id'] ), array( 'id' => $id ) );
				}

				$this->payments->recalc( $ctx, $type, (int) $doc['id'] );
				$this->audit->log( $ctx, 'create', 'return', $id, sprintf( '%s return %s against %s, total %s', ucfirst( $type ), $number, $doc['number'], Decimal::toString( $total, $ctx->decimals() ) ) );
				return $id;
			}
		);
		$ret = $this->get( $ctx, $id );
		$this->events->dispatch( "goriber_hisab/{$type}_return/created", $ctx, $ret );
		return $ret;
	}

	/**
	 * Void a return, restoring stock, ledger and document balances.
	 *
	 * @return array<string,mixed>
	 */
	public function void( BusinessContext $ctx, int $id, string $reason = '' ): array {
		$ret = $this->findScoped( $ctx, 'returns', $id, 'Return' );
		$ctx->authorize( 'sale' === $ret['return_type'] ? 'sales.return' : 'purchases.return' );
		if ( 'void' === $ret['status'] ) {
			return $this->get( $ctx, $id );
		}
		$type       = (string) $ret['return_type'];
		$item_table = $this->db->table( 'sale' === $type ? 'sale_items' : 'purchase_items' );
		$this->db->transaction(
			function () use ( $ctx, $ret, $id, $type, $item_table, $reason ) {
				$ri    = $this->db->table( 'return_items' );
				$pt    = $this->db->table( 'products' );
				$items = $this->db->rows( "SELECT x.*, p.track_stock FROM {$ri} x LEFT JOIN {$pt} p ON p.id = x.product_id WHERE x.return_id = %d", array( $id ) );
				$variance = 0;
				foreach ( $items as $item ) {
					$qty  = Decimal::of( $item['qty'] );
					$cost = Decimal::of( $item['cost_amount'] );
					$meta = array(
						'type'           => $type . '_return_void',
						'date'           => $this->today( $ctx ),
						'reference_type' => 'return',
						'reference_id'   => $id,
						'reference_no'   => (string) $ret['number'],
						'product_name'   => $item['name'],
						'branch_id'      => (int) $ret['branch_id'],
					);
					$used = Json::decode( $item['components'] ?? null );
					if ( $used ) {
						$variance += $this->stock->moveComponents( $ctx, $used, 'out', $meta );
					} elseif ( (int) $item['track_stock'] ) {
						if ( 'sale' === $type ) {
							$res       = $this->stock->out( $ctx, array( 'product_id' => (int) $item['product_id'], 'variant_id' => (int) $item['variant_id'], 'qty' => $qty, 'value' => $cost ), $meta );
							$variance += $res['variance'];
						} else {
							$this->stock->in( $ctx, array( 'product_id' => (int) $item['product_id'], 'variant_id' => (int) $item['variant_id'], 'qty' => $qty, 'value' => $cost ), $meta );
						}
					}
					$this->db->execute( "UPDATE {$item_table} SET returned_qty = returned_qty - %s WHERE id = %d", array( Decimal::toString( $qty ), (int) $item['document_item_id'] ) );
				}
				$this->journal->reverseSource( $ctx, 'return', $id, null, 'Void return ' . $ret['number'] );
				if ( 0 !== $variance ) {
					$this->journal->post(
						$ctx,
						array(
							'date'         => $this->today( $ctx ),
							'source'       => 'return_variance',
							'source_id'    => $id,
							'reference_no' => (string) $ret['number'],
							'memo'         => 'Cost variance on void of return ' . $ret['number'],
						),
						array(
							array( 'account' => 'inventory', 'debit' => $variance ),
							array( 'account' => 'inventory_adjustment', 'credit' => $variance ),
						)
					);
				}
				foreach ( $this->payments->forSource( $ctx, 'sale' === $type ? 'sale_return' : 'purchase_return', $id ) as $p ) {
					$this->payments->void( $ctx, (int) $p['id'], 'Void of return', false );
				}
				$this->db->update(
					$this->db->table( 'returns' ),
					array(
						'status'     => 'void',
						'voided_at'  => $this->now(),
						'voided_by'  => $ctx->user_id,
						'updated_at' => $this->now(),
					),
					array( 'id' => $id )
				);
				$this->payments->recalc( $ctx, $type, (int) $ret['document_id'] );
				$this->audit->log( $ctx, 'void', 'return', $id, 'Return voided ' . $ret['number'] . ( $reason ? ': ' . Text::line( $reason ) : '' ) );
			}
		);
		return $this->get( $ctx, $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ret = $this->findScoped( $ctx, 'returns', $id, 'Return' );
		$ctx->authorize( 'sale' === $ret['return_type'] ? 'sales.view' : 'purchases.view' );
		$ri              = $this->db->table( 'return_items' );
		$ct              = $this->db->table( 'contacts' );
		$dt              = $this->db->table( 'sale' === $ret['return_type'] ? 'sales' : 'purchases' );
		$ret['id']       = (int) $ret['id'];
		$ret['items']    = $this->db->rows( "SELECT * FROM {$ri} WHERE return_id = %d ORDER BY id", array( $id ) );
		$ret['contact']  = (int) $ret['contact_id'] ? $this->db->row( "SELECT id, name, phone, address FROM {$ct} WHERE id = %d", array( (int) $ret['contact_id'] ) ) : null;
		$ret['document'] = $this->db->row( "SELECT id, number FROM {$dt} WHERE id = %d", array( (int) $ret['document_id'] ) );
		if ( ! $ctx->can( 'reports.profit' ) ) {
			unset( $ret['cost_amount'] );
		}
		return $ret;
	}

	/**
	 * @param array<string,mixed> $args type, from, to, contact_id, document_id, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args ): array {
		$type = 'purchase' === ( $args['type'] ?? 'sale' ) ? 'purchase' : 'sale';
		$ctx->authorize( 'sale' === $type ? 'sales.view' : 'purchases.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$rt     = $this->db->table( 'returns' );
		$ct     = $this->db->table( 'contacts' );
		$dt     = $this->db->table( 'sale' === $type ? 'sales' : 'purchases' );
		$where  = array( 'r.business_id = %d', 'r.return_type = %s' );
		$params = array( $ctx->business_id, $type );
		foreach ( array( 'contact_id', 'document_id' ) as $f ) {
			if ( ! empty( $args[ $f ] ) ) {
				$where[]  = "r.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 'r.return_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 'r.return_date <= %s';
			$params[] = $to;
		}
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$rt} r WHERE {$w}", $params );
		$rows  = $this->db->rows(
			"SELECT r.id, r.number, r.return_date, r.document_id, d.number AS document_number, r.contact_id, c.name AS contact_name, r.total, r.refund_amount, r.status
			FROM {$rt} r LEFT JOIN {$ct} c ON c.id = r.contact_id LEFT JOIN {$dt} d ON d.id = r.document_id WHERE {$w} ORDER BY r.return_date DESC, r.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		return $this->paged( $rows, $total, $page, $per_page );
	}

	/**
	 * Default refund account: cash.
	 */
	private function defaultRefundAccount( BusinessContext $ctx ): int {
		$t = $this->db->table( 'accounts' );
		return (int) $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND system_key = 'cash'", array( $ctx->business_id ) );
	}

	/**
	 * Credit value of non-stock purchase lines (originally expensed to COGS).
	 *
	 * @param array<int,array<string,mixed>> $lines Return lines.
	 */
	private function nonStockValue( BusinessContext $ctx, array $lines ): int {
		$pt    = $this->db->table( 'products' );
		$value = 0;
		foreach ( $lines as $line ) {
			$track = (int) $this->db->value( "SELECT track_stock FROM {$pt} WHERE id = %d", array( (int) $line['item']['product_id'] ) );
			if ( ! $track ) {
				$value += $line['net'];
			}
		}
		return $value;
	}
}
