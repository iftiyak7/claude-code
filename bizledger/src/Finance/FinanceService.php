<?php
/**
 * Expenses and other income.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Finance;

use BizLedger\Accounting\AccountService;
use BizLedger\Accounting\JournalService;
use BizLedger\Audit\AuditLogger;
use BizLedger\Database\Database;
use BizLedger\Numbering\NumberingService;
use BizLedger\Support\Clock;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * One service, two kinds:
 *   expense: Dr expense category account / Cr payment account
 *   income:  Dr payment account          / Cr income category account
 * Categories are ledger accounts of type expense/income.
 */
final class FinanceService extends Service {

	private const KINDS = array(
		'expense' => array(
			'table' => 'expenses',
			'date'  => 'expense_date',
			'perm'  => 'expenses',
			'type'  => 'expense',
		),
		'income'  => array(
			'table' => 'incomes',
			'date'  => 'income_date',
			'perm'  => 'income',
			'type'  => 'income',
		),
	);

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
	 * @param array<string,mixed> $data account_id (category), payment_account_id, amount, date, reference, description, contact_id, attachment_id, uuid.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, string $kind, array $data ): array {
		$k = self::KINDS[ $kind ];
		$ctx->authorize( $k['perm'] . '.create' );
		$t    = $this->db->table( $k['table'] );
		$uuid = Text::uuid( $data['uuid'] ?? null );
		if ( $uuid ) {
			$existing = $this->db->value( "SELECT id FROM {$t} WHERE uuid = %s AND business_id = %d", array( $uuid, $ctx->business_id ) );
			if ( $existing ) {
				return $this->get( $ctx, $kind, (int) $existing );
			}
		}
		$clean = $this->validate( $ctx, $kind, $data );
		$id    = $this->db->transaction(
			function () use ( $ctx, $kind, $k, $clean, $uuid, $t ) {
				$number = $this->numbers->next( $ctx, $kind, $clean['date'] );
				$id     = $this->db->insert(
					$t,
					array(
						'uuid'               => $uuid,
						'business_id'        => $ctx->business_id,
						'branch_id'          => $ctx->branch_id,
						'number'             => $number,
						$k['date']           => $clean['date'],
						'account_id'         => $clean['account_id'],
						'payment_account_id' => $clean['payment_account_id'],
						'contact_id'         => $clean['contact_id'],
						'amount'             => Decimal::toString( $clean['amount'] ),
						'reference'          => $clean['reference'],
						'description'        => $clean['description'],
						'attachment_id'      => $clean['attachment_id'],
						'status'             => 'completed',
						'created_by'         => $ctx->user_id,
						'updated_by'         => $ctx->user_id,
						'created_at'         => $this->now(),
						'updated_at'         => $this->now(),
					)
				);
				$this->post( $ctx, $kind, $id, $number, $clean );
				$this->audit->log( $ctx, 'create', $kind, $id, sprintf( '%s %s recorded: %s', ucfirst( $kind ), $number, Decimal::toString( $clean['amount'], $ctx->decimals() ) ) );
				return $id;
			}
		);
		$this->events->dispatch( "bizledger/{$kind}/created", $ctx, $id );
		return $this->get( $ctx, $kind, $id );
	}

	/**
	 * @param array<string,mixed> $data Fields.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, string $kind, int $id, array $data ): array {
		$k = self::KINDS[ $kind ];
		$ctx->authorize( $k['perm'] . '.edit' );
		$row = $this->findScoped( $ctx, $k['table'], $id, ucfirst( $kind ) );
		if ( 'completed' !== $row['status'] ) {
			throw ValidationException::field( 'id', 'A voided record cannot be edited.' );
		}
		$merged = array_merge(
			array(
				'account_id'         => $row['account_id'],
				'payment_account_id' => $row['payment_account_id'],
				'amount'             => $row['amount'],
				'date'               => $row[ $k['date'] ],
				'reference'          => $row['reference'],
				'description'        => $row['description'],
				'contact_id'         => $row['contact_id'],
				'attachment_id'      => $row['attachment_id'],
			),
			$data
		);
		$clean = $this->validate( $ctx, $kind, $merged );
		$this->db->transaction(
			function () use ( $ctx, $kind, $k, $id, $row, $clean ) {
				$this->journal->reverseSource( $ctx, $kind, $id, null, 'Edit ' . $row['number'] );
				$update = array(
					$k['date']           => $clean['date'],
					'account_id'         => $clean['account_id'],
					'payment_account_id' => $clean['payment_account_id'],
					'contact_id'         => $clean['contact_id'],
					'amount'             => Decimal::toString( $clean['amount'] ),
					'reference'          => $clean['reference'],
					'description'        => $clean['description'],
					'attachment_id'      => $clean['attachment_id'],
					'updated_by'         => $ctx->user_id,
					'updated_at'         => $this->now(),
				);
				$this->db->update( $this->db->table( $k['table'] ), $update, array( 'id' => $id ) );
				$this->post( $ctx, $kind, $id, (string) $row['number'], $clean );
				$this->audit->log( $ctx, 'update', $kind, $id, ucfirst( $kind ) . ' edited ' . $row['number'], AuditLogger::diff( $row, $update ) );
			}
		);
		return $this->get( $ctx, $kind, $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function void( BusinessContext $ctx, string $kind, int $id, string $reason = '' ): array {
		$k = self::KINDS[ $kind ];
		$ctx->authorize( $k['perm'] . '.delete' );
		$row = $this->findScoped( $ctx, $k['table'], $id, ucfirst( $kind ) );
		if ( 'void' !== $row['status'] ) {
			$this->db->transaction(
				function () use ( $ctx, $kind, $k, $id, $row, $reason ) {
					$this->journal->reverseSource( $ctx, $kind, $id, null, 'Void ' . $row['number'] );
					$this->db->update(
						$this->db->table( $k['table'] ),
						array(
							'status'     => 'void',
							'voided_at'  => $this->now(),
							'voided_by'  => $ctx->user_id,
							'updated_at' => $this->now(),
						),
						array( 'id' => $id )
					);
					$this->audit->log( $ctx, 'void', $kind, $id, ucfirst( $kind ) . ' voided ' . $row['number'] . ( $reason ? ': ' . Text::line( $reason ) : '' ) );
				}
			);
		}
		return $this->get( $ctx, $kind, $id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, string $kind, int $id ): array {
		$k = self::KINDS[ $kind ];
		$ctx->authorize( $k['perm'] . '.view' );
		$row  = $this->findScoped( $ctx, $k['table'], $id, ucfirst( $kind ) );
		$at   = $this->db->table( 'accounts' );
		$row['id']              = (int) $row['id'];
		$row['date']            = $row[ $k['date'] ];
		$row['category']        = $this->db->row( "SELECT id, code, name FROM {$at} WHERE id = %d", array( (int) $row['account_id'] ) );
		$row['payment_account'] = $this->db->row( "SELECT id, name, subtype FROM {$at} WHERE id = %d", array( (int) $row['payment_account_id'] ) );
		$row['attachment_url']  = (int) $row['attachment_id'] && function_exists( 'wp_get_attachment_url' ) ? (string) wp_get_attachment_url( (int) $row['attachment_id'] ) : '';
		return $row;
	}

	/**
	 * @param array<string,mixed> $args from, to, account_id, payment_account_id, search, include_void, page, per_page.
	 * @return array<string,mixed>
	 */
	public function list( BusinessContext $ctx, string $kind, array $args ): array {
		$k = self::KINDS[ $kind ];
		$ctx->authorize( $k['perm'] . '.view' );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$t      = $this->db->table( $k['table'] );
		$at     = $this->db->table( 'accounts' );
		$d      = $k['date'];
		$where  = array( 'x.business_id = %d' );
		$params = array( $ctx->business_id );
		if ( empty( $args['include_void'] ) ) {
			$where[] = "x.status = 'completed'";
		}
		foreach ( array( 'account_id', 'payment_account_id', 'branch_id', 'created_by' ) as $f ) {
			if ( ! empty( $args[ $f ] ) ) {
				$where[]  = "x.{$f} = %d";
				$params[] = (int) $args[ $f ];
			}
		}
		if ( $from = Text::date( $args['from'] ?? null ) ) {
			$where[]  = "x.{$d} >= %s";
			$params[] = $from;
		}
		if ( $to = Text::date( $args['to'] ?? null ) ) {
			$where[]  = "x.{$d} <= %s";
			$params[] = $to;
		}
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(x.number LIKE %s OR x.description LIKE %s OR x.reference LIKE %s)';
			array_push( $params, $like, $like, $like );
		}
		$w    = implode( ' AND ', $where );
		$agg  = $this->db->row( "SELECT COUNT(*) AS n, COALESCE(SUM(x.amount),0) AS total FROM {$t} x WHERE {$w}", $params );
		$rows = $this->db->rows(
			"SELECT x.*, x.{$d} AS date, c.name AS category_name, p.name AS payment_account_name FROM {$t} x
			LEFT JOIN {$at} c ON c.id = x.account_id LEFT JOIN {$at} p ON p.id = x.payment_account_id
			WHERE {$w} ORDER BY x.{$d} DESC, x.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		$out        = $this->paged( $rows, (int) $agg['n'], $page, $per_page );
		$out['sum'] = Decimal::toString( Decimal::of( $agg['total'] ) );
		return $out;
	}

	/**
	 * @param array<string,mixed> $clean Validated data.
	 */
	private function post( BusinessContext $ctx, string $kind, int $id, string $number, array $clean ): void {
		$lines = 'expense' === $kind
			? array(
				array( 'account' => $clean['account_id'], 'debit' => $clean['amount'] ),
				array( 'account' => $clean['payment_account_id'], 'credit' => $clean['amount'] ),
			)
			: array(
				array( 'account' => $clean['payment_account_id'], 'debit' => $clean['amount'] ),
				array( 'account' => $clean['account_id'], 'credit' => $clean['amount'] ),
			);
		$this->journal->post(
			$ctx,
			array(
				'date'         => $clean['date'],
				'source'       => $kind,
				'source_id'    => $id,
				'reference_no' => $number,
				'memo'         => ucfirst( $kind ) . ' ' . $number . ( '' !== $clean['description'] ? ': ' . mb_substr( $clean['description'], 0, 120 ) : '' ),
			),
			$lines
		);
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function validate( BusinessContext $ctx, string $kind, array $data ): array {
		$errors = array();
		$type   = self::KINDS[ $kind ]['type'];
		try {
			$category = $this->accounts->require( $ctx, (int) ( $data['account_id'] ?? 0 ), $type, false, 'account_id' );
		} catch ( ValidationException $e ) {
			$errors['account_id'] = 'Select a category.';
		}
		if ( isset( $category ) && in_array( $category['system_key'], array( 'cogs', 'inventory_adjustment', 'sales', 'sales_returns', 'shipping_income' ), true ) ) {
			$errors['account_id'] = 'This account is managed automatically. Choose another category.';
		}
		try {
			$pay = $this->accounts->require( $ctx, (int) ( $data['payment_account_id'] ?? 0 ) ?: $this->accounts->systemId( $ctx->business_id, 'cash' ), 'asset', true, 'payment_account_id' );
		} catch ( ValidationException $e ) {
			$errors += $e->errors();
		}
		try {
			$amount = Decimal::round( Decimal::of( $data['amount'] ?? 0 ), $ctx->decimals() );
		} catch ( \InvalidArgumentException $e ) {
			$amount = 0;
		}
		if ( $amount <= 0 ) {
			$errors['amount'] = 'Enter an amount greater than zero.';
		}
		$date = Text::date( $data['date'] ?? null ) ?? $this->today( $ctx );
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		return array(
			'account_id'         => (int) $category['id'],
			'payment_account_id' => (int) $pay['id'],
			'amount'             => $amount,
			'date'               => $date,
			'reference'          => Text::line( $data['reference'] ?? '', 100 ),
			'description'        => Text::multiline( $data['description'] ?? '', 2000 ),
			'contact_id'         => max( 0, (int) ( $data['contact_id'] ?? 0 ) ),
			'attachment_id'      => max( 0, (int) ( $data['attachment_id'] ?? 0 ) ),
		);
	}
}
