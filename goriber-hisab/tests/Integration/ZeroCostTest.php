<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Tests\IntegrationTestCase;

/**
 * Stock entered before its purchase price was known sat at ৳0 cost, so its
 * sales showed the whole price as profit. Setting the price fixes both.
 */
final class ZeroCostTest extends IntegrationTestCase {

	public function testPurchasePriceSetLaterFixesStockAndSales(): void {
		$p    = $this->product( 'Morich gura', '900' );
		$v    = $this->k->products->saveVariant( $this->ctx, $p, array( 'name' => '100 g', 'selling_price' => '90', 'purchase_price' => '', 'opening_qty' => '4' ) )['id'];
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'variant_id' => $v, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '90' ) ) ) );
		$this->assertMoney( '90', $sale['gross_profit'], 'the bug: no cost' );

		$r = $this->k->products->saveVariant( $this->ctx, $p, array( 'name' => '100 g', 'selling_price' => '90', 'purchase_price' => '75' ), $v );
		$this->assertSame( 1, $r['cost_fixed']['sales'] );
		$this->assertSame( '3.0000', $r['cost_fixed']['stock'] );
		$this->assertMoney( '15', $this->k->sales->get( $this->ctx, $sale['id'] )['gross_profit'] );
		$this->assertMoney( '75', $this->balance( 'cogs' ) );
		$this->assertMoney( '225', $this->balance( 'inventory' ), '3 left at 75' );
		$this->assertMoney( '0', $this->balance( 'inventory_adjustment' ) );
		$this->assertBooksBalanced( 'cost fixed' );

		// New sales use the real cost; a void puts the bottle back at 75.
		$s2 = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'variant_id' => $v, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '90' ) ) ) );
		$this->assertMoney( '15', $s2['gross_profit'] );
		$this->k->sales->void( $this->ctx, $sale['id'] );
		$this->assertSame( '3.0000', $this->qty( $p, $v ) );
		$this->assertMoney( '225', $this->balance( 'inventory' ) );
		$this->assertBooksBalanced( 'void after fix' );

		// Saving again changes nothing more.
		$again = $this->k->products->saveVariant( $this->ctx, $p, array( 'name' => '100 g', 'selling_price' => '90', 'purchase_price' => '75' ), $v );
		$this->assertSame( 0, $again['cost_fixed']['sales'] );
	}

	public function testProductWithoutSizes(): void {
		$p    = $this->product( 'Ada', '100', '0', '5' );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '200' ) ) ) );
		$this->k->products->update( $this->ctx, $p, array( 'purchase_price' => '60' ) );
		$this->assertMoney( '80', $this->k->sales->get( $this->ctx, $sale['id'] )['gross_profit'] );
		$this->assertMoney( '180', $this->balance( 'inventory' ) );
		$this->assertBooksBalanced( 'plain product' );
	}

	public function testRepairButtonForPriceAlreadySaved(): void {
		$p = $this->product( 'Holud', '500' );
		$v = $this->k->products->saveVariant( $this->ctx, $p, array( 'name' => '100 g', 'selling_price' => '90', 'purchase_price' => '', 'opening_qty' => '4' ) )['id'];
		// Price saved straight in the database (as on a shop where it was set before this fix).
		$this->db->update( $this->db->table( 'product_variants' ), array( 'purchase_price' => '75' ), array( 'id' => $v ) );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'variant_id' => $v, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '90' ) ) ) );
		$this->assertSame( 1, $this->k->products->get( $this->ctx, $p )['zero_cost'] );
		$r = $this->k->products->repairCost( $this->ctx, $p );
		$this->assertSame( 1, $r['sales'] );
		$this->assertMoney( '15', $this->k->sales->get( $this->ctx, $sale['id'] )['gross_profit'] );
		$this->assertSame( 0, $this->k->products->get( $this->ctx, $p )['zero_cost'] );
		$this->assertBooksBalanced( 'repaired' );
	}
}
