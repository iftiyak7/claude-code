<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Unit;

use GoriberHisab\Support\Decimal as D;
use GoriberHisab\Support\DocumentCalculator;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\TestCase;

final class DocumentCalculatorTest extends TestCase {

	private function line( string $qty, string $price, array $extra = array() ): array {
		return array_merge( array( 'qty' => D::of( $qty ), 'unit_price' => D::of( $price ) ), $extra );
	}

	public function testSimpleTotals(): void {
		$r = DocumentCalculator::calculate( array( $this->line( '2', '50' ), $this->line( '1', '25.50' ) ), array(), 2 );
		$this->assertSame( D::of( '125.50' ), $r['subtotal'] );
		$this->assertSame( D::of( '125.50' ), $r['total'] );
		$this->assertSame( D::of( '125.50' ), $r['net'] );
	}

	public function testLineAndDocumentDiscountAllocation(): void {
		$r = DocumentCalculator::calculate(
			array(
				$this->line( '1', '100', array( 'discount_type' => 'percent', 'discount_value' => D::of( 10 ) ) ),
				$this->line( '3', '10' ),
			),
			array( 'discount_type' => 'fixed', 'discount_value' => D::of( 12 ), 'shipping' => D::of( 5 ) ),
			2
		);
		$this->assertSame( D::of( 120 ), $r['subtotal'] );
		$this->assertSame( D::of( 12 ), $r['discount'] );
		// Allocation 90:30 => 9 : 3
		$this->assertSame( D::of( 9 ), $r['lines'][0]['doc_discount'] );
		$this->assertSame( D::of( 3 ), $r['lines'][1]['doc_discount'] );
		$this->assertSame( D::of( 108 ), $r['net'] );
		$this->assertSame( D::of( 113 ), $r['total'] );
	}

	public function testExclusiveAndInclusiveTax(): void {
		$r = DocumentCalculator::calculate(
			array(
				$this->line( '1', '100', array( 'tax_rate' => D::of( 15 ) ) ),
				$this->line( '1', '115', array( 'tax_rate' => D::of( 15 ), 'tax_inclusive' => true ) ),
			),
			array(),
			2
		);
		$this->assertSame( D::of( 15 ), $r['lines'][0]['tax_amount'] );
		$this->assertSame( D::of( 115 ), $r['lines'][0]['total'] );
		$this->assertSame( D::of( 15 ), $r['lines'][1]['tax_amount'] );
		$this->assertSame( D::of( 100 ), $r['lines'][1]['net_amount'] );
		$this->assertSame( D::of( 115 ), $r['lines'][1]['total'] );
		$this->assertSame( D::of( 230 ), $r['total'] );
		$this->assertSame( $r['total'], $r['net'] + $r['tax'] + $r['shipping'] );
	}

	public function testTotalsAlwaysReconcile(): void {
		for ( $i = 0; $i < 300; $i++ ) {
			$lines = array();
			for ( $j = 0, $n = random_int( 1, 6 ); $j < $n; $j++ ) {
				$lines[] = array(
					'qty'            => random_int( 1, 50000 ),
					'unit_price'     => random_int( 0, 5000000 ),
					'discount_type'  => 'percent',
					'discount_value' => random_int( 0, 300000 ),
					'tax_rate'       => array( 0, 50000, 75000, 150000 )[ random_int( 0, 3 ) ],
					'tax_inclusive'  => (bool) random_int( 0, 1 ),
				);
			}
			$r = DocumentCalculator::calculate( $lines, array( 'discount_type' => 'percent', 'discount_value' => random_int( 0, 500000 ), 'shipping' => random_int( 0, 100000 ) ), 2 );
			$this->assertSame( $r['total'], $r['net'] + $r['tax'] + $r['shipping'] + $r['other'], 'total = net + tax + charges' );
			$this->assertSame( $r['discount'], array_sum( array_column( $r['lines'], 'doc_discount' ) ), 'doc discount fully allocated' );
		}
	}

	public function testValidation(): void {
		$e = $this->assertThrows( ValidationException::class, fn() => DocumentCalculator::calculate( array( $this->line( '0', '10' ) ), array(), 2 ) );
		$this->assertTrue( isset( $e->errors()['items.0.qty'] ) );
		$this->assertThrows( ValidationException::class, fn() => DocumentCalculator::calculate( array( $this->line( '1', '10', array( 'discount_value' => D::of( 11 ) ) ) ), array(), 2 ) );
		$this->assertThrows( ValidationException::class, fn() => DocumentCalculator::calculate( array( $this->line( '1', '10' ) ), array( 'discount_type' => 'percent', 'discount_value' => D::of( 101 ) ), 2 ) );
	}
}
