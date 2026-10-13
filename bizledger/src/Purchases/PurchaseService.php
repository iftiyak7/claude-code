<?php
/**
 * Purchases.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Purchases;

use BizLedger\Accounting\AccountService;
use BizLedger\Accounting\JournalService;
use BizLedger\Audit\AuditLogger;
use BizLedger\Catalog\ProductService;
use BizLedger\Catalog\TaxService;
use BizLedger\Contacts\ContactService;
use BizLedger\Database\Database;
use BizLedger\Inventory\StockService;
use BizLedger\Numbering\NumberingService;
use BizLedger\Payments\PaymentService;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Support\ConflictException;
use BizLedger\Support\Decimal;
use BizLedger\Support\DocumentCalculator;
use BizLedger\Support\Events;
use BizLedger\Support\Json;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Purchase lifecycle with landed costing.
 *
 * Landed cost of a line = net amount (after line + document discount)
 *   + share of shipping and other costs (by net value)
 *   + tax, when purchase tax is not recoverable.
 * Journal: Dr Inventory (landed, stock items) / Dr COGS (landed, non-stock
 * items) / Dr Input Tax (recoverable tax) / Cr Payable (supplier) total.
 */
final class PurchaseService extends Service {

	private SettingsService $settings;
	private ProductService $products;
	private TaxService $taxes;
	private ContactService $contacts;
	private StockService $stock;
	private JournalService $journal;
	private AccountService $accounts;
	private PaymentService $payments;
	private NumberingService $numbers;
	private AuditLogger $audit;

	public function __construct(
		Database $db,
		Clock $clock,
		Events $events,
		SettingsService $settings,
		ProductService $products,
		TaxService $taxes,
		ContactService $contacts,
		StockService $stock,
		JournalService $journal,
		AccountService $accounts,
		PaymentService $payments,
		NumberingService $numbers,
		AuditLogger $audit
	) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
		$this->products = $products;
		$this->taxes    = $taxes;
		$this->contacts = $contacts;
		$this->stock    = $stock;
		$this->journal  = $journal;
		$this->accounts = $accounts;
		$this->payments = $payments;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
	}

	/**
	 * @param array<string,mixed> $data supplier_id, purchase_date, supplier_invoice, items[], discount_*, shipping_amount, other_cost, payments[], notes, status ('completed'|'draft'), uuid.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'purchases.create' );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		$pt   = $this->db->table( 'purchases' );
		if ( $uuid ) {
			$existing = $this->db->value( "SELECT id FROM {$pt} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->get( $ctx, (int) $existing );
			}
		}
		$status = 'draft' === ( $data['status'] ?? '' ) ? 'draft' : 'completed';
		$doc    = $this->prepare( $ctx, $data );

		$id = $this->db->transaction(
			function () use ( $ctx, $doc, $data, $status, $uuid, $pt ) {
				$now = $this->now();
				$id  = $this->db->insert(
					$pt,
					array_merge(
						$this->headerRow( $doc ),
						array(
							'uuid'           => $uuid,
							'business_id'    => $ctx->business_id,
							'branch_id'      => $ctx->branch_id,
							'number'         => 'TMP-' . Text::newUuid(),
							'status'         => $status,
							'payment_status' => $status,
							'currency_code'  => $ctx->currency(),
							'exchange_rate'  => '1',
							'created_by'     => $ctx->user_id,
							'updated_by'     => $ctx->user_id,
							'created_at'     => $now,
							'updated_at'     => $now,
						)
					)
				);
				$this->insertItems( $ctx, $id, $doc );
				if ( 'completed' === $status ) {
					$this->finalise( $ctx, $id, $doc, (array) ( $data['payments'] ?? array() ) );
				} else {
					$this->db->update( $pt, array( 'number' => 'DRAFT-' . $id ), array( 'id' => $id ) );
					$this->audit->log( $ctx, 'create', 'purchase', $id, 'Draft purchase saved' );
				}
				return $id;
			}
		);
		$purchase = $this->get( $ctx, $id );
		if ( 'completed' === $status ) {
			$this->events->dispatch( 'bizledger/purchase/completed', $ctx, $purchase );
		}
		return $purchase;
	}

	/**
	 * Edit: reverse + re-post for completed purchases; replace for drafts.
	 * Passing status=completed on a draft completes it.
	 *
	 * @param array<string,mixed> $data New content.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $id, array $data ): array {
		$ctx->authorize( 'purchases.edit' );
		$purchase = $this->findScoped( $ctx, 'purchases', $id, 'Purchase' );
		if ( 'void' === $purchase['status'] ) {
			throw new ConflictException( 'A voided purchase cannot be edited.' );
		}
		if ( Decimal::of( $purchase['return_amount'] ) > 0 ) {
			throw new ConflictException( 'This purchase has returns. Void the returns before editing it.' );
		}
		$doc = $this->prepare( $ctx, array_merge( $this->asInput( $ctx, $id, $purchase ), $data ) );
		$pt  = $this->db->table( 'purchases' );

		$this->db->transaction(
			function () use ( $ctx, $id, $purchase, $doc, $data, $pt ) {
				$tenders  = array_key_exists( 'payments', $data ) ? (array) $data['payments'] : null;
				$complete = 'completed' === $purchase['status'] || 'completed' === ( $data['status'] ?? '' );
				$kept     = array();
				if ( 'completed' === $purchase['status'] ) {
					$kept     = null === $tenders ? $this->payments->forSource( $ctx, 'purchase', $id ) : array();
					$kept_sum = Decimal::sum( array_map( static fn( $p ) => Decimal::of( $p['amount'] ), $kept ) );
					if ( $kept_sum > $doc['totals']['total'] ) {
						throw ValidationException::field( 'payments', 'The new total is less than the amount already paid. Update the payments as well.' );
					}
					$this->reverseEffects( $ctx, $purchase, null !== $tenders, 'Edit' );
				}
				$this->db->update( $pt, array_merge( $this->headerRow( $doc ), array( 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ) ), array( 'id' => $id ) );
				$this->db->execute( 'DELETE FROM ' . $this->db->table( 'purchase_items' ) . ' WHERE purchase_id = %d AND business_id = %d', array( $id, $ctx->business_id ) );
				$this->insertItems( $ctx, $id, $doc );
				if ( $complete ) {
					$this->finalise( $ctx, $id, $doc, $tenders ?? array(), 'completed' !== $purchase['status'], $kept_sum ?? 0 );
					foreach ( $kept as $p ) {
						$this->payments->attach( $ctx, (int) $p['id'], 'purchase', $id );
					}
					$this->payments->reallocateAdvances( $ctx, 'supplier', (int) $doc['supplier_id'] );
					if ( (int) $purchase['supplier_id'] !== (int) $doc['supplier_id'] ) {
						$this->payments->reallocateAdvances( $ctx, 'supplier', (int) $purchase['supplier_id'] );
					}
					$this->payments->recalc( $ctx, 'purchase', $id );
				}
				$this->audit->log( $ctx, 'update', 'purchase', $id, 'Purchase edited ' . $purchase['number'] );
			}
		);
		return $this->get( $ctx, $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function void( BusinessContext $ctx, int $id, string $reason = '' ): array {
		$ctx->authorize( 'purchases.delete' );
		$purchase = $this->findScoped( $ctx, 'purchases', $id, 'Purchase' );
		if ( 'void' === $purchase['status'] ) {
			return $this->get( $ctx, $id );
		}
		$rt = $this->db->table( 'returns' );
		if ( (int) $this->db->value( "SELECT COUNT(*) FROM {$rt} WHERE business_id = %d AND return_type = 'purchase' AND document_id = %d AND status = 'completed'", array( $ctx->business_id, $id ) ) ) {
			throw new ConflictException( 'This purchase has returns. Void the returns first.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $purchase, $id, $reason ) {
				if ( 'completed' === $purchase['status'] ) {
					$this->reverseEffects( $ctx, $purchase, true, 'Void' );
				}
				$this->db->update(
					$this->db->table( 'purchases' ),
					array(
						'status'         => 'void',
						'payment_status' => 'void',
						'due_amount'     => '0',
						'voided_at'      => $this->now(),
						'voided_by'      => $ctx->user_id,
						'updated_at'     => $this->now(),
					),
					array( 'id' => $id )
				);
				if ( 'completed' === $purchase['status'] ) {
					$this->payments->reallocateAdvances( $ctx, 'supplier', (int) $purchase['supplier_id'] );
				}
				$this->audit->log( $ctx, 'void', 'purchase', $id, 'Purchase voided ' . $purchase['number'] . ( $reason ? ': ' . Text::line( $reason ) : '' ) );
			}
		);
		$out = $this->get( $ctx, $id );
		$this->events->dispatch( 'bizledger/purchase/voided', $ctx, $out );
		return $out;
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'purchases.view' );
		$p  = $this->findScoped( $ctx, 'purchases', $id, 'Purchase' );
		$it = $this->db->table( 'purchase_items' );
		$rt = $this->db->table( 'returns' );
		$ct = $this->db->table( 'contacts' );
		$p['id']       = (int) $p['id'];
		$p['items']    = $this->db->rows( "SELECT * FROM {$it} WHERE purchase_id = %d AND business_id = %d ORDER BY sort_order, id", array( $id, $ctx->business_id ) );
		$p['payments'] = $this->payments->forDocument( $ctx, 'purchase', $id );
		$p['returns']  = $this->db->rows( "SELECT id, number, return_date, total, refund_amount, status FROM {$rt} WHERE business_id = %d AND return_type = 'purchase' AND document_id = %d ORDER BY id", array( $ctx->business_id, $id ) );
		$p['supplier'] = (int) $p['supplier_id'] ? $this->db->row( "SELECT id, code, name, company, phone, email, address, tax_number, balance FROM {$ct} WHERE id = %d AND business_id = %d", array( (int) $p['supplier_id'], $ctx->business_id ) ) : null;
		$p['meta']     = Json::decode( $p['meta'] ?? null );
		return $p;
	}

	/**
	 * @param array<string,mixed> $args from, to, supplier_id, status, payment_status, search, branch_id, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'purchases.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$pt     = $this->db->table( 'purchases' );
		$ct     = $this->db->table( 'contacts' );
		$where  = array( 'p.business_id = %d' );
		$params = array( $ctx->business_id );
		$status = (string) ( $args['status'] ?? 'completed' );
		if ( 'any' !== $status ) {
			$where[]  = 'p.status = %s';
			$params[] = in_array( $status, array( 'completed', 'draft', 'void' ), true ) ? $status : 'completed';
		}
		if ( in_array( $args['payment_status'] ?? '', array( 'paid', 'partial', 'due' ), true ) ) {
			$where[]  = 'p.payment_status = %s';
			$params[] = $args['payment_status'];
		}
		foreach ( array( 'supplier_id', 'branch_id', 'created_by' ) as $f ) {
			if ( isset( $args[ $f ] ) && '' !== $args[ $f ] ) {
				$where[]  = "p.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 'p.purchase_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 'p.purchase_date <= %s';
			$params[] = $to;
		}
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(p.number LIKE %s OR p.supplier_invoice LIKE %s OR c.name LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		$w    = implode( ' AND ', $where );
		$base = "FROM {$pt} p LEFT JOIN {$ct} c ON c.id = p.supplier_id WHERE {$w}";
		$agg  = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(p.total),0) AS total, COALESCE(SUM(p.paid_amount),0) AS paid, COALESCE(SUM(p.due_amount),0) AS due {$base}", $params );
		$rows = $this->db->rows(
			"SELECT p.id, p.number, p.supplier_invoice, p.purchase_date, p.supplier_id, c.name AS supplier_name, p.status, p.total, p.paid_amount, p.due_amount, p.return_amount, p.payment_status, p.created_at {$base} ORDER BY p.purchase_date DESC, p.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		$out            = $this->paged( $rows, (int) $agg['n'], $page, $per_page );
		$out['summary'] = array(
			'total' => Decimal::toString( Decimal::of( $agg['total'] ) ),
			'paid'  => Decimal::toString( Decimal::of( $agg['paid'] ) ),
			'due'   => Decimal::toString( Decimal::of( $agg['due'] ) ),
		);
		return $out;
	}

	/* ------------------------------------------------------------------ Internals */

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function prepare( BusinessContext $ctx, array $data ): array {
		$settings = $this->settings->all( $ctx );
		$places   = $ctx->decimals();
		$errors   = array();

		$supplier_id = max( 0, (int) ( $data['supplier_id'] ?? 0 ) );
		$supplier    = null;
		if ( $supplier_id ) {
			try {
				$supplier = $this->contacts->requireContact( $ctx, 'supplier', $supplier_id, 'supplier_id' );
			} catch ( ValidationException $e ) {
				$errors += $e->errors();
			}
		}
		$date = Text::date( $data['purchase_date'] ?? null ) ?? $this->today( $ctx );
		$due  = Text::date( $data['due_date'] ?? null );

		$tax_enabled = (bool) $settings['tax.enabled'];
		$tax_mode    = (string) $settings['tax.mode'];
		$doc_rate    = null;
		if ( $tax_enabled && 'invoice' === $tax_mode && ! empty( $data['tax_rate_id'] ) ) {
			$doc_rate = $this->taxes->find( $ctx, (int) $data['tax_rate_id'] );
		}

		$items = array_values( (array) ( $data['items'] ?? array() ) );
		if ( array() === $items ) {
			$errors['items'] = 'Add at least one product.';
		}
		$lines = array();
		$calc  = array();
		foreach ( $items as $i => $item ) {
			$field = "items.{$i}.product_id";
			try {
				$ref = $this->products->requireForTransaction( $ctx, (int) ( $item['product_id'] ?? 0 ), (int) ( $item['variant_id'] ?? 0 ), $field );
			} catch ( ValidationException $e ) {
				$errors += $e->errors();
				continue;
			}
			$product = $ref['product'];
			$variant = $ref['variant'];
			try {
				$qty   = Decimal::of( $item['qty'] ?? 1 );
				$price = isset( $item['unit_price'] ) && '' !== $item['unit_price'] ? Decimal::of( $item['unit_price'] ) : Decimal::of( $variant ? $variant['purchase_price'] : $product['purchase_price'] );
				$disc  = Decimal::of( $item['discount_value'] ?? 0 );
			} catch ( \InvalidArgumentException $e ) {
				$errors[ "items.{$i}.qty" ] = 'Enter valid numbers.';
				continue;
			}
			$rate      = 0;
			$inclusive = false;
			if ( $tax_enabled ) {
				$row = 'invoice' === $tax_mode ? $doc_rate : ( isset( $item['tax_rate_id'] ) && '' !== $item['tax_rate_id'] ? $this->taxes->find( $ctx, (int) $item['tax_rate_id'] ) : ( (int) $product['tax_rate_id'] ? $this->taxes->find( $ctx, (int) $product['tax_rate_id'] ) : null ) );
				if ( $row ) {
					$rate      = Decimal::of( $row['rate'] );
					$inclusive = 'invoice' !== $tax_mode && (bool) (int) $row['is_inclusive'];
				}
			}
			$name        = $product['name'] . ( $variant ? ' - ' . $variant['name'] : '' );
			$lines[ $i ] = array(
				'product_id'     => (int) $product['id'],
				'variant_id'     => $variant ? (int) $variant['id'] : 0,
				'name'           => $name,
				'sku'            => $variant && '' !== $variant['sku'] ? $variant['sku'] : $product['sku'],
				'track_stock'    => (int) $product['track_stock'],
				'discount_type'  => 'percent' === ( $item['discount_type'] ?? '' ) ? 'percent' : 'fixed',
				'discount_value' => $disc,
				'batch_no'       => Text::line( $item['batch_no'] ?? '', 60 ),
				'expiry_date'    => Text::date( $item['expiry_date'] ?? null ),
				'update_price'   => Text::bool( $item['update_price'] ?? false ),
			);
			$calc[ $i ]  = array(
				'qty'            => $qty,
				'unit_price'     => $price,
				'discount_type'  => $lines[ $i ]['discount_type'],
				'discount_value' => $disc,
				'tax_rate'       => $rate,
				'tax_inclusive'  => $inclusive,
			);
		}
		try {
			$doc_disc = Decimal::of( $data['discount_value'] ?? 0 );
			$shipping = Decimal::of( $data['shipping_amount'] ?? 0 );
			$other    = Decimal::of( $data['other_cost'] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			$errors['discount_value'] = 'Enter valid amounts.';
			$doc_disc = $shipping = $other = 0; // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$disc_type = 'percent' === ( $data['discount_type'] ?? '' ) ? 'percent' : 'fixed';
		$totals    = DocumentCalculator::calculate(
			$calc,
			array(
				'discount_type'  => $disc_type,
				'discount_value' => $doc_disc,
				'shipping'       => $shipping,
				'other'          => $other,
			),
			$places
		);

		// Landed cost allocation.
		$recoverable = (bool) $settings['tax.purchase_recoverable'];
		$weights     = array();
		foreach ( $totals['lines'] as $i => $l ) {
			$weights[ $i ] = $l['net_amount'];
		}
		$charges = Decimal::allocate( $totals['shipping'] + $totals['other'], $weights, 4 );
		foreach ( $lines as $i => &$line ) {
			$l                  = $totals['lines'][ $i ];
			$landed             = $l['net_amount'] + $charges[ $i ] + ( $recoverable ? 0 : $l['tax_amount'] );
			$line               = array_merge( $line, $l );
			$line['landed_cost'] = $landed;
			$line['unit_cost']   = Decimal::div( $landed, $l['qty'] );
		}
		unset( $line );

		return array(
			'supplier_id'      => $supplier_id,
			'supplier'         => $supplier,
			'purchase_date'    => $date,
			'due_date'         => $due,
			'supplier_invoice' => Text::line( $data['supplier_invoice'] ?? '', 80 ),
			'discount_type'    => $disc_type,
			'discount_value'   => $doc_disc,
			'notes'            => Text::multiline( $data['notes'] ?? '' ),
			'attachment_id'    => max( 0, (int) ( $data['attachment_id'] ?? 0 ) ),
			'recoverable'      => $recoverable,
			'lines'            => $lines,
			'totals'           => $totals,
		);
	}

	/**
	 * @param array<string,mixed> $doc Prepared.
	 * @return array<string,mixed>
	 */
	private function headerRow( array $doc ): array {
		$t = $doc['totals'];
		return array(
			'supplier_id'      => $doc['supplier_id'],
			'supplier_invoice' => $doc['supplier_invoice'],
			'purchase_date'    => $doc['purchase_date'],
			'due_date'         => $doc['due_date'],
			'subtotal'         => Decimal::toString( $t['subtotal'] ),
			'discount_type'    => $doc['discount_type'],
			'discount_value'   => Decimal::toString( $doc['discount_value'] ),
			'discount_amount'  => Decimal::toString( $t['discount'] ),
			'tax_amount'       => Decimal::toString( $t['tax'] ),
			'shipping_amount'  => Decimal::toString( $t['shipping'] ),
			'other_cost'       => Decimal::toString( $t['other'] ),
			'total'            => Decimal::toString( $t['total'] ),
			'notes'            => $doc['notes'],
			'attachment_id'    => $doc['attachment_id'],
		);
	}

	/**
	 * @param array<string,mixed> $doc Prepared.
	 */
	private function insertItems( BusinessContext $ctx, int $id, array $doc ): void {
		$it   = $this->db->table( 'purchase_items' );
		$sort = 0;
		foreach ( $doc['lines'] as $l ) {
			$this->db->insert(
				$it,
				array(
					'business_id'     => $ctx->business_id,
					'purchase_id'     => $id,
					'product_id'      => $l['product_id'],
					'variant_id'      => $l['variant_id'],
					'name'            => $l['name'],
					'sku'             => $l['sku'],
					'qty'             => Decimal::toString( $l['qty'] ),
					'unit_price'      => Decimal::toString( $l['unit_price'] ),
					'discount_type'   => $l['discount_type'],
					'discount_value'  => Decimal::toString( $l['discount_value'] ),
					'discount_amount' => Decimal::toString( $l['discount_amount'] ),
					'doc_discount'    => Decimal::toString( $l['doc_discount'] ),
					'tax_rate'        => Decimal::toString( $l['tax_rate'] ),
					'tax_inclusive'   => $l['tax_inclusive'],
					'tax_amount'      => Decimal::toString( $l['tax_amount'] ),
					'net_amount'      => Decimal::toString( $l['net_amount'] ),
					'total'           => Decimal::toString( $l['total'] ),
					'landed_cost'     => Decimal::toString( $l['landed_cost'] ),
					'unit_cost'       => Decimal::toString( $l['unit_cost'] ),
					'returned_qty'    => '0',
					'batch_no'        => $l['batch_no'],
					'expiry_date'     => $l['expiry_date'],
					'sort_order'      => $sort++,
				)
			);
		}
	}

	/**
	 * @param array<string,mixed>            $doc     Prepared.
	 * @param array<int,array<string,mixed>> $tenders account_id, amount, reference.
	 */
	private function finalise( BusinessContext $ctx, int $id, array $doc, array $tenders, bool $new_number = true, int $already_paid = 0 ): void {
		$pt     = $this->db->table( 'purchases' );
		$number = $new_number ? $this->numbers->next( $ctx, 'purchase', $doc['purchase_date'] ) : (string) $this->db->value( "SELECT number FROM {$pt} WHERE id = %d", array( $id ) );
		$t      = $doc['totals'];

		$rows = array();
		$paid = $already_paid;
		foreach ( array_values( $tenders ) as $i => $tender ) {
			try {
				$amount = Decimal::round( Decimal::of( $tender['amount'] ?? 0 ), $ctx->decimals() );
			} catch ( \InvalidArgumentException $e ) {
				throw ValidationException::field( "payments.{$i}.amount", 'Enter a valid amount.' );
			}
			if ( $amount <= 0 ) {
				continue;
			}
			$rows[] = array(
				'account_id' => (int) ( $tender['account_id'] ?? 0 ) ?: $this->accounts->systemId( $ctx->business_id, 'cash' ),
				'amount'     => $amount,
				'reference'  => Text::line( $tender['reference'] ?? '', 100 ),
				'field'      => "payments.{$i}.account_id",
			);
			$paid  += $amount;
		}
		if ( $paid > $t['total'] ) {
			throw ValidationException::field( 'payments', 'Paid amount is more than the purchase total.' );
		}
		if ( $paid < $t['total'] && 0 === $doc['supplier_id'] ) {
			throw ValidationException::field( 'supplier_id', 'Select a supplier for a purchase with due amount.' );
		}

		$inventory = 0;
		$expensed  = 0;
		$it        = $this->db->table( 'purchase_items' );
		$items     = $this->db->rows( "SELECT * FROM {$it} WHERE purchase_id = %d ORDER BY sort_order, id", array( $id ) );
		$keys      = array_keys( $doc['lines'] );
		foreach ( $items as $i => $item ) {
			$line   = $doc['lines'][ $keys[ $i ] ];
			$landed = Decimal::of( $item['landed_cost'] );
			if ( ! $line['track_stock'] ) {
				$expensed += $landed;
				continue;
			}
			$inventory += $landed;
			$this->stock->in(
				$ctx,
				array(
					'product_id' => (int) $item['product_id'],
					'variant_id' => (int) $item['variant_id'],
					'qty'        => Decimal::of( $item['qty'] ),
					'value'      => $landed,
				),
				array(
					'type'           => 'purchase',
					'date'           => $doc['purchase_date'],
					'reference_type' => 'purchase',
					'reference_id'   => $id,
					'reference_no'   => $number,
				)
			);
			if ( $line['update_price'] ) {
				$this->db->update(
					$this->db->table( (int) $item['variant_id'] ? 'product_variants' : 'products' ),
					array( 'purchase_price' => Decimal::toString( Decimal::of( $item['unit_price'] ) ) ),
					array( 'id' => (int) ( (int) $item['variant_id'] ?: $item['product_id'] ) )
				);
			}
		}

		$this->journal->post(
			$ctx,
			array(
				'date'         => $doc['purchase_date'],
				'source'       => 'purchase',
				'source_id'    => $id,
				'reference_no' => $number,
				'memo'         => 'Purchase ' . $number . ( $doc['supplier'] ? ' - ' . $doc['supplier']['name'] : '' ),
			),
			array(
				array( 'account' => 'inventory', 'debit' => $inventory ),
				array( 'account' => 'cogs', 'debit' => $expensed ),
				array( 'account' => 'tax_input', 'debit' => $doc['recoverable'] ? $t['tax'] : 0 ),
				array( 'account' => 'payable', 'credit' => $t['total'], 'contact_id' => $doc['supplier_id'] ),
			)
		);
		$this->db->update(
			$pt,
			array(
				'number'     => $number,
				'status'     => 'completed',
				'due_amount' => Decimal::toString( $t['total'] ),
			),
			array( 'id' => $id )
		);

		foreach ( $rows as $tender ) {
			$this->payments->record(
				$ctx,
				array(
					'direction'     => 'out',
					'party'         => 'supplier',
					'contact_id'    => $doc['supplier_id'],
					'account_id'    => $tender['account_id'],
					'amount_scaled' => $tender['amount'],
					'date'          => $doc['purchase_date'],
					'reference'     => $tender['reference'],
					'source'        => 'purchase',
					'source_id'     => $id,
					'field'         => $tender['field'],
					'memo'          => 'Payment for ' . $number,
					'allocations'   => array(
						array(
							'document_type' => 'purchase',
							'document_id'   => $id,
							'amount'        => $tender['amount'],
						),
					),
				)
			);
		}
		$this->payments->recalc( $ctx, 'purchase', $id );
		if ( $new_number ) {
			$this->audit->log( $ctx, 'create', 'purchase', $id, sprintf( 'Purchase %s created, total %s', $number, Decimal::toString( $t['total'], $ctx->decimals() ) ) );
		}
	}

	/**
	 * @param array<string,mixed> $purchase Row.
	 */
	private function reverseEffects( BusinessContext $ctx, array $purchase, bool $void_tenders, string $why ): void {
		$id       = (int) $purchase['id'];
		$it       = $this->db->table( 'purchase_items' );
		$pt       = $this->db->table( 'products' );
		$items    = $this->db->rows( "SELECT i.*, p.track_stock FROM {$it} i LEFT JOIN {$pt} p ON p.id = i.product_id WHERE i.purchase_id = %d", array( $id ) );
		$variance = 0;
		$removed  = 0;
		foreach ( $items as $item ) {
			if ( ! (int) $item['track_stock'] ) {
				continue;
			}
			$res       = $this->stock->out(
				$ctx,
				array(
					'product_id' => (int) $item['product_id'],
					'variant_id' => (int) $item['variant_id'],
					'qty'        => Decimal::of( $item['qty'] ),
					'value'      => Decimal::of( $item['landed_cost'] ),
				),
				array(
					'type'           => 'purchase_void',
					'date'           => $this->today( $ctx ),
					'reference_type' => 'purchase',
					'reference_id'   => $id,
					'reference_no'   => (string) $purchase['number'],
					'note'           => $why . ' of purchase',
					'product_name'   => $item['name'],
					'branch_id'      => (int) $purchase['branch_id'],
				)
			);
			$variance += $res['variance'];
			$removed  += $res['cost'];
		}
		$this->journal->reverseSource( $ctx, 'purchase', $id, null, $why . ' purchase ' . $purchase['number'] );
		if ( 0 !== $variance ) {
			// Reversal credited inventory at landed cost; stock actually released $removed.
			$this->journal->post(
				$ctx,
				array(
					'date'         => $this->today( $ctx ),
					'source'       => 'purchase_variance',
					'source_id'    => $id,
					'reference_no' => (string) $purchase['number'],
					'memo'         => 'Cost variance on ' . strtolower( $why ) . ' of purchase ' . $purchase['number'],
				),
				array(
					array( 'account' => 'inventory', 'debit' => $variance ),
					array( 'account' => 'inventory_adjustment', 'credit' => $variance ),
				)
			);
		}
		if ( $void_tenders ) {
			foreach ( $this->payments->forSource( $ctx, 'purchase', $id ) as $p ) {
				$this->payments->void( $ctx, (int) $p['id'], $why . ' of purchase', false );
			}
		}
		$this->payments->detachDocument( $ctx, 'purchase', $id );
	}

	/**
	 * @param array<string,mixed> $p Row.
	 * @return array<string,mixed>
	 */
	private function asInput( BusinessContext $ctx, int $id, array $p ): array {
		$it    = $this->db->table( 'purchase_items' );
		$items = $this->db->rows( "SELECT * FROM {$it} WHERE purchase_id = %d AND business_id = %d ORDER BY sort_order, id", array( $id, $ctx->business_id ) );
		return array(
			'supplier_id'      => (int) $p['supplier_id'],
			'supplier_invoice' => $p['supplier_invoice'],
			'purchase_date'    => $p['purchase_date'],
			'due_date'         => $p['due_date'],
			'discount_type'    => $p['discount_type'],
			'discount_value'   => $p['discount_value'],
			'shipping_amount'  => $p['shipping_amount'],
			'other_cost'       => $p['other_cost'],
			'notes'            => $p['notes'],
			'items'            => array_map(
				static fn( $i ) => array(
					'product_id'     => (int) $i['product_id'],
					'variant_id'     => (int) $i['variant_id'],
					'qty'            => $i['qty'],
					'unit_price'     => $i['unit_price'],
					'discount_type'  => $i['discount_type'],
					'discount_value' => $i['discount_value'],
					'batch_no'       => $i['batch_no'],
					'expiry_date'    => $i['expiry_date'],
				),
				$items
			),
		);
	}
}
