<?php
/**
 * Minimal PHPUnit-like base class.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tests;

/**
 * Methods named test* are run; setUp() runs before each.
 */
abstract class TestCase {

	public int $assertions = 0;

	public function setUp(): void {
	}

	/**
	 * @param mixed $expected Expected.
	 * @param mixed $actual   Actual.
	 */
	protected function assertSame( $expected, $actual, string $message = '' ): void {
		++$this->assertions;
		if ( $expected !== $actual ) {
			throw new AssertionFailed( ( $message ? $message . ': ' : '' ) . 'expected ' . var_export( $expected, true ) . ', got ' . var_export( $actual, true ) );
		}
	}

	/**
	 * @param mixed $value Value.
	 */
	protected function assertTrue( $value, string $message = '' ): void {
		++$this->assertions;
		if ( true !== $value ) {
			throw new AssertionFailed( $message ?: 'Expected true, got ' . var_export( $value, true ) );
		}
	}

	/**
	 * @param mixed $value Value.
	 */
	protected function assertFalse( $value, string $message = '' ): void {
		++$this->assertions;
		if ( false !== $value ) {
			throw new AssertionFailed( $message ?: 'Expected false, got ' . var_export( $value, true ) );
		}
	}

	/**
	 * Assert that $fn throws $class; returns the exception.
	 *
	 * @template T of \Throwable
	 * @param class-string<T> $class Exception class.
	 * @return T
	 */
	protected function assertThrows( string $class, callable $fn, string $message = '' ): \Throwable {
		++$this->assertions;
		try {
			$fn();
		} catch ( \Throwable $e ) {
			if ( $e instanceof $class ) {
				return $e;
			}
			throw new AssertionFailed( ( $message ? $message . ': ' : '' ) . 'expected ' . $class . ', got ' . get_class( $e ) . ': ' . $e->getMessage() );
		}
		throw new AssertionFailed( ( $message ? $message . ': ' : '' ) . 'expected ' . $class . ' to be thrown' );
	}

	/**
	 * Compare decimal strings numerically ("10.5000" == "10.5").
	 *
	 * @param mixed $expected Expected.
	 * @param mixed $actual   Actual.
	 */
	protected function assertMoney( $expected, $actual, string $message = '' ): void {
		++$this->assertions;
		$e = \BizLedger\Support\Decimal::of( $expected );
		$a = \BizLedger\Support\Decimal::of( $actual );
		if ( $e !== $a ) {
			throw new AssertionFailed( ( $message ? $message . ': ' : '' ) . 'expected ' . \BizLedger\Support\Decimal::toString( $e ) . ', got ' . \BizLedger\Support\Decimal::toString( $a ) );
		}
	}
}
