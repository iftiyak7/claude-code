<?php
/**
 * Chart of accounts, journal, expenses and income.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * Accounting routes.
 */
final class AccountingController extends Controller {

	public function routes(): array {
		$acc = $this->k->accounts;
		$j   = $this->k->journal;
		$f   = $this->k->finance;
		$kind = static fn( \WP_REST_Request $r ) => 'incomes' === $r->get_param( 'kind' ) ? 'income' : 'expense';
		$fin  = '/(?P<kind>expenses|incomes)';
		return array(
			$this->route( 'GET', '/accounts', fn( BusinessContext $c, array $a ) => $acc->list( $c, $a ) ),
			$this->route( 'POST', '/accounts', fn( BusinessContext $c, array $a ) => $acc->create( $c, $a ), array( 'created' => true ) ),
			$this->route( 'GET', '/accounts/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $acc->get( $c, self::id( $r ) ) ),
			$this->route( 'PUT', '/accounts/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $acc->update( $c, self::id( $r ), $a ) ),
			$this->route(
				'DELETE',
				'/accounts/(?P<id>\d+)',
				function ( BusinessContext $c, array $a, $r ) use ( $acc ) {
					$acc->delete( $c, self::id( $r ) );
					return array( 'ok' => true );
				}
			),

			$this->route( 'GET', '/cash', fn( BusinessContext $c ) => $this->k->cash->overview( $c ) ),
			$this->route( 'GET', '/cash/moves', fn( BusinessContext $c, array $a ) => $this->k->cash->list( $c, $a ) ),
			$this->route( 'POST', '/cash/moves', fn( BusinessContext $c, array $a ) => $this->k->cash->create( $c, $a ), array( 'created' => true ) ),
			$this->route( 'POST', '/cash/moves/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $r ) => $this->k->cash->void( $c, self::id( $r ), (string) ( $a['reason'] ?? '' ) ) ),
			$this->route( 'GET', '/journal', fn( BusinessContext $c, array $a ) => $j->search( $c, $a ) ),
			$this->route( 'POST', '/journal', fn( BusinessContext $c, array $a ) => $j->entry( $c, $j->manual( $c, $a, (array) ( $a['lines'] ?? array() ) ) ), array( 'created' => true ) ),
			$this->route( 'GET', '/journal/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $j->entry( $c, self::id( $r ) ) ),
			$this->route(
				'POST',
				'/journal/(?P<id>\d+)/void',
				function ( BusinessContext $c, array $a, $r ) use ( $j ) {
					$j->voidManual( $c, self::id( $r ) );
					return $j->entry( $c, self::id( $r ) );
				}
			),

			$this->route( 'GET', $fin, fn( BusinessContext $c, array $a, $r ) => $f->list( $c, $kind( $r ), $a ) ),
			$this->route( 'POST', $fin, fn( BusinessContext $c, array $a, $r ) => $f->create( $c, $kind( $r ), $a ), array( 'created' => true ) ),
			$this->route( 'GET', $fin . '/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $f->get( $c, $kind( $r ), self::id( $r ) ) ),
			$this->route( 'PUT', $fin . '/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $f->update( $c, $kind( $r ), self::id( $r ), $a ) ),
			$this->route( 'POST', $fin . '/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $r ) => $f->void( $c, $kind( $r ), self::id( $r ), (string) ( $a['reason'] ?? '' ) ) ),
		);
	}
}
