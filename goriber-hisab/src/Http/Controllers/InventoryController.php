<?php
/**
 * Stock.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Tenancy\BusinessContext;

/**
 * Inventory routes.
 */
final class InventoryController extends Controller {

	public function routes(): array {
		$s = $this->k->stock;
		return array(
			$this->route( 'GET', '/stock', fn( BusinessContext $c, array $a ) => $s->levels( $c, $a ) ),
			$this->route( 'GET', '/stock/lights', fn( BusinessContext $c, array $a ) => $s->lights( $c, $a ) ),
			$this->route( 'GET', '/stock/movements', fn( BusinessContext $c, array $a ) => $s->movements( $c, $a ) ),
			$this->route( 'POST', '/stock/adjust', fn( BusinessContext $c, array $a ) => $s->adjust( $c, $a ), array( 'created' => true ) ),
		);
	}
}
