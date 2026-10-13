<?php
/**
 * Sales and POS.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Sales;

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
 * Sale lifecycle: held/draft → completed → (edited) → void.
 *
 * Completing a sale, in one transaction:
 *   1. stock out per tracked item at weighted-average cost (cost stored on the line)
 *   2. journal: Dr Receivable / Cr Sales, Output Tax, Shipping ; Dr COGS / Cr Inventory
 *   3. tenders recorded as payments allocated to the sale
 *   4. paid/due/status recomputed, audit + events
 */
final class SaleService extends Service {

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
	 * Create a sale (completed, held or draft). Idempotent on `uuid`.
	 *
	 * @param array<string,mixed> $data See class docs / API.md.
	 * @return array<string,mixed> The saved sale.
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'sales.create' );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		if ( $uuid ) {
			$t        = $this->db->table( 'sales' );
			$existing = $this->db->value( "SELECT id FROM {$t} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->get( $ctx, (int) $existing );
			}
		}
		$status = in_array( $data['status'] ?? 'completed', array( 'completed', 'held', 'draft' ), true ) ? ( $data['status'] ?? 'completed' ) : 'completed';
		$doc    = $this->prepare( $ctx, $data );

		$id = $this->db->transaction(
			function () use ( $ctx, $data, $doc, $status, $uuid ) {
				$id = $this->insertSale( $ctx, $doc, $status, $uuid );
				if ( 'completed' === $status ) {
					$this->finalise( $ctx, $id, $doc, $data['payments'] ?? array() );
				} else {
					$this->db->update( $this->db->table( 'sales' ), array( 'number' => strtoupper( $status ) . '-' . $id ), array( 'id' => $id ) );
					$this->audit->log( $ctx, 'create', 'sale', $id, ucfirst( $status ) . ' sale saved' );
				}
				return $id;
			}
		);

		$sale = $this->get( $ctx, $id );
		if ( 'completed' === $status ) {
			$this->events->dispatch( 'bizledger/sale/completed', $ctx, $sale );
		}
		return $sale;
	}

	/**
	 * Complete a held/draft sale, optionally with updated content.
	 *
	 * @param array<string,mixed> $data Optional new content + payments.
	 * @return array<string,mixed>
	 */
	public function complete( BusinessContext $ctx, int $id, array $data ): array {
		$ctx->authorize( 'sales.create' );
		$sale = $this->findScoped( $ctx, 'sales', $id, 'Sale' );
		if ( ! in_array( $sale['status'], array( 'held', 'draft' ), true ) ) {
			throw new ConflictException( 'Only held or draft sales can be completed.' );
		}
		$doc = $this->prepare( $ctx, array_merge( $this->asInput( $ctx, $id, $sale ), $data ) );
		$this->db->transaction(
			function () use ( $ctx, $id, $doc, $data ) {
				$this->replaceContent( $ctx, $id, $doc, 'completed' );
				$this->finalise( $ctx, $id, $doc, $data['payments'] ?? array() );
			}
		);
		$out = $this->get( $ctx, $id );
		$this->events->dispatch( 'bizledger/sale/completed', $ctx, $out );
		return $out;
	}

	/**
	 * Edit a sale. Completed sales are reversed and re-posted atomically.
	 *
	 * @param array<string,mixed> $data New content. `payments` (if given) replace the tenders taken with the sale.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $id, array $data ): array {
		$ctx->authorize( 'sales.edit' );
		$sale = $this->findScoped( $ctx, 'sales', $id, 'Sale' );
		if ( 'void' === $sale['status'] ) {
			throw new ConflictException( 'A voided sale cannot be edited.' );
		}
		if ( Decimal::of( $sale['return_amount'] ) > 0 ) {
			throw new ConflictException( 'This sale has returns. Void the returns before editing it.' );
		}
		$before = $this->get( $ctx, $id );
		$input  = array_merge( $this->asInput( $ctx, $id, $sale ), $data );
		$doc    = $this->prepare( $ctx, $input, $id );

		$this->db->transaction(
			function () use ( $ctx, $id, $sale, $doc, $data ) {
				if ( 'completed' !== $sale['status'] ) {
					$this->replaceContent( $ctx, $id, $doc, (string) $sale['status'] );
					return;
				}
				$tenders = array_key_exists( 'payments', $data ) ? (array) $data['payments'] : null;
				$kept    = null === $tenders ? $this->payments->forSource( $ctx, 'sale', $id ) : array();
				$kept_sum = Decimal::sum( array_map( static fn( $p ) => Decimal::of( $p['amount'] ), $kept ) );
				if ( $kept_sum > $doc['totals']['total'] ) {
					throw ValidationException::field( 'payments', 'The new total is less than the amount already paid. Update the payments as well.' );
				}
				$this->reverseEffects( $ctx, $sale, null !== $tenders, 'Edit' );
				$this->replaceContent( $ctx, $id, $doc, 'completed', (string) $sale['number'] );
				$this->finalise( $ctx, $id, $doc, $tenders ?? array(), false, $kept_sum );
				foreach ( $kept as $p ) {
					$this->payments->attach( $ctx, (int) $p['id'], 'sale', $id );
				}
				// Re-attach payments that were allocated before the edit.
				$this->payments->reallocateAdvances( $ctx, 'customer', (int) $doc['customer_id'] );
				if ( (int) $sale['customer_id'] !== (int) $doc['customer_id'] ) {
					$this->payments->reallocateAdvances( $ctx, 'customer', (int) $sale['customer_id'] );
				}
				$this->payments->recalc( $ctx, 'sale', $id );
			}
		);
		$after = $this->get( $ctx, $id );
		$this->audit->log(
			$ctx,
			'update',
			'sale',
			$id,
			'Sale edited ' . $after['number'],
			array(
				'total' => array( $before['total'], $after['total'] ),
				'items' => array( count( $before['items'] ), count( $after['items'] ) ),
			)
		);
		$this->events->dispatch( 'bizledger/sale/updated', $ctx, $after );
		return $after;
	}

	/**
	 * Void (soft delete) a sale with full reversal.
	 */
	public function void( BusinessContext $ctx, int $id, string $reason = '' ): array {
		$ctx->authorize( 'sales.delete' );
		$sale = $this->findScoped( $ctx, 'sales', $id, 'Sale' );
		if ( 'void' === $sale['status'] ) {
			return $this->get( $ctx, $id );
		}
		$rt     = $this->db->table( 'returns' );
		$active = (int) $this->db->value( "SELECT COUNT(*) FROM {$rt} WHERE business_id = %d AND return_type = 'sale' AND document_id = %d AND status = 'completed'", array( $ctx->business_id, $id ) );
		if ( $active ) {
			throw new ConflictException( 'This sale has returns. Void the returns first.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $sale, $id, $reason ) {
				if ( 'completed' === $sale['status'] ) {
					$this->reverseEffects( $ctx, $sale, true, 'Void' );
				}
				$this->db->update(
					$this->db->table( 'sales' ),
					array(
						'status'         => 'void',
						'payment_status' => 'void',
						'due_amount'     => '0',
						'voided_at'      => $this->now(),
						'voided_by'      => $ctx->user_id,
						'updated_at'     => $this->now(),
						'updated_by'     => $ctx->user_id,
					),
					array( 'id' => $id )
				);
				if ( 'completed' === $sale['status'] ) {
					$this->payments->reallocateAdvances( $ctx, 'customer', (int) $sale['customer_id'] );
				}
				$this->audit->log( $ctx, 'void', 'sale', $id, 'Sale voided ' . $sale['number'] . ( $reason ? ': ' . Text::line( $reason ) : '' ) );
			}
		);
		$out = $this->get( $ctx, $id );
		$this->events->dispatch( 'bizledger/sale/voided', $ctx, $out );
		return $out;
	}

	/**
	 * Full sale with items, payments, returns and customer.
	 *
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'sales.view' );
		$sale = $this->findScoped( $ctx, 'sales', $id, 'Sale' );
		$it   = $this->db->table( 'sale_items' );
		$rt   = $this->db->table( 'returns' );
		$bt   = $this->db->table( 'branches' );
		$sale['items']    = $this->db->rows( "SELECT * FROM {$it} WHERE sale_id = %d AND business_id = %d ORDER BY sort_order, id", array( $id, $ctx->business_id ) );
		$sale['payments'] = $this->payments->forDocument( $ctx, 'sale', $id );
		$sale['returns']  = $this->db->rows( "SELECT id, number, return_date, total, refund_amount, status FROM {$rt} WHERE business_id = %d AND return_type = 'sale' AND document_id = %d ORDER BY id", array( $ctx->business_id, $id ) );
		$ct               = $this->db->table( 'contacts' );
		$sale['customer'] = (int) $sale['customer_id'] > 0 ? $this->db->row( "SELECT id, code, name, company, phone, email, address, tax_number, balance FROM {$ct} WHERE id = %d AND business_id = %d", array( (int) $sale['customer_id'], $ctx->business_id ) ) : null;
		$sale['branch']   = $this->db->row( "SELECT id, name, address, phone FROM {$bt} WHERE id = %d", array( (int) $sale['branch_id'] ) );
		$sale['meta']     = Json::decode( $sale['meta'] ?? null );
		if ( $ctx->can( 'reports.profit' ) ) {
			$net                  = Decimal::sum( array_map( static fn( $i ) => Decimal::of( $i['net_amount'] ), $sale['items'] ) );
			$sale['gross_profit'] = Decimal::toString( $net - Decimal::of( $sale['cost_amount'] ) );
		} else {
			unset( $sale['cost_amount'] );
			foreach ( $sale['items'] as &$item ) {
				unset( $item['unit_cost'], $item['cost_amount'] );
			}
		}
		$sale['id'] = (int) $sale['id'];
		return $sale;
	}

	/**
	 * Paged sales list.
	 *
	 * @param array<string,mixed> $args from, to, customer_id, status, payment_status, created_by, branch_id, search, channel, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'sales.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$st     = $this->db->table( 'sales' );
		$ct     = $this->db->table( 'contacts' );
		$where  = array( 's.business_id = %d' );
		$params = array( $ctx->business_id );

		$status = (string) ( $args['status'] ?? 'completed' );
		if ( 'any' !== $status ) {
			$where[]  = 's.status = %s';
			$params[] = in_array( $status, array( 'completed', 'held', 'draft', 'void' ), true ) ? $status : 'completed';
		}
		if ( in_array( $args['payment_status'] ?? '', array( 'paid', 'partial', 'due' ), true ) ) {
			$where[]  = 's.payment_status = %s';
			$params[] = $args['payment_status'];
		}
		if ( ! empty( $args['unpaid'] ) ) {
			$where[] = 's.due_amount > 0';
		}
		foreach ( array( 'customer_id', 'created_by', 'branch_id' ) as $f ) {
			if ( isset( $args[ $f ] ) && '' !== $args[ $f ] && null !== $args[ $f ] ) {
				$where[]  = "s.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( ! empty( $args['channel'] ) ) {
			$where[]  = 's.channel = %s';
			$params[] = Text::key( $args['channel'] );
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 's.sale_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 's.sale_date <= %s';
			$params[] = $to;
		}
		foreach ( array( 'min_total' => '>=', 'max_total' => '<=' ) as $f => $op ) {
			if ( isset( $args[ $f ] ) && '' !== $args[ $f ] ) {
				$where[]  = "s.total {$op} %s";
				$params[] = Decimal::toString( Decimal::of( $args[ $f ] ) );
			}
		}
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(s.number LIKE %s OR c.name LIKE %s OR c.phone LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		$w    = implode( ' AND ', $where );
		$base = "FROM {$st} s LEFT JOIN {$ct} c ON c.id = s.customer_id WHERE {$w}";
		$agg  = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(s.total),0) AS total, COALESCE(SUM(s.paid_amount),0) AS paid, COALESCE(SUM(s.due_amount),0) AS due {$base}", $params );
		$rows = $this->db->rows(
			"SELECT s.id, s.number, s.sale_date, s.customer_id, c.name AS customer_name, c.phone AS customer_phone, s.status, s.channel, s.total, s.paid_amount, s.due_amount, s.return_amount, s.payment_status, s.created_by, s.created_at {$base} ORDER BY s.sale_date DESC, s.id DESC LIMIT %d OFFSET %d",
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

	/**
	 * Server-side totals preview (POS shows these before saving).
	 *
	 * @param array<string,mixed> $data Same as create().
	 * @return array<string,mixed>
	 */
	public function quote( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'sales.create' );
		$doc = $this->prepare( $ctx, $data, 0, false );
		return $this->presentTotals( $doc );
	}

	/* ------------------------------------------------------------------ Internals */

	/**
	 * Validate input and compute every amount.
	 *
	 * @param array<string,mixed> $data Raw input.
	 * @return array<string,mixed> Normalised document.
	 */
	private function prepare( BusinessContext $ctx, array $data, int $sale_id = 0, bool $strict = true ): array {
		$settings = $this->settings->all( $ctx );
		$errors   = array();
		$places   = $ctx->decimals();

		$customer_id = max( 0, (int) ( $data['customer_id'] ?? 0 ) );
		$customer    = null;
		if ( $customer_id ) {
			try {
				$customer = $this->contacts->requireContact( $ctx, 'customer', $customer_id, 'customer_id' );
			} catch ( ValidationException $e ) {
				$errors += $e->errors();
			}
		}

		$date = Text::date( $data['sale_date'] ?? null ) ?? $this->today( $ctx );
		$due  = Text::date( $data['due_date'] ?? null );
		if ( $due && $due < $date ) {
			$errors['due_date'] = 'Due date cannot be before the sale date.';
		}
		$price_type = 'wholesale' === ( $data['price_type'] ?? '' ) ? 'wholesale' : 'retail';

		$tax_enabled = (bool) $settings['tax.enabled'];
		$tax_mode    = (string) $settings['tax.mode'];
		$doc_rate    = null;
		if ( $tax_enabled && 'invoice' === $tax_mode ) {
			$doc_rate = ! empty( $data['tax_rate_id'] ) ? $this->taxes->find( $ctx, (int) $data['tax_rate_id'] ) : $this->taxes->default( $ctx );
		}

		$items = array_values( (array) ( $data['items'] ?? array() ) );
		if ( array() === $items ) {
			$errors['items'] = 'Add at least one product.';
		}
		$lines      = array();
		$calc_lines = array();
		$has_disc   = false;
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
			if ( 'active' !== $product['status'] && ! $sale_id ) {
				$errors[ $field ] = sprintf( '%s is inactive.', $product['name'] );
				continue;
			}
			try {
				$qty = Decimal::of( $item['qty'] ?? 1 );
			} catch ( \InvalidArgumentException $e ) {
				$errors[ "items.{$i}.qty" ] = 'Enter a valid quantity.';
				continue;
			}
			$default_price = $variant ? Decimal::of( $variant['selling_price'] ) : Decimal::of( 'wholesale' === $price_type && Decimal::of( $product['wholesale_price'] ) > 0 ? $product['wholesale_price'] : $product['selling_price'] );
			try {
				$price = isset( $item['unit_price'] ) && '' !== $item['unit_price'] ? Decimal::of( $item['unit_price'] ) : $default_price;
			} catch ( \InvalidArgumentException $e ) {
				$errors[ "items.{$i}.unit_price" ] = 'Enter a valid price.';
				continue;
			}
			if ( $price !== $default_price && ! $ctx->can( 'sales.price' ) && $strict ) {
				$errors[ "items.{$i}.unit_price" ] = 'You are not allowed to change prices.';
			}
			$min = Decimal::of( $product['min_selling_price'] );
			if ( $min > 0 && $price < $min && ! $settings['sales.allow_below_min_price'] ) {
				$errors[ "items.{$i}.unit_price" ] = sprintf( 'Price for %1$s cannot be below %2$s.', $product['name'], Decimal::toString( $min, $places ) );
			}
			$disc_type  = 'percent' === ( $item['discount_type'] ?? '' ) ? 'percent' : 'fixed';
			$disc_value = Decimal::of( $item['discount_value'] ?? 0 );
			if ( 0 !== $disc_value ) {
				$has_disc = true;
			}

			$rate      = 0;
			$inclusive = false;
			if ( $tax_enabled ) {
				$rate_row = null;
				if ( 'invoice' === $tax_mode ) {
					$rate_row = $doc_rate;
				} elseif ( isset( $item['tax_rate_id'] ) && '' !== $item['tax_rate_id'] ) {
					$rate_row = $this->taxes->find( $ctx, (int) $item['tax_rate_id'] );
				} elseif ( (int) $product['tax_rate_id'] ) {
					$rate_row = $this->taxes->find( $ctx, (int) $product['tax_rate_id'] );
				} else {
					$rate_row = $this->taxes->default( $ctx );
				}
				if ( $rate_row ) {
					$rate      = Decimal::of( $rate_row['rate'] );
					$inclusive = 'invoice' !== $tax_mode && (bool) (int) $rate_row['is_inclusive'];
				}
			}

			$name         = $product['name'] . ( $variant ? ' - ' . $variant['name'] : '' );
			$lines[ $i ]  = array(
				'product_id'     => (int) $product['id'],
				'variant_id'     => $variant ? (int) $variant['id'] : 0,
				'name'           => Text::line( $item['name'] ?? $name ) ?: $name,
				'sku'            => $variant && '' !== $variant['sku'] ? $variant['sku'] : $product['sku'],
				'track_stock'    => (int) $product['track_stock'],
				'discount_type'  => $disc_type,
				'discount_value' => $disc_value,
			);
			$calc_lines[ $i ] = array(
				'qty'            => $qty,
				'unit_price'     => $price,
				'discount_type'  => $disc_type,
				'discount_value' => $disc_value,
				'tax_rate'       => $rate,
				'tax_inclusive'  => $inclusive,
			);
		}

		$doc_disc_type  = 'percent' === ( $data['discount_type'] ?? '' ) ? 'percent' : 'fixed';
		$doc_disc_value = 0;
		$shipping       = 0;
		try {
			$doc_disc_value = Decimal::of( $data['discount_value'] ?? 0 );
			$shipping       = Decimal::of( $data['shipping_amount'] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			$errors['discount_value'] = 'Enter valid amounts.';
		}
		if ( ( $has_disc || 0 !== $doc_disc_value ) && ! $ctx->can( 'sales.discount' ) && $strict ) {
			$errors['discount_value'] = 'You are not allowed to give discounts.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		$totals = DocumentCalculator::calculate(
			$calc_lines,
			array(
				'discount_type'  => $doc_disc_type,
				'discount_value' => $doc_disc_value,
				'shipping'       => $shipping,
			),
			$places
		);
		$totals = (array) $this->events->filter( 'bizledger/sale/totals', $totals, $data, $ctx );

		foreach ( $lines as $i => &$line ) {
			$line = array_merge( $line, $totals['lines'][ $i ] );
		}
		unset( $line );

		return array(
			'customer_id'    => $customer_id,
			'customer'       => $customer,
			'sale_date'      => $date,
			'due_date'       => $due,
			'price_type'     => $price_type,
			'channel'        => 'pos' === ( $data['channel'] ?? '' ) ? 'pos' : 'backoffice',
			'discount_type'  => $doc_disc_type,
			'discount_value' => $doc_disc_value,
			'notes'          => Text::multiline( $data['notes'] ?? '' ),
			'meta'           => is_array( $data['meta'] ?? null ) ? array_map( static fn( $v ) => is_scalar( $v ) ? Text::line( $v ) : '', $data['meta'] ) : array(),
			'lines'          => $lines,
			'totals'         => $totals,
		);
	}

	/**
	 * @param array<string,mixed> $doc Prepared document.
	 */
	private function insertSale( BusinessContext $ctx, array $doc, string $status, ?string $uuid ): int {
		$now = $this->now();
		$id  = $this->db->insert(
			$this->db->table( 'sales' ),
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
		return $id;
	}

	/**
	 * @param array<string,mixed> $doc Prepared document.
	 * @return array<string,mixed>
	 */
	private function headerRow( array $doc ): array {
		$t = $doc['totals'];
		return array(
			'sale_date'       => $doc['sale_date'],
			'due_date'        => $doc['due_date'],
			'customer_id'     => $doc['customer_id'],
			'channel'         => $doc['channel'],
			'price_type'      => $doc['price_type'],
			'subtotal'        => Decimal::toString( $t['subtotal'] ),
			'discount_type'   => $doc['discount_type'],
			'discount_value'  => Decimal::toString( $doc['discount_value'] ),
			'discount_amount' => Decimal::toString( $t['discount'] ),
			'tax_amount'      => Decimal::toString( $t['tax'] ),
			'shipping_amount' => Decimal::toString( $t['shipping'] ),
			'total'           => Decimal::toString( $t['total'] ),
			'due_amount'      => '0',
			'paid_amount'     => '0',
			'cost_amount'     => '0',
			'notes'           => $doc['notes'],
			'meta'            => $doc['meta'] ? Json::encode( $doc['meta'] ) : null,
		);
	}

	/**
	 * @param array<string,mixed> $doc Prepared document.
	 */
	private function insertItems( BusinessContext $ctx, int $sale_id, array $doc ): void {
		$it   = $this->db->table( 'sale_items' );
		$sort = 0;
		foreach ( $doc['lines'] as $l ) {
			$this->db->insert(
				$it,
				array(
					'business_id'     => $ctx->business_id,
					'sale_id'         => $sale_id,
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
					'unit_cost'       => '0',
					'cost_amount'     => '0',
					'returned_qty'    => '0',
					'sort_order'      => $sort++,
				)
			);
		}
	}

	/**
	 * @param array<string,mixed> $doc Prepared document.
	 */
	private function replaceContent( BusinessContext $ctx, int $id, array $doc, string $status, string $number = '' ): void {
		$row = $this->headerRow( $doc );
		$row = array_merge(
			$row,
			array(
				'status'     => $status,
				'updated_by' => $ctx->user_id,
				'updated_at' => $this->now(),
			)
		);
		if ( '' !== $number ) {
			$row['number'] = $number;
		}
		$this->db->update( $this->db->table( 'sales' ), $row, array( 'id' => $id ) );
		$this->db->execute( 'DELETE FROM ' . $this->db->table( 'sale_items' ) . ' WHERE sale_id = %d AND business_id = %d', array( $id, $ctx->business_id ) );
		$this->insertItems( $ctx, $id, $doc );
	}

	/**
	 * Apply stock, ledger and payments for a completed sale.
	 *
	 * @param array<string,mixed>            $doc     Prepared document.
	 * @param array<int,array<string,mixed>> $tenders account_id, amount, reference.
	 */
	private function finalise( BusinessContext $ctx, int $id, array $doc, array $tenders, bool $new_number = true, int $already_paid = 0 ): void {
		$settings = $this->settings->all( $ctx );
		$st       = $this->db->table( 'sales' );
		$number   = $new_number ? $this->numbers->next( $ctx, 'sale', $doc['sale_date'] ) : (string) $this->db->value( "SELECT number FROM {$st} WHERE id = %d", array( $id ) );
		$t        = $doc['totals'];

		// Validate tenders before touching stock.
		$tender_rows = array();
		$paid        = $already_paid;
		foreach ( array_values( $tenders ) as $i => $tender ) {
			try {
				$amount = Decimal::round( Decimal::of( $tender['amount'] ?? 0 ), $ctx->decimals() );
			} catch ( \InvalidArgumentException $e ) {
				throw ValidationException::field( "payments.{$i}.amount", 'Enter a valid amount.' );
			}
			if ( 0 === $amount ) {
				continue;
			}
			if ( $amount < 0 ) {
				throw ValidationException::field( "payments.{$i}.amount", 'Payment cannot be negative.' );
			}
			$account_id    = (int) ( $tender['account_id'] ?? 0 ) ?: $this->accounts->defaultPaymentAccount( $ctx, (int) $settings['sales.default_payment_account'] );
			$tender_rows[] = array(
				'account_id' => $account_id,
				'amount'     => $amount,
				'reference'  => Text::line( $tender['reference'] ?? '', 100 ),
				'field'      => "payments.{$i}.account_id",
			);
			$paid += $amount;
		}
		if ( $paid > $t['total'] ) {
			throw ValidationException::field( 'payments', 'Paid amount is more than the invoice total. Enter the change separately.' );
		}
		$due = $t['total'] - $paid;
		if ( $due > 0 && 0 === $doc['customer_id'] && ! $settings['sales.allow_credit_walkin'] ) {
			throw ValidationException::field( 'customer_id', 'Select a customer for a sale with due amount.' );
		}
		if ( $due > 0 && $doc['customer'] && $settings['sales.enforce_credit_limit'] ) {
			$limit = Decimal::of( $doc['customer']['credit_limit'] );
			$ct    = $this->db->table( 'contacts' );
			$owing = Decimal::of( $this->db->value( "SELECT balance FROM {$ct} WHERE id = %d", array( $doc['customer_id'] ) ) );
			if ( $limit > 0 && $owing + $due > $limit ) {
				throw ValidationException::field( 'customer_id', sprintf( 'Credit limit exceeded: limit %1$s, current due %2$s.', Decimal::toString( $limit, $ctx->decimals() ), Decimal::toString( $owing, $ctx->decimals() ) ) );
			}
		}

		// 1. Stock.
		$it    = $this->db->table( 'sale_items' );
		$items = $this->db->rows( "SELECT * FROM {$it} WHERE sale_id = %d ORDER BY sort_order, id", array( $id ) );
		$cogs  = 0;
		foreach ( $items as $i => $item ) {
			$line = $doc['lines'][ array_keys( $doc['lines'] )[ $i ] ];
			if ( ! $line['track_stock'] ) {
				continue;
			}
			$res = $this->stock->out(
				$ctx,
				array(
					'product_id' => (int) $item['product_id'],
					'variant_id' => (int) $item['variant_id'],
					'qty'        => Decimal::of( $item['qty'] ),
				),
				array(
					'type'           => 'sale',
					'date'           => $doc['sale_date'],
					'reference_type' => 'sale',
					'reference_id'   => $id,
					'reference_no'   => $number,
					'product_name'   => $item['name'],
					'field'          => "items.{$i}.qty",
				)
			);
			$cogs += $res['cost'];
			$this->db->update(
				$it,
				array(
					'unit_cost'   => Decimal::toString( $res['unit_cost'] ),
					'cost_amount' => Decimal::toString( $res['cost'] ),
				),
				array( 'id' => (int) $item['id'] )
			);
		}

		// 2. Ledger.
		$this->journal->post(
			$ctx,
			array(
				'date'         => $doc['sale_date'],
				'source'       => 'sale',
				'source_id'    => $id,
				'reference_no' => $number,
				'memo'         => 'Sale ' . $number . ( $doc['customer'] ? ' - ' . $doc['customer']['name'] : '' ),
			),
			array(
				array( 'account' => 'receivable', 'debit' => $t['total'], 'contact_id' => $doc['customer_id'] ),
				array( 'account' => 'sales', 'credit' => $t['net'] ),
				array( 'account' => 'tax_output', 'credit' => $t['tax'] ),
				array( 'account' => 'shipping_income', 'credit' => $t['shipping'] ),
				array( 'account' => 'cogs', 'debit' => $cogs ),
				array( 'account' => 'inventory', 'credit' => $cogs ),
			)
		);

		$this->db->update(
			$st,
			array(
				'number'      => $number,
				'status'      => 'completed',
				'cost_amount' => Decimal::toString( $cogs ),
				'due_amount'  => Decimal::toString( $t['total'] ),
			),
			array( 'id' => $id )
		);

		// 3. Payments.
		foreach ( $tender_rows as $tender ) {
			$this->payments->record(
				$ctx,
				array(
					'direction'     => 'in',
					'party'         => 'customer',
					'contact_id'    => $doc['customer_id'],
					'account_id'    => $tender['account_id'],
					'amount_scaled' => $tender['amount'],
					'date'          => $doc['sale_date'],
					'reference'     => $tender['reference'],
					'source'        => 'sale',
					'source_id'     => $id,
					'field'         => $tender['field'],
					'memo'          => 'Payment for ' . $number,
					'allocations'   => array(
						array(
							'document_type' => 'sale',
							'document_id'   => $id,
							'amount'        => $tender['amount'],
						),
					),
				)
			);
		}
		$this->payments->recalc( $ctx, 'sale', $id );

		if ( $new_number ) {
			$this->audit->log( $ctx, 'create', 'sale', $id, sprintf( 'Sale %s created, total %s', $number, Decimal::toString( $t['total'], $ctx->decimals() ) ) );
		}
	}

	/**
	 * Undo the stock, ledger and (optionally) tender effects of a completed sale.
	 *
	 * @param array<string,mixed> $sale Sale row.
	 */
	private function reverseEffects( BusinessContext $ctx, array $sale, bool $void_tenders, string $why ): void {
		$id    = (int) $sale['id'];
		$it    = $this->db->table( 'sale_items' );
		$items = $this->db->rows( "SELECT * FROM {$it} WHERE sale_id = %d", array( $id ) );
		foreach ( $items as $item ) {
			$cost = Decimal::of( $item['cost_amount'] );
			$qty  = Decimal::of( $item['qty'] );
			$pt   = $this->db->table( 'products' );
			$trk  = (int) $this->db->value( "SELECT track_stock FROM {$pt} WHERE id = %d", array( (int) $item['product_id'] ) );
			if ( ! $trk || $qty <= 0 ) {
				continue;
			}
			$this->stock->in(
				$ctx,
				array(
					'product_id' => (int) $item['product_id'],
					'variant_id' => (int) $item['variant_id'],
					'qty'        => $qty,
					'value'      => $cost,
				),
				array(
					'type'           => 'sale_void',
					'date'           => $this->today( $ctx ),
					'reference_type' => 'sale',
					'reference_id'   => $id,
					'reference_no'   => (string) $sale['number'],
					'note'           => $why . ' of sale',
					'branch_id'      => (int) $sale['branch_id'],
				)
			);
		}
		$this->journal->reverseSource( $ctx, 'sale', $id, null, $why . ' sale ' . $sale['number'] );

		if ( $void_tenders ) {
			foreach ( $this->payments->forSource( $ctx, 'sale', $id ) as $p ) {
				$this->payments->void( $ctx, (int) $p['id'], $why . ' of sale', false );
			}
		}
		$this->payments->detachDocument( $ctx, 'sale', $id );
	}

	/**
	 * Convert a stored sale back into create() input (for partial updates).
	 *
	 * @param array<string,mixed> $sale Row.
	 * @return array<string,mixed>
	 */
	private function asInput( BusinessContext $ctx, int $id, array $sale ): array {
		$it    = $this->db->table( 'sale_items' );
		$items = $this->db->rows( "SELECT * FROM {$it} WHERE sale_id = %d AND business_id = %d ORDER BY sort_order, id", array( $id, $ctx->business_id ) );
		return array(
			'customer_id'     => (int) $sale['customer_id'],
			'sale_date'       => $sale['sale_date'],
			'due_date'        => $sale['due_date'],
			'price_type'      => $sale['price_type'],
			'channel'         => $sale['channel'],
			'discount_type'   => $sale['discount_type'],
			'discount_value'  => $sale['discount_value'],
			'shipping_amount' => $sale['shipping_amount'],
			'notes'           => $sale['notes'],
			'meta'            => Json::decode( $sale['meta'] ?? null ),
			'items'           => array_map(
				static fn( $i ) => array(
					'product_id'     => (int) $i['product_id'],
					'variant_id'     => (int) $i['variant_id'],
					'name'           => $i['name'],
					'qty'            => $i['qty'],
					'unit_price'     => $i['unit_price'],
					'discount_type'  => $i['discount_type'],
					'discount_value' => $i['discount_value'],
				),
				$items
			),
		);
	}

	/**
	 * @param array<string,mixed> $doc Prepared document.
	 * @return array<string,mixed>
	 */
	private function presentTotals( array $doc ): array {
		$t     = $doc['totals'];
		$lines = array();
		foreach ( $doc['lines'] as $l ) {
			$lines[] = array(
				'product_id'      => $l['product_id'],
				'variant_id'      => $l['variant_id'],
				'name'            => $l['name'],
				'qty'             => Decimal::toString( $l['qty'] ),
				'unit_price'      => Decimal::toString( $l['unit_price'] ),
				'discount_amount' => Decimal::toString( $l['discount_amount'] + $l['doc_discount'] ),
				'tax_amount'      => Decimal::toString( $l['tax_amount'] ),
				'total'           => Decimal::toString( $l['total'] ),
			);
		}
		return array(
			'lines'           => $lines,
			'subtotal'        => Decimal::toString( $t['subtotal'] ),
			'discount_amount' => Decimal::toString( $t['discount'] ),
			'tax_amount'      => Decimal::toString( $t['tax'] ),
			'shipping_amount' => Decimal::toString( $t['shipping'] ),
			'total'           => Decimal::toString( $t['total'] ),
		);
	}
}
