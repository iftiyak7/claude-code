<?php
/**
 * JSON helpers.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Support;

/**
 * JSON encode/decode that works inside and outside WordPress.
 */
final class Json {

	/**
	 * @param mixed $value Value.
	 */
	public static function encode( $value ): string {
		$json = function_exists( 'wp_json_encode' )
			? wp_json_encode( $value, JSON_UNESCAPED_UNICODE )
			: json_encode( $value, JSON_UNESCAPED_UNICODE );
		return false === $json ? '' : (string) $json;
	}

	/**
	 * Decode to an array; invalid/empty input yields $default.
	 *
	 * @param mixed               $json    Raw value.
	 * @param array<mixed>        $default Fallback.
	 * @return array<mixed>
	 */
	public static function decode( $json, array $default = array() ): array {
		if ( is_array( $json ) ) {
			return $json;
		}
		if ( ! is_string( $json ) || '' === $json ) {
			return $default;
		}
		$data = json_decode( $json, true );
		return is_array( $data ) ? $data : $default;
	}
}
