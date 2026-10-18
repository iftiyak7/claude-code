<?php
/**
 * Amount in words, South-Asian style (lakh / crore), in English or Bangla:
 * 125050.50 → "One Lakh Twenty Five Thousand Fifty Taka and Fifty Paisa Only"
 *           → "এক লক্ষ পঁচিশ হাজার পঞ্চাশ টাকা পঞ্চাশ পয়সা মাত্র".
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Support;

/**
 * Number to words.
 */
final class NumberWords {

	private const EN_ONES = array( '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen' );
	private const EN_TENS = array( '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety' );

	/** 0–99 in Bangla (each is its own word). */
	private const BN = array( 'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়', 'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ', 'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'উনত্রিশ', 'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'উনচল্লিশ', 'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ', 'পঞ্চাশ', 'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট', 'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর', 'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনআশি', 'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'উননব্বই', 'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই' );

	/**
	 * @param string|int|float $amount Decimal string preferred.
	 */
	public static function money( $amount, string $lang = 'en' ): string {
		$s = number_format( abs( (float) $amount ), 2, '.', '' );
		list( $int, $frac ) = explode( '.', $s );
		$taka  = (int) $int;
		$paisa = (int) $frac;
		if ( 'bn' === $lang ) {
			$out = ( 0 === $taka ? self::BN[0] : self::bn( $taka ) ) . ' টাকা';
			if ( $paisa ) {
				$out .= ' ' . self::BN[ $paisa ] . ' পয়সা';
			}
			return $out . ' মাত্র';
		}
		$out = ( 0 === $taka ? 'Zero' : self::en( $taka ) ) . ' Taka';
		if ( $paisa ) {
			$out .= ' and ' . self::en( $paisa ) . ' Paisa';
		}
		return $out . ' Only';
	}

	private static function en( int $n ): string {
		$parts = array();
		foreach ( array( array( 10000000, 'Crore' ), array( 100000, 'Lakh' ), array( 1000, 'Thousand' ), array( 100, 'Hundred' ) ) as list( $size, $word ) ) {
			if ( $n >= $size ) {
				$parts[] = self::en( intdiv( $n, $size ) ) . ' ' . $word;
				$n      %= $size;
			}
		}
		if ( $n > 0 ) {
			$parts[] = $n < 20 ? self::EN_ONES[ $n ] : trim( self::EN_TENS[ intdiv( $n, 10 ) ] . ' ' . self::EN_ONES[ $n % 10 ] );
		}
		return implode( ' ', $parts );
	}

	private static function bn( int $n ): string {
		$parts = array();
		foreach ( array( array( 10000000, 'কোটি' ), array( 100000, 'লক্ষ' ), array( 1000, 'হাজার' ), array( 100, 'শত' ) ) as list( $size, $word ) ) {
			if ( $n >= $size ) {
				$parts[] = self::bn( intdiv( $n, $size ) ) . ' ' . $word;
				$n      %= $size;
			}
		}
		if ( $n > 0 ) {
			$parts[] = self::BN[ $n ];
		}
		return implode( ' ', $parts );
	}
}
