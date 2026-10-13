<?php
/**
 * Online orders (Facebook, WhatsApp, website, phone…) and courier delivery.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Orders;

use GoriberHisab\Accounting\AccountService;
use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Catalog\ProductService;
use GoriberHisab\Contacts\ContactService;
use GoriberHisab\Database\Database;
use GoriberHisab\Finance\FinanceService;
use GoriberHisab\Numbering\NumberingService;
use GoriberHisab\Payments\PaymentService;
use GoriberHisab\Sales\SaleService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Lifecycle:
 *
 *   pending ──confirm──▶ confirmed ──▶ packed ──ship/book──▶ shipped ──▶ delivered ──collect COD──▶ (paid)
 *      │                    │            │                     │
 *      └──── cancel ────────┴────────────┘                     └── return ──▶ returned
 *
 * Nothing touches stock or the books until an order is confirmed: confirming
 * creates a normal sale (channel "online") for the customer, with the
 * delivery charge as shipping and any advance as a payment, so stock,
 * receivables and reports stay correct. COD collected from the courier is a
 * customer payment against that sale (the courier's fee is booked as a
 * Delivery expense). Cancelling or returning a confirmed order voids the sale,
 * which puts the stock back.
 */
final class OrderService extends Service {

	public const SOURCES  = array( 'facebook', 'whatsapp', 'instagram', 'website', 'phone', 'daraz', 'other' );
	public const STATUSES = array( 'pending', 'confirmed', 'packed', 'shipped', 'delivered', 'returned', 'cancelled' );
	public const COURIERS = array(
		'steadfast' => 'Steadfast',
		'pathao'    => 'Pathao',
		'redx'      => 'RedX',
		'paperfly'  => 'Paperfly',
		'ecourier'  => 'eCourier',
		'sundarban' => 'Sundarban',
		'sa_paribahan' => 'SA Paribahan',
		'self'      => 'Own delivery',
		'other'     => 'Other',
	);

	private SaleService $sales;
	private ContactService $contacts;
	private PaymentService $payments;
	private FinanceService $finance;
	private AccountService $accounts;
	private ProductService $products;
	private NumberingService $numbers;
	private AuditLogger $audit;

	/**
	 * @var callable(string,string,array<string,string>,?string):array{0:int,1:string}
	 */
	private $http;

	/**
	 * @param callable(string,string,array<string,string>,?string):array{0:int,1:string} $http HTTP transport for courier APIs.
	 */
	public function __construct( Database $db, Clock $clock, Events $events, SaleService $sales, ContactService $contacts, PaymentService $payments, FinanceService $finance, AccountService $accounts, ProductService $products, NumberingService $numbers, AuditLogger $audit, callable $http ) {
		parent::__construct( $db, $clock, $events );
		$this->sales    = $sales;
		$this->contacts = $contacts;
		$this->payments = $payments;
		$this->finance  = $finance;
		$this->accounts = $accounts;
		$this->products = $products;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
		$this->http     = $http;
	}

	/* -------------------------------------------------------------- Reads */

	/**
	 * @param array<string,mixed> $args status, source, courier, search, from, to, cod (pending), page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args = array() ): array {
		$ctx->authorize( 'orders.view' );
		$t      = $this->db->table( 'orders' );
		$where  = array( 'business_id = %d', 'deleted_at IS NULL' );
		$params = array( $ctx->business_id );
		if ( ! empty( $args['status'] ) && 'all' !== $args['status'] ) {
			if ( 'active' === $args['status'] ) {
				$where[] = "status IN ('pending','confirmed','packed','shipped')";
			} else {
				$where[]  = 'status = %s';
				$params[] = Text::key( $args['status'] );
			}
		}
		if ( ! empty( $args['source'] ) ) {
			$where[]  = 'source = %s';
			$params[] = Text::key( $args['source'] );
		}
		if ( ! empty( $args['courier'] ) ) {
			$where[]  = 'courier = %s';
			$params[] = Text::key( $args['courier'] );
		}
		if ( ! empty( $args['cod'] ) ) {
			$where[] = "status IN ('shipped','delivered') AND cod_collected = 0 AND cod_amount > 0";
		}
		foreach ( array( 'from' => '>=', 'to' => '<=' ) as $k => $op ) {
			$d = Text::date( $args[ $k ] ?? '' );
			if ( $d ) {
				$where[]  = "order_date {$op} %s";
				$params[] = $d;
			}
		}
		$q = Text::line( $args['search'] ?? '', 100 );
		if ( '' !== $q ) {
			$like     = '%' . $this->db->escapeLike( $q ) . '%';
			$where[]  = '(number LIKE %s OR customer_name LIKE %s OR phone LIKE %s OR consignment_id LIKE %s OR tracking_code LIKE %s)';
			$params   = array_merge( $params, array( $like, $like, $like, $like, $like ) );
		}
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE {$w}", $params );
		$rows  = $this->db->rows( "SELECT * FROM {$t} WHERE {$w} ORDER BY id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, $offset ) ) );
		$out   = $this->paged( array_map( fn( $r ) => $this->present( $ctx, $r ), $rows ), $total, $page, $per_page );
		$out['summary'] = $this->summary( $ctx );
		return $out;
	}

	/**
	 * Counts per status + COD still to collect.
	 *
	 * @return array<string,mixed>
	 */
	public function summary( BusinessContext $ctx ): array {
		$t      = $this->db->table( 'orders' );
		$counts = array_fill_keys( self::STATUSES, 0 );
		foreach ( $this->db->rows( "SELECT status, COUNT(*) AS n FROM {$t} WHERE business_id = %d AND deleted_at IS NULL GROUP BY status", array( $ctx->business_id ) ) as $r ) {
			$counts[ (string) $r['status'] ] = (int) $r['n'];
		}
		$cod = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(cod_amount),0) AS amount FROM {$t} WHERE business_id = %d AND deleted_at IS NULL AND status IN ('shipped','delivered') AND cod_collected = 0 AND cod_amount > 0", array( $ctx->business_id ) );
		return array(
			'counts'      => $counts,
			'cod_pending' => array(
				'orders' => (int) $cod['n'],
				'amount' => Decimal::toString( Decimal::of( $cod['amount'] ) ),
			),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'orders.view' );
		$order = $this->present( $ctx, $this->findScoped( $ctx, 'orders', $id, 'Order' ) );
		if ( $order['sale_id'] ) {
			$st            = $this->db->table( 'sales' );
			$order['sale'] = $this->db->row( "SELECT id, number, status, total, paid_amount, due_amount FROM {$st} WHERE id = %d AND business_id = %d", array( $order['sale_id'], $ctx->business_id ) );
		}
		return $order;
	}

	/* ------------------------------------------------------------- Writes */

	/**
	 * @param array<string,mixed> $data customer_name, phone, address, area, source, items[{product_id, variant_id, qty, unit_price}], discount, delivery_charge, advance, note, order_date, customer_id, confirm (bool), advance_account_id.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'orders.manage' );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		$t    = $this->db->table( 'orders' );
		if ( $uuid ) {
			$existing = $this->db->value( "SELECT id FROM {$t} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->get( $ctx, (int) $existing );
			}
		}
		$clean = $this->validate( $ctx, $data );
		$id    = $this->db->transaction(
			function () use ( $ctx, $clean, $uuid, $t ) {
				$id = $this->db->insert(
					$t,
					array_merge(
						$clean,
						array(
							'uuid'        => $uuid ?: Text::newUuid(),
							'business_id' => $ctx->business_id,
							'branch_id'   => $ctx->branch_id,
							'number'      => $this->numbers->next( $ctx, 'order', $clean['order_date'] ),
							'status'      => 'pending',
							'created_by'  => $ctx->user_id,
							'updated_by'  => $ctx->user_id,
							'created_at'  => $this->now(),
							'updated_at'  => $this->now(),
						)
					)
				);
				$this->audit->log( $ctx, 'create', 'order', $id, 'Online order created for ' . $clean['customer_name'] );
				return $id;
			}
		);
		if ( ! empty( $data['confirm'] ) ) {
			return $this->confirm( $ctx, $id, $data );
		}
		$this->events->dispatch( 'goriber_hisab/order/created', $ctx, $id );
		return $this->get( $ctx, $id );
	}

	/**
	 * Edit a pending order.
	 *
	 * @param array<string,mixed> $data Same as create().
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $id, array $data ): array {
		$ctx->authorize( 'orders.manage' );
		$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		if ( 'pending' !== $row['status'] ) {
			// After confirmation only delivery details can change.
			$set = array();
			foreach ( array( 'address', 'area', 'note' ) as $k ) {
				if ( isset( $data[ $k ] ) ) {
					$set[ $k ] = 'area' === $k ? Text::line( $data[ $k ], 100 ) : Text::multiline( $data[ $k ], 1000 );
				}
			}
			if ( isset( $data['phone'] ) && Text::phone( $data['phone'] ) ) {
				$set['phone'] = Text::phone( $data['phone'] );
			}
			if ( $set ) {
				$this->db->update( $this->db->table( 'orders' ), $set + array( 'updated_at' => $this->now(), 'updated_by' => $ctx->user_id ), array( 'id' => $id ) );
			}
			return $this->get( $ctx, $id );
		}
		$clean = $this->validate( $ctx, array_merge( $this->present( $ctx, $row ), $data ) );
		$this->db->update( $this->db->table( 'orders' ), $clean + array( 'updated_at' => $this->now(), 'updated_by' => $ctx->user_id ), array( 'id' => $id ) );
		$this->audit->log( $ctx, 'update', 'order', $id, 'Order ' . $row['number'] . ' edited' );
		return $this->get( $ctx, $id );
	}

	/**
	 * Confirm: create the customer (by phone) and the sale. Stock leaves now.
	 *
	 * @param array<string,mixed> $data advance_account_id, advance_reference.
	 * @return array<string,mixed>
	 */
	public function confirm( BusinessContext $ctx, int $id, array $data = array() ): array {
		$ctx->authorize( 'orders.manage' );
		$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		if ( 'pending' !== $row['status'] ) {
			return $this->get( $ctx, $id );
		}
		$this->db->transaction(
			function () use ( $ctx, $row, $id, $data ) {
				$customer = (int) $row['customer_id']
					? $this->contacts->get( $ctx, 'customer', (int) $row['customer_id'] )
					: $this->contacts->quickCreate(
						$ctx,
						'customer',
						array(
							'name'    => $row['customer_name'],
							'phone'   => $row['phone'],
							'address' => trim( $row['address'] . ( '' !== $row['area'] ? ', ' . $row['area'] : '' ) ),
						)
					);
				$advance  = Decimal::of( $row['advance'] );
				$payments = array();
				if ( $advance > 0 ) {
					$payments[] = array(
						'account_id' => (int) ( $data['advance_account_id'] ?? 0 ) ?: $this->accounts->systemId( $ctx->business_id, 'mobile' ),
						'amount'     => Decimal::toString( $advance ),
						'reference'  => Text::line( $data['advance_reference'] ?? '', 100 ),
					);
				}
				$sale = $this->sales->create(
					$ctx,
					array(
						'uuid'            => $row['uuid'],
						'customer_id'     => (int) $customer['id'],
						'channel'         => 'online',
						'items'           => array_map(
							static fn( $l ) => array(
								'product_id' => (int) $l['product_id'],
								'variant_id' => (int) ( $l['variant_id'] ?? 0 ),
								'qty'        => $l['qty'],
								'unit_price' => $l['unit_price'],
							),
							Json::decode( $row['items'] )
						),
						'discount_type'   => 'fixed',
						'discount_value'  => $row['discount'],
						'shipping_amount' => $row['delivery_charge'],
						'notes'           => trim( 'Online order ' . $row['number'] . ( '' !== (string) $row['note'] ? "\n" . $row['note'] : '' ) ),
						'payments'        => $payments,
					)
				);
				$this->db->update(
					$this->db->table( 'orders' ),
					array(
						'status'      => 'confirmed',
						'customer_id' => (int) $customer['id'],
						'sale_id'     => (int) $sale['id'],
						'total'       => $sale['total'],
						'cod_amount'  => $sale['due_amount'],
						'updated_at'  => $this->now(),
						'updated_by'  => $ctx->user_id,
					),
					array( 'id' => $id )
				);
				$this->audit->log( $ctx, 'confirm', 'order', $id, 'Order ' . $row['number'] . ' confirmed as sale ' . $sale['number'] );
			}
		);
		$this->events->dispatch( 'goriber_hisab/order/confirmed', $ctx, $id );
		return $this->get( $ctx, $id );
	}

	/**
	 * Move along the pipeline: packed, shipped (with courier details), delivered.
	 *
	 * @param array<string,mixed> $data courier, consignment_id, tracking_code (for shipped).
	 * @return array<string,mixed>
	 */
	public function advance( BusinessContext $ctx, int $id, string $status, array $data = array() ): array {
		$ctx->authorize( 'orders.manage' );
		$row  = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		$from = array(
			'packed'    => array( 'confirmed' ),
			'shipped'   => array( 'confirmed', 'packed' ),
			'delivered' => array( 'confirmed', 'packed', 'shipped' ),
		);
		if ( ! isset( $from[ $status ] ) ) {
			throw ValidationException::field( 'status', 'Invalid status.' );
		}
		if ( 'pending' === $row['status'] ) {
			$this->confirm( $ctx, $id );
			$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		}
		if ( ! in_array( $row['status'], $from[ $status ], true ) ) {
			throw new ConflictException( sprintf( 'This order is already %s.', $row['status'] ) );
		}
		$set = array(
			'status'     => $status,
			'updated_at' => $this->now(),
			'updated_by' => $ctx->user_id,
		);
		if ( 'shipped' === $status ) {
			$courier = Text::key( $data['courier'] ?? $row['courier'] );
			if ( ! isset( self::COURIERS[ $courier ] ) ) {
				throw ValidationException::field( 'courier', 'Choose a courier.' );
			}
			$set['courier']        = $courier;
			$set['consignment_id'] = Text::line( $data['consignment_id'] ?? $row['consignment_id'], 100 );
			$set['tracking_code']  = Text::line( $data['tracking_code'] ?? $row['tracking_code'], 100 );
			$set['shipped_at']     = $this->now();
		}
		if ( 'delivered' === $status ) {
			$set['delivered_at'] = $this->now();
		}
		$this->db->update( $this->db->table( 'orders' ), $set, array( 'id' => $id ) );
		$this->audit->log( $ctx, $status, 'order', $id, 'Order ' . $row['number'] . ' marked ' . $status );
		$this->events->dispatch( 'goriber_hisab/order/' . $status, $ctx, $id );
		return $this->get( $ctx, $id );
	}

	/**
	 * Book the parcel with Steadfast and mark the order shipped.
	 *
	 * @return array<string,mixed>
	 */
	public function bookSteadfast( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'orders.manage' );
		$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		if ( 'pending' === $row['status'] ) {
			$this->confirm( $ctx, $id );
			$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		}
		if ( ! in_array( $row['status'], array( 'confirmed', 'packed' ), true ) ) {
			throw new ConflictException( 'Only confirmed or packed orders can be booked.' );
		}
		$phone = preg_replace( '/[^0-9]/', '', (string) $row['phone'] );
		$phone = str_starts_with( $phone, '880' ) ? '0' . substr( $phone, 3 ) : $phone;
		if ( 11 !== strlen( $phone ) ) {
			throw ValidationException::field( 'phone', 'Steadfast needs an 11-digit mobile number (01XXXXXXXXX).' );
		}
		$parcel = $this->steadfast( $ctx )->book(
			array(
				'invoice' => (string) $row['number'],
				'name'    => (string) $row['customer_name'],
				'phone'   => $phone,
				'address' => trim( $row['address'] . ( '' !== $row['area'] ? ', ' . $row['area'] : '' ) ),
				'cod'     => Decimal::toString( Decimal::of( $row['cod_amount'] ), 0 ),
				'note'    => Text::line( $row['note'], 190 ),
			)
		);
		return $this->advance(
			$ctx,
			$id,
			'shipped',
			array(
				'courier'        => 'steadfast',
				'consignment_id' => $parcel['consignment_id'],
				'tracking_code'  => $parcel['tracking_code'],
			)
		) + array( 'booked' => $parcel );
	}

	/**
	 * Ask Steadfast for the latest status; marks the order delivered when it is.
	 *
	 * @return array<string,mixed>
	 */
	public function refreshCourier( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'orders.view' );
		$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		if ( 'steadfast' !== $row['courier'] || '' === (string) $row['consignment_id'] ) {
			throw new ValidationException( array(), 'Live tracking is available for Steadfast parcels only.' );
		}
		$status = $this->steadfast( $ctx )->status( (string) $row['consignment_id'] );
		$this->db->update( $this->db->table( 'orders' ), array( 'courier_status' => Text::line( $status, 60 ), 'updated_at' => $this->now() ), array( 'id' => $id ) );
		if ( in_array( $status, array( 'delivered', 'partial_delivered' ), true ) && 'shipped' === $row['status'] && $ctx->can( 'orders.manage' ) ) {
			return $this->advance( $ctx, $id, 'delivered' );
		}
		return $this->get( $ctx, $id );
	}

	/**
	 * Courier paid out the COD for some orders: record each as a customer
	 * payment, and the courier's fee as a Delivery expense.
	 *
	 * @param array<int,int>      $ids  Order ids.
	 * @param array<string,mixed> $data account_id, date, reference, fees {order_id: fee}.
	 * @return array{orders:int,amount:string,fees:string}
	 */
	public function collectCod( BusinessContext $ctx, array $ids, array $data ): array {
		$ctx->authorize( 'orders.manage' );
		$account = (int) ( $data['account_id'] ?? 0 ) ?: $this->accounts->systemId( $ctx->business_id, 'bank' );
		$fees    = is_array( $data['fees'] ?? null ) ? $data['fees'] : array();
		$date    = Text::date( $data['date'] ?? '' ) ?: $this->today( $ctx );
		$ref     = Text::line( $data['reference'] ?? '', 100 );
		$total   = 0;
		$fee_sum = 0;
		$done    = 0;
		$this->db->transaction(
			function () use ( $ctx, $ids, $account, $fees, $date, $ref, &$total, &$fee_sum, &$done ) {
				foreach ( array_unique( array_map( 'intval', $ids ) ) as $id ) {
					$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
					if ( (int) $row['cod_collected'] || ! in_array( $row['status'], array( 'shipped', 'delivered' ), true ) ) {
						continue;
					}
					$sale = $this->sales->get( $ctx, (int) $row['sale_id'] );
					$due  = Decimal::of( $sale['due_amount'] );
					if ( $due > 0 ) {
						$this->payments->receive(
							$ctx,
							array(
								'contact_id' => (int) $row['customer_id'],
								'account_id' => $account,
								'amount'     => Decimal::toString( $due ),
								'date'       => $date,
								'reference'  => $ref ?: (string) $row['consignment_id'],
								'note'       => 'COD for order ' . $row['number'],
								'sale_id'    => (int) $row['sale_id'],
							)
						);
						$total += $due;
					}
					$fee = Decimal::of( $fees[ $id ] ?? $fees[ (string) $id ] ?? 0 );
					if ( $fee > 0 ) {
						$this->finance->create(
							$ctx,
							'expense',
							array(
								'account_id'         => $this->deliveryAccount( $ctx ),
								'payment_account_id' => $account,
								'amount'             => Decimal::toString( $fee ),
								'date'               => $date,
								'reference'          => (string) $row['consignment_id'],
								'description'        => 'Courier charge for order ' . $row['number'],
							)
						);
						$fee_sum += $fee;
					}
					$this->db->update(
						$this->db->table( 'orders' ),
						array(
							'status'        => 'delivered',
							'cod_collected' => 1,
							'courier_fee'   => Decimal::toString( $fee ),
							'delivered_at'  => $row['delivered_at'] ?: $this->now(),
							'updated_at'    => $this->now(),
							'updated_by'    => $ctx->user_id,
						),
						array( 'id' => $id )
					);
					++$done;
				}
			}
		);
		return array(
			'orders' => $done,
			'amount' => Decimal::toString( $total ),
			'fees'   => Decimal::toString( $fee_sum ),
		);
	}

	/**
	 * Cancel (before delivery) or mark returned (parcel came back). A sale that
	 * was already created is voided, putting the stock back.
	 *
	 * @param array<string,mixed> $data reason, return_charge, account_id.
	 * @return array<string,mixed>
	 */
	public function close( BusinessContext $ctx, int $id, string $status, array $data = array() ): array {
		$ctx->authorize( 'orders.manage' );
		if ( ! in_array( $status, array( 'cancelled', 'returned' ), true ) ) {
			throw ValidationException::field( 'status', 'Invalid status.' );
		}
		$row = $this->findScoped( $ctx, 'orders', $id, 'Order' );
		if ( in_array( $row['status'], array( 'cancelled', 'returned' ), true ) ) {
			return $this->get( $ctx, $id );
		}
		if ( (int) $row['cod_collected'] ) {
			throw new ConflictException( 'COD for this order was already collected. Use a sales return instead.' );
		}
		$reason = Text::line( $data['reason'] ?? '', 190 );
		$this->db->transaction(
			function () use ( $ctx, $row, $id, $status, $reason, $data ) {
				if ( (int) $row['sale_id'] ) {
					$this->sales->void( $ctx, (int) $row['sale_id'], ( 'returned' === $status ? 'Order returned' : 'Order cancelled' ) . ( $reason ? ': ' . $reason : '' ) );
				}
				$charge = Decimal::of( $data['return_charge'] ?? 0 );
				if ( $charge > 0 ) {
					$this->finance->create(
						$ctx,
						'expense',
						array(
							'account_id'         => $this->deliveryAccount( $ctx ),
							'payment_account_id' => (int) ( $data['account_id'] ?? 0 ) ?: $this->accounts->systemId( $ctx->business_id, 'cash' ),
							'amount'             => Decimal::toString( $charge ),
							'reference'          => (string) $row['consignment_id'],
							'description'        => 'Return charge for order ' . $row['number'],
						)
					);
				}
				$this->db->update(
					$this->db->table( 'orders' ),
					array(
						'status'      => $status,
						'courier_fee' => Decimal::toString( $charge ),
						'note'        => trim( $row['note'] . ( $reason ? "\n" . ucfirst( $status ) . ': ' . $reason : '' ) ),
						'updated_at'  => $this->now(),
						'updated_by'  => $ctx->user_id,
					),
					array( 'id' => $id )
				);
				$this->audit->log( $ctx, $status, 'order', $id, 'Order ' . $row['number'] . ' ' . $status . ( $reason ? ': ' . $reason : '' ) );
			}
		);
		return $this->get( $ctx, $id );
	}

	/* ----------------------------------------------------- Courier config */

	/**
	 * @return array<string,mixed> Masked credentials + delivery charge defaults.
	 */
	public function courierSettings( BusinessContext $ctx ): array {
		$ctx->authorize( 'orders.view' );
		$c = $this->courierConfig( $ctx->business_id );
		return array(
			'steadfast_connected' => '' !== $c['steadfast_key'] && '' !== $c['steadfast_secret'],
			'steadfast_key'       => '' !== $c['steadfast_key'] ? substr( $c['steadfast_key'], 0, 4 ) . str_repeat( '•', 8 ) : '',
			'charge_inside'       => $c['charge_inside'],
			'charge_outside'      => $c['charge_outside'],
			'default_courier'     => $c['default_courier'],
			'couriers'            => self::COURIERS,
			'sources'             => self::SOURCES,
		);
	}

	/**
	 * @param array<string,mixed> $data steadfast_key, steadfast_secret, charge_inside, charge_outside, default_courier, test (bool).
	 * @return array<string,mixed>
	 */
	public function saveCourierSettings( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'settings.manage' );
		$c = $this->courierConfig( $ctx->business_id );
		foreach ( array( 'steadfast_key', 'steadfast_secret' ) as $k ) {
			// Masked values come back unchanged from the form: keep the stored one.
			if ( isset( $data[ $k ] ) && ! str_contains( (string) $data[ $k ], '•' ) ) {
				$c[ $k ] = trim( Text::line( $data[ $k ], 200 ) );
			}
		}
		foreach ( array( 'charge_inside', 'charge_outside' ) as $k ) {
			if ( isset( $data[ $k ] ) ) {
				$v = Decimal::of( $data[ $k ] );
				if ( $v < 0 ) {
					throw ValidationException::field( $k, 'Cannot be negative.' );
				}
				$c[ $k ] = Decimal::toString( $v, 2 );
			}
		}
		if ( isset( $data['default_courier'] ) && isset( self::COURIERS[ $data['default_courier'] ] ) ) {
			$c['default_courier'] = (string) $data['default_courier'];
		}
		$t   = $this->db->table( 'settings' );
		$key = 'secret.courier';
		$val = (string) Json::encode( $c );
		if ( $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND setting_key = %s", array( $ctx->business_id, $key ) ) ) {
			$this->db->update( $t, array( 'setting_value' => $val, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ), array( 'business_id' => $ctx->business_id, 'setting_key' => $key ) );
		} else {
			$this->db->insert( $t, array( 'business_id' => $ctx->business_id, 'setting_key' => $key, 'setting_value' => $val, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ) );
		}
		$this->audit->log( $ctx, 'update', 'settings', $ctx->business_id, 'Courier settings updated' );
		$out = $this->courierSettings( $ctx );
		if ( ! empty( $data['test'] ) && $out['steadfast_connected'] ) {
			$out['steadfast_balance'] = $this->steadfast( $ctx )->balance();
		}
		return $out;
	}

	/* ------------------------------------------------------------ Helpers */

	/**
	 * @return array{steadfast_key:string,steadfast_secret:string,charge_inside:string,charge_outside:string,default_courier:string}
	 */
	private function courierConfig( int $business_id ): array {
		$t   = $this->db->table( 'settings' );
		$raw = $this->db->value( "SELECT setting_value FROM {$t} WHERE business_id = %d AND setting_key = 'secret.courier'", array( $business_id ) );
		$c   = is_string( $raw ) ? json_decode( $raw, true ) : null;
		return array_merge(
			array(
				'steadfast_key'    => '',
				'steadfast_secret' => '',
				'charge_inside'    => '70.00',
				'charge_outside'   => '130.00',
				'default_courier'  => 'steadfast',
			),
			is_array( $c ) ? $c : array()
		);
	}

	private function steadfast( BusinessContext $ctx ): Steadfast {
		$c = $this->courierConfig( $ctx->business_id );
		return new Steadfast( $this->http, $c['steadfast_key'], $c['steadfast_secret'] );
	}

	private function deliveryAccount( BusinessContext $ctx ): int {
		$t  = $this->db->table( 'accounts' );
		$id = (int) $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND type = 'expense' AND code = '6070' AND status = 'active'", array( $ctx->business_id ) );
		return $id ?: $this->accounts->systemId( $ctx->business_id, 'other_expense' );
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed> Columns.
	 */
	private function validate( BusinessContext $ctx, array $data ): array {
		$errors = array();
		$name   = Text::line( $data['customer_name'] ?? '' );
		$phone  = Text::phone( $data['phone'] ?? '' );
		$cid    = (int) ( $data['customer_id'] ?? 0 );
		if ( $cid ) {
			$c     = $this->contacts->get( $ctx, 'customer', $cid );
			$name  = '' !== $name ? $name : (string) $c['name'];
			$phone = '' !== $phone ? $phone : (string) $c['phone'];
		}
		if ( '' === $name ) {
			$errors['customer_name'] = 'Name is required.';
		}
		if ( '' === $phone ) {
			$errors['phone'] = 'Enter the customer\'s phone number.';
		}
		$source = Text::key( $data['source'] ?? 'facebook' );
		$source = in_array( $source, self::SOURCES, true ) ? $source : 'other';

		$items    = array();
		$subtotal = 0;
		foreach ( array_values( (array) ( $data['items'] ?? array() ) ) as $i => $item ) {
			$pid = (int) ( $item['product_id'] ?? 0 );
			try {
				$product = $this->products->get( $ctx, $pid );
			} catch ( \GoriberHisab\Support\NotFoundException $e ) {
				$errors[ "items.{$i}.product_id" ] = 'Select a product.';
				continue;
			}
			try {
				$qty   = Decimal::of( $item['qty'] ?? 1 );
				$price = Decimal::of( $item['unit_price'] ?? $product['selling_price'] );
			} catch ( \InvalidArgumentException $e ) {
				$errors[ "items.{$i}.qty" ] = 'Enter valid numbers.';
				continue;
			}
			if ( $qty <= 0 ) {
				$errors[ "items.{$i}.qty" ] = 'Quantity must be greater than zero.';
				continue;
			}
			if ( $price < 0 ) {
				$errors[ "items.{$i}.unit_price" ] = 'Price cannot be negative.';
				continue;
			}
			$vid  = (int) ( $item['variant_id'] ?? 0 );
			$vname = '';
			foreach ( (array) ( $product['variants'] ?? array() ) as $v ) {
				if ( (int) $v['id'] === $vid ) {
					$vname = ' - ' . $v['name'];
				}
			}
			$items[]   = array(
				'product_id' => $pid,
				'variant_id' => $vname ? $vid : 0,
				'name'       => $product['name'] . $vname,
				'qty'        => Decimal::toString( $qty ),
				'unit_price' => Decimal::toString( $price ),
				'total'      => Decimal::toString( Decimal::mul( $qty, $price ) ),
			);
			$subtotal += Decimal::mul( $qty, $price );
		}
		if ( ! $items && ! isset( $errors['items'] ) && ! array_filter( array_keys( $errors ), static fn( $k ) => str_starts_with( $k, 'items.' ) ) ) {
			$errors['items'] = 'Add at least one product.';
		}
		try {
			$discount = Decimal::of( $data['discount'] ?? 0 );
			$delivery = Decimal::of( $data['delivery_charge'] ?? 0 );
			$advance  = Decimal::of( $data['advance'] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			throw new ValidationException( $errors + array( 'discount' => 'Enter valid amounts.' ) );
		}
		if ( $discount < 0 || $discount > $subtotal ) {
			$errors['discount'] = 'Discount cannot exceed the subtotal.';
		}
		if ( $delivery < 0 ) {
			$errors['delivery_charge'] = 'Cannot be negative.';
		}
		$total = $subtotal - $discount + $delivery;
		if ( $advance < 0 || $advance > $total ) {
			$errors['advance'] = 'Advance cannot be more than the order total.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		return array(
			'order_date'      => Text::date( $data['order_date'] ?? '' ) ?: $this->today( $ctx ),
			'source'          => $source,
			'customer_id'     => $cid,
			'customer_name'   => $name,
			'phone'           => $phone,
			'address'         => Text::multiline( $data['address'] ?? '', 1000 ),
			'area'            => Text::line( $data['area'] ?? '', 100 ),
			'items'           => Json::encode( $items ),
			'subtotal'        => Decimal::toString( $subtotal ),
			'discount'        => Decimal::toString( $discount ),
			'delivery_charge' => Decimal::toString( $delivery ),
			'total'           => Decimal::toString( $total ),
			'advance'         => Decimal::toString( $advance ),
			'cod_amount'      => Decimal::toString( $total - $advance ),
			'courier'         => isset( self::COURIERS[ $data['courier'] ?? '' ] ) ? (string) $data['courier'] : '',
			'note'            => Text::multiline( $data['note'] ?? '', 1000 ),
		);
	}

	/**
	 * @param array<string,mixed> $r Row.
	 * @return array<string,mixed>
	 */
	private function present( BusinessContext $ctx, array $r ): array {
		$p = $ctx->decimals();
		foreach ( array( 'subtotal', 'discount', 'delivery_charge', 'total', 'advance', 'cod_amount', 'courier_fee' ) as $k ) {
			$r[ $k ] = Decimal::toString( Decimal::of( $r[ $k ] ?? 0 ), $p );
		}
		foreach ( array( 'id', 'branch_id', 'customer_id', 'sale_id' ) as $k ) {
			$r[ $k ] = (int) ( $r[ $k ] ?? 0 );
		}
		$r['cod_collected'] = (bool) (int) ( $r['cod_collected'] ?? 0 );
		$r['items']         = is_array( $r['items'] ) ? $r['items'] : Json::decode( $r['items'] ?? null );
		$r['courier_name']  = self::COURIERS[ $r['courier'] ?? '' ] ?? '';
		$r['tracking_url']  = self::trackingUrl( (string) ( $r['courier'] ?? '' ), (string) ( $r['tracking_code'] ?? '' ), (string) ( $r['consignment_id'] ?? '' ) );
		unset( $r['deleted_at'], $r['deleted_by'] );
		return $r;
	}

	public static function trackingUrl( string $courier, string $tracking, string $consignment ): string {
		$code = '' !== $tracking ? $tracking : $consignment;
		if ( '' === $code ) {
			return '';
		}
		switch ( $courier ) {
			case 'steadfast':
				return Steadfast::trackingUrl( $code );
			case 'pathao':
				return 'https://merchant.pathao.com/tracking?consignment_id=' . rawurlencode( $code );
			case 'redx':
				return 'https://redx.com.bd/track-parcel/?trackingId=' . rawurlencode( $code );
			case 'paperfly':
				return 'https://go.paperfly.com.bd/track/order/' . rawurlencode( $code );
		}
		return '';
	}
}

