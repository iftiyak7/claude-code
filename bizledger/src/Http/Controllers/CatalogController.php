<?php
/**
 * Products, variants, taxonomies and tax rates.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Http\Controllers;

use BizLedger\Catalog\TaxonomyService;
use BizLedger\Support\NotFoundException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Catalogue routes.
 */
final class CatalogController extends Controller {

	public function routes(): array {
		$p = $this->k->products;
		return array(
			$this->route( 'GET', '/products', fn( BusinessContext $c, array $a ) => $p->list( $c, $a ) ),
			$this->route( 'POST', '/products', fn( BusinessContext $c, array $a ) => $p->create( $c, $a ), array( 'created' => true ) ),
			$this->route( 'GET', '/products/lookup', fn( BusinessContext $c, array $a ) => $p->findByCode( $c, (string) ( $a['code'] ?? '' ) ) ),
			$this->route( 'GET', '/products/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $p->get( $c, self::id( $r ) ) ),
			$this->route( 'PUT', '/products/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $p->update( $c, self::id( $r ), $a ) ),
			$this->route( 'DELETE', '/products/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->ok( $p->delete( $c, self::id( $r ) ) ) ),
			$this->route( 'POST', '/products/(?P<id>\d+)/variants', fn( BusinessContext $c, array $a, $r ) => $p->saveVariant( $c, self::id( $r ), $a ), array( 'created' => true ) ),
			$this->route( 'PUT', '/products/(?P<id>\d+)/variants/(?P<vid>\d+)', fn( BusinessContext $c, array $a, $r ) => $p->saveVariant( $c, self::id( $r ), $a, self::id( $r, 'vid' ) ) ),
			$this->route( 'DELETE', '/products/(?P<id>\d+)/variants/(?P<vid>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->ok( $p->deleteVariant( $c, self::id( $r ), self::id( $r, 'vid' ) ) ) ),

			$this->route( 'GET', '/taxonomies/(?P<kind>[a-z]+)', fn( BusinessContext $c, array $a, $r ) => $this->k->taxonomy->list( $c, $this->kind( $r ) ) ),
			$this->route( 'POST', '/taxonomies/(?P<kind>[a-z]+)', fn( BusinessContext $c, array $a, $r ) => $this->k->taxonomy->save( $c, $this->kind( $r ), $a ), array( 'created' => true ) ),
			$this->route( 'PUT', '/taxonomies/(?P<kind>[a-z]+)/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->k->taxonomy->save( $c, $this->kind( $r ), $a, self::id( $r ) ) ),
			$this->route( 'DELETE', '/taxonomies/(?P<kind>[a-z]+)/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->ok( $this->k->taxonomy->delete( $c, $this->kind( $r ), self::id( $r ) ) ) ),

			$this->route( 'GET', '/tax-rates', fn( BusinessContext $c ) => $this->k->taxes->list( $c ) ),
			$this->route( 'POST', '/tax-rates', fn( BusinessContext $c, array $a ) => $this->k->taxes->save( $c, $a ), array( 'created' => true ) ),
			$this->route( 'PUT', '/tax-rates/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->k->taxes->save( $c, $a, self::id( $r ) ) ),
			$this->route( 'DELETE', '/tax-rates/(?P<id>\d+)', fn( BusinessContext $c, array $a, $r ) => $this->ok( $this->k->taxes->delete( $c, self::id( $r ) ) ) ),
		);
	}

	private function kind( \WP_REST_Request $r ): string {
		$kind = (string) $r->get_param( 'kind' );
		if ( ! TaxonomyService::valid( $kind ) ) {
			throw new NotFoundException( 'Unknown list.' );
		}
		return $kind;
	}

	/**
	 * @param mixed $ignored Ignored.
	 * @return array{ok:bool}
	 */
	private function ok( $ignored = null ): array {
		unset( $ignored );
		return array( 'ok' => true );
	}
}
