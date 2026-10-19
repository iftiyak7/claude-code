<?php
/**
 * General ledger posting.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Accounting;

use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * The only writer of journal_entries / journal_lines.
 *
 * Lines are given as:
 *   ['account' => 'receivable'|int id, 'debit' => int, 'credit' => int,
 *    'contact_id' => int, 'memo' => string]
 * Amounts are Decimal-scaled integers. Zero lines are dropped, lines on the
 * same account/contact/side are merged, and the entry must balance.
 *
 * Contact balances (receivable/payable sub-ledgers) are cached on the
 * contacts table and updated here, in the same transaction, so the cache
 * can never drift from the ledger.
 */
final class JournalService extends Service {

	private AccountService $accounts;
	private SettingsService $settings;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AccountService $accounts, SettingsService $settings, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->accounts = $accounts;
		$this->settings = $settings;
		$this->audit    = $audit;
	}

	/**
	 * Post a balanced entry. Returns the entry id (0 when every line is zero).
	 *
	 * @param array{date:string,source:string,source_id?:int,reference_no?:string,memo?:string,branch_id?:int} $header Entry header.
	 * @param array<int,array<string,mixed>> $lines Lines.
	 * @throws ValidationException When unbalanced or dated in a locked period.
	 */
	public function post( BusinessContext $ctx, array $header, array $lines, bool $is_reversal = false, int $reverses_id = 0 ): int {
		$date = Text::date( $header['date'] ?? '' );
		if ( null === $date ) {
			throw ValidationException::field( 'date', 'A valid transaction date is required.' );
		}
		$this->assertOpenPeriod( $ctx, $date );

		$lines = $this->normalise( $ctx, $lines );
		if ( array() === $lines ) {
			return 0;
		}

		$debits  = Decimal::sum( array_column( $lines, 'debit' ) );
		$credits = Decimal::sum( array_column( $lines, 'credit' ) );
		if ( $debits !== $credits ) {
			throw new \LogicException( sprintf( 'Unbalanced journal entry (%s): debit %s, credit %s.', $header['source'], Decimal::toString( $debits ), Decimal::toString( $credits ) ) );
		}

		$branch = (int) ( $header['branch_id'] ?? $ctx->branch_id );

		return $this->db->transaction(
			function () use ( $ctx, $header, $lines, $date, $debits, $branch, $is_reversal, $reverses_id ) {
				$entry_id = $this->db->insert(
					$this->db->table( 'journal_entries' ),
					array(
						'business_id'  => $ctx->business_id,
						'branch_id'    => $branch,
						'entry_date'   => $date,
						'source'       => Text::key( $header['source'], 30 ),
						'source_id'    => (int) ( $header['source_id'] ?? 0 ),
						'reference_no' => Text::line( $header['reference_no'] ?? '', 60 ),
						'memo'         => Text::line( $header['memo'] ?? '', 255 ),
						'total'        => Decimal::toString( $debits ),
						'is_reversal'  => $is_reversal ? 1 : 0,
						'reverses_id'  => $reverses_id,
						'is_reversed'  => 0,
						'created_by'   => $ctx->user_id,
						'created_at'   => $this->now(),
					)
				);

				$lt = $this->db->table( 'journal_lines' );
				foreach ( $lines as $line ) {
					$this->db->insert(
						$lt,
						array(
							'business_id' => $ctx->business_id,
							'branch_id'   => $branch,
							'entry_id'    => $entry_id,
							'entry_date'  => $date,
							'account_id'  => $line['account_id'],
							'contact_id'  => $line['contact_id'],
							'debit'       => Decimal::toString( $line['debit'] ),
							'credit'      => Decimal::toString( $line['credit'] ),
							'memo'        => $line['memo'],
						)
					);
					$this->touchContact( $ctx, $line );
				}

				$this->events->dispatch( 'goriber_hisab/journal/posted', $ctx, $entry_id, $header, $lines );
				return $entry_id;
			}
		);
	}

	/**
	 * Reverse every live entry produced by a source document.
	 *
	 * @return int Number of entries reversed.
	 */
	public function reverseSource( BusinessContext $ctx, string $source, int $source_id, ?string $date = null, string $memo = '' ): int {
		$et      = $this->db->table( 'journal_entries' );
		$entries = $this->db->rows(
			"SELECT * FROM {$et} WHERE business_id = %d AND source = %s AND source_id = %d AND is_reversal = 0 AND is_reversed = 0 ORDER BY id",
			array( $ctx->business_id, $source, $source_id )
		);
		foreach ( $entries as $entry ) {
			$this->reverseEntry( $ctx, $entry, $date, $memo );
		}
		return count( $entries );
	}

	/**
	 * Reverse one live entry (used by documents that undo themselves, e.g. a stock adjustment).
	 */
	public function reverseOne( BusinessContext $ctx, int $entry_id, string $memo = '' ): void {
		$entry = $this->findScoped( $ctx, 'journal_entries', $entry_id, 'Journal entry' );
		if ( (int) $entry['is_reversal'] || (int) $entry['is_reversed'] ) {
			throw ValidationException::field( 'id', 'This entry was already reversed.' );
		}
		$this->reverseEntry( $ctx, $entry, null, $memo );
	}

	/**
	 * @param array<string,mixed> $entry Entry row.
	 */
	private function reverseEntry( BusinessContext $ctx, array $entry, ?string $date, string $memo ): void {
		$lt    = $this->db->table( 'journal_lines' );
		$rows  = $this->db->rows( "SELECT * FROM {$lt} WHERE entry_id = %d AND business_id = %d", array( (int) $entry['id'], $ctx->business_id ) );
		if ( null === $date ) {
			// Reverse on the original date unless that period is locked.
			$lock = (string) ( $this->settings->all( $ctx )['accounting.lock_date'] ?? '' );
			$date = ( '' !== $lock && (string) $entry['entry_date'] <= $lock ) ? $this->today( $ctx ) : (string) $entry['entry_date'];
		}
		$lines = array();
		foreach ( $rows as $r ) {
			$lines[] = array(
				'account'    => (int) $r['account_id'],
				'contact_id' => (int) $r['contact_id'],
				'debit'      => Decimal::of( $r['credit'] ),
				'credit'     => Decimal::of( $r['debit'] ),
				'memo'       => (string) $r['memo'],
			);
		}
		$this->db->transaction(
			function () use ( $ctx, $entry, $date, $memo, $lines ) {
				$this->post(
					$ctx,
					array(
						'date'         => $date,
						'source'       => (string) $entry['source'],
						'source_id'    => (int) $entry['source_id'],
						'reference_no' => (string) $entry['reference_no'],
						'memo'         => '' !== $memo ? $memo : 'Reversal: ' . $entry['memo'],
						'branch_id'    => (int) $entry['branch_id'],
					),
					$lines,
					true,
					(int) $entry['id']
				);
				$this->db->update( $this->db->table( 'journal_entries' ), array( 'is_reversed' => 1 ), array( 'id' => (int) $entry['id'] ) );
			}
		);
	}

	/**
	 * Manual journal entry (accounting.manage). Lines use account ids.
	 *
	 * @param array<string,mixed>            $data  date, memo, reference_no.
	 * @param array<int,array<string,mixed>> $lines account_id, debit, credit, contact_id, memo (decimal strings).
	 */
	public function manual( BusinessContext $ctx, array $data, array $lines ): int {
		$ctx->authorize( 'accounting.manage' );
		$clean   = array();
		$errors  = array();
		$debits  = 0;
		$credits = 0;
		foreach ( array_values( $lines ) as $i => $line ) {
			$acc_id = (int) ( $line['account_id'] ?? 0 );
			try {
				$acc = $this->accounts->require( $ctx, $acc_id, null, false, "lines.{$i}.account_id" );
			} catch ( ValidationException $e ) {
				$errors += $e->errors();
				continue;
			}
			// Manual entries must not bypass inventory/AR/AP sub-ledgers.
			if ( in_array( $acc['system_key'], array( 'inventory', 'receivable', 'payable' ), true ) ) {
				$errors[ "lines.{$i}.account_id" ] = 'Use the sales, purchase, payment or stock modules for this account.';
				continue;
			}
			try {
				$dr = Decimal::of( $line['debit'] ?? 0 );
				$cr = Decimal::of( $line['credit'] ?? 0 );
			} catch ( \InvalidArgumentException $e ) {
				$errors[ "lines.{$i}.debit" ] = 'Enter a valid amount.';
				continue;
			}
			if ( $dr < 0 || $cr < 0 || ( $dr > 0 && $cr > 0 ) ) {
				$errors[ "lines.{$i}.debit" ] = 'Each line needs either a debit or a credit.';
				continue;
			}
			$debits  += $dr;
			$credits += $cr;
			$clean[]  = array(
				'account'    => $acc_id,
				'debit'      => $dr,
				'credit'     => $cr,
				'contact_id' => 0,
				'memo'       => Text::line( $line['memo'] ?? '', 255 ),
			);
		}
		if ( count( $clean ) < 2 && ! $errors ) {
			$errors['lines'] = 'A journal entry needs at least two lines.';
		}
		if ( ! $errors && $debits !== $credits ) {
			$errors['lines'] = sprintf( 'Debits (%s) and credits (%s) must be equal.', Decimal::toString( $debits, 2 ), Decimal::toString( $credits, 2 ) );
		}
		if ( ! $errors && 0 === $debits ) {
			$errors['lines'] = 'Enter at least one amount.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		return $this->db->transaction(
			function () use ( $ctx, $data, $clean ) {
				$id = $this->post(
					$ctx,
					array(
						'date'         => (string) ( $data['date'] ?? $this->today( $ctx ) ),
						'source'       => 'manual',
						'reference_no' => $data['reference_no'] ?? '',
						'memo'         => $data['memo'] ?? 'Manual journal',
					),
					$clean
				);
				$this->db->update( $this->db->table( 'journal_entries' ), array( 'source_id' => $id ), array( 'id' => $id ) );
				$this->audit->log( $ctx, 'create', 'journal', $id, 'Manual journal entry posted' );
				return $id;
			}
		);
	}

	/**
	 * Void a manual journal entry.
	 */
	public function voidManual( BusinessContext $ctx, int $entry_id ): void {
		$ctx->authorize( 'accounting.manage' );
		$entry = $this->findScoped( $ctx, 'journal_entries', $entry_id, 'Journal entry' );
		if ( 'manual' !== $entry['source'] || (int) $entry['is_reversal'] || (int) $entry['is_reversed'] ) {
			throw ValidationException::field( 'id', 'Only active manual entries can be voided here.' );
		}
		$this->db->transaction(
			function () use ( $ctx, $entry ) {
				$this->reverseEntry( $ctx, $entry, null, 'Void: ' . $entry['memo'] );
				$this->audit->log( $ctx, 'void', 'journal', (int) $entry['id'], 'Manual journal entry voided' );
			}
		);
	}

	/**
	 * Entry with lines and account names.
	 *
	 * @return array<string,mixed>
	 */
	public function entry( BusinessContext $ctx, int $id ): array {
		$ctx->authorize( 'accounting.view' );
		$entry = $this->findScoped( $ctx, 'journal_entries', $id, 'Journal entry' );
		$lt    = $this->db->table( 'journal_lines' );
		$at    = $this->db->table( 'accounts' );
		$entry['lines'] = $this->db->rows(
			"SELECT l.*, a.code AS account_code, a.name AS account_name FROM {$lt} l JOIN {$at} a ON a.id = l.account_id WHERE l.entry_id = %d AND l.business_id = %d ORDER BY l.id",
			array( $id, $ctx->business_id )
		);
		return $entry;
	}

	/**
	 * Paged journal listing.
	 *
	 * @param array<string,mixed> $args from, to, source, page, per_page.
	 * @return array<string,mixed>
	 */
	public function search( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'accounting.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$et     = $this->db->table( 'journal_entries' );
		$where  = array( 'business_id = %d' );
		$params = array( $ctx->business_id );
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = 'entry_date >= %s';
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = 'entry_date <= %s';
			$params[] = $to;
		}
		if ( ! empty( $args['source'] ) ) {
			$where[]  = 'source = %s';
			$params[] = Text::key( $args['source'] );
		}
		$w     = implode( ' AND ', $where );
		$total = (int) $this->db->value( "SELECT COUNT(*) FROM {$et} WHERE {$w}", $params );
		$items = $this->db->rows( "SELECT * FROM {$et} WHERE {$w} ORDER BY entry_date DESC, id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, $offset ) ) );
		return $this->paged( $items, $total, $page, $per_page );
	}

	/**
	 * Resolve accounts, validate amounts, drop zeros, merge duplicates.
	 *
	 * @param array<int,array<string,mixed>> $lines Raw lines.
	 * @return array<int,array{account_id:int,contact_id:int,debit:int,credit:int,memo:string,system_key:?string}>
	 */
	private function normalise( BusinessContext $ctx, array $lines ): array {
		$merged = array();
		foreach ( $lines as $line ) {
			$account    = $line['account'];
			$account_id = is_int( $account ) ? $account : $this->accounts->systemId( $ctx->business_id, (string) $account );
			$debit      = (int) ( $line['debit'] ?? 0 );
			$credit     = (int) ( $line['credit'] ?? 0 );
			if ( $debit < 0 ) {
				$credit -= $debit;
				$debit   = 0;
			}
			if ( $credit < 0 ) {
				$debit -= $credit;
				$credit = 0;
			}
			$net = $debit - $credit;
			if ( 0 === $net ) {
				continue;
			}
			$contact = (int) ( $line['contact_id'] ?? 0 );
			$key     = $account_id . ':' . $contact;
			if ( ! isset( $merged[ $key ] ) ) {
				$merged[ $key ] = array(
					'account_id' => $account_id,
					'contact_id' => $contact,
					'net'        => 0,
					'memo'       => Text::line( $line['memo'] ?? '', 255 ),
				);
			}
			$merged[ $key ]['net'] += $net;
		}

		$out = array();
		$sys = $this->systemKeys( $ctx );
		foreach ( $merged as $m ) {
			if ( 0 === $m['net'] ) {
				continue;
			}
			$out[] = array(
				'account_id' => $m['account_id'],
				'contact_id' => $m['contact_id'],
				'debit'      => $m['net'] > 0 ? $m['net'] : 0,
				'credit'     => $m['net'] < 0 ? -$m['net'] : 0,
				'memo'       => $m['memo'],
				'system_key' => $sys[ $m['account_id'] ] ?? null,
			);
		}
		return $out;
	}

	/**
	 * account id => system key for the business.
	 *
	 * @return array<int,string>
	 */
	private function systemKeys( BusinessContext $ctx ): array {
		$map = array();
		foreach ( array( 'receivable', 'payable' ) as $key ) {
			$map[ $this->accounts->systemId( $ctx->business_id, $key ) ] = $key;
		}
		return $map;
	}

	/**
	 * Keep contacts.balance in sync with the AR/AP sub-ledger.
	 *
	 * Customer balance = receivable debit − credit (positive: they owe us).
	 * Supplier balance = payable credit − debit (positive: we owe them).
	 *
	 * @param array<string,mixed> $line Normalised line.
	 */
	private function touchContact( BusinessContext $ctx, array $line ): void {
		if ( $line['contact_id'] <= 0 || null === $line['system_key'] ) {
			return;
		}
		$delta = 'receivable' === $line['system_key'] ? $line['debit'] - $line['credit'] : $line['credit'] - $line['debit'];
		$ct    = $this->db->table( 'contacts' );
		$this->db->execute(
			"UPDATE {$ct} SET balance = balance + %s, last_activity_at = %s WHERE id = %d AND business_id = %d",
			array( Decimal::toString( $delta ), $this->now(), $line['contact_id'], $ctx->business_id )
		);
	}

	/**
	 * @throws ValidationException When the date falls in a locked period.
	 */
	private function assertOpenPeriod( BusinessContext $ctx, string $date ): void {
		$lock = (string) ( $this->settings->all( $ctx )['accounting.lock_date'] ?? '' );
		if ( '' !== $lock && $date <= $lock ) {
			throw ValidationException::field( 'date', sprintf( 'The books are locked up to %s. Choose a later date.', $lock ) );
		}
	}
}
