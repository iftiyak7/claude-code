<?php
/**
 * Purchases and payments.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * Purchase and payment routes.
 */
final class PurchasesController extends Controller {

	public function routes(): array {
		$p   = $this->k->purchases;
		$pay = $this->k->payments;
		return array(
			$this->route( 'GET', '/purchases', fn( BusinessContext $c, array $a ) => $p->list( $c, $a ) ),
			$this->route( 'POST', '/purchases', fn( BusinessContext $c, array $a ) => $p->create( $c, $a ), array( 'created' => true ) ),
			$this->route( 'GET', '/purchases/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $p->get( $c, self::id( $r ) ) ),
			$this->route( 'PUT', '/purchases/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $p->update( $c, self::id( $r ), $a ) ),
			$this->route( 'POST', '/purchases/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $r ) => $p->void( $c, self::id( $r ), (string) ( $a['reason'] ?? '' ) ) ),

			$this->route( 'GET', '/payments', fn( BusinessContext $c, array $a ) => $pay->list( $c, $a ) ),
			$this->route( 'GET', '/payments/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $pay->get( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/payments/receive', fn( BusinessContext $c, array $a ) => $pay->receive( $c, $a ), array( 'created' => true ) ),
			$this->route( 'POST', '/payments/pay', fn( BusinessContext $c, array $a ) => $pay->pay( $c, $a ), array( 'created' => true ) ),
			$this->route(
				'POST',
				'/payments/(?P<id>\d+)/void',
				function ( BusinessContext $c, array $a, $r ) use ( $pay ) {
					$pay->void( $c, self::id( $r ), (string) ( $a['reason'] ?? '' ) );
					return $pay->get( $c, self::id( $r ) );
				}
			),
		);
	}
}
