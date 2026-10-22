<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

/**
 * End-to-end: purchase → sale → partial payment → collection → return → void,
 * with every accounting invariant re-checked after each step.
 */
final class SalesFlowTest extends IntegrationTestCase {

	public function testBusinessSetupSeedsLedger(): void {
		$this->assertTrue( $this->account( 'cash' ) > 0 );
		$this->assertSame( 'owner', $this->ctx->role );
		$this->assertBooksBalanced( 'fresh business' );
	}

	public function testOpeningStockAndBalances(): void {
		$p = $this->product( 'Rice 1kg', '80', '60', '10' );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertMoney( '600', $this->balance( 'inventory' ) );
		$c = $this->customer( 'Karim', '500' );
		$s = $this->supplier( 'Wholesaler', '1200' );
		$this->assertMoney( '500', $this->balance( 'receivable', $c ) );
		$this->assertMoney( '1200', $this->balance( 'payable', $s ) );
		$this->assertMoney( '-100', $this->balance( 'opening_balance' ), 'OBE = 600 + 500 - 1200' );
		$this->assertBooksBalanced( 'openings' );

		// Changing the opening balance re-posts it.
		$this->k->contacts->update( $this->ctx, 'customer', $c, array( 'opening_balance' => '300' ) );
		$this->assertMoney( '300', $this->balance( 'receivable', $c ) );
		$this->assertBooksBalanced( 'opening edited' );
	}

	public function testCashSaleWithCogs(): void {
		$p    = $this->product( 'Pen', '20', '12', '100' );
		$sale = $this->k->sales->create(
			$this->ctx,
			array(
				'items'    => array( array( 'product_id' => $p, 'qty' => '5' ) ),
				'payments' => array( array( 'amount' => '100' ) ),
			)
		);
		$this->assertSame( 'completed', $sale['status'] );
		$this->assertSame( 'INV-000001', $sale['number'] );
		$this->assertSame( 'paid', $sale['payment_status'] );
		$this->assertMoney( '100', $sale['total'] );
		$this->assertMoney( '60', $sale['cost_amount'] );
		$this->assertMoney( '40', $sale['gross_profit'] );
		$this->assertSame( '95.0000', $this->qty( $p ) );
		$this->assertMoney( '100', $this->balance( 'cash' ) );
		$this->assertMoney( '100', $this->balance( 'sales' ) );
		$this->assertMoney( '60', $this->balance( 'cogs' ) );
		$this->assertMoney( '0', $this->balance( 'receivable' ) );
		$this->assertBooksBalanced( 'cash sale' );
	}

	public function testCreditSaleCollectionAndFifoAllocation(): void {
		$p = $this->product( 'Soap', '50', '30', '50' );
		$c = $this->customer( 'Rahim' );

		$s1 = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '4' ) ), 'payments' => array( array( 'amount' => '50' ) ) ) );
		$s2 = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ) ) );
		$this->assertSame( 'partial', $s1['payment_status'] );
		$this->assertMoney( '150', $s1['due_amount'] );
		$this->assertSame( 'due', $s2['payment_status'] );
		$this->assertMoney( '250', $this->balance( 'receivable', $c ) );
		$this->assertBooksBalanced( 'credit sales' );

		// Collect 200: FIFO pays s1 (150) then 50 of s2.
		$pay = $this->k->payments->receive( $this->ctx, array( 'contact_id' => $c, 'account_id' => $this->account( 'bank' ), 'amount' => '200', 'reference' => 'TRX-1' ) );
		$this->assertSame( 2, count( $pay['allocations'] ) );
		$this->assertSame( 'paid', $this->k->sales->get( $this->ctx, $s1['id'] )['payment_status'] );
		$this->assertMoney( '50', $this->k->sales->get( $this->ctx, $s2['id'] )['due_amount'] );
		$this->assertMoney( '50', $this->balance( 'receivable', $c ) );
		$this->assertMoney( '200', $this->balance( 'bank' ) );
		$this->assertBooksBalanced( 'collection' );

		// Overpay → advance (negative customer balance).
		$this->k->payments->receive( $this->ctx, array( 'contact_id' => $c, 'account_id' => $this->account( 'cash' ), 'amount' => '80' ) );
		$this->assertMoney( '-30', $this->balance( 'receivable', $c ) );
		$this->assertSame( 'paid', $this->k->sales->get( $this->ctx, $s2['id'] )['payment_status'] );
		$this->assertBooksBalanced( 'advance' );

		// Voiding the collection restores dues.
		$this->k->payments->void( $this->ctx, $pay['id'] );
		$this->assertMoney( '170', $this->balance( 'receivable', $c ) );
		$this->assertBooksBalanced( 'payment void' );
	}

	public function testSplitPaymentAndWalkInRules(): void {
		$p = $this->product( 'Bag', '1000', '700', '5' );
		$sale = $this->k->sales->create(
			$this->ctx,
			array(
				'items'    => array( array( 'product_id' => $p, 'qty' => '1' ) ),
				'payments' => array(
					array( 'amount' => '600', 'account_id' => $this->account( 'cash' ) ),
					array( 'amount' => '400', 'account_id' => $this->account( 'mobile' ), 'reference' => 'bKash 01700' ),
				),
			)
		);
		$this->assertSame( 2, count( $sale['payments'] ) );
		$this->assertMoney( '400', $this->balance( 'mobile' ) );

		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '500' ) ) ) ) );
		$this->assertTrue( isset( $e->errors()['customer_id'] ), 'walk-in credit refused' );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '1500' ) ) ) ) );
		$this->assertSame( '4.0000', $this->qty( $p ), 'failed sales leave stock untouched (transaction rolled back)' );
		$this->assertBooksBalanced( 'split' );
	}

	public function testInsufficientStockIsRejected(): void {
		$p = $this->product( 'Phone', '15000', '12000', '1' );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '30000' ) ) ) ) );
		$this->assertTrue( str_contains( $e->getMessage(), 'Not enough stock' ) );
		$this->assertSame( '1.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'rejected' );
	}

	public function testDiscountsAndTax(): void {
		$this->k->settings->update( $this->ctx, array( 'tax.enabled' => true ) );
		$this->k->taxes->save( $this->ctx, array( 'name' => 'VAT 15%', 'rate' => '15', 'is_default' => true ) );
		$p    = $this->product( 'Shirt', '1000', '600', '10' );
		$c    = $this->customer( 'Nadia' );
		$sale = $this->k->sales->create(
			$this->ctx,
			array(
				'customer_id'     => $c,
				'items'           => array( array( 'product_id' => $p, 'qty' => '2', 'discount_type' => 'percent', 'discount_value' => '10' ) ),
				'discount_value'  => '100',
				'shipping_amount' => '60',
			)
		);
		// 2000 - 200 line - 100 doc = 1700 net; tax 255; +60 shipping
		$this->assertMoney( '1800', $sale['subtotal'] );
		$this->assertMoney( '255', $sale['tax_amount'] );
		$this->assertMoney( '2015', $sale['total'] );
		$this->assertMoney( '1700', $this->balance( 'sales' ) );
		$this->assertMoney( '255', $this->balance( 'tax_output' ) );
		$this->assertMoney( '60', $this->balance( 'shipping_income' ) );
		$this->assertMoney( '2015', $this->balance( 'receivable', $c ) );
		$this->assertBooksBalanced( 'tax' );
	}

	public function testHeldSaleHasNoEffectsUntilCompleted(): void {
		$p    = $this->product( 'Tea', '10', '6', '20' );
		$held = $this->k->sales->create( $this->ctx, array( 'status' => 'held', 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ) ) );
		$this->assertSame( 'held', $held['status'] );
		$this->assertSame( 'HELD-' . $held['id'], $held['number'] );
		$this->assertSame( '20.0000', $this->qty( $p ) );
		$this->assertMoney( '0', $this->balance( 'sales' ) );

		$done = $this->k->sales->complete( $this->ctx, $held['id'], array( 'items' => array( array( 'product_id' => $p, 'qty' => '4' ) ), 'payments' => array( array( 'amount' => '40' ) ) ) );
		$this->assertSame( 'completed', $done['status'] );
		$this->assertSame( 'INV-000001', $done['number'] );
		$this->assertSame( '16.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'held → completed' );
	}

	public function testEditCompletedSaleReversesAndReposts(): void {
		$p    = $this->product( 'Milk', '90', '70', '30' );
		$c    = $this->customer( 'Sumi' );
		$sale = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '5' ) ), 'payments' => array( array( 'amount' => '200' ) ) ) );
		$this->k->payments->receive( $this->ctx, array( 'contact_id' => $c, 'account_id' => $this->account( 'cash' ), 'amount' => '100' ) );
		$this->assertMoney( '150', $this->balance( 'receivable', $c ) );

		$edited = $this->k->sales->update( $this->ctx, $sale['id'], array( 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ) ) );
		$this->assertSame( $sale['number'], $edited['number'], 'number kept' );
		$this->assertMoney( '270', $edited['total'] );
		$this->assertSame( '27.0000', $this->qty( $p ) );
		$this->assertMoney( '-30', $this->balance( 'receivable', $c ), 'customer now has 30 advance' );
		$this->assertMoney( '0', $edited['due_amount'] );
		$this->assertMoney( '210', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'edit' );

		// Replace tenders explicitly.
		$edited = $this->k->sales->update( $this->ctx, $sale['id'], array( 'items' => array( array( 'product_id' => $p, 'qty' => '6' ) ), 'payments' => array( array( 'amount' => '540' ) ) ) );
		$this->assertMoney( '540', $edited['total'] );
		$this->assertBooksBalanced( 'edit with tenders' );
	}

	public function testVoidSaleRestoresEverything(): void {
		$p    = $this->product( 'Oil', '200', '150', '10' );
		$c    = $this->customer( 'Jamal' );
		$sale = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ), 'payments' => array( array( 'amount' => '100' ) ) ) );
		$this->k->sales->void( $this->ctx, $sale['id'], 'Customer cancelled' );
		$after = $this->k->sales->get( $this->ctx, $sale['id'] );
		$this->assertSame( 'void', $after['status'] );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertMoney( '0', $this->balance( 'receivable', $c ) );
		$this->assertMoney( '0', $this->balance( 'cash' ) );
		$this->assertMoney( '0', $this->balance( 'sales' ) );
		$this->assertMoney( '0', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'void' );
	}

	public function testSalesReturnWithRefund(): void {
		$p    = $this->product( 'Shoe', '1200', '800', '10' );
		$c    = $this->customer( 'Tania' );
		$sale = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ), 'discount_value' => '300', 'payments' => array( array( 'amount' => '3300' ) ) ) );
		$item = $sale['items'][0];

		$ret = $this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => '1' ) ), 'refund_amount' => '1100', 'refund_account_id' => $this->account( 'cash' ) ) );
		$this->assertMoney( '1100', $ret['total'], 'pro-rata of discounted line' );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		$this->assertMoney( '1100', $this->balance( 'sales_returns' ) );
		$this->assertMoney( '1600', $this->balance( 'cogs' ) );
		$this->assertMoney( '2200', $this->balance( 'cash' ) );
		$this->assertMoney( '0', $this->balance( 'receivable', $c ) );
		$this->assertBooksBalanced( 'return + refund' );

		$this->assertThrows( ValidationException::class, fn() => $this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => '3' ) ) ) ) );
		$this->assertThrows( ConflictException::class, fn() => $this->k->sales->void( $this->ctx, $sale['id'] ) );

		// Return remaining 2 without refund → customer credit.
		$this->k->returns->create( $this->ctx, 'sale', array( 'document_id' => $sale['id'], 'items' => array( array( 'item_id' => $item['id'], 'qty' => '2' ) ) ) );
		$this->assertMoney( '-2200', $this->balance( 'receivable', $c ) );
		$this->assertMoney( '3300', $this->balance( 'sales_returns' ), 'full line reversed exactly' );
		$this->assertBooksBalanced( 'full return' );

		// Void the first return.
		$this->k->returns->void( $this->ctx, $ret['id'] );
		$this->assertSame( '9.0000', $this->qty( $p ) );
		$this->assertMoney( '2', $this->k->sales->get( $this->ctx, $sale['id'] )['items'][0]['returned_qty'] );
		$this->assertBooksBalanced( 'return void' );
	}

	public function testProfitAndLossMatchesLedger(): void {
		$p = $this->product( 'Book', '500', '300', '20' );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '4' ) ), 'payments' => array( array( 'amount' => '2000' ) ) ) );
		$rent = $this->k->accounts->list( $this->ctx, array( 'type' => 'expense', 'search' => 'Rent' ) )[0]['id'];
		$this->k->finance->create( $this->ctx, 'expense', array( 'account_id' => $rent, 'amount' => '300', 'description' => 'March rent' ) );
		$svc = $this->k->accounts->list( $this->ctx, array( 'type' => 'income', 'search' => 'Service' ) )[0]['id'];
		$this->k->finance->create( $this->ctx, 'income', array( 'account_id' => $svc, 'amount' => '150' ) );

		$pl = $this->k->reports->profitLoss( $this->ctx, array( 'range' => 'this_month' ) );
		$this->assertMoney( '2000', $pl['total_revenue'] );
		$this->assertMoney( '1200', $pl['total_cogs'] );
		$this->assertMoney( '800', $pl['gross_profit'] );
		$this->assertMoney( '150', $pl['total_other_income'] );
		$this->assertMoney( '300', $pl['total_expenses'] );
		$this->assertMoney( '650', $pl['net_profit'] );
		$this->assertSame( '40.00', $pl['gross_margin'] );

		$dash = $this->k->reports->dashboard( $this->ctx, array( 'range' => 'today' ) );
		$this->assertMoney( '2000', $dash['today']['sales'] );
		$this->assertMoney( '650', $dash['today']['profit'] );
		$this->assertMoney( '1850', $dash['overview']['cash_balance'] );
		$this->assertMoney( '4800', $dash['overview']['stock_value'] );
		$this->assertBooksBalanced( 'p&l' );
	}

	public function testLooseItemsSoldByWeight(): void {
		$p = $this->product( 'Badam (loose)', '1200', '900', '5' ); // per kg, 5 kg in stock
		// 250 g.
		$a = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '0.25' ) ), 'payments' => array( array( 'amount' => '300' ) ) ) );
		$this->assertMoney( '300', $a['total'] );
		$this->assertMoney( '225', $a['cost_amount'] );
		// "৳50 worth": the POS sends 0.0417 kg (rounded up) with the paisa difference as discount.
		$b = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '0.0417', 'discount_value' => '0.04' ) ), 'payments' => array( array( 'amount' => '50' ) ) ) );
		$this->assertMoney( '50', $b['total'] );
		$this->assertSame( '4.7083', $this->qty( $p ) );
		$this->assertBooksBalanced( 'loose items' );
	}

	public function testVoidedSaleCanBeRestored(): void {
		$p    = $this->product( 'Honey 500 g', '300', '220', '10' );
		$c    = $this->customer( 'Mina' );
		$sale = $this->k->sales->create( $this->ctx, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '600' ) ) ) );
		$this->k->sales->void( $this->ctx, $sale['id'], 'by mistake' );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$back = $this->k->sales->restore( $this->ctx, $sale['id'] );
		$this->assertSame( 'completed', $back['status'] );
		$this->assertSame( $sale['number'], $back['number'] );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		$this->assertMoney( '600', $back['due_amount'], 'old payment stays cancelled' );
		$this->assertMoney( '600', $this->balance( 'receivable', $c ) );
		$this->assertMoney( '440', $this->balance( 'cogs' ) );
		$this->assertBooksBalanced( 'restored' );
		$this->assertThrows( ConflictException::class, fn() => $this->k->sales->restore( $this->ctx, $sale['id'] ) );
	}
}
