<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Read one setting, falling back to its default.
 */
function nmo_get( $key ) {
	static $opts = null;
	if ( null === $opts ) {
		$saved = get_option( NMO_OPTION, array() );
		$opts  = wp_parse_args( is_array( $saved ) ? $saved : array(), nmo_defaults() );
	}
	return isset( $opts[ $key ] ) ? $opts[ $key ] : '';
}

/**
 * Split a "lines" setting into rows of trimmed columns.
 */
function nmo_lines( $key, $cols = 1 ) {
	$rows = array();
	foreach ( preg_split( '/\r\n|\r|\n/', (string) nmo_get( $key ) ) as $line ) {
		if ( '' === trim( $line ) ) {
			continue;
		}
		$parts = array_map( 'trim', explode( '|', $line ) );
		$parts = array_pad( $parts, $cols, '' );
		$rows[] = 1 === $cols ? $parts[0] : $parts;
	}
	return $rows;
}

function nmo_to_en_digits( $s ) {
	return strtr( (string) $s, array(
		'০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4',
		'৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9',
	) );
}

function nmo_to_bn_digits( $s ) {
	return strtr( (string) $s, array(
		'0' => '০', '1' => '১', '2' => '২', '3' => '৩', '4' => '৪',
		'5' => '৫', '6' => '৬', '7' => '৭', '8' => '৮', '9' => '৯',
	) );
}

function nmo_num( $n ) {
	$s = number_format( (float) $n, 0, '.', ',' );
	return nmo_get( 'bangla_digits' ) ? nmo_to_bn_digits( $s ) : $s;
}

function nmo_price( $n ) {
	return nmo_num( $n ) . nmo_get( 'currency' );
}

/**
 * Packages as associative arrays.
 */
function nmo_packages() {
	$out = array();
	foreach ( nmo_lines( 'packages', 6 ) as $i => $p ) {
		$out[] = array(
			'id'     => $i + 1,
			'name'   => $p[0],
			'weight' => $p[1],
			'price'  => (float) nmo_to_en_digits( $p[2] ),
			'old'    => (float) nmo_to_en_digits( $p[3] ),
			'badge'  => $p[4],
			'wc'     => absint( nmo_to_en_digits( $p[5] ) ),
		);
	}
	return $out;
}

function nmo_zones() {
	$out = array();
	foreach ( nmo_lines( 'ship_zones', 2 ) as $i => $z ) {
		$out[] = array(
			'id'     => $i + 1,
			'name'   => $z[0],
			'charge' => (float) nmo_to_en_digits( $z[1] ),
		);
	}
	return $out;
}

/**
 * Responsive, lazy image from a media-library ID (or a URL).
 */
function nmo_img( $key, $size = 'large', $attrs = array() ) {
	$val = nmo_get( $key );
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

function nmo_img_url( $key, $size = 'large' ) {
	$val = nmo_get( $key );
	if ( is_numeric( $val ) && $val ) {
		$src = wp_get_attachment_image_url( (int) $val, $size );
		return $src ? $src : '';
	}
	return $val ? esc_url_raw( $val ) : '';
}

function nmo_youtube_id( $url ) {
	if ( preg_match( '~(?:youtu\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{11})~', (string) $url, $m ) ) {
		return $m[1];
	}
	return '';
}

/**
 * Normalise a Bangladeshi mobile number to 01XXXXXXXXX, or '' if invalid.
 */
function nmo_normalize_phone( $phone ) {
	$p = preg_replace( '/[^0-9]/', '', nmo_to_en_digits( $phone ) );
	if ( 0 === strpos( $p, '880' ) ) {
		$p = substr( $p, 2 );
	}
	return preg_match( '/^01[3-9][0-9]{8}$/', $p ) ? $p : '';
}
