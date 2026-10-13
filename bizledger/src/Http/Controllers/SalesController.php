<?php
/**
 * Sales, POS and returns.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http\Controllers;

use BizLedger\Tenancy\BusinessContext;

/**
 * Sales routes.
 */
final class SalesController extends Controller {

	public function routes(): array {
		$s = $this->k->sales;
		$r = $this->k->returns;
		return array(
			$this->route( 'GET', '/sales', fn( BusinessContext $c, array $a ) => $s->list( $c, $a ) ),
			$this->route( 'POST', '/sales', fn( BusinessContext $c, array $a ) => $s->create( $c, $a ), array( 'created' => true ) ),
			$this->route( 'POST', '/sales/quote', fn( BusinessContext $c, array $a ) => $s->quote( $c, $a ) ),
			$this->route( 'GET', '/sales/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $s->get( $c, self::id( $q ) ) ),
			$this->route( 'PUT', '/sales/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $s->update( $c, self::id( $q ), $a ) ),
			$this->route( 'POST', '/sales/(?P<id>\d+)/complete', fn( BusinessContext $c, array $a, $q ) => $s->complete( $c, self::id( $q ), $a ) ),
			$this->route( 'POST', '/sales/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $q ) => $s->void( $c, self::id( $q ), (string) ( $a['reason'] ?? '' ) ) ),

			$this->route( 'GET', '/returns', fn( BusinessContext $c, array $a ) => $r->list( $c, $a ) ),
			$this->route( 'POST', '/returns', fn( BusinessContext $c, array $a ) => $r->create( $c, (string) ( $a['type'] ?? 'sale' ), $a ), array( 'created' => true ) ),
			$this->route( 'GET', '/returns/(?P<id>\d+)', fn( BusinessContext $c, array $a, $q ) => $r->get( $c, self::id( $q ) ) ),
			$this->route( 'POST', '/returns/(?P<id>\d+)/void', fn( BusinessContext $c, array $a, $q ) => $r->void( $c, self::id( $q ), (string) ( $a['reason'] ?? '' ) ) ),
		);
	}
}
