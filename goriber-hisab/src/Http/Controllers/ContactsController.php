<?php
/**
 * Customers and suppliers.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * /customers and /suppliers share one implementation.
 */
final class ContactsController extends Controller {

	public function routes(): array {
		$c    = $this->k->contacts;
		$type = static fn( \WP_REST_Request $r ) => 'suppliers' === $r->get_param( 'type' ) ? 'supplier' : 'customer';
		$base = '/(?P<type>customers|suppliers)';
		return array(
			$this->route( 'GET', $base, fn( BusinessContext $x, array $a, $r ) => $c->list( $x, $type( $r ), $a ) ),
			$this->route( 'POST', $base, fn( BusinessContext $x, array $a, $r ) => ! empty( $a['quick'] ) ? $c->quickCreate( $x, $type( $r ), $a ) : $c->create( $x, $type( $r ), $a ), array( 'created' => true ) ),
			$this->route( 'GET', $base . '/(?P<id>\d+)', fn( BusinessContext $x, array $a, $r ) => $c->get( $x, $type( $r ), self::id( $r ) ) ),
			$this->route( 'PUT', $base . '/(?P<id>\d+)', fn( BusinessContext $x, array $a, $r ) => $c->update( $x, $type( $r ), self::id( $r ), $a ) ),
			$this->route(
				'DELETE',
				$base . '/(?P<id>\d+)',
				function ( BusinessContext $x, array $a, $r ) use ( $c, $type ) {
					$c->delete( $x, $type( $r ), self::id( $r ) );
					return array( 'ok' => true );
				}
			),
			$this->route( 'GET', $base . '/(?P<id>\d+)/statement', fn( BusinessContext $x, array $a, $r ) => $c->statement( $x, $type( $r ), self::id( $r ), $a ) ),
		);
	}
}
