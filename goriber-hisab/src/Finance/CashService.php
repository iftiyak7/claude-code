<?php
/**
 * Cash management: money moving between cash in hand, bank and mobile
 * accounts, the owner putting money in or taking it out, and cash counts.
 *
 * Every move is a document (CSH-000001) with its own journal entry, so it
 * shows in the cash book, ledgers and balance sheet, and can be voided.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Finance;

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
 * Cash moves.
 */
final class CashService extends Service {

	/**
	 * transfer   from one money account to another
	 * owner_in   owner puts money in (capital)
	 * owner_out  owner takes money out (drawings)
	 * cash_in    other money in (loan received, misc. receipt → other income)
	 * cash_out   other money out (misc. payment → other expense)
	 * count      counted balance differs: excess (other income) or shortage (other expense)
	 */
	public const KINDS = array( 'transfer', 'owner_in', 'owner_out', 'cash_in', 'cash_out', 'count' );

	private AccountService $accounts;
	private JournalService $journal;
	private NumberingService $numbers;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AccountService $accounts, JournalService $journal, NumberingService $numbers, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->accounts = $accounts;
		$this->journal  = $journal;
		$this->numbers  = $numbers;
		$this->audit    = $audit;
	}

	/**
	 * Money accounts with their balances + today's in/out.
	 *
	 * @return array<string,mixed>
	 */
	public function overview( BusinessContext $ctx ): array {
		$ctx->authorize( 'cash.manage' );
		$accounts = array();
		$total    = 0;
		foreach ( $this->accounts->list( $ctx, array( 'payment' => true, 'with_balance' => true ) ) as $a ) {
			$total     += Decimal::of( $a['balance'] );
			$accounts[] = array(
				'id'      => (int) $a['id'],
				'name'    => $a['name'],
				'subtype' => $a['subtype'],
				'balance' => $a['balance'],
			);
		}
		$l     = $this->db->table( 'journal_lines' );
		$a     = $this->db->table( 'accounts' );
		$today = $this->today( $ctx );
		$flow  = $this->db->row(
			"SELECT COALESCE(SUM(l.debit),0) AS in_amt, COALESCE(SUM(l.credit),0) AS out_amt FROM {$l} l JOIN {$a} a ON a.id = l.account_id
			WHERE l.business_id = %d AND a.is_payment = 1 AND l.entry_date = %s",
			array( $ctx->business_id, $today )
		);
		return array(
			'accounts' => $accounts,
			'total'    => Decimal::toString( $total ),
			'today_in'  => Decimal::toString( Decimal::of( $flow['in_amt'] ?? 0 ) ),
			'today_out' => Decimal::toString( Decimal::of( $flow['out_amt'] ?? 0 ) ),
		);
	}

	/**
	 * @param array<string,mixed> $args kind, from, to, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, array $args = array() ): array {
		$ctx->authorize( 'cash.manage' );
		list( $page, $per_page, $offset ) = $this->paging( $args, 200 );
		$t      = $this->db->table( 'cash_moves' );
		$a      = $this->db->table( 'accounts' );
		$where  = array( 'm.business_id = %d' );
		$params = array( $ctx->business_id );
		if ( ! empty( $args['kind'] ) && in_array( $args['kind'], self::KINDS, true ) ) {
			$where[]  = 'm.kind = %s';
			$params[] = $args['kind'];
		}
		foreach ( array( 'from' => '>=', 'to' => '<=' ) as $k => $op ) {
			$d = Text::date( $args[ $k ] ?? null );
			if ( $d ) {
				$where[]  = "m.move_date {$op} %s";
				$params[] = $d;
			}
		}
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} m WHERE {$w}", $params );
		$rows  = $this->db->rows(
			"SELECT m.*, fa.name AS from_name, ta.name AS to_name FROM {$t} m
			LEFT JOIN {$a} fa ON fa.id = m.from_account_id LEFT JOIN {$a} ta ON ta.id = m.to_account_id
			WHERE {$w} ORDER BY m.move_date DESC, m.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		return $this->paged( array_map( array( $this, 'present' ), $rows ), $total, $page, $per_page );
	}

	/**
	 * @param array<string,mixed> $data kind, amount (or counted for count), from_account_id, to_account_id, account_id, date, note, uuid.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'cash.manage' );
		$t    = $this->db->table( 'cash_moves' );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		if ( $uuid ) {
			$existing = $this->db->row( "SELECT * FROM {$t} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->present( $existing );
			}
		}
		$kind = (string) ( $data['kind'] ?? '' );
		if ( ! in_array( $kind, self::KINDS, true ) ) {
			throw ValidationException::field( 'kind', 'Choose what kind of cash entry this is.' );
		}
		$date = Text::date( $data['date'] ?? null ) ?? $this->today( $ctx );
		$note = Text::line( $data['note'] ?? '', 255 );
		$from = 0;
		$to   = 0;
		$acc  = static fn( $v ) => (int) $v;

		if ( 'count' === $kind ) {
			$account = $this->accounts->require( $ctx, $acc( $data['account_id'] ?? 0 ), 'asset', true, 'account_id' );
			try {
				$counted = Decimal::of( $data['counted'] ?? '' );
			} catch ( \InvalidArgumentException $e ) {
				throw ValidationException::field( 'counted', 'Enter the amount you counted.' );
			}
			if ( $counted < 0 ) {
				throw ValidationException::field( 'counted', 'The counted amount cannot be negative.' );
			}
			$balance = Decimal::of( $this->balance( $ctx, (int) $account['id'] ) );
			$diff    = $counted - $balance;
			if ( 0 === $diff ) {
				throw ValidationException::field( 'counted', 'The count matches the books — nothing to adjust.' );
			}
			$amount = abs( $diff );
			if ( $diff > 0 ) {
				$to = (int) $account['id'];
			} else {
				$from = (int) $account['id'];
			}
			$note = '' !== $note ? $note : ( $diff > 0 ? 'Cash count: excess' : 'Cash count: shortage' );
		} else {
			try {
				$amount = Decimal::of( $data['amount'] ?? '' );
			} catch ( \InvalidArgumentException $e ) {
				throw ValidationException::field( 'amount', 'Enter an amount.' );
			}
			if ( $amount <= 0 ) {
				throw ValidationException::field( 'amount', 'Enter an amount greater than zero.' );
			}
			if ( in_array( $kind, array( 'transfer', 'owner_out', 'cash_out' ), true ) ) {
				$from = (int) $this->accounts->require( $ctx, $acc( $data['from_account_id'] ?? 0 ), 'asset', true, 'from_account_id' )['id'];
			}
			if ( in_array( $kind, array( 'transfer', 'owner_in', 'cash_in' ), true ) ) {
				$to = (int) $this->accounts->require( $ctx, $acc( $data['to_account_id'] ?? 0 ), 'asset', true, 'to_account_id' )['id'];
			}
			if ( 'transfer' === $kind && $from === $to ) {
				throw ValidationException::field( 'to_account_id', 'Choose two different accounts.' );
			}
		}

		$id = $this->db->transaction(
			function () use ( $ctx, $t, $uuid, $kind, $date, $from, $to, $amount, $note ) {
				$number = $this->numbers->next( $ctx, 'cash', $date );
				$id     = $this->db->insert(
					$t,
					array(
						'uuid'            => $uuid ?: Text::newUuid(),
						'business_id'     => $ctx->business_id,
						'branch_id'       => $ctx->branch_id,
						'number'          => $number,
						'kind'            => $kind,
						'move_date'       => $date,
						'from_account_id' => $from,
						'to_account_id'   => $to,
						'amount'          => Decimal::toString( $amount ),
						'note'            => $note,
						'status'          => 'completed',
						'created_by'      => $ctx->user_id,
						'updated_by'      => $ctx->user_id,
						'created_at'      => $this->now(),
						'updated_at'      => $this->now(),
					)
				);
				$counter = match ( $kind ) {
					'owner_in'  => 'capital',
					'owner_out' => 'drawings',
					'cash_in'   => 'other_income',
					'cash_out'  => 'other_expense',
					'count'     => $to ? 'other_income' : 'other_expense',
					default     => null,
				};
				$lines = array();
				if ( $to ) {
					$lines[] = array( 'account' => $to, 'debit' => $amount );
				}
				if ( $from ) {
					$lines[] = array( 'account' => $from, 'credit' => $amount );
				}
				if ( $counter ) {
					$lines[] = $to ? array( 'account' => $counter, 'credit' => $amount ) : array( 'account' => $counter, 'debit' => $amount );
				}
				$this->journal->post(
					$ctx,
					array(
						'date'         => $date,
						'source'       => 'cash_move',
						'source_id'    => $id,
						'reference_no' => $number,
						'memo'         => self::label( $kind ) . ( '' !== $note ? ': ' . $note : '' ),
					),
					$lines
				);
				$this->audit->log( $ctx, 'create', 'cash_move', $id, self::label( $kind ) . ' ' . Decimal::toString( $amount, 2 ) );
				return $id;
			}
		);
		$this->events->dispatch( 'goriber_hisab/cash/moved', $ctx, $id );
		return $this->get( $ctx, $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'cash.manage' );
		$t   = $this->db->table( 'cash_moves' );
		$a   = $this->db->table( 'accounts' );
		$row = $this->db->row(
			"SELECT m.*, fa.name AS from_name, ta.name AS to_name FROM {$t} m
			LEFT JOIN {$a} fa ON fa.id = m.from_account_id LEFT JOIN {$a} ta ON ta.id = m.to_account_id
			WHERE m.id = %d AND m.business_id = %d",
			array( $id, $ctx->business_id )
		);
		if ( null === $row ) {
			throw new \GoriberHisab\Support\NotFoundException( 'Cash entry not found.' );
		}
		return $this->present( $row );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function void( BusinessContext $ctx, int $id, string $reason = '' ): array {
		$ctx->authorize( 'cash.manage' );
		$row = $this->get( $ctx, $id );
		if ( 'void' === $row['status'] ) {
			throw new ConflictException( 'This entry is already void.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $id, $reason ) {
				$this->journal->reverseSource( $ctx, 'cash_move', $id, null, 'Void cash entry' . ( '' !== $reason ? ': ' . $reason : '' ) );
				$this->db->update( $this->db->table( 'cash_moves' ), array( 'status' => 'void', 'voided_at' => $this->now(), 'voided_by' => $ctx->user_id ), array( 'id' => $id ) );
				$this->audit->log( $ctx, 'void', 'cash_move', $id, 'Cash entry voided' . ( '' !== $reason ? ': ' . $reason : '' ) );
			}
		);
		return $this->get( $ctx, $id );
	}

	private function balance( BusinessContext $ctx, int $account_id ): string {
		foreach ( $this->accounts->list( $ctx, array( 'payment' => true, 'with_balance' => true ) ) as $a ) {
			if ( (int) $a['id'] === $account_id ) {
				return (string) $a['balance'];
			}
		}
		return '0';
	}

	public static function label( string $kind ): string {
		return array(
			'transfer'  => 'Transfer',
			'owner_in'  => 'Owner put money in',
			'owner_out' => 'Owner took money',
			'cash_in'   => 'Other money in',
			'cash_out'  => 'Other money out',
			'count'     => 'Cash count adjustment',
		)[ $kind ] ?? $kind;
	}

	/**
	 * @param array<string,mixed> $r Row.
	 * @return array<string,mixed>
	 */
	private function present( array $r ): array {
		return array(
			'id'              => (int) $r['id'],
			'number'          => (string) $r['number'],
			'kind'            => (string) $r['kind'],
			'kind_label'      => self::label( (string) $r['kind'] ),
			'date'            => (string) $r['move_date'],
			'from_account_id' => (int) $r['from_account_id'],
			'to_account_id'   => (int) $r['to_account_id'],
			'from_name'       => (string) ( $r['from_name'] ?? '' ),
			'to_name'         => (string) ( $r['to_name'] ?? '' ),
			'amount'          => Decimal::toString( Decimal::of( $r['amount'] ) ),
			'note'            => (string) $r['note'],
			'status'          => (string) $r['status'],
			'created_at'      => (string) $r['created_at'],
		);
	}
}
