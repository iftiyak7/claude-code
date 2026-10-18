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
			$this->route( 'GET', '/orders/board', fn( BusinessContext $c, array $p ) => $o()->courierBoard( $c, $p ) ),
			$this->route( 'POST', '/orders/refresh', fn( BusinessContext $c ) => $o()->refreshAll( $c ) ),
			$this->route( 'GET', '/orders/courier', fn( BusinessContext $c ) => $o()->courierSettings( $c ) ),
			$this->route( 'PUT', '/orders/courier', fn( BusinessContext $c, array $p ) => $o()->saveCourierSettings( $c, $p ) ),
			$this->route( 'POST', '/orders/parse', array( $this, 'parse' ) ),
			$this->route( 'GET', '/orders/check', array( $this, 'check' ) ),
			$this->route( 'POST', '/orders/cod', fn( BusinessContext $c, array $p ) => $o()->collectCod( $c, (array) ( $p['ids'] ?? array() ), $p ) ),
			$this->route( 'GET', '/orders/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $o()->get( $c, self::id( $r ) ) ),
			$this->route( 'PUT', '/orders/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $o()->update( $c, self::id( $r ), $p ) ),
			$this->route( 'GET', '/orders/(?P<id>\d+)/siblings', fn( BusinessContext $c, array $p, $r ) => $o()->siblings( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/items', fn( BusinessContext $c, array $p, $r ) => $o()->addItems( $c, self::id( $r ), (array) ( $p['items'] ?? array() ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/merge', fn( BusinessContext $c, array $p, $r ) => $o()->merge( $c, self::id( $r ), (int) ( $p['source_id'] ?? 0 ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/confirm', fn( BusinessContext $c, array $p, $r ) => $o()->confirm( $c, self::id( $r ), $p ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/status', fn( BusinessContext $c, array $p, $r ) => $o()->advance( $c, self::id( $r ), (string) ( $p['status'] ?? '' ), $p ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/steadfast', fn( BusinessContext $c, array $p, $r ) => $o()->bookSteadfast( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/track', fn( BusinessContext $c, array $p, $r ) => $o()->refreshCourier( $c, self::id( $r ) ) ),
			$this->route( 'POST', '/orders/(?P<id>\d+)/close', fn( BusinessContext $c, array $p, $r ) => $o()->close( $c, self::id( $r ), (string) ( $p['status'] ?? '' ), $p ) ),
		);
	}

	/**
	 * @param array<string,mixed> $p phone, refresh, order_id.
	 * @return array<string,mixed>
	 */
	public function check( BusinessContext $ctx, array $p ): array {
		// Paid courier lookups are cached a day per phone; still cap them per shop.
		$this->k->limiter->hit( 'phone-check:' . $ctx->business_id, 600, DAY_IN_SECONDS );
		return $this->k->orders->risk( $ctx, (string) ( $p['phone'] ?? '' ), ! empty( $p['refresh'] ), (int) ( $p['order_id'] ?? 0 ) );
	}

	/**
	 * @param array<string,mixed> $p text, ai.
	 * @return array<string,mixed>
	 */
	public function parse( BusinessContext $ctx, array $p ): array {
		$use_ai = ! isset( $p['ai'] ) || ! empty( $p['ai'] );
		if ( $use_ai && $this->k->orders->aiAvailable() ) {
			// AI calls cost the site owner money: cap them per shop.
			$this->k->limiter->hit( 'ai-order:' . $ctx->business_id, 120, HOUR_IN_SECONDS );
		}
		return $this->k->orders->parse( $ctx, (string) ( $p['text'] ?? '' ), $use_ai );
	}
}
