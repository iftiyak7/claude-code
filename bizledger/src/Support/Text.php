<?php
/**
 * Input normalisation helpers.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Support;

/**
 * WordPress-independent sanitisation used by domain services. Controllers
 * still sanitise with WP functions; services re-normalise because they can
 * be called from other entry points (CLI, imports, add-ons).
 */
final class Text {

	/**
	 * Single-line plain text: strips tags, control chars, collapses spaces.
	 *
	 * @param mixed $value Raw.
	 */
	public static function line( $value, int $max = 191 ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$value = strip_tags( (string) $value );
		$value = preg_replace( '/[\x00-\x1F\x7F]+/u', ' ', $value ) ?? '';
		$value = trim( preg_replace( '/\s+/u', ' ', $value ) ?? '' );
		return mb_substr( $value, 0, $max );
	}

	/**
	 * Multi-line plain text.
	 *
	 * @param mixed $value Raw.
	 */
	public static function multiline( $value, int $max = 5000 ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$value = strip_tags( (string) $value );
		$value = str_replace( "\r\n", "\n", $value );
		$value = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $value ) ?? '';
		return mb_substr( trim( $value ), 0, $max );
	}

	/**
	 * Machine key: lowercase a-z0-9_ .-
	 *
	 * @param mixed $value Raw.
	 */
	public static function key( $value, int $max = 64 ): string {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		return substr( (string) preg_replace( '/[^a-z0-9_.\-]/', '', strtolower( (string) $value ) ), 0, $max );
	}

	/**
	 * Validate an email; returns '' when invalid.
	 *
	 * @param mixed $value Raw.
	 */
	public static function email( $value ): string {
		$value = self::line( $value, 100 );
		return '' === $value || false === filter_var( $value, FILTER_VALIDATE_EMAIL ) ? '' : $value;
	}

	/**
	 * Phone: digits, + - space ( ).
	 *
	 * @param mixed $value Raw.
	 */
	public static function phone( $value ): string {
		return self::line( preg_replace( '/[^0-9+\-() ]/', '', is_scalar( $value ) ? (string) $value : '' ), 30 );
	}

	/**
	 * URL (http/https only).
	 *
	 * @param mixed $value Raw.
	 */
	public static function url( $value ): string {
		$value = self::line( $value, 255 );
		if ( '' === $value ) {
			return '';
		}
		if ( ! preg_match( '#^https?://#i', $value ) ) {
			$value = 'https://' . $value;
		}
		return false === filter_var( $value, FILTER_VALIDATE_URL ) ? '' : $value;
	}

	/**
	 * Strict Y-m-d date or null.
	 *
	 * @param mixed $value Raw.
	 */
	public static function date( $value ): ?string {
		if ( ! is_string( $value ) || ! preg_match( '/^(\d{4})-(\d{2})-(\d{2})/', $value, $m ) ) {
			return null;
		}
		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ? "{$m[1]}-{$m[2]}-{$m[3]}" : null;
	}

	/**
	 * RFC 4122 v4 UUID (validated) or null.
	 *
	 * @param mixed $value Raw.
	 */
	public static function uuid( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}
		$value = strtolower( trim( $value ) );
		return preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $value ) ? $value : null;
	}

	public static function newUuid(): string {
		$b    = random_bytes( 16 );
		$b[6] = chr( ord( $b[6] ) & 0x0f | 0x40 );
		$b[8] = chr( ord( $b[8] ) & 0x3f | 0x80 );
		return vsprintf( '%s%s-%s-%s-%s-%s%s%s', str_split( bin2hex( $b ), 4 ) );
	}

	/**
	 * Boolean from common representations.
	 *
	 * @param mixed $value Raw.
	 */
	public static function bool( $value ): bool {
		return filter_var( $value, FILTER_VALIDATE_BOOLEAN );
	}
}
