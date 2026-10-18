<?php
/**
 * Sales, POS and returns.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * Sales routes.
 */
final class SalesController extends Controller {

	public function routes(): array {
		$s = $this->k->sales;
		$r = $this->k->returns;
		return array(
			$this->route( 'GET', '/sales', fn( BusinessContext $c, array $a ) => $s->list( $c, $a ) ),
			$this->route( 'POST', '/sales', fn( BusinessContext $c, array $a ) => $this->withSms( $c, $s->create( $c, $a ) ), array( 'created' => true ) ),
			$this->route( 'POST', '/sales/quote', fn( BusinessContext $c, array $a ) => $s->quote( $c, $a ) ),
			$this->route( 'GET', '/sales/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $s->get( $c, self::id( $q ) ) ),
			$this->route( 'PUT', '/sales/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $s->update( $c, self::id( $q ), $a ) ),
			$this->route( 'POST', '/sales/(?P<id>\d+)/complete', fn( BusinessContext $c, array $a, $q ) => $this->withSms( $c, $s->complete( $c, self::id( $q ), $a ) ) ),
			$this->route( 'POST', '/sms/send', array( $this, 'sendSms' ) ),
			$this->route( 'GET', '/sms/usage', fn( BusinessContext $c ) => $this->k->sms->usage( $c ) ),
			$this->route( 'POST', '/sales/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $q ) => $s->void( $c, self::id( $q ), (string) ( $a['reason'] ?? '' ) ) ),

			$this->route( 'GET', '/returns', fn( BusinessContext $c, array $a ) => $r->list( $c, $a ) ),
			$this->route( 'POST', '/returns', fn( BusinessContext $c, array $a ) => $r->create( $c, (string) ( $a['type'] ?? 'sale' ), $a ), array( 'created' => true ) ),
			$this->route( 'GET', '/returns/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $r->get( $c, self::id( $q ) ) ),
			$this->route( 'POST', '/returns/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $q ) => $r->void( $c, self::id( $q ), (string) ( $a['reason'] ?? '' ) ) ),
		);
	}

	/**
	 * Thank-you SMS after a sale, when the shop has turned it on.
	 *
	 * @param array<string,mixed> $sale Sale.
	 * @return array<string,mixed>
	 */
	private function withSms( BusinessContext $ctx, array $sale ): array {
		$sale['sms_sent'] = $this->k->sms->afterSale( $ctx, $sale );
		return $sale;
	}

	/**
	 * Due reminder or any message to a customer.
	 *
	 * @param array<string,mixed> $a phone, message, customer_id.
	 * @return array{ok:bool}
	 */
	public function sendSms( BusinessContext $ctx, array $a ): array {
		if ( ! $ctx->can( 'customers.view' ) ) {
			throw new \GoriberHisab\Support\PermissionException( 'You do not have access to this.' );
		}
		$this->k->limiter->hit( 'sms:' . $ctx->business_id . ':' . $ctx->user_id, 200, HOUR_IN_SECONDS );
		$ok = $this->k->sms->send( $ctx, (string) ( $a['phone'] ?? '' ), (string) ( $a['message'] ?? '' ), (string) ( $a['ref_type'] ?? 'manual' ), (int) ( $a['customer_id'] ?? 0 ) );
		if ( ! $ok ) {
			throw new \GoriberHisab\Support\ValidationException( array(), 'The SMS gateway did not accept the message. Check the SMS balance and settings.' );
		}
		return array( 'ok' => true );
	}
}
