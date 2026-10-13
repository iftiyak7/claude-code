<?php
/**
 * Fixed-point decimal arithmetic.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Support;

/**
 * Money and quantities are handled as integers scaled by 10^4.
 *
 * "12.5" => 125000. All arithmetic stays in integers, so no floating point
 * error can creep into financial totals, and bcmath is not required.
 * Rounding is always half away from zero.
 */
final class Decimal {

	public const SCALE  = 4;
	public const FACTOR = 10000;

	/**
	 * Parse a user/database value into a scaled integer.
	 *
	 * @param mixed $value String, int, float or null.
	 * @throws \InvalidArgumentException When the value is not numeric.
	 */
	public static function of( $value ): int {
		if ( null === $value || '' === $value ) {
			return 0;
		}
		if ( is_int( $value ) ) {
			return self::checkedMul( $value, self::FACTOR );
		}
		if ( is_float( $value ) ) {
			if ( ! is_finite( $value ) ) {
				throw new \InvalidArgumentException( 'Non-finite number.' );
			}
			$value = sprintf( '%.6F', $value );
		}
		if ( ! is_string( $value ) ) {
			throw new \InvalidArgumentException( 'Invalid decimal value.' );
		}

		$value = str_replace( array( ',', ' ', '_' ), '', trim( $value ) );
		if ( ! preg_match( '/^([+-]?)(\d*)(?:\.(\d*))?$/', $value, $m ) || ( '' === $m[2] && ( ! isset( $m[3] ) || '' === $m[3] ) ) ) {
			throw new \InvalidArgumentException( sprintf( 'Invalid decimal value "%s".', $value ) );
		}

		$negative = '-' === $m[1];
		$int_part = ltrim( $m[2], '0' );
		$frac     = $m[3] ?? '';
		if ( strlen( $int_part ) > 14 ) {
			throw new \InvalidArgumentException( 'Decimal value out of range.' );
		}

		$frac_main = substr( str_pad( $frac, self::SCALE, '0' ), 0, self::SCALE );
		$result    = (int) ( ( '' === $int_part ? '0' : $int_part ) ) * self::FACTOR + (int) $frac_main;

		// Half-up on the first dropped digit.
		if ( strlen( $frac ) > self::SCALE && (int) $frac[ self::SCALE ] >= 5 ) {
			++$result;
		}

		return $negative ? -$result : $result;
	}

	/**
	 * Format a scaled integer as a plain decimal string ("1234.5000").
	 */
	public static function toString( int $value, int $places = self::SCALE ): string {
		$places   = max( 0, min( self::SCALE, $places ) );
		$value    = self::round( $value, $places );
		$negative = $value < 0;
		$abs      = abs( $value );
		$int      = intdiv( $abs, self::FACTOR );
		$frac     = str_pad( (string) ( $abs % self::FACTOR ), self::SCALE, '0', STR_PAD_LEFT );
		$out      = (string) $int;
		if ( $places > 0 ) {
			$out .= '.' . substr( $frac, 0, $places );
		}
		return ( $negative && 0 !== $value ? '-' : '' ) . $out;
	}

	/**
	 * Convert to float for JSON/presentation only. Never use for arithmetic.
	 */
	public static function toFloat( int $value ): float {
		return $value / self::FACTOR;
	}

	/**
	 * Multiply two scaled values (e.g. qty × price).
	 */
	public static function mul( int $a, int $b ): int {
		$sign = ( $a < 0 ) !== ( $b < 0 ) ? -1 : 1;
		$a    = abs( $a );
		$b    = abs( $b );

		// a = hi·F + lo  =>  a·b/F = hi·b + lo·b/F (keeps intermediates in range).
		$hi       = intdiv( $a, self::FACTOR );
		$lo       = $a % self::FACTOR;
		$whole    = self::checkedMul( $hi, $b );
		$lo_prod  = self::checkedMul( $lo, $b );
		$fraction = intdiv( $lo_prod, self::FACTOR );
		if ( ( $lo_prod % self::FACTOR ) * 2 >= self::FACTOR ) {
			++$fraction;
		}

		return $sign * ( $whole + $fraction );
	}

	/**
	 * Divide two scaled values. Returns a scaled result.
	 *
	 * @throws \DivisionByZeroError When $b is zero.
	 */
	public static function div( int $a, int $b ): int {
		if ( 0 === $b ) {
			throw new \DivisionByZeroError( 'Division by zero.' );
		}
		$sign = ( $a < 0 ) !== ( $b < 0 ) ? -1 : 1;
		$a    = abs( $a );
		$b    = abs( $b );

		$q      = intdiv( $a, $b );
		$r      = $a % $b;
		$result = self::checkedMul( $q, self::FACTOR );

		// Long division for the fractional digits, plus one guard digit for rounding.
		$frac = 0;
		for ( $i = 0; $i < self::SCALE; $i++ ) {
			$r    *= 10;
			$frac  = $frac * 10 + intdiv( $r, $b );
			$r     = $r % $b;
		}
		$guard = intdiv( $r * 10, $b );
		if ( $guard >= 5 ) {
			++$frac;
		}

		return $sign * ( $result + $frac );
	}

	/**
	 * Percentage of an amount: amount × rate / 100.
	 */
	public static function percent( int $amount, int $rate ): int {
		return self::divInt( self::mul( $amount, $rate ), 100 );
	}

	/**
	 * Divide a scaled value by a plain integer with half-up rounding.
	 */
	public static function divInt( int $a, int $n ): int {
		if ( 0 === $n ) {
			throw new \DivisionByZeroError( 'Division by zero.' );
		}
		$sign = ( $a < 0 ) !== ( $n < 0 ) ? -1 : 1;
		$a    = abs( $a );
		$n    = abs( $n );
		$q    = intdiv( $a, $n );
		if ( ( $a % $n ) * 2 >= $n ) {
			++$q;
		}
		return $sign * $q;
	}

	/**
	 * Round a scaled value to a number of decimal places (0..4).
	 */
	public static function round( int $value, int $places ): int {
		$places = max( 0, min( self::SCALE, $places ) );
		if ( self::SCALE === $places ) {
			return $value;
		}
		$step = 10 ** ( self::SCALE - $places );
		return self::divInt( $value, $step ) * $step;
	}

	/**
	 * Split $total across $weights proportionally using the largest
	 * remainder method, so the parts always sum exactly to $total.
	 *
	 * @param int        $total   Scaled amount to distribute.
	 * @param array<int> $weights Scaled weights (non-negative).
	 * @param int        $places  Decimal places of each part.
	 * @return array<int> Parts keyed like $weights.
	 */
	public static function allocate( int $total, array $weights, int $places ): array {
		$parts = array_fill_keys( array_keys( $weights ), 0 );
		$sum   = array_sum( array_map( 'abs', $weights ) );
		if ( 0 === $total || array() === $weights ) {
			return $parts;
		}
		if ( 0 === $sum ) {
			$weights = array_fill_keys( array_keys( $weights ), 1 );
			$sum     = count( $weights );
		}

		$unit      = 10 ** ( self::SCALE - max( 0, min( self::SCALE, $places ) ) );
		$sign      = $total < 0 ? -1 : 1;
		$units     = intdiv( abs( $total ), $unit );
		$remainder = array();
		$assigned  = 0;

		foreach ( $weights as $key => $weight ) {
			// Floats only decide *fairness* of the split; exactness is restored below.
			$exact             = $units * ( abs( $weight ) / $sum );
			$floor             = (int) floor( $exact );
			$parts[ $key ]     = $floor;
			$remainder[ $key ] = $exact - $floor;
			$assigned         += $floor;
		}

		$left = $units - $assigned;
		if ( $left > 0 ) {
			arsort( $remainder );
			foreach ( array_keys( $remainder ) as $key ) {
				if ( $left <= 0 ) {
					break;
				}
				++$parts[ $key ];
				--$left;
			}
		} elseif ( $left < 0 ) {
			asort( $remainder );
			foreach ( array_keys( $remainder ) as $key ) {
				if ( $left >= 0 ) {
					break;
				}
				if ( $parts[ $key ] > 0 ) {
					--$parts[ $key ];
					++$left;
				}
			}
		}

		foreach ( $parts as $key => $p ) {
			$parts[ $key ] = $sign * $p * $unit;
		}
		// Sub-unit dust (when $total isn't a multiple of the unit) goes to the largest part.
		$dust = $total - array_sum( $parts );
		if ( 0 !== $dust ) {
			$max_key           = array_keys( $weights, max( $weights ), true )[0];
			$parts[ $max_key ] += $dust;
		}
		return $parts;
	}

	/**
	 * Sum scaled values.
	 *
	 * @param iterable<int> $values Values.
	 */
	public static function sum( iterable $values ): int {
		$total = 0;
		foreach ( $values as $v ) {
			$total += $v;
		}
		return $total;
	}

	private static function checkedMul( int $a, int $b ): int {
		$r = $a * $b;
		if ( ! is_int( $r ) ) {
			throw new \OverflowException( 'Decimal overflow.' );
		}
		return $r;
	}
}
