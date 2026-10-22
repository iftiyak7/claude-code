<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

/**
 * Products made from a recipe at the moment of sale (honey nuts from cashew,
 * almond and walnut): ingredients leave stock at their real cost.
 */
final class RecipeTest extends IntegrationTestCase {

	public function testRecipeSaleUsesIngredientCost(): void {
		$cashew = $this->product( 'Cashew', '1500', '1200', '10' );
		$almond = $this->product( 'Almond', '1300', '1000', '10' );
		$walnut = $this->product( 'Walnut', '1100', '900', '10' );
		$honey  = $this->product( 'Honey nut', '2000' );

		$rec = $this->k->products->saveRecipe(
			$this->ctx,
			$honey,
			array(
				'items' => array(
					array( 'product_id' => $cashew, 'qty' => '0.3' ),
					array( 'product_id' => $almond, 'qty' => '0.3' ),
					array( 'product_id' => $walnut, 'qty' => '0.2' ),
				),
			)
		);
		$this->assertMoney( '840', $rec['recipes'][0]['cost'], '360 + 300 + 180' );
		$this->assertSame( '33', $rec['make_qty'], 'cashew 10 / 0.3' );
		$p = $this->k->products->get( $this->ctx, $honey );
		$this->assertTrue( $p['has_recipe'] );
		$this->assertTrue( ! $p['track_stock'] );
		$this->assertMoney( '840', $p['purchase_price'], 'reference cost follows the recipe' );

		$this->assertBooksBalanced( 'recipe saved' );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $honey, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '4000' ) ) ) );
		$this->assertMoney( '1680', $sale['cost_amount'] );
		$this->assertMoney( '2320', $sale['gross_profit'] );
		$this->assertSame( '9.4000', $this->qty( $cashew ) );
		$this->assertSame( '9.4000', $this->qty( $almond ) );
		$this->assertSame( '9.6000', $this->qty( $walnut ) );
		$this->assertSame( 3, count( $sale['items'][0]['components'] ) );
		$this->assertMoney( '1680', $this->balance( 'cogs' ) );
		$this->assertMoney( '0', $this->balance( 'inventory_adjustment' ) );
		$this->assertBooksBalanced( 'recipe sale' );

		// Return one jar: half the ingredients come back at the same cost.
		$item = $sale['items'][0];
		$ret  = $this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => '1' ) ), 'refund_amount' => '2000', 'refund_account_id' => $this->account( 'cash' ) ) );
		$this->assertSame( '9.7000', $this->qty( $cashew ) );
		$this->assertSame( '9.8000', $this->qty( $walnut ) );
		$this->assertMoney( '840', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'recipe return' );

		$this->k->returns->void( $this->ctx, $ret['id'] );
		$this->assertSame( '9.4000', $this->qty( $cashew ) );
		$this->assertMoney( '1680', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'recipe return void' );

		// A second sale, then void it: everything goes back.
		$s2 = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $honey, 'qty' => '0.5' ) ), 'payments' => array( array( 'amount' => '1000' ) ) ) );
		$this->assertMoney( '420', $s2['cost_amount'] );
		$this->assertSame( '9.2500', $this->qty( $cashew ) );
		$this->k->sales->void( $this->ctx, $s2['id'] );
		$this->assertSame( '9.4000', $this->qty( $cashew ) );
		$this->assertMoney( '1680', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'recipe void' );
	}

	public function testRecipeRules(): void {
		$nut   = $this->product( 'Nut', '100', '50', '5' );
		$mix   = $this->product( 'Mix', '300' );
		$stock = $this->product( 'Has stock', '100', '50', '2' );
		$this->assertThrows( ValidationException::class, fn() => $this->k->products->saveRecipe( $this->ctx, $mix, array( 'items' => array( array( 'product_id' => $mix, 'qty' => '1' ) ) ) ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->products->saveRecipe( $this->ctx, $mix, array( 'items' => array( array( 'product_id' => $nut, 'qty' => '0' ) ) ) ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->products->saveRecipe( $this->ctx, $stock, array( 'items' => array( array( 'product_id' => $nut, 'qty' => '1' ) ) ) ) );
		$this->k->products->saveRecipe( $this->ctx, $mix, array( 'items' => array( array( 'product_id' => $nut, 'qty' => '1' ) ) ) );
		// No recipe inside a recipe.
		$other = $this->product( 'Other', '100' );
		$this->assertThrows( ValidationException::class, fn() => $this->k->products->saveRecipe( $this->ctx, $other, array( 'items' => array( array( 'product_id' => $mix, 'qty' => '1' ) ) ) ) );
		// Not enough ingredients → sale refused.
		$this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $mix, 'qty' => '6' ) ), 'payments' => array( array( 'amount' => '1800' ) ) ) ) );
		// Removing the recipe.
		$r = $this->k->products->saveRecipe( $this->ctx, $mix, array( 'items' => array() ) );
		$this->assertSame( 0, count( $r['recipes'] ) );
	}

	public function testPackAheadHoneyBottles(): void {
		$bulk  = $this->product( 'Honey loose', '900', '600', '20' );
		$honey = $this->product( 'Honey', '900' );
		$v500  = $this->k->products->saveVariant( $this->ctx, $honey, array( 'name' => '500 g', 'selling_price' => '480' ) )['id'];
		$this->k->products->saveRecipe( $this->ctx, $honey, array( 'mode' => 'pack', 'variant_id' => $v500, 'items' => array( array( 'product_id' => $bulk, 'qty' => '0.5' ) ) ) );
		$this->assertTrue( (bool) $this->k->products->get( $this->ctx, $honey )['track_stock'], 'packed ahead keeps its own stock' );
		$this->assertSame( 'pack', $this->k->products->recipe( $this->ctx, $honey )['mode'] );

		// Pack 5 bottles: 2.5 kg leaves the bulk, 5 bottles at 300 each.
		$r = $this->k->stock->pack( $this->ctx, $honey, $v500, \GoriberHisab\Support\Decimal::of( '5' ) );
		$this->assertMoney( '1500', $r['cost'] );
		$this->assertSame( '17.5000', $this->qty( $bulk ) );
		$this->assertSame( '5.0000', $this->qty( $honey, $v500 ) );
		$this->assertMoney( '0', $this->balance( 'inventory_adjustment' ) );
		$this->assertBooksBalanced( 'packed' );

		// Sell 3: from the packed bottles, bulk untouched.
		$s1 = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $honey, 'variant_id' => $v500, 'qty' => '3' ) ), 'payments' => array( array( 'amount' => '1440' ) ) ) );
		$this->assertMoney( '900', $s1['cost_amount'] );
		$this->assertSame( '2.0000', $this->qty( $honey, $v500 ) );
		$this->assertSame( '17.5000', $this->qty( $bulk ) );

		// Sell 4 with only 2 packed: 2 more are packed from the bulk on the spot.
		$s2 = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $honey, 'variant_id' => $v500, 'qty' => '4' ) ), 'payments' => array( array( 'amount' => '1920' ) ) ) );
		$this->assertMoney( '1200', $s2['cost_amount'] );
		$this->assertSame( '0.0000', $this->qty( $honey, $v500 ) );
		$this->assertSame( '16.5000', $this->qty( $bulk ) );
		$this->assertMoney( '2100', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'auto-packed sale' );

		// Void puts the bottles back as packed bottles.
		$this->k->sales->void( $this->ctx, $s2['id'] );
		$this->assertSame( '4.0000', $this->qty( $honey, $v500 ) );
		// Unpack 1 (packed by mistake): back into the bulk at its cost.
		$this->k->stock->pack( $this->ctx, $honey, $v500, -\GoriberHisab\Support\Decimal::of( '1' ) );
		$this->assertSame( '3.0000', $this->qty( $honey, $v500 ) );
		$this->assertSame( '17.0000', $this->qty( $bulk ) );
		$this->assertBooksBalanced( 'unpacked' );
	}
}
