<?php
/**
 * Reports.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http\Controllers;

use BizLedger\Support\NotFoundException;
use BizLedger\Tenancy\BusinessContext;

/**
 * GET /reports/{name}. Add-ons can add report types with the
 * "bizledger/reports" filter (name => callable(ctx, args)).
 */
final class ReportsController extends Controller {

	public function routes(): array {
		return array(
			$this->route( 'GET', '/reports/(?P<name>[a-z\-]+)', array( $this, 'run' ) ),
		);
	}

	/**
	 * @param array<string,mixed> $args Query.
	 * @return mixed
	 */
	public function run( BusinessContext $ctx, array $args, \WP_REST_Request $request ) {
		$r       = $this->k->reports;
		$reports = array(
			'dashboard'      => fn() => $r->dashboard( $ctx, $args ),
			'profit-loss'    => fn() => $r->profitLoss( $ctx, $args ),
			'trial-balance'  => fn() => $r->trialBalance( $ctx, $args ),
			'balance-sheet'  => fn() => $r->balanceSheet( $ctx, $args ),
			'ledger'         => fn() => $r->ledger( $ctx, $args ),
			'cash-flow'      => fn() => $r->cashFlow( $ctx, $args ),
			'sales'          => fn() => $r->sales( $ctx, $args ),
			'invoice-profit' => fn() => $r->invoiceProfit( $ctx, $args ),
			'purchases'      => fn() => $r->purchases( $ctx, $args ),
			'expenses'       => fn() => $r->byCategory( $ctx, 'expense', $args ),
			'income'         => fn() => $r->byCategory( $ctx, 'income', $args ),
			'dues'           => fn() => $r->dues( $ctx, $args ),
			'tax'            => fn() => $r->tax( $ctx, $args ),
			'slow-movers'    => fn() => $r->slowMovers( $ctx, $args ),
			'stock'          => fn() => $this->k->stock->levels( $ctx, $args + array( 'branch_id' => 'all', 'per_page' => 200 ) ),
		);
		$reports = (array) apply_filters( 'bizledger/reports', $reports, $ctx, $args );
		$name    = (string) $request->get_param( 'name' );
		if ( ! isset( $reports[ $name ] ) ) {
			throw new NotFoundException( 'Unknown report.' );
		}
		return $reports[ $name ]();
	}
}
