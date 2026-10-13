<?php
/**
 * Chart of accounts.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Accounting;

use BizLedger\Audit\AuditLogger;
use BizLedger\Database\Database;
use BizLedger\Support\Clock;
use BizLedger\Support\ConflictException;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Json;
use BizLedger\Support\NotFoundException;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Manages ledger accounts. Expense and income categories are accounts too.
 */
final class AccountService extends Service {

	public const TYPES = array( 'asset', 'liability', 'equity', 'income', 'expense' );

	private AuditLogger $audit;

	/**
	 * business id => system_key => account id.
	 *
	 * @var array<int,array<string,int>>
	 */
	private array $system_cache = array();

	public function __construct( Database $db, Clock $clock, Events $events, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->audit = $audit;
	}

	/**
	 * Default chart of accounts.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function defaultChart(): array {
		$a = static fn( string $code, string $name, string $type, string $subtype, ?string $key = null, bool $payment = false, bool $contra = false ) => array(
			'code'       => $code,
			'name'       => $name,
			'type'       => $type,
			'subtype'    => $subtype,
			'system_key' => $key,
			'is_payment' => $payment,
			'is_contra'  => $contra,
		);
		$chart = array(
			$a( '1000', 'Cash in Hand', 'asset', 'cash', 'cash', true ),
			$a( '1010', 'Bank Account', 'asset', 'bank', 'bank', true ),
			$a( '1020', 'Mobile Banking', 'asset', 'mobile', 'mobile', true ),
			$a( '1100', 'Accounts Receivable', 'asset', 'receivable', 'receivable' ),
			$a( '1200', 'Inventory', 'asset', 'inventory', 'inventory' ),
			$a( '1300', 'Input Tax', 'asset', 'tax', 'tax_input' ),
			$a( '2000', 'Accounts Payable', 'liability', 'payable', 'payable' ),
			$a( '2100', 'Output Tax', 'liability', 'tax', 'tax_output' ),
			$a( '3000', "Owner's Capital", 'equity', 'capital', 'capital' ),
			$a( '3100', "Owner's Drawings", 'equity', 'drawings', 'drawings', false, true ),
			$a( '3200', 'Opening Balance Equity', 'equity', 'opening', 'opening_balance' ),
			$a( '3300', 'Retained Earnings', 'equity', 'retained', 'retained_earnings' ),
			$a( '4000', 'Sales', 'income', 'sales', 'sales' ),
			$a( '4010', 'Sales Returns', 'income', 'sales', 'sales_returns', false, true ),
			$a( '4100', 'Shipping Income', 'income', 'other', 'shipping_income' ),
			$a( '4900', 'Other Income', 'income', 'other', 'other_income' ),
			$a( '4910', 'Service Income', 'income', 'other' ),
			$a( '4920', 'Commission Income', 'income', 'other' ),
			$a( '5000', 'Cost of Goods Sold', 'expense', 'cogs', 'cogs' ),
			$a( '5100', 'Inventory Adjustments', 'expense', 'cogs', 'inventory_adjustment' ),
			$a( '6000', 'Rent', 'expense', 'operating' ),
			$a( '6010', 'Salary', 'expense', 'operating' ),
			$a( '6020', 'Electricity', 'expense', 'operating' ),
			$a( '6030', 'Internet', 'expense', 'operating' ),
			$a( '6040', 'Transport', 'expense', 'operating' ),
			$a( '6050', 'Marketing', 'expense', 'operating' ),
			$a( '6060', 'Packaging', 'expense', 'operating' ),
			$a( '6070', 'Delivery', 'expense', 'operating' ),
			$a( '6080', 'Maintenance', 'expense', 'operating' ),
			$a( '6900', 'Other Expense', 'expense', 'operating', 'other_expense' ),
		);
		return (array) $this->events->filter( 'bizledger/default_accounts', $chart );
	}

	/**
	 * Seed the default chart for a new business (idempotent).
	 */
	public function seed( int $business_id, int $user_id ): void {
		$t   = $this->db->table( 'accounts' );
		$now = $this->now();
		foreach ( $this->defaultChart() as $acc ) {
			if ( null !== $acc['system_key'] ) {
				$exists = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND system_key = %s", array( $business_id, $acc['system_key'] ) );
				if ( $exists ) {
					continue;
				}
			}
			$this->db->insert(
				$t,
				array(
					'business_id' => $business_id,
					'code'        => $acc['code'],
					'name'        => $acc['name'],
					'type'        => $acc['type'],
					'subtype'     => $acc['subtype'],
					'system_key'  => $acc['system_key'],
					'is_payment'  => $acc['is_payment'] ? 1 : 0,
					'is_system'   => null !== $acc['system_key'] ? 1 : 0,
					'is_contra'   => $acc['is_contra'] ? 1 : 0,
					'status'      => 'active',
					'created_by'  => $user_id,
					'updated_by'  => $user_id,
					'created_at'  => $now,
					'updated_at'  => $now,
				)
			);
		}
		unset( $this->system_cache[ $business_id ] );
	}

	/**
	 * Account id for a system key ("cash", "receivable", …).
	 *
	 * @throws NotFoundException When the chart is incomplete.
	 */
	public function systemId( int $business_id, string $key ): int {
		if ( ! isset( $this->system_cache[ $business_id ] ) ) {
			$t    = $this->db->table( 'accounts' );
			$rows = $this->db->rows( "SELECT id, system_key FROM {$t} WHERE business_id = %d AND system_key IS NOT NULL", array( $business_id ) );
			$map  = array();
			foreach ( $rows as $r ) {
				$map[ (string) $r['system_key'] ] = (int) $r['id'];
			}
			$this->system_cache[ $business_id ] = $map;
		}
		if ( ! isset( $this->system_cache[ $business_id ][ $key ] ) ) {
			throw new NotFoundException( sprintf( 'System account "%s" is missing.', $key ) );
		}
		return $this->system_cache[ $business_id ][ $key ];
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( BusinessContext $ctx, int $id ): array {
		return $this->hydrate( $this->findScoped( $ctx, 'accounts', $id, 'Account' ) );
	}

	/**
	 * Validate that an account exists in the business, is active and of the
	 * expected kind. Returns the row.
	 *
	 * @param string|null $type    Required type.
	 * @return array<string,mixed>
	 * @throws ValidationException When unsuitable.
	 */
	public function require( BusinessContext $ctx, int $id, ?string $type = null, bool $payment = false, string $field = 'account_id' ): array {
		$t   = $this->db->table( 'accounts' );
		$row = $id > 0 ? $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d AND deleted_at IS NULL AND status = 'active'", array( $id, $ctx->business_id ) ) : null;
		if ( null === $row ) {
			throw ValidationException::field( $field, 'Select a valid account.' );
		}
		if ( null !== $type && $row['type'] !== $type ) {
			throw ValidationException::field( $field, sprintf( 'The account must be a %s account.', $type ) );
		}
		if ( $payment && ! (int) $row['is_payment'] ) {
			throw ValidationException::field( $field, 'Select a cash, bank or mobile banking account.' );
		}
		return $row;
	}

	/**
	 * Default payment account (setting, else cash).
	 */
	public function defaultPaymentAccount( BusinessContext $ctx, int $configured = 0 ): int {
		if ( $configured > 0 ) {
			try {
				return (int) $this->require( $ctx, $configured, null, true )['id'];
			} catch ( ValidationException $e ) {
				// Fall back to cash.
				unset( $e );
			}
		}
		return $this->systemId( $ctx->business_id, 'cash' );
	}

	/**
	 * List accounts with optional balances.
	 *
	 * @param array<string,mixed> $args type, payment (bool), with_balance (bool), as_of (date), search.
	 * @return array<int,array<string,mixed>>
	 */
	public function list( BusinessContext $ctx, array $args = array() ): array {
		$t      = $this->db->table( 'accounts' );
		$where  = array( 'a.business_id = %d', 'a.deleted_at IS NULL' );
		$params = array( $ctx->business_id );
		if ( ! empty( $args['type'] ) && in_array( $args['type'], self::TYPES, true ) ) {
			$where[]  = 'a.type = %s';
			$params[] = $args['type'];
		}
		if ( ! empty( $args['subtype'] ) ) {
			$where[]  = 'a.subtype = %s';
			$params[] = Text::key( $args['subtype'] );
		}
		if ( ! empty( $args['payment'] ) ) {
			$where[] = 'a.is_payment = 1';
		}
		if ( empty( $args['include_inactive'] ) ) {
			$where[] = "a.status = 'active'";
		}
		if ( ! empty( $args['search'] ) ) {
			$like     = '%' . $this->db->escapeLike( Text::line( $args['search'] ) ) . '%';
			$where[]  = '(a.name LIKE %s OR a.code LIKE %s)';
			$params[] = $like;
			$params[] = $like;
		}

		$select = 'a.*';
		$join   = '';
		if ( ! empty( $args['with_balance'] ) ) {
			$l       = $this->db->table( 'journal_lines' );
			$as_of   = Text::date( $args['as_of'] ?? null );
			$cond    = 'l.account_id = a.id AND l.business_id = a.business_id' . ( $as_of ? ' AND l.entry_date <= %s' : '' );
			$select .= ', COALESCE(SUM(l.debit),0) AS total_debit, COALESCE(SUM(l.credit),0) AS total_credit';
			$join    = " LEFT JOIN {$l} l ON {$cond}";
			if ( $as_of ) {
				array_unshift( $params, $as_of );
			}
		}
		$sql  = "SELECT {$select} FROM {$t} a{$join} WHERE " . implode( ' AND ', $where ) . ( $join ? ' GROUP BY a.id' : '' ) . ' ORDER BY a.code, a.name';
		$rows = $this->db->rows( $sql, $params );
		return array_map( array( $this, 'hydrate' ), $rows );
	}

	/**
	 * Create an account.
	 *
	 * @param array<string,mixed> $data code, name, type, subtype, is_payment, details.
	 * @return array<string,mixed>
	 */
	public function create( BusinessContext $ctx, array $data ): array {
		$this->authorizeFor( $ctx, $data['type'] ?? '' );
		$clean = $this->validate( $ctx, $data );
		$now   = $this->now();
		$id    = $this->db->insert(
			$this->db->table( 'accounts' ),
			array_merge(
				$clean,
				array(
					'business_id' => $ctx->business_id,
					'is_system'   => 0,
					'status'      => 'active',
					'created_by'  => $ctx->user_id,
					'updated_by'  => $ctx->user_id,
					'created_at'  => $now,
					'updated_at'  => $now,
				)
			)
		);
		$this->audit->log( $ctx, 'create', 'account', $id, 'Account created: ' . $clean['name'] );
		return $this->get( $ctx, $id );
	}

	/**
	 * @param array<string,mixed> $data Fields.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, int $id, array $data ): array {
		$before = $this->findScoped( $ctx, 'accounts', $id, 'Account' );
		$this->authorizeFor( $ctx, (string) $before['type'] );
		$data['type'] = $before['type']; // Type is immutable once created.
		$clean        = $this->validate( $ctx, array_merge( $before, $data ), $id );
		if ( (int) $before['is_system'] ) {
			// System accounts: only cosmetic changes.
			$clean = array_intersect_key( $clean, array_flip( array( 'name', 'code', 'details' ) ) );
		}
		if ( isset( $data['status'] ) && in_array( $data['status'], array( 'active', 'inactive' ), true ) && ! (int) $before['is_system'] ) {
			$clean['status'] = $data['status'];
		}
		$clean['updated_by'] = $ctx->user_id;
		$clean['updated_at'] = $this->now();
		$this->db->update( $this->db->table( 'accounts' ), $clean, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		$this->audit->log( $ctx, 'update', 'account', $id, 'Account updated: ' . ( $clean['name'] ?? $before['name'] ), AuditLogger::diff( $before, $clean ) );
		return $this->get( $ctx, $id );
	}

	public function delete( BusinessContext $ctx, int $id ): void {
		$row = $this->findScoped( $ctx, 'accounts', $id, 'Account' );
		$this->authorizeFor( $ctx, (string) $row['type'] );
		if ( (int) $row['is_system'] ) {
			throw new ConflictException( 'System accounts cannot be deleted.' );
		}
		$l    = $this->db->table( 'journal_lines' );
		$used = (int) $this->db->value( "SELECT COUNT(*) FROM {$l} WHERE business_id = %d AND account_id = %d", array( $ctx->business_id, $id ) );
		if ( $used > 0 ) {
			throw new ConflictException( 'This account has transactions. Deactivate it instead.' );
		}
		$this->db->update( $this->db->table( 'accounts' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		$this->audit->log( $ctx, 'delete', 'account', $id, 'Account deleted: ' . $row['name'] );
	}

	/**
	 * Normal-balance sign: +1 when debits increase the account.
	 *
	 * @param array<string,mixed> $account Row.
	 */
	public static function normalSign( array $account ): int {
		$debit_normal = in_array( $account['type'], array( 'asset', 'expense' ), true );
		if ( (int) ( $account['is_contra'] ?? 0 ) ) {
			$debit_normal = ! $debit_normal;
		}
		return $debit_normal ? 1 : -1;
	}

	/**
	 * Expense/income accounts may be managed by those modules' editors;
	 * everything else needs accounting.manage.
	 */
	private function authorizeFor( BusinessContext $ctx, string $type ): void {
		if ( 'expense' === $type && $ctx->can( 'expenses.create' ) ) {
			return;
		}
		if ( 'income' === $type && $ctx->can( 'income.create' ) ) {
			return;
		}
		$ctx->authorize( 'accounting.manage' );
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function validate( BusinessContext $ctx, array $data, int $id = 0 ): array {
		$errors = array();
		$name   = Text::line( $data['name'] ?? '' );
		$type   = (string) ( $data['type'] ?? '' );
		$code   = Text::line( $data['code'] ?? '', 20 );
		if ( '' === $name ) {
			$errors['name'] = 'Account name is required.';
		}
		if ( ! in_array( $type, self::TYPES, true ) ) {
			$errors['type'] = 'Choose an account type.';
		}
		$payment = Text::bool( $data['is_payment'] ?? false ) && 'asset' === $type;
		$subtype = Text::key( $data['subtype'] ?? '', 30 );
		if ( $payment && ! in_array( $subtype, array( 'cash', 'bank', 'mobile' ), true ) ) {
			$subtype = 'bank';
		}
		if ( '' === $code ) {
			$code = $this->suggestCode( $ctx, $type );
		} else {
			$t   = $this->db->table( 'accounts' );
			$dup = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND code = %s AND deleted_at IS NULL AND id <> %d", array( $ctx->business_id, $code, $id ) );
			if ( $dup ) {
				$errors['code'] = 'Another account already uses this code.';
			}
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$details = is_array( $data['details'] ?? null ) ? array_map( static fn( $v ) => Text::line( $v ), $data['details'] ) : Json::decode( $data['details'] ?? null );
		return array(
			'code'       => $code,
			'name'       => $name,
			'type'       => $type,
			'subtype'    => '' !== $subtype ? $subtype : ( 'expense' === $type ? 'operating' : 'other' ),
			'is_payment' => $payment ? 1 : 0,
			'parent_id'  => max( 0, (int) ( $data['parent_id'] ?? 0 ) ),
			'details'    => $details ? Json::encode( $details ) : null,
		);
	}

	private function suggestCode( BusinessContext $ctx, string $type ): string {
		$base = array(
			'asset'     => 1000,
			'liability' => 2000,
			'equity'    => 3000,
			'income'    => 4000,
			'expense'   => 6000,
		)[ $type ] ?? 9000;
		$t    = $this->db->table( 'accounts' );
		$cast = 'sqlite' === $this->db->driver() ? 'INTEGER' : 'UNSIGNED';
		$max  = (int) $this->db->value( "SELECT MAX(CAST(code AS {$cast})) FROM {$t} WHERE business_id = %d AND type = %s", array( $ctx->business_id, $type ) );
		return (string) max( $base, $max + 10 );
	}

	/**
	 * @param array<string,mixed> $row DB row.
	 * @return array<string,mixed>
	 */
	private function hydrate( array $row ): array {
		$row['id']         = (int) $row['id'];
		$row['parent_id']  = (int) $row['parent_id'];
		$row['is_payment'] = (bool) (int) $row['is_payment'];
		$row['is_system']  = (bool) (int) $row['is_system'];
		$row['is_contra']  = (bool) (int) $row['is_contra'];
		$row['details']    = Json::decode( $row['details'] ?? null );
		if ( array_key_exists( 'total_debit', $row ) ) {
			$dr             = Decimal::of( $row['total_debit'] );
			$cr             = Decimal::of( $row['total_credit'] );
			$row['balance'] = Decimal::toString( ( $dr - $cr ) * self::normalSign( $row ) );
			$row['total_debit']  = Decimal::toString( $dr );
			$row['total_credit'] = Decimal::toString( $cr );
		}
		unset( $row['deleted_at'], $row['deleted_by'] );
		return $row;
	}
}
