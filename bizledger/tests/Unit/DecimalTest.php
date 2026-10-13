<?php
declare(strict_types=1);

namespace BizLedger\Tests\Unit;

use BizLedger\Support\Decimal;
use BizLedger\Tests\TestCase;

final class DecimalTest extends TestCase {

	public function testParsing(): void {
		$this->assertSame( 125000, Decimal::of( '12.5' ) );
		$this->assertSame( -125000, Decimal::of( '-12.5' ) );
		$this->assertSame( 10000, Decimal::of( 1 ) );
		$this->assertSame( 1, Decimal::of( '0.00005' ) ); // half-up on 5th digit
		$this->assertSame( 0, Decimal::of( '0.00004' ) );
		$this->assertSame( 12345678900, Decimal::of( '1,234,567.89' ) );
		$this->assertSame( 3000, Decimal::of( 0.1 + 0.2 ) );
		$this->assertSame( 0, Decimal::of( null ) );
		$this->assertSame( 5000, Decimal::of( '.5' ) );
		$this->assertThrows( \InvalidArgumentException::class, fn() => Decimal::of( 'abc' ) );
		$this->assertThrows( \InvalidArgumentException::class, fn() => Decimal::of( '1.2.3' ) );
	}

	public function testFormatting(): void {
		$this->assertSame( '12.5000', Decimal::toString( 125000 ) );
		$this->assertSame( '12.50', Decimal::toString( 125000, 2 ) );
		$this->assertSame( '-0.01', Decimal::toString( -50, 2 ) );
		$this->assertSame( '13', Decimal::toString( 125000, 0 ) );
		$this->assertSame( '0.00', Decimal::toString( -40, 2 ) );
	}

	public function testMultiplyAndDivide(): void {
		$this->assertSame( Decimal::of( '37.5' ), Decimal::mul( Decimal::of( '2.5' ), Decimal::of( '15' ) ) );
		$this->assertSame( Decimal::of( '0.0001' ), Decimal::mul( Decimal::of( '0.01' ), Decimal::of( '0.005' ) ) ); // 0.00005 rounds up
		$this->assertSame( Decimal::of( '-37.5' ), Decimal::mul( Decimal::of( '-2.5' ), Decimal::of( '15' ) ) );
		// Large values stay exact: 1,000,000 qty × 99,999.9999 price.
		$this->assertSame( '99999999900.0000', Decimal::toString( Decimal::mul( Decimal::of( '1000000' ), Decimal::of( '99999.9999' ) ) ) );
		$this->assertSame( Decimal::of( '3.3333' ), Decimal::div( Decimal::of( 10 ), Decimal::of( 3 ) ) );
		$this->assertSame( Decimal::of( '6.6667' ), Decimal::div( Decimal::of( 20 ), Decimal::of( 3 ) ) );
		$this->assertSame( Decimal::of( '-0.5' ), Decimal::div( Decimal::of( -1 ), Decimal::of( 2 ) ) );
		$this->assertSame( Decimal::of( '15' ), Decimal::percent( Decimal::of( 100 ), Decimal::of( 15 ) ) );
	}

	public function testRounding(): void {
		$this->assertSame( Decimal::of( '1.24' ), Decimal::round( Decimal::of( '1.235' ), 2 ) );
		$this->assertSame( Decimal::of( '-1.24' ), Decimal::round( Decimal::of( '-1.235' ), 2 ) );
		$this->assertSame( Decimal::of( '2' ), Decimal::round( Decimal::of( '1.5' ), 0 ) );
	}

	public function testAllocateAlwaysSumsExactly(): void {
		$parts = Decimal::allocate( Decimal::of( '10' ), array( Decimal::of( 1 ), Decimal::of( 1 ), Decimal::of( 1 ) ), 2 );
		$this->assertSame( Decimal::of( '10' ), array_sum( $parts ) );
		$this->assertSame( array( Decimal::of( '3.34' ), Decimal::of( '3.33' ), Decimal::of( '3.33' ) ), array_values( $parts ) );

		$parts = Decimal::allocate( Decimal::of( '0.05' ), array( 'a' => Decimal::of( 70 ), 'b' => Decimal::of( 30 ) ), 2 );
		$this->assertSame( Decimal::of( '0.05' ), array_sum( $parts ) );
		$this->assertSame( Decimal::of( '0.04' ), $parts['a'] );

		$parts = Decimal::allocate( Decimal::of( '-7' ), array( Decimal::of( 2 ), Decimal::of( 5 ) ), 2 );
		$this->assertSame( Decimal::of( '-7' ), array_sum( $parts ) );

		$parts = Decimal::allocate( Decimal::of( '9' ), array( 0, 0, 0 ), 2 );
		$this->assertSame( Decimal::of( '9' ), array_sum( $parts ) );

		for ( $i = 0; $i < 200; $i++ ) {
			$weights = array();
			for ( $j = 0, $n = random_int( 1, 9 ); $j < $n; $j++ ) {
				$weights[] = random_int( 0, 10000000 );
			}
			$total = random_int( 0, 100000000 );
			$this->assertSame( $total, array_sum( Decimal::allocate( $total, $weights, 4 ) ), 'random allocation sums' );
		}
	}
}
