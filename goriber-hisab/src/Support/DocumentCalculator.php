<?php
/**
 * Totals engine for sales and purchases.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Support;

/**
 * Computes every amount on a sales/purchase document on the server.
 *
 * Per line:
 *   gross        = qty × unit_price                    (rounded to currency)
 *   line discount= fixed amount, or percent of gross   (≤ gross)
 *   after_line   = gross − line discount
 * Document discount (fixed or percent of Σ after_line) is allocated across
 * lines in proportion to after_line (largest remainder), so per-line
 * revenue/profit is exact and Σ always equals the header.
 *   base         = after_line − doc share
 *   exclusive tax: tax = base × r%;  net = base;       total = base + tax
 *   inclusive tax: tax = base − base/(1+r%); net = base − tax; total = base
 * Document:
 *   subtotal = Σ after_line, discount = doc discount, tax = Σ tax,
 *   total    = Σ line total + shipping + other charges
 *   net      = Σ net  (revenue/cost excluding tax and charges)
 *
 * All inputs/outputs are Decimal-scaled integers.
 */
final class DocumentCalculator {

	/**
	 * @param array<int,array{qty:int,unit_price:int,discount_type?:string,discount_value?:int,tax_rate?:int,tax_inclusive?:bool}> $lines
	 * @param array{discount_type?:string,discount_value?:int,shipping?:int,other?:int} $doc
	 * @param int $places Currency decimal places.
	 * @return array{lines:array<int,array<string,int>>,subtotal:int,discount:int,tax:int,shipping:int,other:int,net:int,total:int}
	 * @throws ValidationException On impossible values.
	 */
	public static function calculate( array $lines, array $doc, int $places ): array {
		$out    = array();
		$after  = array();
		$errors = array();

		foreach ( $lines as $i => $line ) {
			$qty   = (int) $line['qty'];
			$price = (int) $line['unit_price'];
			if ( $qty <= 0 ) {
				$errors[ "items.{$i}.qty" ] = 'Quantity must be greater than zero.';
				continue;
			}
			if ( $price < 0 ) {
				$errors[ "items.{$i}.unit_price" ] = 'Price cannot be negative.';
				continue;
			}
			$gross = Decimal::round( Decimal::mul( $qty, $price ), $places );
			$disc  = self::discount( $line['discount_type'] ?? 'fixed', (int) ( $line['discount_value'] ?? 0 ), $gross, $places );
			if ( $disc < 0 ) {
				$errors[ "items.{$i}.discount_value" ] = 'Discount cannot be negative.';
				continue;
			}
			if ( $disc > $gross ) {
				$errors[ "items.{$i}.discount_value" ] = 'Discount cannot exceed the line amount.';
				continue;
			}
			$out[ $i ]   = array(
				'qty'             => $qty,
				'unit_price'      => $price,
				'gross'           => $gross,
				'discount_amount' => $disc,
				'tax_rate'        => max( 0, (int) ( $line['tax_rate'] ?? 0 ) ),
				'tax_inclusive'   => ! empty( $line['tax_inclusive'] ) ? 1 : 0,
			);
			$after[ $i ] = $gross - $disc;
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		$subtotal = Decimal::sum( $after );
		$doc_disc = self::discount( $doc['discount_type'] ?? 'fixed', (int) ( $doc['discount_value'] ?? 0 ), $subtotal, $places );
		if ( $doc_disc < 0 ) {
			throw ValidationException::field( 'discount_value', 'Discount cannot be negative.' );
		}
		if ( $doc_disc > $subtotal ) {
			throw ValidationException::field( 'discount_value', 'Discount cannot exceed the subtotal.' );
		}
		$shares = Decimal::allocate( $doc_disc, $after, $places );

		$tax_total = 0;
		$net_total = 0;
		$sum_total = 0;
		foreach ( $out as $i => &$l ) {
			$base = $after[ $i ] - $shares[ $i ];
			$rate = $l['tax_rate'];
			if ( $rate > 0 && $l['tax_inclusive'] ) {
				$net = Decimal::round( Decimal::div( $base, Decimal::of( 1 ) + Decimal::divInt( $rate, 100 ) ), $places );
				$tax = $base - $net;
				$tot = $base;
			} else {
				$tax = $rate > 0 ? Decimal::round( Decimal::percent( $base, $rate ), $places ) : 0;
				$net = $base;
				$tot = $base + $tax;
			}
			$l['doc_discount'] = $shares[ $i ];
			$l['tax_amount']   = $tax;
			$l['net_amount']   = $net;
			$l['total']        = $tot;
			$tax_total        += $tax;
			$net_total        += $net;
			$sum_total        += $tot;
		}
		unset( $l );

		$shipping = Decimal::round( (int) ( $doc['shipping'] ?? 0 ), $places );
		$other    = Decimal::round( (int) ( $doc['other'] ?? 0 ), $places );
		if ( $shipping < 0 ) {
			throw ValidationException::field( 'shipping_amount', 'Shipping cannot be negative.' );
		}
		if ( $other < 0 ) {
			throw ValidationException::field( 'other_cost', 'Other cost cannot be negative.' );
		}

		return array(
			'lines'    => $out,
			'subtotal' => $subtotal,
			'discount' => $doc_disc,
			'tax'      => $tax_total,
			'shipping' => $shipping,
			'other'    => $other,
			'net'      => $net_total,
			'total'    => $sum_total + $shipping + $other,
		);
	}

	private static function discount( string $type, int $value, int $base, int $places ): int {
		if ( 0 === $value ) {
			return 0;
		}
		if ( 'percent' === $type ) {
			if ( $value > Decimal::of( 100 ) ) {
				return $base + 1; // Triggers the "exceeds" validation.
			}
			return Decimal::round( Decimal::percent( $base, $value ), $places );
		}
		return Decimal::round( $value, $places );
	}
}
