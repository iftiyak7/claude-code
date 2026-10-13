<?php
/**
 * Code 128 barcode as SVG.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Support;

/**
 * Minimal Code 128 (subset B) encoder producing an SVG string. Used on
 * printed invoices and product labels; scanners read it as plain text.
 */
final class Barcode {

	/**
	 * Bar/space widths for symbols 0..106.
	 */
	private const PATTERNS = array(
		'212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
		'221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
		'221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
		'212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
		'231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
		'231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
		'314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
		'112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
		'111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
		'214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
		'114131', '311141', '411131', '211412', '211214', '211232', '2331112',
	);

	public static function svg( string $text, int $height = 40, float $module = 1.4 ): string {
		$text = preg_replace( '/[^\x20-\x7E]/', '', $text ) ?? '';
		if ( '' === $text ) {
			return '';
		}
		$codes    = array( 104 ); // Start B.
		$checksum = 104;
		foreach ( str_split( $text ) as $i => $ch ) {
			$code      = ord( $ch ) - 32;
			$codes[]   = $code;
			$checksum += $code * ( $i + 1 );
		}
		$codes[] = $checksum % 103;
		$codes[] = 106; // Stop.

		$x    = 10 * $module; // Quiet zone.
		$bars = '';
		foreach ( $codes as $code ) {
			$pattern = self::PATTERNS[ $code ];
			foreach ( str_split( $pattern ) as $j => $w ) {
				$width = (int) $w * $module;
				if ( 0 === $j % 2 ) {
					$bars .= sprintf( '<rect x="%.2F" y="0" width="%.2F" height="%d"/>', $x, $width, $height );
				}
				$x += $width;
			}
		}
		$total = $x + 10 * $module;
		return sprintf(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.2F %d" width="%.2F" height="%d" role="img" aria-label="%s"><g fill="#000">%s</g></svg>',
			$total,
			$height,
			$total,
			$height,
			htmlspecialchars( $text, ENT_QUOTES ),
			$bars
		);
	}
}
