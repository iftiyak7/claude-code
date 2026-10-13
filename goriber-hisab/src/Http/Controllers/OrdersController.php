<?php
/**
 * Online orders & courier REST routes.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * /orders — see OrderService for the lifecycle.
 */
final class OrdersController extends Controller {

	public function routes(): array {
		$o = fn() => $this->k->orders;
		return array(
			$this->route( 'GET', '/orders', fn( BusinessContext $c, array $p ) => $o()->list( $c, $p ) ),
			$this->route( 'POST', '/orders', fn( BusinessContext $c, array $p ) => $o()->create( $c, $p ), array( 'created' => true ) ),
			$this->route( 'GET', '/orders/courier', fn( BusinessContext $c ) => $o()->courierSettings( $c ) ),
			$this->route( 'PUT', '/orders/courier', fn( BusinessContext $c, array $p ) => $o()->saveCourierSettings( $c, $p ) ),
			$this->route( 'POST', '/orders/cod', fn( BusinessContext $c, array $p ) => $o()->collectCod( $c, (array) ( $p['ids'] ?? array() ), $p ) ),
			$this->route( 'GET', '/orders/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $o()->get( $c, self::id( $r ) ) ),
			$this->route( 'PUT', '/orders/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $o()->update( $c, self::id( $r ), $p ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/confirm', fn( BusinessContext $c, array $p, $r ) => $o()->confirm( $c, self::id( $r ), $p ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/status', fn( BusinessContext $c, array $p, $r ) => $o()->advance( $c, self::id( $r ), (string) ( $p['status'] ?? '' ), $p ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/steadfast', fn( BusinessContext $c, array $p, $r ) => $o()->bookSteadfast( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/track', fn( BusinessContext $c, array $p, $r ) => $o()->refreshCourier( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/close', fn( BusinessContext $c, array $p, $r ) => $o()->close( $c, self::id( $r ), (string) ( $p['status'] ?? '' ), $p ) ),
		);
	}
}
