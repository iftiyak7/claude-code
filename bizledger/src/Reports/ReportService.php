<?php
/**
 * Read-only reporting.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Reports;

use BizLedger\Accounting\AccountService;
use BizLedger\Database\Database;
use BizLedger\Support\Clock;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * All reports are computed from posted data: financial statements from the
 * journal, operational reports from documents. Nothing here writes.
 *
 * Common arguments: from, to (Y-m-d), branch_id (int, or "all").
 */
final class ReportService extends Service {

	private AccountService $accounts;

	public function __construct( Database $db, Clock $clock, Events $events, AccountService $accounts ) {
		parent::__construct( $db, $clock, $events );
		$this->accounts = $accounts;
	}

	/* ------------------------------------------------------------------ Dashboard */

	/**
	 * @param array<string,mixed> $args range (today|yesterday|7d|this_month|last_month|this_year|custom), from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function dashboard( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'dashboard.view' );
		list( $from, $to ) = $this->range( $ctx, $args );
		$today             = $this->today( $ctx );
		$branch            = $this->branchFilter( $ctx, $args );
		$profit_ok         = $ctx->can( 'reports.profit' );

		$today_block = $this->periodMetrics( $ctx, $today, $today, $branch, $profit_ok );
		$range_block = $this->periodMetrics( $ctx, $from, $to, $branch, $profit_ok );

		$ct       = $this->db->table( 'contacts' );
		$st       = $this->db->table( 'stock_levels' );
		$cust_due = $this->db->value( "SELECT COALESCE(SUM(balance),0) FROM {$ct} WHERE business_id = %d AND type = 'customer' AND balance > 0 AND deleted_at IS NULL", array( $ctx->business_id ) );
		$supp_due = $this->db->value( "SELECT COALESCE(SUM(balance),0) FROM {$ct} WHERE business_id = %d AND type = 'supplier' AND balance > 0 AND deleted_at IS NULL", array( $ctx->business_id ) );
		list( $bsql, $bparams ) = $this->branchSql( $branch, 'branch_id' );
		$stock    = $this->db->value( "SELECT COALESCE(SUM(value),0) FROM {$st} WHERE business_id = %d{$bsql}", array_merge( array( $ctx->business_id ), $bparams ) );

		$balances = array(
			'cash'   => 0,
			'bank'   => 0,
			'mobile' => 0,
		);
		foreach ( $this->accounts->list( $ctx, array( 'payment' => true, 'with_balance' => true ) ) as $acc ) {
			$key              = isset( $balances[ $acc['subtype'] ] ) ? $acc['subtype'] : 'bank';
			$balances[ $key ] += Decimal::of( $acc['balance'] );
		}

		$overview = array_merge(
			$range_block,
			array(
				'customer_due' => Decimal::toString( Decimal::of( $cust_due ) ),
				'supplier_due' => Decimal::toString( Decimal::of( $supp_due ) ),
				'stock_value'  => $ctx->can( 'products.cost' ) ? Decimal::toString( Decimal::of( $stock ) ) : null,
				'cash_balance' => $ctx->can( 'accounting.view' ) ? Decimal::toString( $balances['cash'] ) : null,
				'bank_balance' => $ctx->can( 'accounting.view' ) ? Decimal::toString( $balances['bank'] + $balances['mobile'] ) : null,
			)
		);

		$pt  = $this->db->table( 'products' );
		$low = (int) $this->db->value(
			"SELECT COUNT(*) FROM {$pt} p
			WHERE p.business_id = %d AND p.deleted_at IS NULL AND p.track_stock = 1 AND p.status = 'active' AND p.min_stock > 0
			AND COALESCE((SELECT SUM(s.qty) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id AND s.branch_id = %d),0) <= p.min_stock",
			array( $ctx->business_id, $ctx->branch_id )
		);


		return array(
			'from'          => $from,
			'to'            => $to,
			'today'         => $today_block,
			'overview'      => $overview,
			'charts'        => $this->series( $ctx, $from, $to, $branch, $profit_ok ),
			'low_stock'     => $low,
			'top_products'  => $this->topProducts( $ctx, $from, $to, $branch, 5 ),
			'recent_sales'  => $this->recentSales( $ctx, $branch ),
		);
	}

	/**
	 * Key metrics for a period.
	 *
	 * @param array<int,int>|null $branch Branch ids or null for all.
	 * @return array<string,string|null>
	 */
	private function periodMetrics( BusinessContext $ctx, string $from, string $to, ?array $branch, bool $profit_ok ): array {
		$s  = $this->db->table( 'sales' );
		$p  = $this->db->table( 'purchases' );
		$e  = $this->db->table( 'expenses' );
		$i  = $this->db->table( 'incomes' );
		$pm = $this->db->table( 'payments' );
		$r  = $this->db->table( 'returns' );

		list( $bs, $bp ) = $this->branchSql( $branch, 'branch_id' );
		$base            = array( $ctx->business_id, $from, $to );

		$sales     = $this->db->row( "SELECT COALESCE(SUM(total),0) AS total, COALESCE(SUM(due_amount),0) AS due, COUNT(*) AS n FROM {$s} WHERE business_id = %d AND status = 'completed' AND sale_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );
		$purchases = $this->db->value( "SELECT COALESCE(SUM(total),0) FROM {$p} WHERE business_id = %d AND status = 'completed' AND purchase_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );
		$expenses  = $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$e} WHERE business_id = %d AND status = 'completed' AND expense_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );
		$income    = $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$i} WHERE business_id = %d AND status = 'completed' AND income_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );
		$collected = $this->db->value( "SELECT COALESCE(SUM(amount),0) FROM {$pm} WHERE business_id = %d AND status = 'completed' AND direction = 'in' AND source IN ('sale','collection') AND payment_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );
		$returns   = $this->db->value( "SELECT COALESCE(SUM(total),0) FROM {$r} WHERE business_id = %d AND status = 'completed' AND return_type = 'sale' AND return_date BETWEEN %s AND %s{$bs}", array_merge( $base, $bp ) );

		$pl = $profit_ok ? $this->profitTotals( $ctx, $from, $to, $branch ) : null;

		return array(
			'sales'        => Decimal::toString( Decimal::of( $sales['total'] ?? 0 ) ),
			'sales_count'  => (string) (int) ( $sales['n'] ?? 0 ),
			'sales_due'    => Decimal::toString( Decimal::of( $sales['due'] ?? 0 ) ),
			'returns'      => Decimal::toString( Decimal::of( $returns ) ),
			'purchases'    => Decimal::toString( Decimal::of( $purchases ) ),
			'expenses'     => Decimal::toString( Decimal::of( $expenses ) ),
			'other_income' => Decimal::toString( Decimal::of( $income ) ),
			'collection'   => Decimal::toString( Decimal::of( $collected ) ),
			'revenue'      => $pl ? Decimal::toString( $pl['revenue'] ) : null,
			'gross_profit' => $pl ? Decimal::toString( $pl['gross'] ) : null,
			'profit'       => $pl ? Decimal::toString( $pl['net'] ) : null,
		);
	}

	/**
	 * Revenue/gross/net from the journal.
	 *
	 * @param array<int,int>|null $branch Branches.
	 * @return array{revenue:int,cogs:int,gross:int,other_income:int,expenses:int,net:int}
	 */
	private function profitTotals( BusinessContext $ctx, string $from, string $to, ?array $branch ): array {
		$rows    = $this->accountTotals( $ctx, $from, $to, $branch, array( 'income', 'expense' ) );
		$revenue = 0;
		$other   = 0;
		$cogs    = 0;
		$exp     = 0;
		foreach ( $rows as $r ) {
			$amount = $r['amount'];
			if ( 'income' === $r['type'] ) {
				if ( in_array( $r['system_key'], array( 'sales', 'sales_returns', 'shipping_income' ), true ) ) {
					$revenue += $amount;
				} else {
					$other += $amount;
				}
			} elseif ( 'cogs' === $r['subtype'] ) {
				$cogs += $amount;
			} else {
				$exp += $amount;
			}
		}
		$gross = $revenue - $cogs;
		return array(
			'revenue'      => $revenue,
			'cogs'         => $cogs,
			'gross'        => $gross,
			'other_income' => $other,
			'expenses'     => $exp,
			'net'          => $gross + $other - $exp,
		);
	}

	/**
	 * @param array<int,int>|null $branch Branches.
	 * @return array<string,array<int,array<string,string>>>
	 */
	private function series( BusinessContext $ctx, string $from, string $to, ?array $branch, bool $profit_ok ): array {
		$days  = (int) ( ( strtotime( $to ) - strtotime( $from ) ) / 86400 ) + 1;
		$month = $days > 62;
		$key   = static fn( string $col ) => $month ? "SUBSTR({$col},1,7)" : $col;

		list( $bs, $bp ) = $this->branchSql( $branch, 'branch_id' );
		$params          = array_merge( array( $ctx->business_id, $from, $to ), $bp );
		$s               = $this->db->table( 'sales' );
		$p               = $this->db->table( 'purchases' );
		$e               = $this->db->table( 'expenses' );

		$collect = function ( string $sql ) use ( $params ): array {
			$out = array();
			foreach ( $this->db->rows( $sql, $params ) as $r ) {
				$out[ (string) $r['k'] ] = Decimal::of( $r['v'] );
			}
			return $out;
		};
		$sales     = $collect( "SELECT {$key('sale_date')} AS k, SUM(total) AS v FROM {$s} WHERE business_id = %d AND status = 'completed' AND sale_date BETWEEN %s AND %s{$bs} GROUP BY k" );
		$due       = $collect( "SELECT {$key('sale_date')} AS k, SUM(due_amount) AS v FROM {$s} WHERE business_id = %d AND status = 'completed' AND sale_date BETWEEN %s AND %s{$bs} GROUP BY k" );
		$purchases = $collect( "SELECT {$key('purchase_date')} AS k, SUM(total) AS v FROM {$p} WHERE business_id = %d AND status = 'completed' AND purchase_date BETWEEN %s AND %s{$bs} GROUP BY k" );
		$expenses  = $collect( "SELECT {$key('expense_date')} AS k, SUM(amount) AS v FROM {$e} WHERE business_id = %d AND status = 'completed' AND expense_date BETWEEN %s AND %s{$bs} GROUP BY k" );

		$profit = array();
		if ( $profit_ok ) {
			$l  = $this->db->table( 'journal_lines' );
			$a  = $this->db->table( 'accounts' );
			list( $lbs, $lbp ) = $this->branchSql( $branch, 'l.branch_id' );
			$rows = $this->db->rows(
				"SELECT {$key('l.entry_date')} AS k, SUM(l.credit - l.debit) AS v
				FROM {$l} l JOIN {$a} a ON a.id = l.account_id
				WHERE l.business_id = %d AND l.entry_date BETWEEN %s AND %s AND a.type IN ('income','expense'){$lbs} GROUP BY k",
				array_merge( array( $ctx->business_id, $from, $to ), $lbp )
			);
			foreach ( $rows as $r ) {
				$profit[ (string) $r['k'] ] = Decimal::of( $r['v'] );
			}
		}

		$labels = array();
		$cursor = new \DateTimeImmutable( $from );
		$end    = new \DateTimeImmutable( $to );
		while ( $cursor <= $end ) {
			$labels[ $month ? $cursor->format( 'Y-m' ) : $cursor->format( 'Y-m-d' ) ] = true;
			$cursor = $month ? $cursor->modify( 'first day of next month' ) : $cursor->modify( '+1 day' );
		}
		$out = array();
		foreach ( array_keys( $labels ) as $label ) {
			$out[] = array(
				'label'     => $label,
				'sales'     => Decimal::toString( $sales[ $label ] ?? 0, 2 ),
				'purchases' => Decimal::toString( $purchases[ $label ] ?? 0, 2 ),
				'expenses'  => Decimal::toString( $expenses[ $label ] ?? 0, 2 ),
				'due'       => Decimal::toString( $due[ $label ] ?? 0, 2 ),
				'profit'    => $profit_ok ? Decimal::toString( $profit[ $label ] ?? 0, 2 ) : null,
			);
		}
		return array(
			'interval' => $month ? 'month' : 'day',
			'points'   => $out,
		);
	}

	/**
	 * @param array<int,int>|null $branch Branches.
	 * @return array<int,array<string,mixed>>
	 */
	private function topProducts( BusinessContext $ctx, string $from, string $to, ?array $branch, int $limit ): array {
		$s = $this->db->table( 'sales' );
		$i = $this->db->table( 'sale_items' );
		list( $bs, $bp ) = $this->branchSql( $branch, 's.branch_id' );
		return array_map(
			static fn( $r ) => array(
				'product_id' => (int) $r['product_id'],
				'name'       => $r['name'],
				'qty'        => Decimal::toString( Decimal::of( $r['qty'] ) ),
				'amount'     => Decimal::toString( Decimal::of( $r['amount'] ) ),
			),
			$this->db->rows(
				"SELECT i.product_id, MAX(i.name) AS name, SUM(i.qty) AS qty, SUM(i.net_amount) AS amount FROM {$i} i JOIN {$s} s ON s.id = i.sale_id
				WHERE s.business_id = %d AND s.status = 'completed' AND s.sale_date BETWEEN %s AND %s{$bs} GROUP BY i.product_id ORDER BY amount DESC LIMIT %d",
				array_merge( array( $ctx->business_id, $from, $to ), $bp, array( $limit ) )
			)
		);
	}

	/**
	 * @param array<int,int>|null $branch Branches.
	 * @return array<int,array<string,mixed>>
	 */
	private function recentSales( BusinessContext $ctx, ?array $branch ): array {
		if ( ! $ctx->can( 'sales.view' ) ) {
			return array();
		}
		$s = $this->db->table( 'sales' );
		$c = $this->db->table( 'contacts' );
		list( $bs, $bp ) = $this->branchSql( $branch, 's.branch_id' );
		return $this->db->rows(
			"SELECT s.id, s.number, s.sale_date, s.total, s.due_amount, s.payment_status, c.name AS customer_name FROM {$s} s LEFT JOIN {$c} c ON c.id = s.customer_id
			WHERE s.business_id = %d AND s.status = 'completed'{$bs} ORDER BY s.id DESC LIMIT 8",
			array_merge( array( $ctx->business_id ), $bp )
		);
	}

	/* ------------------------------------------------------------------ Financial statements */

	/**
	 * Profit & Loss statement.
	 *
	 * @param array<string,mixed> $args from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function profitLoss( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		$ctx->authorize( 'reports.profit' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$rows              = $this->accountTotals( $ctx, $from, $to, $branch, array( 'income', 'expense' ) );

		$sections = array(
			'revenue'      => array(),
			'cogs'         => array(),
			'other_income' => array(),
			'expenses'     => array(),
		);
		foreach ( $rows as $r ) {
			if ( 0 === $r['amount'] ) {
				continue;
			}
			$line = array(
				'account_id' => $r['id'],
				'code'       => $r['code'],
				'name'       => $r['name'],
				'amount'     => $r['amount'],
			);
			if ( 'income' === $r['type'] ) {
				$sections[ in_array( $r['system_key'], array( 'sales', 'sales_returns', 'shipping_income' ), true ) ? 'revenue' : 'other_income' ][] = $line;
			} else {
				$sections[ 'cogs' === $r['subtype'] ? 'cogs' : 'expenses' ][] = $line;
			}
		}
		$sum   = static fn( array $lines ) => Decimal::sum( array_column( $lines, 'amount' ) );
		$rev   = $sum( $sections['revenue'] );
		$cogs  = $sum( $sections['cogs'] );
		$other = $sum( $sections['other_income'] );
		$exp   = $sum( $sections['expenses'] );
		$gross = $rev - $cogs;
		$net   = $gross + $other - $exp;

		$fmt = static function ( array $lines ): array {
			foreach ( $lines as &$l ) {
				$l['amount'] = Decimal::toString( $l['amount'] );
			}
			return $lines;
		};
		$pct = static fn( int $a, int $b ) => 0 === $b ? '0.00' : Decimal::toString( Decimal::mul( Decimal::div( $a, $b ), Decimal::of( 100 ) ), 2 );

		return array(
			'from'               => $from,
			'to'                 => $to,
			'revenue'            => $fmt( $sections['revenue'] ),
			'total_revenue'      => Decimal::toString( $rev ),
			'cogs'               => $fmt( $sections['cogs'] ),
			'total_cogs'         => Decimal::toString( $cogs ),
			'gross_profit'       => Decimal::toString( $gross ),
			'gross_margin'       => $pct( $gross, $rev ),
			'other_income'       => $fmt( $sections['other_income'] ),
			'total_other_income' => Decimal::toString( $other ),
			'expenses'           => $fmt( $sections['expenses'] ),
			'total_expenses'     => Decimal::toString( $exp ),
			'net_profit'         => Decimal::toString( $net ),
			'net_margin'         => $pct( $net, $rev ),
		);
	}

	/**
	 * Trial balance as of a date.
	 *
	 * @param array<string,mixed> $args as_of, branch_id.
	 * @return array<string,mixed>
	 */
	public function trialBalance( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'accounting.view' );
		$as_of  = Text::date( $args['as_of'] ?? null ) ?? $this->today( $ctx );
		$branch = $this->branchFilter( $ctx, $args );
		$rows   = $this->accountTotals( $ctx, '1970-01-01', $as_of, $branch, null, true );
		$lines  = array();
		$tdr    = 0;
		$tcr    = 0;
		foreach ( $rows as $r ) {
			$net = $r['debit'] - $r['credit'];
			if ( 0 === $net ) {
				continue;
			}
			$dr      = $net > 0 ? $net : 0;
			$cr      = $net < 0 ? -$net : 0;
			$tdr    += $dr;
			$tcr    += $cr;
			$lines[] = array(
				'account_id' => $r['id'],
				'code'       => $r['code'],
				'name'       => $r['name'],
				'type'       => $r['type'],
				'debit'      => Decimal::toString( $dr ),
				'credit'     => Decimal::toString( $cr ),
			);
		}
		return array(
			'as_of'        => $as_of,
			'lines'        => $lines,
			'total_debit'  => Decimal::toString( $tdr ),
			'total_credit' => Decimal::toString( $tcr ),
			'balanced'     => $tdr === $tcr,
		);
	}

	/**
	 * Balance sheet as of a date. Unclosed profit is shown as current earnings.
	 *
	 * @param array<string,mixed> $args as_of, branch_id.
	 * @return array<string,mixed>
	 */
	public function balanceSheet( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'accounting.view' );
		$as_of  = Text::date( $args['as_of'] ?? null ) ?? $this->today( $ctx );
		$branch = $this->branchFilter( $ctx, $args );
		$rows   = $this->accountTotals( $ctx, '1970-01-01', $as_of, $branch, null, true );
		$out    = array(
			'asset'     => array(),
			'liability' => array(),
			'equity'    => array(),
		);
		$earnings = 0;
		foreach ( $rows as $r ) {
			if ( in_array( $r['type'], array( 'income', 'expense' ), true ) ) {
				$earnings += $r['credit'] - $r['debit'];
				continue;
			}
			if ( 0 === $r['amount'] ) {
				continue;
			}
			$out[ $r['type'] ][] = array(
				'account_id' => $r['id'],
				'code'       => $r['code'],
				'name'       => $r['name'],
				'amount'     => $r['amount'],
			);
		}
		if ( 0 !== $earnings ) {
			$out['equity'][] = array(
				'account_id' => 0,
				'code'       => '',
				'name'       => 'Current Earnings (unclosed profit)',
				'amount'     => $earnings,
			);
		}
		$totals = array();
		foreach ( $out as $type => &$lines ) {
			$totals[ $type ] = Decimal::sum( array_column( $lines, 'amount' ) );
			foreach ( $lines as &$l ) {
				$l['amount'] = Decimal::toString( $l['amount'] );
			}
		}
		unset( $lines, $l );
		return array(
			'as_of'                        => $as_of,
			'assets'                       => $out['asset'],
			'liabilities'                  => $out['liability'],
			'equity'                       => $out['equity'],
			'total_assets'                 => Decimal::toString( $totals['asset'] ),
			'total_liabilities'            => Decimal::toString( $totals['liability'] ),
			'total_equity'                 => Decimal::toString( $totals['equity'] ),
			'total_liabilities_and_equity' => Decimal::toString( $totals['liability'] + $totals['equity'] ),
			'balanced'                     => $totals['asset'] === $totals['liability'] + $totals['equity'],
		);
	}

	/**
	 * Account ledger with running balance (cash book / bank book = ledger of
	 * a payment account).
	 *
	 * @param array<string,mixed> $args account_id, from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function ledger( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'accounting.view' );
		$account = $this->accounts->get( $ctx, (int) ( $args['account_id'] ?? 0 ) );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$sign              = AccountService::normalSign( $account );
		$l                 = $this->db->table( 'journal_lines' );
		$e                 = $this->db->table( 'journal_entries' );
		$c                 = $this->db->table( 'contacts' );
		list( $bs, $bp )   = $this->branchSql( $branch, 'l.branch_id' );

		$o       = $this->db->row(
			"SELECT COALESCE(SUM(l.debit),0) AS dr, COALESCE(SUM(l.credit),0) AS cr FROM {$l} l WHERE l.business_id = %d AND l.account_id = %d AND l.entry_date < %s{$bs}",
			array_merge( array( $ctx->business_id, $account['id'], $from ), $bp )
		);
		$opening = $sign * ( Decimal::of( $o['dr'] ) - Decimal::of( $o['cr'] ) );
		$rows    = $this->db->rows(
			"SELECT l.entry_date, l.debit, l.credit, l.contact_id, c.name AS contact_name, e.id AS entry_id, e.source, e.source_id, e.reference_no, e.memo
			FROM {$l} l JOIN {$e} e ON e.id = l.entry_id LEFT JOIN {$c} c ON c.id = l.contact_id
			WHERE l.business_id = %d AND l.account_id = %d AND l.entry_date BETWEEN %s AND %s{$bs} ORDER BY l.entry_date, l.id LIMIT 5000",
			array_merge( array( $ctx->business_id, $account['id'], $from, $to ), $bp )
		);
		$running = $opening;
		$tdr     = 0;
		$tcr     = 0;
		foreach ( $rows as &$r ) {
			$dr           = Decimal::of( $r['debit'] );
			$cr           = Decimal::of( $r['credit'] );
			$tdr         += $dr;
			$tcr         += $cr;
			$running     += $sign * ( $dr - $cr );
			$r['debit']   = Decimal::toString( $dr );
			$r['credit']  = Decimal::toString( $cr );
			$r['balance'] = Decimal::toString( $running );
		}
		unset( $r );
		return array(
			'account'         => $account,
			'from'            => $from,
			'to'              => $to,
			'opening_balance' => Decimal::toString( $opening ),
			'lines'           => $rows,
			'total_debit'     => Decimal::toString( $tdr ),
			'total_credit'    => Decimal::toString( $tcr ),
			'closing_balance' => Decimal::toString( $running ),
		);
	}

	/**
	 * Cash flow (direct method) across payment accounts.
	 *
	 * @param array<string,mixed> $args from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function cashFlow( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'accounting.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$l                 = $this->db->table( 'journal_lines' );
		$e                 = $this->db->table( 'journal_entries' );
		$a                 = $this->db->table( 'accounts' );
		list( $bs, $bp )   = $this->branchSql( $branch, 'l.branch_id' );
		$rows              = $this->db->rows(
			"SELECT e.source, SUM(l.debit) AS inflow, SUM(l.credit) AS outflow FROM {$l} l JOIN {$e} e ON e.id = l.entry_id JOIN {$a} a ON a.id = l.account_id
			WHERE l.business_id = %d AND a.is_payment = 1 AND l.entry_date BETWEEN %s AND %s{$bs} GROUP BY e.source ORDER BY e.source",
			array_merge( array( $ctx->business_id, $from, $to ), $bp )
		);
		$in  = 0;
		$out = 0;
		$by  = array();
		foreach ( $rows as $r ) {
			$i    = Decimal::of( $r['inflow'] );
			$o    = Decimal::of( $r['outflow'] );
			$in  += $i;
			$out += $o;
			$by[] = array(
				'source'  => $r['source'],
				'inflow'  => Decimal::toString( $i ),
				'outflow' => Decimal::toString( $o ),
				'net'     => Decimal::toString( $i - $o ),
			);
		}
		$opening = Decimal::of(
			$this->db->value(
				"SELECT COALESCE(SUM(l.debit - l.credit),0) FROM {$l} l JOIN {$a} a ON a.id = l.account_id WHERE l.business_id = %d AND a.is_payment = 1 AND l.entry_date < %s{$bs}",
				array_merge( array( $ctx->business_id, $from ), $bp )
			)
		);
		return array(
			'from'            => $from,
			'to'              => $to,
			'opening_balance' => Decimal::toString( $opening ),
			'by_source'       => $by,
			'total_inflow'    => Decimal::toString( $in ),
			'total_outflow'   => Decimal::toString( $out ),
			'net_change'      => Decimal::toString( $in - $out ),
			'closing_balance' => Decimal::toString( $opening + $in - $out ),
		);
	}

	/* ------------------------------------------------------------------ Operational reports */

	/**
	 * Sales analysis grouped by day|month|product|customer|user|branch|category.
	 *
	 * @param array<string,mixed> $args group_by, from, to, branch_id, limit.
	 * @return array<string,mixed>
	 */
	public function sales( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$group             = (string) ( $args['group_by'] ?? 'day' );
		$s                 = $this->db->table( 'sales' );
		$i                 = $this->db->table( 'sale_items' );
		$c                 = $this->db->table( 'contacts' );
		$b                 = $this->db->table( 'branches' );
		$p                 = $this->db->table( 'products' );
		$cat               = $this->db->table( 'categories' );
		list( $bs, $bp )   = $this->branchSql( $branch, 's.branch_id' );

		$groups = array(
			'day'      => array( 's.sale_date', 's.sale_date', '' ),
			'month'    => array( 'SUBSTR(s.sale_date,1,7)', 'SUBSTR(s.sale_date,1,7)', '' ),
			'product'  => array( 'i.product_id', 'MAX(i.name)', '' ),
			'customer' => array( 's.customer_id', "COALESCE(MAX(c.name), 'Walk-in')", "LEFT JOIN {$c} c ON c.id = s.customer_id" ),
			'user'     => array( 's.created_by', 's.created_by', '' ),
			'branch'   => array( 's.branch_id', 'MAX(b.name)', "LEFT JOIN {$b} b ON b.id = s.branch_id" ),
			'category' => array( 'p.category_id', "COALESCE(MAX(cat.name), 'Uncategorised')", "LEFT JOIN {$p} p ON p.id = i.product_id LEFT JOIN {$cat} cat ON cat.id = p.category_id" ),
		);
		if ( ! isset( $groups[ $group ] ) ) {
			throw ValidationException::field( 'group_by', 'Unknown grouping.' );
		}
		list( $key, $label, $join ) = $groups[ $group ];
		$limit                      = max( 1, min( 1000, (int) ( $args['limit'] ?? 500 ) ) );

		$rows = $this->db->rows(
			"SELECT {$key} AS group_key, {$label} AS label, COUNT(DISTINCT s.id) AS invoices, SUM(i.qty) AS qty, SUM(i.net_amount) AS net, SUM(i.tax_amount) AS tax, SUM(i.cost_amount) AS cost, SUM(i.returned_qty) AS returned_qty
			FROM {$i} i JOIN {$s} s ON s.id = i.sale_id {$join}
			WHERE s.business_id = %d AND s.status = 'completed' AND s.sale_date BETWEEN %s AND %s{$bs}
			GROUP BY {$key} ORDER BY " . ( in_array( $group, array( 'day', 'month' ), true ) ? 'group_key' : 'net DESC' ) . ' LIMIT %d',
			array_merge( array( $ctx->business_id, $from, $to ), $bp, array( $limit ) )
		);

		$profit_ok = $ctx->can( 'reports.profit' );
		if ( 'user' === $group ) {
			foreach ( $rows as &$r ) {
				$u          = function_exists( 'get_userdata' ) ? get_userdata( (int) $r['group_key'] ) : null;
				$r['label'] = $u ? $u->display_name : 'User #' . $r['group_key'];
			}
			unset( $r );
		}
		$totals = array(
			'net'    => 0,
			'tax'    => 0,
			'cost'   => 0,
			'profit' => 0,
		);
		$out    = array();
		foreach ( $rows as $r ) {
			$net             = Decimal::of( $r['net'] );
			$tax             = Decimal::of( $r['tax'] );
			$cost            = Decimal::of( $r['cost'] );
			$totals['net']  += $net;
			$totals['tax']  += $tax;
			$totals['cost'] += $cost;
			$out[]           = array(
				'key'          => $r['group_key'],
				'label'        => (string) $r['label'],
				'invoices'     => (int) $r['invoices'],
				'qty'          => Decimal::toString( Decimal::of( $r['qty'] ) ),
				'returned_qty' => Decimal::toString( Decimal::of( $r['returned_qty'] ) ),
				'net'          => Decimal::toString( $net ),
				'tax'          => Decimal::toString( $tax ),
				'total'        => Decimal::toString( $net + $tax ),
				'cost'         => $profit_ok ? Decimal::toString( $cost ) : null,
				'profit'       => $profit_ok ? Decimal::toString( $net - $cost ) : null,
				'margin'       => $profit_ok && $net ? Decimal::toString( Decimal::mul( Decimal::div( $net - $cost, $net ), Decimal::of( 100 ) ), 2 ) : null,
			);
		}
		return array(
			'from'     => $from,
			'to'       => $to,
			'group_by' => $group,
			'rows'     => $out,
			'totals'   => array(
				'net'    => Decimal::toString( $totals['net'] ),
				'tax'    => Decimal::toString( $totals['tax'] ),
				'total'  => Decimal::toString( $totals['net'] + $totals['tax'] ),
				'cost'   => $profit_ok ? Decimal::toString( $totals['cost'] ) : null,
				'profit' => $profit_ok ? Decimal::toString( $totals['net'] - $totals['cost'] ) : null,
			),
			'note'     => 'Figures are gross of returns; see returns report for credits.',
		);
	}

	/**
	 * Invoice-wise profit.
	 *
	 * @param array<string,mixed> $args from, to, branch_id, page, per_page.
	 * @return array<string,mixed>
	 */
	public function invoiceProfit( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.profit' );
		list( $from, $to )                = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch                           = $this->branchFilter( $ctx, $args );
		list( $page, $per_page, $offset ) = $this->paging( $args );
		$s                                = $this->db->table( 'sales' );
		$i                                = $this->db->table( 'sale_items' );
		$c                                = $this->db->table( 'contacts' );
		list( $bs, $bp )                  = $this->branchSql( $branch, 's.branch_id' );
		$params                           = array_merge( array( $ctx->business_id, $from, $to ), $bp );
		$total                            = (int) $this->db->value( "SELECT COUNT(*) FROM {$s} s WHERE s.business_id = %d AND s.status = 'completed' AND s.sale_date BETWEEN %s AND %s{$bs}", $params );
		$rows                             = $this->db->rows(
			"SELECT s.id, s.number, s.sale_date, c.name AS customer_name, s.total, s.cost_amount,
				(SELECT COALESCE(SUM(i.net_amount),0) FROM {$i} i WHERE i.sale_id = s.id) AS net
			FROM {$s} s LEFT JOIN {$c} c ON c.id = s.customer_id
			WHERE s.business_id = %d AND s.status = 'completed' AND s.sale_date BETWEEN %s AND %s{$bs} ORDER BY s.sale_date DESC, s.id DESC LIMIT %d OFFSET %d",
			array_merge( $params, array( $per_page, $offset ) )
		);
		foreach ( $rows as &$r ) {
			$net         = Decimal::of( $r['net'] );
			$cost        = Decimal::of( $r['cost_amount'] );
			$r['net']    = Decimal::toString( $net );
			$r['profit'] = Decimal::toString( $net - $cost );
			$r['margin'] = $net ? Decimal::toString( Decimal::mul( Decimal::div( $net - $cost, $net ), Decimal::of( 100 ) ), 2 ) : '0.00';
		}
		return $this->paged( $rows, $total, $page, $per_page );
	}

	/**
	 * Purchases grouped by supplier|product|day|month.
	 *
	 * @param array<string,mixed> $args group_by, from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function purchases( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$group             = (string) ( $args['group_by'] ?? 'supplier' );
		$p                 = $this->db->table( 'purchases' );
		$i                 = $this->db->table( 'purchase_items' );
		$c                 = $this->db->table( 'contacts' );
		list( $bs, $bp )   = $this->branchSql( $branch, 'p.branch_id' );
		$groups            = array(
			'supplier' => array( 'p.supplier_id', "COALESCE(MAX(c.name), 'Cash purchase')", "LEFT JOIN {$c} c ON c.id = p.supplier_id" ),
			'product'  => array( 'i.product_id', 'MAX(i.name)', '' ),
			'day'      => array( 'p.purchase_date', 'p.purchase_date', '' ),
			'month'    => array( 'SUBSTR(p.purchase_date,1,7)', 'SUBSTR(p.purchase_date,1,7)', '' ),
		);
		if ( ! isset( $groups[ $group ] ) ) {
			throw ValidationException::field( 'group_by', 'Unknown grouping.' );
		}
		list( $key, $label, $join ) = $groups[ $group ];
		$rows                       = $this->db->rows(
			"SELECT {$key} AS group_key, {$label} AS label, COUNT(DISTINCT p.id) AS documents, SUM(i.qty) AS qty, SUM(i.net_amount) AS net, SUM(i.tax_amount) AS tax, SUM(i.landed_cost) AS landed
			FROM {$i} i JOIN {$p} p ON p.id = i.purchase_id {$join}
			WHERE p.business_id = %d AND p.status = 'completed' AND p.purchase_date BETWEEN %s AND %s{$bs}
			GROUP BY {$key} ORDER BY " . ( in_array( $group, array( 'day', 'month' ), true ) ? 'group_key' : 'net DESC' ) . ' LIMIT 1000',
			array_merge( array( $ctx->business_id, $from, $to ), $bp )
		);
		$sum = array(
			'net'    => 0,
			'tax'    => 0,
			'landed' => 0,
		);
		foreach ( $rows as &$r ) {
			foreach ( array( 'net', 'tax', 'landed' ) as $f ) {
				$v         = Decimal::of( $r[ $f ] );
				$sum[ $f ] += $v;
				$r[ $f ]   = Decimal::toString( $v );
			}
			$r['qty'] = Decimal::toString( Decimal::of( $r['qty'] ) );
		}
		return array(
			'from'     => $from,
			'to'       => $to,
			'group_by' => $group,
			'rows'     => $rows,
			'totals'   => array_map( array( Decimal::class, 'toString' ), $sum ),
		);
	}

	/**
	 * Expense or income totals by category.
	 *
	 * @param array<string,mixed> $args from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function byCategory( BusinessContext $ctx, string $kind, array $args ): array {
		$ctx->authorize( 'reports.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$t                 = $this->db->table( 'expense' === $kind ? 'expenses' : 'incomes' );
		$d                 = 'expense' === $kind ? 'expense_date' : 'income_date';
		$a                 = $this->db->table( 'accounts' );
		list( $bs, $bp )   = $this->branchSql( $branch, 'x.branch_id' );
		$rows              = $this->db->rows(
			"SELECT x.account_id, MAX(a.name) AS category, COUNT(*) AS entries, SUM(x.amount) AS amount FROM {$t} x LEFT JOIN {$a} a ON a.id = x.account_id
			WHERE x.business_id = %d AND x.status = 'completed' AND x.{$d} BETWEEN %s AND %s{$bs} GROUP BY x.account_id ORDER BY amount DESC",
			array_merge( array( $ctx->business_id, $from, $to ), $bp )
		);
		$total = 0;
		foreach ( $rows as &$r ) {
			$v           = Decimal::of( $r['amount'] );
			$total      += $v;
			$r['amount'] = Decimal::toString( $v );
		}
		unset( $r );
		foreach ( $rows as &$r ) {
			$r['share'] = $total ? Decimal::toString( Decimal::mul( Decimal::div( Decimal::of( $r['amount'] ), $total ), Decimal::of( 100 ) ), 2 ) : '0.00';
		}
		return array(
			'from'  => $from,
			'to'    => $to,
			'rows'  => $rows,
			'total' => Decimal::toString( $total ),
		);
	}

	/**
	 * Receivable/payable aging per contact.
	 *
	 * @param array<string,mixed> $args type (customer|supplier), as_of.
	 * @return array<string,mixed>
	 */
	public function dues( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		$type  = 'supplier' === ( $args['type'] ?? '' ) ? 'supplier' : 'customer';
		$as_of = Text::date( $args['as_of'] ?? null ) ?? $this->today( $ctx );
		$c     = $this->db->table( 'contacts' );
		$d     = $this->db->table( 'customer' === $type ? 'sales' : 'purchases' );
		$fk    = 'customer' === $type ? 'customer_id' : 'supplier_id';
		$date  = 'customer' === $type ? 'sale_date' : 'purchase_date';

		$contacts = $this->db->rows( "SELECT id, code, name, phone, balance FROM {$c} WHERE business_id = %d AND type = %s AND balance <> 0 AND deleted_at IS NULL ORDER BY balance DESC", array( $ctx->business_id, $type ) );
		$docs     = $this->db->rows( "SELECT {$fk} AS contact_id, {$date} AS doc_date, due_amount FROM {$d} WHERE business_id = %d AND status = 'completed' AND due_amount > 0", array( $ctx->business_id ) );
		$aging    = array();
		$now      = strtotime( $as_of );
		foreach ( $docs as $doc ) {
			$age    = (int) floor( ( $now - strtotime( (string) $doc['doc_date'] ) ) / 86400 );
			$bucket = $age <= 30 ? 'd0_30' : ( $age <= 60 ? 'd31_60' : ( $age <= 90 ? 'd61_90' : 'd90_plus' ) );
			$cid    = (int) $doc['contact_id'];
			$aging[ $cid ][ $bucket ] = ( $aging[ $cid ][ $bucket ] ?? 0 ) + Decimal::of( $doc['due_amount'] );
		}
		$totals = array(
			'balance'  => 0,
			'd0_30'    => 0,
			'd31_60'   => 0,
			'd61_90'   => 0,
			'd90_plus' => 0,
		);
		foreach ( $contacts as &$row ) {
			$bal               = Decimal::of( $row['balance'] );
			$totals['balance'] += $bal;
			$row['balance']    = Decimal::toString( $bal );
			foreach ( array( 'd0_30', 'd31_60', 'd61_90', 'd90_plus' ) as $b ) {
				$v               = $aging[ (int) $row['id'] ][ $b ] ?? 0;
				$totals[ $b ]   += $v;
				$row[ $b ]       = Decimal::toString( $v );
			}
		}
		unset( $row );
		return array(
			'type'   => $type,
			'as_of'  => $as_of,
			'rows'   => $contacts,
			'totals' => array_map( array( Decimal::class, 'toString' ), $totals ),
		);
	}

	/**
	 * Output vs input tax for a period.
	 *
	 * @param array<string,mixed> $args from, to, branch_id.
	 * @return array<string,mixed>
	 */
	public function tax( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'this_month' ) );
		$branch            = $this->branchFilter( $ctx, $args );
		$l                 = $this->db->table( 'journal_lines' );
		list( $bs, $bp )   = $this->branchSql( $branch, 'branch_id' );
		$out_id            = $this->accounts->systemId( $ctx->business_id, 'tax_output' );
		$in_id             = $this->accounts->systemId( $ctx->business_id, 'tax_input' );
		$sum               = function ( int $account, bool $credit_normal ) use ( $ctx, $l, $from, $to, $bs, $bp ): int {
			$r = $this->db->row( "SELECT COALESCE(SUM(debit),0) AS dr, COALESCE(SUM(credit),0) AS cr FROM {$l} WHERE business_id = %d AND account_id = %d AND entry_date BETWEEN %s AND %s{$bs}", array_merge( array( $ctx->business_id, $account, $from, $to ), $bp ) );
			$v = Decimal::of( $r['cr'] ) - Decimal::of( $r['dr'] );
			return $credit_normal ? $v : -$v;
		};
		$output = $sum( $out_id, true );
		$input  = $sum( $in_id, false );

		$s     = $this->db->table( 'sale_items' );
		$sh    = $this->db->table( 'sales' );
		list( $sbs, $sbp ) = $this->branchSql( $branch, 'h.branch_id' );
		$rates = $this->db->rows(
			"SELECT i.tax_rate, SUM(i.net_amount) AS taxable, SUM(i.tax_amount) AS tax FROM {$s} i JOIN {$sh} h ON h.id = i.sale_id
			WHERE h.business_id = %d AND h.status = 'completed' AND h.sale_date BETWEEN %s AND %s{$sbs} GROUP BY i.tax_rate ORDER BY i.tax_rate",
			array_merge( array( $ctx->business_id, $from, $to ), $sbp )
		);
		foreach ( $rates as &$r ) {
			$r['tax_rate'] = Decimal::toString( Decimal::of( $r['tax_rate'] ), 2 );
			$r['taxable']  = Decimal::toString( Decimal::of( $r['taxable'] ) );
			$r['tax']      = Decimal::toString( Decimal::of( $r['tax'] ) );
		}
		return array(
			'from'          => $from,
			'to'            => $to,
			'output_tax'    => Decimal::toString( $output ),
			'input_tax'     => Decimal::toString( $input ),
			'net_payable'   => Decimal::toString( $output - $input ),
			'sales_by_rate' => $rates,
		);
	}

	/**
	 * Slow-moving products: tracked items with stock but few/no sales in the period.
	 *
	 * @param array<string,mixed> $args from, to, limit.
	 * @return array<int,array<string,mixed>>
	 */
	public function slowMovers( BusinessContext $ctx, array $args ): array {
		$ctx->authorize( 'reports.view' );
		list( $from, $to ) = $this->range( $ctx, $args + array( 'range' => 'last_90' ) );
		$p                 = $this->db->table( 'products' );
		$st                = $this->db->table( 'stock_levels' );
		$i                 = $this->db->table( 'sale_items' );
		$s                 = $this->db->table( 'sales' );
		$rows              = $this->db->rows(
			"SELECT p.id, p.name, p.sku, COALESCE((SELECT SUM(x.qty) FROM {$st} x WHERE x.business_id = p.business_id AND x.product_id = p.id),0) AS stock,
				COALESCE((SELECT SUM(si.qty) FROM {$i} si JOIN {$s} sa ON sa.id = si.sale_id WHERE si.product_id = p.id AND sa.business_id = p.business_id AND sa.status = 'completed' AND sa.sale_date BETWEEN %s AND %s),0) AS sold
			FROM {$p} p WHERE p.business_id = %d AND p.deleted_at IS NULL AND p.track_stock = 1 AND p.status = 'active'
			ORDER BY sold ASC, stock DESC LIMIT %d",
			array( $from, $to, $ctx->business_id, max( 1, min( 200, (int) ( $args['limit'] ?? 20 ) ) ) )
		);
		$out = array();
		foreach ( $rows as $r ) {
			if ( Decimal::of( $r['stock'] ) <= 0 ) {
				continue;
			}
			$out[] = array(
				'product_id' => (int) $r['id'],
				'name'       => $r['name'],
				'sku'        => $r['sku'],
				'stock'      => Decimal::toString( Decimal::of( $r['stock'] ) ),
				'sold'       => Decimal::toString( Decimal::of( $r['sold'] ) ),
			);
		}
		return $out;
	}

	/* ------------------------------------------------------------------ Helpers */

	/**
	 * Per-account debit/credit totals with a signed "amount" in the account's
	 * normal direction.
	 *
	 * @param array<int,int>|null    $branch Branches.
	 * @param array<int,string>|null $types  Account types to include.
	 * @return array<int,array<string,mixed>>
	 */
	private function accountTotals( BusinessContext $ctx, string $from, string $to, ?array $branch, ?array $types, bool $all_accounts = false ): array {
		$l      = $this->db->table( 'journal_lines' );
		$a      = $this->db->table( 'accounts' );
		$params = array( $from, $to );
		list( $bs, $bp ) = $this->branchSql( $branch, 'l.branch_id' );
		$params = array_merge( $params, $bp, array( $ctx->business_id ) );
		$tw     = '';
		if ( $types ) {
			$tw     = ' AND a.type IN ' . $this->inList( $types, '%s' );
			$params = array_merge( $params, $types );
		}
		$rows = $this->db->rows(
			"SELECT a.id, a.code, a.name, a.type, a.subtype, a.system_key, a.is_contra, COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit
			FROM {$a} a LEFT JOIN {$l} l ON l.account_id = a.id AND l.business_id = a.business_id AND l.entry_date BETWEEN %s AND %s{$bs}
			WHERE a.business_id = %d AND a.deleted_at IS NULL{$tw}
			GROUP BY a.id, a.code, a.name, a.type, a.subtype, a.system_key, a.is_contra ORDER BY a.code",
			$params
		);
		$out  = array();
		foreach ( $rows as $r ) {
			$dr = Decimal::of( $r['debit'] );
			$cr = Decimal::of( $r['credit'] );
			if ( ! $all_accounts && 0 === $dr && 0 === $cr ) {
				continue;
			}
			// Contra accounts reduce their section, so they are reported in the section's normal direction.
			$section_sign = in_array( $r['type'], array( 'asset', 'expense' ), true ) ? 1 : -1;
			$out[]        = array(
				'id'         => (int) $r['id'],
				'code'       => $r['code'],
				'name'       => $r['name'],
				'type'       => $r['type'],
				'subtype'    => $r['subtype'],
				'system_key' => $r['system_key'],
				'debit'      => $dr,
				'credit'     => $cr,
				'amount'     => $section_sign * ( $dr - $cr ),
			);
		}
		return $out;
	}

	/**
	 * Resolve a date range from presets or explicit dates.
	 *
	 * @param array<string,mixed> $args range, from, to.
	 * @return array{0:string,1:string}
	 */
	public function range( BusinessContext $ctx, array $args ): array {
		$today = new \DateTimeImmutable( $this->today( $ctx ) );
		$from  = Text::date( $args['from'] ?? null );
		$to    = Text::date( $args['to'] ?? null );
		if ( $from && $to ) {
			if ( $from > $to ) {
				throw ValidationException::field( 'from', 'Start date must be before end date.' );
			}
			return array( $from, $to );
		}
		switch ( (string) ( $args['range'] ?? 'this_month' ) ) {
			case 'today':
				return array( $today->format( 'Y-m-d' ), $today->format( 'Y-m-d' ) );
			case 'yesterday':
				$y = $today->modify( '-1 day' )->format( 'Y-m-d' );
				return array( $y, $y );
			case '7d':
			case 'last_7':
				return array( $today->modify( '-6 days' )->format( 'Y-m-d' ), $today->format( 'Y-m-d' ) );
			case '30d':
			case 'last_30':
				return array( $today->modify( '-29 days' )->format( 'Y-m-d' ), $today->format( 'Y-m-d' ) );
			case 'last_90':
				return array( $today->modify( '-89 days' )->format( 'Y-m-d' ), $today->format( 'Y-m-d' ) );
			case 'last_month':
				$f = $today->modify( 'first day of last month' );
				return array( $f->format( 'Y-m-d' ), $f->modify( 'last day of this month' )->format( 'Y-m-d' ) );
			case 'this_year':
				return array( $today->format( 'Y' ) . '-01-01', $today->format( 'Y-m-d' ) );
			case 'fiscal_year':
				$fy    = (string) ( $ctx->business['fiscal_year_start'] ?? '01-01' );
				$start = new \DateTimeImmutable( $today->format( 'Y' ) . '-' . $fy );
				if ( $start > $today ) {
					$start = $start->modify( '-1 year' );
				}
				return array( $start->format( 'Y-m-d' ), $today->format( 'Y-m-d' ) );
			case 'this_month':
			default:
				return array( $today->format( 'Y-m-01' ), $today->format( 'Y-m-d' ) );
		}
	}

	/**
	 * Branch filter from args: null = all branches the user can see.
	 *
	 * @param array<string,mixed> $args branch_id.
	 * @return array<int,int>|null
	 */
	private function branchFilter( BusinessContext $ctx, array $args ): ?array {
		$b = $args['branch_id'] ?? 'all';
		if ( 'all' === $b || '' === $b || null === $b || 0 === (int) $b ) {
			return array() === $ctx->branch_ids ? null : $ctx->branch_ids;
		}
		$id = (int) $b;
		if ( ! $ctx->canAccessBranch( $id ) ) {
			throw new \BizLedger\Support\PermissionException( 'You do not have access to this branch.' );
		}
		return array( $id );
	}

	/**
	 * @param array<int,int>|null $branch Branch ids.
	 * @return array{0:string,1:array<int,int>}
	 */
	private function branchSql( ?array $branch, string $column ): array {
		if ( null === $branch ) {
			return array( '', array() );
		}
		return array( " AND {$column} IN " . $this->inList( $branch ), $branch );
	}
}
