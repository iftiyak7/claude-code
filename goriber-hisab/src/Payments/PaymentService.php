<?php
/**
 * Payments, collections and due allocation.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Payments;

use GoriberHisab\Accounting\AccountService;
use GoriberHisab\Accounting\JournalService;
use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Contacts\ContactService;
use GoriberHisab\Database\Database;
use GoriberHisab\Numbering\NumberingService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Records money received/paid against customers and suppliers, allocates it
 * to invoices, and keeps document paid/due/payment_status in sync.
 *
 * Journal effect (party = receivable for customers, payable for suppliers):
 *   direction "in":  Dr payment account   / Cr party
 *   direction "out": Dr party             / Cr payment account
 */
final class PaymentService extends Service {

	private const DOC_TABLES = array(
		'sale'     => 'sales',
		'purchase' => 'purchases',
	);

	private JournalService $journal;
	private AccountService $accounts;
	private ContactService $contacts;
	private NumberingService $numbers;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, JournalService $journal, AccountService $accounts, ContactService $contacts, NumberingService $numbers, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->journal  = $journal;
		$this->accounts = $accounts;
		$this->contacts = $contacts;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
	}

	/**
	 * Customer due collection (public entry point).
	 *
	 * @param array<string,mixed> $data contact_id, account_id, amount, date, reference, note, sale_id (optional), uuid.
	 * @return array<string,mixed>
	 */
	public function receive( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'payments.receive' );
		$contact = $this->contacts->requireContact( $ctx, 'customer', (int) ( $data['contact_id'] ?? 0 ), 'contact_id' );
		$alloc   = ! empty( $data['sale_id'] ) ? array( array( 'document_type' => 'sale', 'document_id' => (int) $data['sale_id'], 'amount' => null ) ) : 'auto';
		$id      = $this->record( $ctx, array_merge( $data, array( 'direction' => 'in', 'contact_id' => (int) $contact['id'], 'party' => 'customer', 'source' => 'collection', 'allocations' => $alloc ) ) );
		return $this->get( $ctx, $id );
	}

	/**
	 * Supplier payment (public entry point).
	 *
	 * @param array<string,mixed> $data contact_id, account_id, amount, date, reference, note, purchase_id (optional), uuid.
	 * @return array<string,mixed>
	 */
	public function pay( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'payments.pay' );
		$contact = $this->contacts->requireContact( $ctx, 'supplier', (int) ( $data['contact_id'] ?? 0 ), 'contact_id' );
		$alloc   = ! empty( $data['purchase_id'] ) ? array( array( 'document_type' => 'purchase', 'document_id' => (int) $data['purchase_id'], 'amount' => null ) ) : 'auto';
		$id      = $this->record( $ctx, array_merge( $data, array( 'direction' => 'out', 'contact_id' => (int) $contact['id'], 'party' => 'supplier', 'source' => 'supplier_payment', 'allocations' => $alloc ) ) );
		return $this->get( $ctx, $id );
	}

	/**
	 * Low-level recorder used by sales, purchases, returns and the entry
	 * points above. Callers are responsible for authorisation.
	 *
	 * @param array<string,mixed> $data direction, party ('customer'|'supplier'), contact_id, account_id, amount (decimal string or scaled int via amount_scaled),
	 *                                  date, reference, note, source, source_id, allocations ('auto'|list|none), uuid.
	 * @return int Payment id.
	 */
	public function record( BusinessContext $ctx, array $data ): int {
		$direction = 'out' === ( $data['direction'] ?? '' ) ? 'out' : 'in';
		$party     = 'supplier' === ( $data['party'] ?? '' ) ? 'supplier' : 'customer';
		$contact   = max( 0, (int) ( $data['contact_id'] ?? 0 ) );
		$uuid      = Text::uuid( $data['uuid'] ?? null );
		$pt        = $this->db->table( 'payments' );

		if ( $uuid ) {
			$existing = $this->db->value( "SELECT id FROM {$pt} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return (int) $existing;
			}
		}

		$errors = array();
		if ( isset( $data['amount_scaled'] ) ) {
			$amount = (int) $data['amount_scaled'];
		} else {
			try {
				$amount = Decimal::round( Decimal::of( $data['amount'] ?? 0 ), $ctx->decimals() );
			} catch ( \InvalidArgumentException $e ) {
				$amount = 0;
			}
		}
		if ( $amount <= 0 ) {
			$errors['amount'] = 'Enter an amount greater than zero.';
		}
		$date = Text::date( $data['date'] ?? null ) ?? $this->today( $ctx );
		try {
			$account = $this->accounts->require( $ctx, (int) ( $data['account_id'] ?? 0 ), 'asset', true, (string) ( $data['field'] ?? 'account_id' ) );
		} catch ( ValidationException $e ) {
			$errors += $e->errors();
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		return $this->db->transaction(
			function () use ( $ctx, $data, $direction, $party, $contact, $uuid, $amount, $date, $account, $pt ) {
				$number = $this->numbers->next( $ctx, 'in' === $direction ? 'payment_in' : 'payment_out', $date );
				$id     = $this->db->insert(
					$pt,
					array(
						'uuid'         => $uuid,
						'business_id'  => $ctx->business_id,
						'branch_id'    => $ctx->branch_id,
						'number'       => $number,
						'direction'    => $direction,
						'contact_id'   => $contact,
						'account_id'   => (int) $account['id'],
						'amount'       => Decimal::toString( $amount ),
						'payment_date' => $date,
						'source'       => Text::key( $data['source'] ?? 'manual', 20 ),
						'source_id'    => (int) ( $data['source_id'] ?? 0 ),
						'reference'    => Text::line( $data['reference'] ?? '', 100 ),
						'note'         => Text::multiline( $data['note'] ?? '', 1000 ),
						'status'       => 'completed',
						'created_by'   => $ctx->user_id,
						'updated_by'   => $ctx->user_id,
						'created_at'   => $this->now(),
						'updated_at'   => $this->now(),
					)
				);

				$party_account = 'supplier' === $party ? 'payable' : 'receivable';
				$cash          = (int) $account['id'];
				$lines         = 'in' === $direction
					? array(
						array( 'account' => $cash, 'debit' => $amount ),
						array( 'account' => $party_account, 'credit' => $amount, 'contact_id' => $contact ),
					)
					: array(
						array( 'account' => $party_account, 'debit' => $amount, 'contact_id' => $contact ),
						array( 'account' => $cash, 'credit' => $amount ),
					);
				$this->journal->post(
					$ctx,
					array(
						'date'         => $date,
						'source'       => 'payment',
						'source_id'    => $id,
						'reference_no' => $number,
						'memo'         => (string) ( $data['memo'] ?? ( 'in' === $direction ? 'Payment received ' : 'Payment made ' ) . $number ),
					),
					$lines
				);

				$allocations = $data['allocations'] ?? array();
				$settles     = ( 'customer' === $party && 'in' === $direction ) || ( 'supplier' === $party && 'out' === $direction );
				if ( $settles ) {
					$doc_type = 'customer' === $party ? 'sale' : 'purchase';
					if ( 'auto' === $allocations ) {
						$this->allocateFifo( $ctx, $id, $doc_type, $contact, $amount );
					} elseif ( is_array( $allocations ) ) {
						$this->allocateExplicit( $ctx, $id, $allocations, $amount, $contact );
					}
				}

				$this->audit->log(
					$ctx,
					'create',
					'payment',
					$id,
					sprintf( '%s %s %s', 'in' === $direction ? 'Received' : 'Paid', Decimal::toString( $amount, $ctx->decimals() ), $number ),
					array( 'contact_id' => $contact, 'account_id' => (int) $account['id'], 'source' => $data['source'] ?? 'manual' )
				);
				$this->events->dispatch( 'goriber_hisab/payment/recorded', $ctx, $id, $direction, $amount, $contact );
				return $id;
			}
		);
	}

	/**
	 * Void a payment: reverse the ledger, release allocations.
	 */
	public function void( BusinessContext $ctx, int $id, string $reason = '', bool $authorize = true ): void {
		if ( $authorize ) {
			$ctx->authorize( 'payments.delete' );
		}
		$payment = $this->findScoped( $ctx, 'payments', $id, 'Payment' );
		if ( 'void' === $payment['status'] ) {
			return;
		}
		if ( $authorize && in_array( $payment['source'], array( 'sale', 'purchase', 'sale_return', 'purchase_return' ), true ) ) {
			throw new ConflictException( 'This payment belongs to a document. Edit or void the document instead.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $payment, $id, $reason ) {
				$this->journal->reverseSource( $ctx, 'payment', $id, null, 'Void payment ' . $payment['number'] );
				$docs = $this->releaseAllocations( $ctx, $id );
				$this->db->update(
					$this->db->table( 'payments' ),
					array(
						'status'     => 'void',
						'voided_at'  => $this->now(),
						'voided_by'  => $ctx->user_id,
						'updated_at' => $this->now(),
					),
					array( 'id' => $id )
				);
				foreach ( $docs as $doc ) {
					$this->recalc( $ctx, $doc[0], $doc[1] );
				}
				$this->audit->log( $ctx, 'void', 'payment', $id, 'Payment voided ' . $payment['number'] . ( $reason ? ': ' . $reason : '' ) );
				$this->events->dispatch( 'goriber_hisab/payment/voided', $ctx, $id );
			}
		);
	}

	/**
	 * Recompute paid/due/status of a sale or purchase from allocations and returns.
	 */
	public function recalc( BusinessContext $ctx, string $doc_type, int $doc_id ): void {
		$table = $this->db->table( self::DOC_TABLES[ $doc_type ] );
		$doc   = $this->db->row( "SELECT id, total, status FROM {$table} WHERE id = %d AND business_id = %d", array( $doc_id, $ctx->business_id ) );
		if ( null === $doc ) {
			return;
		}
		$at   = $this->db->table( 'payment_allocations' );
		$pt   = $this->db->table( 'payments' );
		$rt   = $this->db->table( 'returns' );
		$paid = Decimal::of(
			$this->db->value(
				"SELECT COALESCE(SUM(a.amount),0) FROM {$at} a JOIN {$pt} p ON p.id = a.payment_id
				WHERE a.business_id = %d AND a.document_type = %s AND a.document_id = %d AND p.status = 'completed'",
				array( $ctx->business_id, $doc_type, $doc_id )
			)
		);
		$ret  = $this->db->row(
			"SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(refund_amount),0) AS refund FROM {$rt}
			WHERE business_id = %d AND return_type = %s AND document_id = %d AND status = 'completed'",
			array( $ctx->business_id, $doc_type, $doc_id )
		);
		$returned = Decimal::of( $ret['total'] ?? 0 );
		$refunded = Decimal::of( $ret['refund'] ?? 0 );
		$total    = Decimal::of( $doc['total'] );
		$due      = max( 0, $total - $paid - $returned + $refunded );

		if ( 'void' === $doc['status'] || in_array( $doc['status'], array( 'held', 'draft' ), true ) ) {
			$status = $doc['status'];
			$due    = 0;
		} elseif ( 0 === $due ) {
			$status = 'paid';
		} elseif ( $paid > 0 || $returned > 0 ) {
			$status = 'partial';
		} else {
			$status = 'due';
		}
		$this->db->update(
			$table,
			array(
				'paid_amount'    => Decimal::toString( $paid ),
				'return_amount'  => Decimal::toString( $returned ),
				'due_amount'     => Decimal::toString( $due ),
				'payment_status' => $status,
			),
			array( 'id' => $doc_id )
		);
	}

	/**
	 * Remove allocations to a document (voided/edited document). The
	 * payments themselves remain as unallocated advances. Returns affected
	 * payment ids.
	 *
	 * @return array<int,int>
	 */
	public function detachDocument( BusinessContext $ctx, string $doc_type, int $doc_id ): array {
		$at  = $this->db->table( 'payment_allocations' );
		$ids = array_map( 'intval', $this->db->column( "SELECT DISTINCT payment_id FROM {$at} WHERE business_id = %d AND document_type = %s AND document_id = %d", array( $ctx->business_id, $doc_type, $doc_id ) ) );
		$this->db->execute( "DELETE FROM {$at} WHERE business_id = %d AND document_type = %s AND document_id = %d", array( $ctx->business_id, $doc_type, $doc_id ) );
		return $ids;
	}

	/**
	 * Re-apply unallocated amounts of a contact's payments to open documents
	 * (used after a document edit/void frees allocations).
	 */
	public function reallocateAdvances( BusinessContext $ctx, string $party, int $contact_id ): void {
		if ( $contact_id <= 0 ) {
			return;
		}
		$direction = 'customer' === $party ? 'in' : 'out';
		$doc_type  = 'customer' === $party ? 'sale' : 'purchase';
		$pt        = $this->db->table( 'payments' );
		$at        = $this->db->table( 'payment_allocations' );
		$payments  = $this->db->rows(
			"SELECT p.id, p.amount, COALESCE((SELECT SUM(a.amount) FROM {$at} a WHERE a.payment_id = p.id),0) AS allocated
			FROM {$pt} p WHERE p.business_id = %d AND p.contact_id = %d AND p.direction = %s AND p.status = 'completed'
			AND p.source IN ('collection','supplier_payment','sale','purchase') ORDER BY p.payment_date, p.id",
			array( $ctx->business_id, $contact_id, $direction )
		);
		foreach ( $payments as $p ) {
			$free = Decimal::of( $p['amount'] ) - Decimal::of( $p['allocated'] );
			if ( $free > 0 ) {
				$this->allocateFifo( $ctx, (int) $p['id'], $doc_type, $contact_id, $free );
			}
		}
	}

	/**
	 * Allocate whatever is still free on a payment to a specific document.
	 */
	public function attach( BusinessContext $ctx, int $payment_id, string $doc_type, int $doc_id ): void {
		$pt   = $this->db->table( 'payments' );
		$at   = $this->db->table( 'payment_allocations' );
		$p    = $this->db->row( "SELECT amount, status FROM {$pt} WHERE id = %d AND business_id = %d", array( $payment_id, $ctx->business_id ) );
		if ( null === $p || 'completed' !== $p['status'] ) {
			return;
		}
		$used = Decimal::of( $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$at} WHERE payment_id = %d", array( $payment_id ) ) );
		$free = Decimal::of( $p['amount'] ) - $used;
		$t    = $this->db->table( self::DOC_TABLES[ $doc_type ] );
		$due  = Decimal::of( $this->db->value( "SELECT due_amount FROM {$t} WHERE id = %d AND business_id = %d", array( $doc_id, $ctx->business_id ) ) );
		$take = min( $free, $due );
		if ( $take > 0 ) {
			$this->insertAllocation( $ctx, $payment_id, $doc_type, $doc_id, $take );
			$this->recalc( $ctx, $doc_type, $doc_id );
		}
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'payments.view' );
		$p  = $this->findScoped( $ctx, 'payments', $id, 'Payment' );
		$at = $this->db->table( 'payment_allocations' );
		$ct = $this->db->table( 'contacts' );
		$ac = $this->db->table( 'accounts' );
		$p['allocations'] = $this->db->rows( "SELECT document_type, document_id, amount FROM {$at} WHERE payment_id = %d", array( $id ) );
		$p['contact']     = $p['contact_id'] ? $this->db->row( "SELECT id, name, phone, type FROM {$ct} WHERE id = %d", array( (int) $p['contact_id'] ) ) : null;
		$p['account']     = $this->db->row( "SELECT id, name, subtype FROM {$ac} WHERE id = %d", array( (int) $p['account_id'] ) );
		foreach ( $p['allocations'] as &$a ) {
			$table        = $this->db->table( self::DOC_TABLES[ $a['document_type'] ] ?? 'sales' );
			$a['number']  = $this->db->value( "SELECT number FROM {$table} WHERE id = %d", array( (int) $a['document_id'] ) );
		}
		return $p;
	}

	/**
	 * @param array<string,mixed> $args direction, contact_id, account_id, source, from, to, search, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'payments.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$pt     = $this->db->table( 'payments' );
		$ct     = $this->db->table( 'contacts' );
		$ac     = $this->db->table( 'accounts' );
		$where  = array( 'p.business_id = %d' );
		$params = array( $ctx->business_id );
		if ( in_array( $args['direction'] ?? '', array( 'in', 'out' ), true ) ) {
			$where[]  = 'p.direction = %s';
			$params[] = $args['direction'];
		}
		foreach ( array( 'contact_id', 'account_id' ) as $f ) {
			if ( ! empty( $args[ $f ] ) ) {
				$where[]  = "p.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( ! empty( $args['source'] ) ) {
			$where[]  = 'p.source = %s';
			$params[] = Text::key( $args['source'] );
		}
		if ( empty( $args['include_void'] ) ) {
			$where[] = "p.status = 'completed'";
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 'p.payment_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 'p.payment_date <= %s';
			$params[] = $to;
		}
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(p.number LIKE %s OR p.reference LIKE %s OR c.name LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		$w     = implode( ' AND ', $where );
		$from_sql = "FROM {$pt} p LEFT JOIN {$ct} c ON c.id = p.contact_id LEFT JOIN {$ac} a ON a.id = p.account_id WHERE {$w}";
		$agg   = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(p.amount),0) AS total {$from_sql}", $params );
		$rows  = $this->db->rows( "SELECT p.*, c.name AS contact_name, a.name AS account_name {$from_sql} ORDER BY p.payment_date DESC, p.id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, $offset ) ) );
		$out   = $this->paged( $rows, (int) $agg['n'], $page, $per_page );
		$out['sum'] = Decimal::toString( Decimal::of( $agg['total'] ) );
		return $out;
	}

	/**
	 * Payments taken together with a document (POS tenders etc.).
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function forSource( BusinessContext $ctx, string $source, int $source_id ): array {
		$pt = $this->db->table( 'payments' );
		$ac = $this->db->table( 'accounts' );
		return $this->db->rows(
			"SELECT p.*, a.name AS account_name FROM {$pt} p LEFT JOIN {$ac} a ON a.id = p.account_id WHERE p.business_id = %d AND p.source = %s AND p.source_id = %d AND p.status = 'completed' ORDER BY p.id",
			array( $ctx->business_id, $source, $source_id )
		);
	}

	/**
	 * Every completed payment allocated to a document.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function forDocument( BusinessContext $ctx, string $doc_type, int $doc_id ): array {
		$pt = $this->db->table( 'payments' );
		$at = $this->db->table( 'payment_allocations' );
		$ac = $this->db->table( 'accounts' );
		return $this->db->rows(
			"SELECT p.id, p.number, p.payment_date, p.source, p.reference, a.amount, ac.name AS account_name
			FROM {$at} a JOIN {$pt} p ON p.id = a.payment_id LEFT JOIN {$ac} ac ON ac.id = p.account_id
			WHERE a.business_id = %d AND a.document_type = %s AND a.document_id = %d AND p.status = 'completed' ORDER BY p.payment_date, p.id",
			array( $ctx->business_id, $doc_type, $doc_id )
		);
	}

	/* ------------------------------------------------------------------ Internals */

	private function allocateFifo( BusinessContext $ctx, int $payment_id, string $doc_type, int $contact_id, int $amount ): void {
		if ( $contact_id <= 0 || $amount <= 0 ) {
			return;
		}
		$table   = $this->db->table( self::DOC_TABLES[ $doc_type ] );
		$col     = 'sale' === $doc_type ? 'customer_id' : 'supplier_id';
		$datecol = 'sale' === $doc_type ? 'sale_date' : 'purchase_date';
		$docs    = $this->db->rows(
			"SELECT id, due_amount FROM {$table} WHERE business_id = %d AND {$col} = %d AND status = 'completed' AND due_amount > 0 ORDER BY {$datecol}, id",
			array( $ctx->business_id, $contact_id )
		);
		foreach ( $docs as $doc ) {
			if ( $amount <= 0 ) {
				break;
			}
			$take = min( $amount, Decimal::of( $doc['due_amount'] ) );
			$this->insertAllocation( $ctx, $payment_id, $doc_type, (int) $doc['id'], $take );
			$this->recalc( $ctx, $doc_type, (int) $doc['id'] );
			$amount -= $take;
		}
	}

	/**
	 * @param array<int,array<string,mixed>> $allocations document_type, document_id, amount (scaled int|null = as much as possible).
	 */
	private function allocateExplicit( BusinessContext $ctx, int $payment_id, array $allocations, int $amount, int $contact_id ): void {
		foreach ( $allocations as $a ) {
			if ( $amount <= 0 ) {
				break;
			}
			$type = (string) ( $a['document_type'] ?? '' );
			if ( ! isset( self::DOC_TABLES[ $type ] ) ) {
				continue;
			}
			$table = $this->db->table( self::DOC_TABLES[ $type ] );
			$col   = 'sale' === $type ? 'customer_id' : 'supplier_id';
			$doc   = $this->db->row( "SELECT id, due_amount, status, {$col} AS contact_id FROM {$table} WHERE id = %d AND business_id = %d", array( (int) $a['document_id'], $ctx->business_id ) );
			if ( null === $doc || 'completed' !== $doc['status'] || (int) $doc['contact_id'] !== $contact_id ) {
				throw ValidationException::field( 'document_id', 'The selected invoice cannot receive this payment.' );
			}
			$due  = Decimal::of( $doc['due_amount'] );
			$want = null === ( $a['amount'] ?? null ) ? $amount : min( $amount, (int) $a['amount'] );
			$take = min( $want, $due );
			if ( $take > 0 ) {
				$this->insertAllocation( $ctx, $payment_id, $type, (int) $doc['id'], $take );
				$this->recalc( $ctx, $type, (int) $doc['id'] );
				$amount -= $take;
			}
		}
		// Anything left over settles other open invoices of the same contact.
		if ( $amount > 0 && $contact_id > 0 ) {
			$type = (string) ( $allocations[0]['document_type'] ?? 'sale' );
			$this->allocateFifo( $ctx, $payment_id, $type, $contact_id, $amount );
		}
	}

	private function insertAllocation( BusinessContext $ctx, int $payment_id, string $doc_type, int $doc_id, int $amount ): void {
		$this->db->insert(
			$this->db->table( 'payment_allocations' ),
			array(
				'business_id'   => $ctx->business_id,
				'payment_id'    => $payment_id,
				'document_type' => $doc_type,
				'document_id'   => $doc_id,
				'amount'        => Decimal::toString( $amount ),
				'created_at'    => $this->now(),
			)
		);
	}

	/**
	 * Delete a payment's allocations; returns [type, id] of affected docs.
	 *
	 * @return array<int,array{0:string,1:int}>
	 */
	private function releaseAllocations( BusinessContext $ctx, int $payment_id ): array {
		$at   = $this->db->table( 'payment_allocations' );
		$docs = $this->db->rows( "SELECT DISTINCT document_type, document_id FROM {$at} WHERE payment_id = %d AND business_id = %d", array( $payment_id, $ctx->business_id ) );
		$this->db->execute( "DELETE FROM {$at} WHERE payment_id = %d AND business_id = %d", array( $payment_id, $ctx->business_id ) );
		return array_map( static fn( $d ) => array( (string) $d['document_type'], (int) $d['document_id'] ), $docs );
	}
}
