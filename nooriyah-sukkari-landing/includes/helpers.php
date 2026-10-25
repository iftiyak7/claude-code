<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Read one setting, falling back to its default.
 */
function nsl_get( $key ) {
	static $opts = null;
	if ( null === $opts ) {
		$saved = get_option( NSL_OPTION, array() );
		$opts  = wp_parse_args( is_array( $saved ) ? $saved : array(), nsl_defaults() );
	}
	return isset( $opts[ $key ] ) ? $opts[ $key ] : '';
}

/**
 * Split a "lines" setting into rows of trimmed columns.
 */
function nsl_lines( $key, $cols = 1 ) {
	$rows = array();
	foreach ( preg_split( '/\r\n|\r|\n/', (string) nsl_get( $key ) ) as $line ) {
		if ( '' === trim( $line ) ) {
			continue;
		}
		$parts = array_map( 'trim', explode( '|', $line ) );
		$parts = array_pad( $parts, $cols, '' );
		$rows[] = 1 === $cols ? $parts[0] : $parts;
	}
	return $rows;
}

function nsl_to_en_digits( $s ) {
	return strtr( (string) $s, array(
		'০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4',
		'৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9',
	) );
}

function nsl_to_bn_digits( $s ) {
	return strtr( (string) $s, array(
		'0' => '০', '1' => '১', '2' => '২', '3' => '৩', '4' => '৪',
		'5' => '৫', '6' => '৬', '7' => '৭', '8' => '৮', '9' => '৯',
	) );
}

function nsl_num( $n ) {
	$s = number_format( (float) $n, 0, '.', ',' );
	return nsl_get( 'bangla_digits' ) ? nsl_to_bn_digits( $s ) : $s;
}

function nsl_price( $n ) {
	return nsl_num( $n ) . nsl_get( 'currency' );
}

/**
 * Packages as associative arrays.
 */
function nsl_packages() {
	$out = array();
	foreach ( nsl_lines( 'packages', 6 ) as $i => $p ) {
		$out[] = array(
			'id'     => $i + 1,
			'name'   => $p[0],
			'weight' => $p[1],
			'price'  => (float) nsl_to_en_digits( $p[2] ),
			'old'    => (float) nsl_to_en_digits( $p[3] ),
			'badge'  => $p[4],
			'wc'     => absint( nsl_to_en_digits( $p[5] ) ),
		);
	}
	return $out;
}

function nsl_zones() {
	$out = array();
	foreach ( nsl_lines( 'ship_zones', 2 ) as $i => $z ) {
		$out[] = array(
			'id'     => $i + 1,
			'name'   => $z[0],
			'charge' => (float) nsl_to_en_digits( $z[1] ),
		);
	}
	return $out;
}

/**
 * Responsive, lazy image from a media-library ID (or a URL).
 */
function nsl_img( $key, $size = 'large', $attrs = array() ) {
	$val = nsl_get( $key );
	if ( ! $val ) {
		return '';
	}
	$attrs = wp_parse_args( $attrs, array( 'loading' => 'lazy', 'decoding' => 'async' ) );
	if ( is_numeric( $val ) ) {
		return wp_get_attachment_image( (int) $val, $size, false, $attrs );
	}
	$html = '<img src="' . esc_url( $val ) . '"';
	foreach ( $attrs as $k => $v ) {
		$html .= ' ' . esc_attr( $k ) . '="' . esc_attr( $v ) . '"';
	}
	return $html . '>';
}

function nsl_img_url( $key, $size = 'large' ) {
	$val = nsl_get( $key );
	if ( is_numeric( $val ) && $val ) {
		$src = wp_get_attachment_image_url( (int) $val, $size );
		return $src ? $src : '';
	}
	return $val ? esc_url_raw( $val ) : '';
}

function nsl_youtube_id( $url ) {
	if ( preg_match( '~(?:youtu\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{11})~', (string) $url, $m ) ) {
		return $m[1];
	}
	return '';
}

/**
 * Normalise a Bangladeshi mobile number to 01XXXXXXXXX, or '' if invalid.
 */
function nsl_normalize_phone( $phone ) {
	$p = preg_replace( '/[^0-9]/', '', nsl_to_en_digits( $phone ) );
	if ( 0 === strpos( $p, '880' ) ) {
		$p = substr( $p, 2 );
	}
	return preg_match( '/^01[3-9][0-9]{8}$/', $p ) ? $p : '';
}
