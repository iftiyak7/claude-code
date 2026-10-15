<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

final class PurchaseInventoryTest extends IntegrationTestCase {

	public function testPurchaseWithLandedCostAndPartialPayment(): void {
		$a = $this->product( 'Item A', '50', '0' );
		$b = $this->product( 'Item B', '100', '0' );
		$s = $this->supplier( 'Dhaka Traders' );

		$pur = $this->k->purchases->create(
			$this->ctx,
			array(
				'supplier_id'      => $s,
				'supplier_invoice' => 'DT-778',
				'items'            => array(
					array( 'product_id' => $a, 'qty' => '10', 'unit_price' => '30' ),
					array( 'product_id' => $b, 'qty' => '5', 'unit_price' => '60' ),
				),
				'shipping_amount'  => '60',
				'other_cost'       => '0',
				'payments'         => array( array( 'amount' => '400', 'account_id' => $this->account( 'cash' ) ) ),
			)
		);
		$this->assertSame( 'PUR-000001', $pur['number'] );
		$this->assertMoney( '660', $pur['total'] );
		$this->assertMoney( '260', $pur['due_amount'] );
		$this->assertSame( 'partial', $pur['payment_status'] );
		// Shipping 60 split 300:300 => 30 each.
		$this->assertMoney( '330', $pur['items'][0]['landed_cost'] );
		$this->assertMoney( '33', $pur['items'][0]['unit_cost'] );
		$this->assertMoney( '660', $this->balance( 'inventory' ) );
		$this->assertMoney( '260', $this->balance( 'payable', $s ) );
		$this->assertMoney( '-400', $this->balance( 'cash' ) );
		$this->assertBooksBalanced( 'purchase' );

		// Weighted average after a second, dearer purchase.
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $s, 'items' => array( array( 'product_id' => $a, 'qty' => '10', 'unit_price' => '37' ) ) ) );
		$this->assertMoney( '35', Decimal::toString( $this->k->stock->averageCost( $this->ctx, $a ) ) );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $a, 'qty' => '4' ) ), 'payments' => array( array( 'amount' => '200' ) ) ) );
		$this->assertMoney( '140', $sale['cost_amount'] );

		// Supplier payment settles oldest purchase first.
		$this->k->payments->pay( $this->ctx, array( 'contact_id' => $s, 'account_id' => $this->account( 'bank' ), 'amount' => '300' ) );
		$this->assertMoney( '0', $this->k->purchases->get( $this->ctx, $pur['id'] )['due_amount'] );
		$this->assertMoney( '330', $this->balance( 'payable', $s ) );
		$this->assertBooksBalanced( 'supplier payment' );
	}

	public function testNonRecoverableTaxIsCapitalised(): void {
		$this->k->settings->update( $this->ctx, array( 'tax.enabled' => true, 'tax.purchase_recoverable' => false ) );
		$rate = $this->k->taxes->save( $this->ctx, array( 'name' => 'VAT', 'rate' => '10' ) );
		$p    = $this->product( 'Taxed', '200', '0', '0', array( 'tax_rate_id' => $rate['id'] ) );
		$s    = $this->supplier( 'Sup' );
		$pur  = $this->k->purchases->create( $this->ctx, array( 'supplier_id' => $s, 'items' => array( array( 'product_id' => $p, 'qty' => '2', 'unit_price' => '100' ) ) ) );
		$this->assertMoney( '220', $pur['total'] );
		$this->assertMoney( '220', $this->balance( 'inventory' ) );
		$this->assertMoney( '0', $this->balance( 'tax_input' ) );
		$this->assertBooksBalanced( 'non-recoverable' );
	}

	public function testPurchaseVoidAndVarianceAfterPartialSale(): void {
		$p  = $this->product( 'Widget', '30', '0' );
		$s  = $this->supplier( 'W Co' );
		$p1 = $this->k->purchases->create( $this->ctx, array( 'supplier_id' => $s, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '10' ) ) ) );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $s, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '20' ) ) ) );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '10' ) ), 'payments' => array( array( 'amount' => '300' ) ) ) );
		// 10 left at avg 15 = 150. Voiding first purchase (value 100) empties stock.
		$this->k->purchases->void( $this->ctx, $p1['id'] );
		$this->assertSame( '0.0000', $this->qty( $p ) );
		$this->assertMoney( '0', $this->balance( 'inventory' ) );
		$this->assertMoney( '50', $this->balance( 'inventory_adjustment' ), 'sold goods really cost 50 more: variance loss' );
		$this->assertMoney( '200', $this->balance( 'payable', $s ) );
		$this->assertBooksBalanced( 'void with variance' );

		// Voiding the second purchase now would go negative.
		$this->assertThrows( ValidationException::class, fn() => $this->k->purchases->void( $this->ctx, $p1['id'] + 1 ) );
	}

	public function testPurchaseReturnWithRefundAndVariance(): void {
		$p   = $this->product( 'Cable', '50', '0' );
		$s   = $this->supplier( 'Cable Co' );
		$pur = $this->k->purchases->create( $this->ctx, array( 'supplier_id' => $s, 'items' => array( array( 'product_id' => $p, 'qty' => '10', 'unit_price' => '20' ) ), 'shipping_amount' => '50' ) );
		$this->assertMoney( '25', $pur['items'][0]['unit_cost'] );
		$ret = $this->k->returns->create( $this->ctx, 'purchase', array( 'document_id' => $pur['id'], 'items' => array( array( 'item_id' => $pur['items'][0]['id'], 'qty' => '2' ) ), 'refund_amount' => '40', 'refund_account_id' => $this->account( 'cash' ) ) );
		$this->assertMoney( '40', $ret['total'] );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		// Inventory leaves at avg 25 (=50); supplier credits 40 → 10 loss.
		$this->assertMoney( '200', $this->balance( 'inventory' ) );
		$this->assertMoney( '10', $this->balance( 'inventory_adjustment' ) );
		$this->assertMoney( '250', $this->balance( 'payable', $s ) );
		$this->assertMoney( '40', $this->balance( 'cash' ) );
		$this->assertBooksBalanced( 'purchase return' );

		$this->assertThrows( ConflictException::class, fn() => $this->k->purchases->update( $this->ctx, $pur['id'], array( 'notes' => 'x' ) ) );
		$this->k->returns->void( $this->ctx, $ret['id'] );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertMoney( '250', $this->balance( 'inventory' ) );
		$this->assertBooksBalanced( 'purchase return void' );
	}

	public function testPurchaseEditAndDraft(): void {
		$p     = $this->product( 'Flour', '60', '0' );
		$s     = $this->supplier( 'Mill' );
		$draft = $this->k->purchases->create( $this->ctx, array( 'status' => 'draft', 'supplier_id' => $s, 'items' => array( array( 'product_id' => $p, 'qty' => '5', 'unit_price' => '40' ) ) ) );
		$this->assertSame( 'draft', $draft['status'] );
		$this->assertSame( '0.0000', $this->qty( $p ) );
		$done = $this->k->purchases->update( $this->ctx, $draft['id'], array( 'status' => 'completed', 'items' => array( array( 'product_id' => $p, 'qty' => '6', 'unit_price' => '40' ) ) ) );
		$this->assertSame( 'completed', $done['status'] );
		$this->assertSame( 'PUR-000001', $done['number'] );
		$this->assertSame( '6.0000', $this->qty( $p ) );

		$edit = $this->k->purchases->update( $this->ctx, $draft['id'], array( 'items' => array( array( 'product_id' => $p, 'qty' => '8', 'unit_price' => '40' ) ), 'payments' => array( array( 'amount' => '100' ) ) ) );
		$this->assertMoney( '320', $edit['total'] );
		$this->assertMoney( '220', $edit['due_amount'] );
		$this->assertSame( '8.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'purchase edit' );
	}

	public function testStockAdjustmentsAndLowStockNotification(): void {
		$p = $this->product( 'Egg', '12', '10', '20', array( 'min_stock' => '5' ) );
		$this->k->stock->adjust( $this->ctx, array( 'product_id' => $p, 'mode' => 'remove', 'qty' => '3', 'reason' => 'Broken' ) );
		$this->assertSame( '17.0000', $this->qty( $p ) );
		$this->assertMoney( '30', $this->balance( 'inventory_adjustment' ) );
		$this->k->stock->adjust( $this->ctx, array( 'product_id' => $p, 'mode' => 'set', 'qty' => '4', 'reason' => 'Count' ) );
		$this->assertSame( '4.0000', $this->qty( $p ) );
		$low = $this->k->stock->levels( $this->ctx, array( 'low' => 1 ) );
		$this->assertSame( 1, $low['total'] );
		$this->assertMoney( '4', $low['items'][0]['qty'] );
		$this->assertTrue( $low['items'][0]['is_low'] );
		$this->assertSame( 1, $this->k->reports->dashboard( $this->ctx, array() )['low_stock'] );
		$inbox = $this->k->notifications->inbox( $this->ctx );
		$this->assertSame( 1, $inbox['unread'] );
		$this->assertSame( 'low_stock', $inbox['items'][0]['type'] );
		$this->k->stock->adjust( $this->ctx, array( 'product_id' => $p, 'mode' => 'add', 'qty' => '6', 'unit_cost' => '11', 'reason' => 'Found' ) );
		$this->assertSame( '10.0000', $this->qty( $p ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->stock->adjust( $this->ctx, array( 'product_id' => $p, 'mode' => 'add', 'qty' => '1' ) ) );
		$moves = $this->k->stock->movements( $this->ctx, array( 'product_id' => $p ) );
		$this->assertSame( 4, $moves['total'] );
		$this->assertMoney( '4', $moves['items'][0]['qty_before'] );
		$this->assertMoney( '10', $moves['items'][0]['qty_after'] );
		$this->assertBooksBalanced( 'adjustments' );
	}

	public function testVariantsHaveSeparateStock(): void {
		$p  = $this->product( 'T-Shirt', '500', '300' );
		$vm = $this->k->products->saveVariant( $this->ctx, $p, array( 'attributes' => array( 'size' => 'M', 'color' => 'Red' ), 'barcode' => '111', 'opening_qty' => '5' ) );
		$vl = $this->k->products->saveVariant( $this->ctx, $p, array( 'attributes' => array( 'size' => 'L' ), 'selling_price' => '550', 'opening_qty' => '3' ) );
		$this->assertSame( 'M / Red', $vm['name'] );
		$this->assertSame( '5.0000', $this->qty( $p, $vm['id'] ) );

		$found = $this->k->products->findByCode( $this->ctx, '111' );
		$this->assertSame( $vm['id'], $found['variant']['id'] );

		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '500' ) ) ) ) );
		$this->assertTrue( str_contains( $e->getMessage(), 'variant' ) );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'variant_id' => $vl['id'], 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '550' ) ) ) );
		$this->assertMoney( '550', $sale['total'] );
		$this->assertSame( '2.0000', $this->qty( $p, $vl['id'] ) );
		$this->assertSame( 'T-Shirt - L', $sale['items'][0]['name'] );
		$this->assertBooksBalanced( 'variants' );
	}

	public function testBarcodesGeneratedAndLabelled(): void {
		$a  = $this->product( 'Soap', '40' );
		$b  = $this->product( 'Shirt', '500', '0', '0', array( 'barcode' => 'KEEP1' ) );
		$vm = $this->k->products->saveVariant( $this->ctx, $b, array( 'attributes' => array( 'size' => 'M' ) ) );
		$vl = $this->k->products->saveVariant( $this->ctx, $b, array( 'attributes' => array( 'size' => 'L' ), 'selling_price' => '550', 'barcode' => 'L-1' ) );
		$done = $this->k->products->generateBarcodes( $this->ctx );
		$this->assertSame( array( 'products' => 1, 'variants' => 1 ), $done );
		$soap = $this->k->products->get( $this->ctx, $a );
		$this->assertSame( \GoriberHisab\Catalog\ProductService::internalBarcode( $a ), $soap['barcode'] );
		$this->assertSame( 13, strlen( $soap['barcode'] ) );
		$this->assertSame( 'KEEP1', $this->k->products->get( $this->ctx, $b )['barcode'] );
		$this->assertSame( $a, $this->k->products->findByCode( $this->ctx, $soap['barcode'] )['product']['id'] );
		$this->assertSame( array( 'products' => 0, 'variants' => 0 ), $this->k->products->generateBarcodes( $this->ctx ) );

		$items = $this->k->products->labelItems( $this->ctx, array( $b, $a ) );
		$this->assertSame( 3, count( $items ) );
		$this->assertSame( $vm['id'], $items[0]['variant_id'] );
		$this->assertSame( '29', substr( $items[0]['code'], 0, 2 ) );
		$this->assertMoney( '500', $items[0]['price'] );
		$this->assertSame( 'L-1', $items[1]['code'] );
		$this->assertMoney( '550', $items[1]['price'] );
		$this->assertSame( 'Soap', $items[2]['name'] );
	}

	public function testServiceProductsSkipStock(): void {
		$svc  = $this->product( 'Repair', '300', '0', '0', array( 'type' => 'service' ) );
		$sale = $this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $svc, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '600' ) ) ) );
		$this->assertMoney( '0', $sale['cost_amount'] );
		$this->assertSame( '0.0000', $this->qty( $svc ) );
		$this->assertBooksBalanced( 'service' );
	}

	public function testNegativeStockWhenAllowed(): void {
		$this->k->settings->update( $this->ctx, array( 'inventory.allow_negative' => true ) );
		$p = $this->product( 'Pre-order', '100', '60', '1' );
		$this->k->sales->create( $this->ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '3' ) ), 'payments' => array( array( 'amount' => '300' ) ) ) );
		$this->assertSame( '-2.0000', $this->qty( $p ) );
		$this->assertMoney( '180', $this->balance( 'cogs' ) );
		$this->k->purchases->create( $this->ctx, array( 'supplier_id' => $this->supplier( 'X' ), 'items' => array( array( 'product_id' => $p, 'qty' => '5', 'unit_price' => '60' ) ) ) );
		$this->assertSame( '3.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'negative stock' );
	}
}
