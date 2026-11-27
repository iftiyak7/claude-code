<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Tests\IntegrationTestCase;

/**
 * Sizes of one product are different things to a shop: 1 L and 500 ml oil
 * must never be added together in any report.
 */
final class ReportSizesTest extends IntegrationTestCase {

	public function testEachSizeIsCountedOnItsOwn(): void {
		$oil = $this->product( 'Mustard oil', '300' );
		$big = $this->k->products->saveVariant( $this->ctx, $oil, array( 'name' => '1 L', 'selling_price' => '300', 'purchase_price' => '250', 'opening_qty' => '50' ) )['id'];
		$sml = $this->k->products->saveVariant( $this->ctx, $oil, array( 'name' => '500 ml', 'selling_price' => '160', 'purchase_price' => '130', 'opening_qty' => '50' ) )['id'];
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $oil, 'variant_id' => $big, 'qty' => '15' ) ), 'payments' => array( array( 'amount' => '4500' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $oil, 'variant_id' => $sml, 'qty' => '5' ) ), 'payments' => array( array( 'amount' => '800' ) ) ) );

		$r    = $this->k->reports->review( $this->ctx, array( 'range' => 'this_month' ) );
		$best = array_column( $r['best'], 'qty', 'name' );
		$this->assertMoney( '15', $best['Mustard oil - 1 L'] );
		$this->assertMoney( '5', $best['Mustard oil - 500 ml'], 'not 20' );
		$prof = array_column( $r['products'], 'profit', 'name' );
		$this->assertMoney( '750', $prof['Mustard oil - 1 L'] );
		$this->assertMoney( '150', $prof['Mustard oil - 500 ml'] );

		$top = array_column( $this->k->reports->dashboard( $this->ctx, array( 'range' => 'this_month' ) )['top_products'], 'qty', 'name' );
		$this->assertMoney( '5', $top['Mustard oil - 500 ml'] );

		$rep = array_column( $this->k->reports->sales( $this->ctx, array( 'range' => 'this_month', 'group_by' => 'product' ) )['rows'], 'qty', 'label' );
		$this->assertMoney( '15', $rep['Mustard oil - 1 L'] );
		$this->assertMoney( '5', $rep['Mustard oil - 500 ml'] );
	}
}
