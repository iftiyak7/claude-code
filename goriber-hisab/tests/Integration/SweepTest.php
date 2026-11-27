<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Tests\IntegrationTestCase;

/**
 * Regression tests for the November bug sweep: numbers a shop owner reads.
 */
final class SweepTest extends IntegrationTestCase {

	public function testLowStockIsPerSize(): void {
		$shirt = $this->product( 'Shirt', '500', '300', '0', array( 'min_stock' => '5' ) );
		$m     = $this->k->products->saveVariant( $this->ctx, $shirt, array( 'name' => 'M', 'selling_price' => '500', 'opening_qty' => '6' ) )['id'];
		$this->k->products->saveVariant( $this->ctx, $shirt, array( 'name' => 'L', 'selling_price' => '500', 'opening_qty' => '20' ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $shirt, 'variant_id' => $m, 'qty' => '6' ) ), 'payments' => array( array( 'amount' => '3000' ) ) ) );

		$d = $this->k->reports->dashboard( $this->ctx, array( 'range' => 'today' ) );
		$this->assertSame( 1, $d['low_stock'], 'size M is out even though L has 20' );
		$this->assertSame( 'Shirt - M', $d['low_items'][0]['name'] );
		$lights = $this->k->stock->lights( $this->ctx );
		$this->assertSame( 1, $lights['counts']['red'] );
		$low = $this->k->stock->levels( $this->ctx, array( 'low' => 1 ) );
		$this->assertSame( 1, $low['total'] );
		$this->assertSame( 'Shirt - M', $low['items'][0]['name'] );
		// The alert names the size.
		$n = $this->k->notifications->inbox( $this->ctx, array() );
		$this->assertTrue( (bool) array_filter( $n['items'], static fn( $x ) => false !== strpos( (string) $x['title'], 'Shirt - M' ) ) );
	}

	public function testProfitIsAfterReturns(): void {
		$p    = $this->product( 'Ghee', '500', '300', '10' );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '500' ) ) ) );
		$this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $sale['items'][0]['id'], 'qty' => '1' ) ), 'refund_amount' => '500', 'refund_account_id' => $this->account( 'cash' ) ) );
		$this->assertMoney( '0', $this->k->sales->get( $this->ctx, $sale['id'] )['gross_profit'] );
		$this->assertMoney( '0', $this->k->sales->get( $this->ctx, $sale['id'] )['items'][0]['profit'] );
		$this->assertMoney( '0', $this->k->reports->invoiceProfit( $this->ctx, array( 'range' => 'today' ) )['items'][0]['profit'] );
		$list = $this->k->sales->list( $this->ctx, array() );
		$this->assertMoney( '0', $list['items'][0]['profit'] );
		$this->assertMoney( '0', $list['summary']['profit'] );
		$rep = $this->k->reports->sales( $this->ctx, array( 'range' => 'today', 'group_by' => 'product' ) );
		$this->assertMoney( '0', $rep['totals']['profit'] );
	}

	public function testAllSalesTotalsSkipVoided(): void {
		$p = $this->product( 'Oil', '1000', '800', '10' );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '1000' ) ) ) );
		$v = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '1000' ) ) ) );
		$this->k->sales->void( $this->ctx, $v['id'] );
		$all = $this->k->sales->list( $this->ctx, array( 'status' => 'any' ) );
		$this->assertSame( 2, $all['total'], 'both rows listed' );
		$this->assertMoney( '1000', $all['summary']['total'], 'voided one not counted' );
		$this->assertSame( 1, $all['summary']['count'] );
	}

	public function testDrilldownCountsEverySale(): void {
		$p = $this->product( 'Pen', '10', '5', '1000' );
		for ( $i = 0; $i < 305; $i++ ) {
			$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '10' ) ) ) );
		}
		$d = $this->k->reports->drilldown( $this->ctx, array( 'metric' => 'sales', 'range' => 'today' ) );
		$this->assertSame( '305', $d['summary'][0]['value'] );
		$this->assertMoney( '3050', $d['summary'][1]['value'] );
	}

	public function testSlowMoversCountRecipeIngredients(): void {
		$cashew = $this->product( 'Cashew', '1500', '1200', '10' );
		$idle   = $this->product( 'Idle thing', '100', '50', '3' );
		$nut    = $this->product( 'Honey nut', '2000' );
		$this->k->products->saveRecipe( $this->ctx, $nut, array( 'items' => array( array( 'product_id' => $cashew, 'qty' => '0.5' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $nut, 'qty' => '8' ) ), 'payments' => array( array( 'amount' => '16000' ) ) ) );
		$slow = $this->k->reports->slowMovers( $this->ctx, array() );
		$this->assertSame( 'Idle thing', $slow[0]['name'] );
		$byName = array_column( $slow, 'sold', 'name' );
		$this->assertMoney( '4', $byName['Cashew'], 'used in 8 honey nuts' );
	}

	/** Inventory account must always equal the value of the stock on the shelf. */
	private function assertStockMatchesBooks( string $label ): void {
		$st = $this->db->table( 'stock_levels' );
		$v  = \GoriberHisab\Support\Decimal::toString( \GoriberHisab\Support\Decimal::of( $this->db->value( "SELECT COALESCE(SUM(value),0) FROM {$st} WHERE business_id = %d", array( $this->ctx->business_id ) ) ) );
		$this->assertMoney( $v, $this->balance( 'inventory' ), $label . ': inventory account = stock value' );
		$this->assertBooksBalanced( $label );
	}

	public function testSellingIntoMinusThenBuying(): void {
		$this->k->settings->update( $this->ctx, array( 'inventory.allow_negative' => true ) );
		$p   = $this->product( 'Rice', '120', '0' );
		$sup = $this->supplier( 'Mill' );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '5' ) ), 'payments' => array( array( 'amount' => '600' ) ) ) );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $sup, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '100' ) ) ) );
		$this->assertSame( '5.0000', $this->qty( $p ) );
		$this->assertMoney( '500', $this->balance( 'inventory' ), 'the 5 left cost 100 each, not 200' );
		$this->assertMoney( '500', $this->balance( 'cogs' ), 'the 5 sold earlier got their cost' );
		$this->k->stock->repairZeroCosts( $this->ctx );
		$this->assertMoney( '500', $this->balance( 'cogs' ), 'repair adds nothing more' );
		$this->assertStockMatchesBooks( 'minus then buy' );
	}

	public function testRepairIgnoresProductsWithoutStock(): void {
		$p   = $this->product( 'Service-like', '200', '0', '0', array( 'track_stock' => false ) );
		$sup = $this->supplier( 'Maker' );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $sup, 'items' => array( array( 'product_id' => $p, 'qty' => '1', 'unit_price' => '100' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '200' ) ) ) );
		$before = $this->balance( 'cogs' );
		$this->k->stock->repairZeroCosts( $this->ctx );
		$this->assertMoney( $before, $this->balance( 'cogs' ), 'not counted twice' );
		$this->assertBooksBalanced( 'untracked repair' );
	}

	public function testCancelAdjustmentAfterPricesMoved(): void {
		$p   = $this->product( 'Soap', '50', '10' );
		$sup = $this->supplier( 'Unilever' );
		$this->k->stock->adjust( $this->ctx, array( 'product_id' => $p, 'mode' => 'add', 'qty' => '5', 'unit_cost' => '10', 'reason' => 'Found' ) );
		$e  = $this->db->table( 'journal_entries' );
		$id = (int) $this->db->value( "SELECT MAX(id) FROM {$e} WHERE business_id = %d AND source = 'stock_adjustment'", array( $this->ctx->business_id ) );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $sup, 'items' => array( array( 'product_id' => $p, 'qty' => '5', 'unit_price' => '20' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '5' ) ), 'payments' => array( array( 'amount' => '250' ) ) ) );
		$this->k->stock->voidAdjustment( $this->ctx, $id );
		$this->assertSame( '0.0000', $this->qty( $p ) );
		$this->assertStockMatchesBooks( 'cancelled adjustment' );
	}

	public function testVoidPurchaseAfterMostWasSold(): void {
		$p   = $this->product( 'Lentil', '150', '0' );
		$sup = $this->supplier( 'Trader' );
		$a   = $this->k->purchases->create( $this->ctx, array( 'supplier_id' => $sup, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '100' ) ) ) );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $sup, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '1' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '9' ) ), 'payments' => array( array( 'amount' => '1350' ) ) ) );
		$this->k->purchases->void( $this->ctx, $a['id'] );
		$st = $this->db->table( 'stock_levels' );
		$this->assertTrue( \GoriberHisab\Support\Decimal::of( $this->db->value( "SELECT value FROM {$st} WHERE product_id = %d", array( $p ) ) ) >= 0, 'no negative stock value' );
		$this->assertStockMatchesBooks( 'void purchase' );
	}

	public function testVoidFollowsWhatTheSaleDidNotTodaysSetting(): void {
		$p    = $this->product( 'Candle', '20', '12', '5' );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '5' ) ), 'payments' => array( array( 'amount' => '100' ) ) ) );
		$this->k->products->update( $this->ctx, $p, array( 'track_stock' => false ) );
		$this->k->sales->void( $this->ctx, $sale['id'] );
		$this->assertStockMatchesBooks( 'tracked then untracked' );

		$q    = $this->product( 'Gift wrap', '10', '0', '0', array( 'track_stock' => false ) );
		$s2   = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $q, 'qty' => '3' ) ), 'payments' => array( array( 'amount' => '30' ) ) ) );
		$this->k->products->update( $this->ctx, $q, array( 'track_stock' => true ) );
		$this->k->sales->void( $this->ctx, $s2['id'] );
		$this->assertSame( '0.0000', $this->qty( $q ), 'no stock appears from nowhere' );
		$this->assertStockMatchesBooks( 'untracked then tracked' );
	}

	public function testEditKeepsTaxAndSeller(): void {
		$tax  = $this->k->taxes->save( $this->ctx, array( 'name' => 'VAT 10', 'rate' => '10' ) );
		$this->k->settings->update( $this->ctx, array( 'tax.enabled' => true ) );
		$p    = $this->product( 'Phone case', '1000', '600', '10', array( 'tax_rate_id' => $tax['id'] ) );
		$w    = $this->k->workers->save( $this->ctx, array( 'role' => 'seller', 'name' => 'Rahim' ) );
		$sale = $this->k->sales->create( $this->ctx, array( 'seller_id' => $w['id'], 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '1100' ) ) ) );
		$this->assertMoney( '1100', $sale['total'] );
		// The product's tax changes later; editing only the note keeps what was charged.
		$this->k->products->update( $this->ctx, $p, array( 'tax_rate_id' => 0 ) );
		$e = $this->k->sales->update( $this->ctx, $sale['id'], array( 'notes' => 'gift wrap' ) );
		$this->assertMoney( '1100', $e['total'] );
		$this->assertSame( $w['id'], $e['seller_id'], 'still Rahim\'s sale' );
		$this->assertBooksBalanced( 'edit keeps tax' );
	}
}
