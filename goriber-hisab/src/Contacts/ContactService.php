<?php
/**
 * Customers and suppliers.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Contacts;

use GoriberHisab\Accounting\AccountService;
use GoriberHisab\Accounting\JournalService;
use GoriberHisab\Audit\AuditLogger;
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
 * Customer and supplier records with receivable/payable sub-ledgers.
 *
 * `balance` is a cache maintained by JournalService:
 *   customer: positive = customer owes us (due), negative = advance
 *   supplier: positive = we owe the supplier (payable)
 */
final class ContactService extends Service {

	public const TYPES = array( 'customer', 'supplier' );

	private JournalService $journal;
	private AccountService $accounts;
	private NumberingService $numbers;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, JournalService $journal, AccountService $accounts, NumberingService $numbers, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->journal  = $journal;
		$this->accounts = $accounts;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
	}

	private static function perm( string $type, string $action ): string {
		return ( 'customer' === $type ? 'customers.' : 'suppliers.' ) . $action;
	}

	/**
	 * @param array<string,mixed> $args search, due_only, min_bought, max_bought, location, zone (inside|outside),
	 *                                  channel (online|shop), last_from, last_to, inactive_days, page, per_page, orderby.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, string $type, array $args = array() ): array {
		$ctx->authorize( self::perm( $type, 'view' ) );
		list( $page, $per_page, $offset ) = $this->paging( $args, 500 );
		$t      = $this->db->table( 'contacts' );
		$docs   = $this->db->table( 'customer' === $type ? 'sales' : 'purchases' );
		$party  = 'customer' === $type ? 'customer_id' : 'supplier_id';
		$dcol   = 'customer' === $type ? 'sale_date' : 'purchase_date';
		$ot     = $this->db->table( 'orders' );
		$where  = array( 'c.business_id = %d', 'c.type = %s', 'c.deleted_at IS NULL' );
		$params = array( $ctx->business_id, $type );
		if ( ! empty( $args['search'] ) ) {
			$term     = Text::line( $args['search'] );
			$like     = '%' . $this->db->escapeLike( $term ) . '%';
			$where[]  = '(c.name LIKE %s OR c.phone LIKE %s OR c.code = %s OR c.company LIKE %s OR c.email LIKE %s)';
			array_push( $params, $like, $like, $term, $like, $like );
		}
		if ( ! empty( $args['due_only'] ) ) {
			$where[] = 'c.balance > 0';
		}
		if ( ! empty( $args['location'] ) ) {
			// Address on the customer, or any delivery area/address used in their online orders.
			$like     = '%' . $this->db->escapeLike( Text::line( $args['location'] ) ) . '%';
			$where[]  = "(c.address LIKE %s OR EXISTS (SELECT 1 FROM {$ot} o WHERE o.business_id = c.business_id AND o.customer_id = c.id AND (o.area LIKE %s OR o.address LIKE %s)))";
			array_push( $params, $like, $like, $like );
		}
		if ( 'customer' === $type && in_array( $args['zone'] ?? '', array( 'inside', 'outside' ), true ) ) {
			$where[]  = "EXISTS (SELECT 1 FROM {$ot} o WHERE o.business_id = c.business_id AND o.customer_id = c.id AND o.zone = %s)";
			$params[] = $args['zone'];
		}
		if ( 'customer' === $type && in_array( $args['channel'] ?? '', array( 'online', 'shop' ), true ) ) {
			$where[] = "EXISTS (SELECT 1 FROM {$docs} d WHERE d.business_id = c.business_id AND d.customer_id = c.id AND d.status = 'completed' AND d.channel " . ( 'online' === $args['channel'] ? "= 'online'" : "<> 'online'" ) . ')';
		}

		// Trading figures per contact, then filters on them.
		$inner = "SELECT c.*,
				(SELECT COALESCE(SUM(d.total - d.return_amount),0) FROM {$docs} d WHERE d.business_id = c.business_id AND d.{$party} = c.id AND d.status = 'completed') AS bought,
				(SELECT COUNT(*) FROM {$docs} d WHERE d.business_id = c.business_id AND d.{$party} = c.id AND d.status = 'completed') AS invoices,
				(SELECT MAX(d.{$dcol}) FROM {$docs} d WHERE d.business_id = c.business_id AND d.{$party} = c.id AND d.status = 'completed') AS last_buy
			FROM {$t} c WHERE " . implode( ' AND ', $where );
		$outer  = array( '1 = 1' );
		$oparam = array();
		foreach ( array( 'min_bought' => '>=', 'max_bought' => '<=' ) as $k => $op ) {
			if ( isset( $args[ $k ] ) && '' !== (string) $args[ $k ] && is_numeric( $args[ $k ] ) ) {
				// Validated number written inline: SQLite compares a bound string as text.
				$outer[] = "x.bought {$op} " . sprintf( '%.4F', Decimal::of( $args[ $k ] ) / 10000 );
			}
		}
		foreach ( array( 'last_from' => '>=', 'last_to' => '<=' ) as $k => $op ) {
			$d = Text::date( $args[ $k ] ?? null );
			if ( $d ) {
				$outer[]  = "x.last_buy {$op} %s";
				$oparam[] = $d;
			}
		}
		if ( ! empty( $args['inactive_days'] ) && (int) $args['inactive_days'] > 0 ) {
			$outer[]  = '(x.last_buy IS NULL OR x.last_buy < %s)';
			$oparam[] = ( new \DateTimeImmutable( $this->today( $ctx ) ) )->modify( '-' . (int) $args['inactive_days'] . ' days' )->format( 'Y-m-d' );
		}
		$order = array(
			'name'    => 'x.name ASC',
			'balance' => 'x.balance DESC',
			'recent'  => 'x.last_activity_at DESC',
			'newest'  => 'x.id DESC',
			'bought'  => 'x.bought DESC',
			'visits'  => 'x.invoices DESC',
		)[ $args['orderby'] ?? 'name' ] ?? 'x.name ASC';
		$w      = implode( ' AND ', $outer );
		$all    = array_merge( $params, $oparam );
		$agg    = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(x.bought),0) AS bought FROM ({$inner}) x WHERE {$w}", $all );
		$rows   = $this->db->rows( "SELECT * FROM ({$inner}) x WHERE {$w} ORDER BY {$order} LIMIT %d OFFSET %d", array_merge( $all, array( $per_page, $offset ) ) );
		$sum    = $this->db->value( "SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),0) FROM {$t} WHERE business_id = %d AND type = %s AND deleted_at IS NULL", array( $ctx->business_id, $type ) );
		$items  = array_map(
			function ( array $r ): array {
				$out             = $this->present( $r );
				$out['bought']   = Decimal::toString( Decimal::of( $r['bought'] ?? 0 ) );
				$out['invoices'] = (int) ( $r['invoices'] ?? 0 );
				$out['last_buy'] = $r['last_buy'] ?? null;
				return $out;
			},
			$rows
		);
		$out                  = $this->paged( $items, (int) $agg['n'], $page, $per_page );
		$out['total_balance'] = Decimal::toString( Decimal::of( $sum ) );
		$out['total_bought']  = Decimal::toString( Decimal::of( $agg['bought'] ?? 0 ) );
		return $out;
	}

	/**
	 * Profile with trading summary.
	 *
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, string $type, int $id ): array {
		$ctx->authorize( self::perm( $type, 'view' ) );
		$row     = $this->requireRow( $ctx, $type, $id );
		$contact = $this->present( $row );

		if ( 'customer' === $type ) {
			$t   = $this->db->table( 'sales' );
			$sum = $this->db->row(
				"SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid_amount),0) AS paid, COALESCE(SUM(return_amount),0) AS returned, MAX(sale_date) AS last_date
				FROM {$t} WHERE business_id = %d AND customer_id = %d AND status = 'completed'",
				array( $ctx->business_id, $id )
			);
		} else {
			$t   = $this->db->table( 'purchases' );
			$sum = $this->db->row(
				"SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid_amount),0) AS paid, COALESCE(SUM(return_amount),0) AS returned, MAX(purchase_date) AS last_date
				FROM {$t} WHERE business_id = %d AND supplier_id = %d AND status = 'completed'",
				array( $ctx->business_id, $id )
			);
		}
		$pt  = $this->db->table( 'payments' );
		$pay = $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$pt} WHERE business_id = %d AND contact_id = %d AND status = 'completed'", array( $ctx->business_id, $id ) );

		$contact['summary'] = array(
			'documents'      => (int) ( $sum['count'] ?? 0 ),
			'total_amount'   => Decimal::toString( Decimal::of( $sum['total'] ?? 0 ) ),
			'total_returned' => Decimal::toString( Decimal::of( $sum['returned'] ?? 0 ) ),
			'total_paid'     => Decimal::toString( Decimal::of( $pay ) ),
			'balance'        => $contact['balance'],
			'last_date'      => $sum['last_date'] ?? null,
		);
		return $contact;
	}

	/**
	 * @param array<string,mixed> $data Fields incl. opening_balance.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, string $type, array $data ): array {
		$ctx->authorize( self::perm( $type, 'create' ) );
		$clean   = $this->validate( $ctx, $type, $data );
		$opening = $this->money( $data, 'opening_balance' );
		$now     = $this->now();

		$id = $this->db->transaction(
			function () use ( $ctx, $type, $clean, $opening, $now ) {
				$code = '' !== $clean['code'] ? $clean['code'] : $this->numbers->next( $ctx, $type );
				$id   = $this->db->insert(
					$this->db->table( 'contacts' ),
					array_merge(
						$clean,
						array(
							'code'            => $code,
							'business_id'     => $ctx->business_id,
							'type'            => $type,
							'opening_balance' => Decimal::toString( $opening ),
							'balance'         => '0',
							'status'          => 'active',
							'created_by'      => $ctx->user_id,
							'updated_by'      => $ctx->user_id,
							'created_at'      => $now,
							'updated_at'      => $now,
						)
					)
				);
				$this->postOpening( $ctx, $type, $id, $opening, $clean['name'] );
				$this->audit->log( $ctx, 'create', $type, $id, ucfirst( $type ) . ' created: ' . $clean['name'] );
				return $id;
			}
		);
		$this->events->dispatch( "goriber_hisab/{$type}/created", $ctx, $id );
		return $this->get( $ctx, $type, $id );
	}

	/**
	 * @param array<string,mixed> $data Fields.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, string $type, int $id, array $data ): array {
		$ctx->authorize( self::perm( $type, 'edit' ) );
		$before = $this->requireRow( $ctx, $type, $id );
		$clean  = $this->validate( $ctx, $type, array_merge( $before, $data ), $id );
		if ( '' === $clean['code'] ) {
			$clean['code'] = $before['code'];
		}
		$opening     = array_key_exists( 'opening_balance', $data ) ? $this->money( $data, 'opening_balance' ) : Decimal::of( $before['opening_balance'] );
		$old_opening = Decimal::of( $before['opening_balance'] );

		$this->db->transaction(
			function () use ( $ctx, $type, $id, $clean, $opening, $old_opening, $before ) {
				$clean['opening_balance'] = Decimal::toString( $opening );
				$clean['updated_by']      = $ctx->user_id;
				$clean['updated_at']      = $this->now();
				$this->db->update( $this->db->table( 'contacts' ), $clean, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
				if ( $opening !== $old_opening ) {
					$this->journal->reverseSource( $ctx, "opening_{$type}", $id );
					$this->postOpening( $ctx, $type, $id, $opening, $clean['name'] );
				}
				$this->audit->log( $ctx, 'update', $type, $id, ucfirst( $type ) . ' updated: ' . $clean['name'], AuditLogger::diff( $before, $clean ) );
			}
		);
		return $this->get( $ctx, $type, $id );
	}

	public function delete( BusinessContext $ctx, string $type, int $id ): void {
		$ctx->authorize( self::perm( $type, 'delete' ) );
		$row = $this->requireRow( $ctx, $type, $id );
		if ( 0 !== Decimal::of( $row['balance'] ) ) {
			throw new ConflictException( sprintf( 'This %s has an outstanding balance of %s. Settle it before deleting.', $type, Decimal::toString( Decimal::of( $row['balance'] ), $ctx->decimals() ) ) );
		}
		$this->db->transaction(
			function () use ( $ctx, $type, $id, $row ) {
				$this->db->update( $this->db->table( 'contacts' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
				$this->audit->log( $ctx, 'delete', $type, $id, ucfirst( $type ) . ' deleted: ' . $row['name'] );
			}
		);
	}

	/**
	 * Ledger statement with running balance.
	 *
	 * @param array<string,mixed> $args from, to.
	 * @return array<string,mixed>
	 */
	public function statement( BusinessContext $ctx, string $type, int $id, array $args = array() ): array {
		$ctx->authorize( self::perm( $type, 'view' ) );
		$contact = $this->present( $this->requireRow( $ctx, $type, $id ) );
		$account = $this->accounts->systemId( $ctx->business_id, 'customer' === $type ? 'receivable' : 'payable' );
		$sign    = 'customer' === $type ? 1 : -1;
		$from    = Text::date( $args['from'] ?? null );
		$to      = Text::date( $args['to'] ?? null ) ?? $this->today( $ctx );
		$lt      = $this->db->table( 'journal_lines' );
		$et      = $this->db->table( 'journal_entries' );

		$opening = 0;
		if ( $from ) {
			$o       = $this->db->row(
				"SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM {$lt} WHERE business_id = %d AND account_id = %d AND contact_id = %d AND entry_date < %s",
				array( $ctx->business_id, $account, $id, $from )
			);
			$opening = $sign * ( Decimal::of( $o['dr'] ?? 0 ) - Decimal::of( $o['cr'] ?? 0 ) );
		}

		$params = array( $ctx->business_id, $account, $id );
		$range  = '';
		if ( $from ) {
			$range   .= ' AND l.entry_date >= %s';
			$params[] = $from;
		}
		$range   .= ' AND l.entry_date <= %s';
		$params[] = $to;

		$rows    = $this->db->rows(
			"SELECT l.entry_date, l.debit, l.credit, e.source, e.source_id, e.reference_no, e.memo, e.is_reversal
			FROM {$lt} l JOIN {$et} e ON e.id = l.entry_id
			WHERE l.business_id = %d AND l.account_id = %d AND l.contact_id = %d{$range}
			ORDER BY l.entry_date, l.id",
			$params
		);
		$running = $opening;
		$lines   = array();
		$tdr     = 0;
		$tcr     = 0;
		foreach ( $rows as $r ) {
			$dr       = Decimal::of( $r['debit'] );
			$cr       = Decimal::of( $r['credit'] );
			$tdr     += $dr;
			$tcr     += $cr;
			$running += $sign * ( $dr - $cr );
			$lines[]  = array(
				'date'         => $r['entry_date'],
				'source'       => $r['source'],
				'source_id'    => (int) $r['source_id'],
				'reference_no' => $r['reference_no'],
				'description'  => $r['memo'],
				'debit'        => Decimal::toString( $dr ),
				'credit'       => Decimal::toString( $cr ),
				'balance'      => Decimal::toString( $running ),
			);
		}
		return array(
			'contact'         => $contact,
			'from'            => $from,
			'to'              => $to,
			'opening_balance' => Decimal::toString( $opening ),
			'lines'           => $lines,
			'total_debit'     => Decimal::toString( $tdr ),
			'total_credit'    => Decimal::toString( $tcr ),
			'closing_balance' => Decimal::toString( $running ),
		);
	}

	/**
	 * Validate a contact reference from a transaction payload.
	 *
	 * @return array<string,mixed>
	 * @throws ValidationException When invalid.
	 */
	public function requireContact( BusinessContext $ctx, string $type, int $id, string $field ): array {
		$t   = $this->db->table( 'contacts' );
		$row = $id > 0 ? $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d AND type = %s AND deleted_at IS NULL", array( $id, $ctx->business_id, $type ) ) : null;
		if ( null === $row ) {
			throw ValidationException::field( $field, sprintf( 'Select a valid %s.', $type ) );
		}
		return $row;
	}

	/**
	 * Quick-create (POS "new customer" with just name/phone).
	 *
	 * @param array<string,mixed> $data name, phone.
	 * @return array<string,mixed>
	 */
	public function quickCreate( BusinessContext $ctx, string $type, array $data ): array {
		$phone = Text::phone( $data['phone'] ?? '' );
		if ( '' !== $phone ) {
			$t        = $this->db->table( 'contacts' );
			$existing = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND type = %s AND phone = %s AND deleted_at IS NULL", array( $ctx->business_id, $type, $phone ) );
			if ( $existing ) {
				return $this->get( $ctx, $type, (int) $existing );
			}
		}
		return $this->create( $ctx, $type, $data );
	}

	/**
	 * @return array<string,mixed>
	 */
	private function requireRow( BusinessContext $ctx, string $type, int $id ): array {
		$row = $this->findScoped( $ctx, 'contacts', $id, ucfirst( $type ) );
		if ( $row['type'] !== $type ) {
			throw new \GoriberHisab\Support\NotFoundException( ucfirst( $type ) . ' not found.' );
		}
		return $row;
	}

	private function postOpening( BusinessContext $ctx, string $type, int $id, int $amount, string $name ): void {
		if ( 0 === $amount ) {
			return;
		}
		$lines = 'customer' === $type
			? array(
				array( 'account' => 'receivable', 'debit' => $amount, 'contact_id' => $id ),
				array( 'account' => 'opening_balance', 'credit' => $amount ),
			)
			: array(
				array( 'account' => 'opening_balance', 'debit' => $amount ),
				array( 'account' => 'payable', 'credit' => $amount, 'contact_id' => $id ),
			);
		$this->journal->post(
			$ctx,
			array(
				'date'      => $this->today( $ctx ),
				'source'    => "opening_{$type}",
				'source_id' => $id,
				'memo'      => 'Opening balance: ' . $name,
			),
			$lines
		);
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function validate( BusinessContext $ctx, string $type, array $data, int $id = 0 ): array {
		$errors = array();
		$name   = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			$errors['name'] = 'Name is required.';
		}
		$email = Text::email( $data['email'] ?? '' );
		if ( '' !== trim( (string) ( $data['email'] ?? '' ) ) && '' === $email ) {
			$errors['email'] = 'Enter a valid email address.';
		}
		$phone = Text::phone( $data['phone'] ?? '' );
		$code  = Text::line( $data['code'] ?? '', 40 );
		$t     = $this->db->table( 'contacts' );
		if ( '' !== $phone ) {
			$dup = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND type = %s AND phone = %s AND deleted_at IS NULL AND id <> %d", array( $ctx->business_id, $type, $phone, $id ) );
			if ( $dup ) {
				$errors['phone'] = sprintf( 'Another %s already uses this phone number.', $type );
			}
		}
		if ( '' !== $code ) {
			$dup = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND code = %s AND deleted_at IS NULL AND id <> %d", array( $ctx->business_id, $code, $id ) );
			if ( $dup ) {
				$errors['code'] = 'This ID is already in use.';
			}
		}
		$limit = 0;
		try {
			$limit = Decimal::of( $data['credit_limit'] ?? 0 );
			if ( $limit < 0 ) {
				$errors['credit_limit'] = 'Cannot be negative.';
			}
		} catch ( \InvalidArgumentException $e ) {
			$errors['credit_limit'] = 'Enter a valid amount.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		return array(
			'code'         => $code,
			'name'         => $name,
			'company'      => Text::line( $data['company'] ?? '' ),
			'phone'        => $phone,
			'email'        => $email,
			'address'      => Text::multiline( $data['address'] ?? '', 500 ),
			'tax_number'   => Text::line( $data['tax_number'] ?? '', 60 ),
			'credit_limit' => Decimal::toString( $limit ),
			'notes'        => Text::multiline( $data['notes'] ?? '' ),
		);
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 */
	private function money( array $data, string $field ): int {
		try {
			return Decimal::round( Decimal::of( $data[ $field ] ?? 0 ), 4 );
		} catch ( \InvalidArgumentException $e ) {
			throw ValidationException::field( $field, 'Enter a valid amount.' );
		}
	}

	/**
	 * @param array<string,mixed> $row DB row.
	 * @return array<string,mixed>
	 */
	private function present( array $row ): array {
		$row['id'] = (int) $row['id'];
		foreach ( array( 'opening_balance', 'balance', 'credit_limit' ) as $f ) {
			$row[ $f ] = Decimal::toString( Decimal::of( $row[ $f ] ) );
		}
		unset( $row['deleted_at'], $row['deleted_by'] );
		return $row;
	}
}
