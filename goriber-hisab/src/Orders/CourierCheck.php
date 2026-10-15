<?php
/**
 * Customer delivery history across Bangladeshi couriers (Pathao, Steadfast,
 * RedX, Paperfly…) from a courier-check service such as BD Courier.
 *
 * The endpoint and key are set by the site owner. Responses differ between
 * providers, so the reader looks for any object carrying parcel counts
 * (total / success / cancelled) and treats its key as the courier name.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Orders;

use GoriberHisab\Support\ValidationException;

/**
 * Courier history client.
 */
final class CourierCheck {

	public const DEFAULT_URL = 'https://api.bdcourier.com/courier-check';

	/** @var callable */
	private $http;
	private string $url;
	private string $key;

	/**
	 * @param callable(string,string,array<string,string>,?string):array{0:int,1:string} $http Transport.
	 */
	public function __construct( callable $http, string $url, string $key ) {
		$this->http = $http;
		$this->url  = '' !== trim( $url ) ? trim( $url ) : self::DEFAULT_URL;
		$this->key  = $key;
	}

	/**
	 * @return array<int,array{name:string,total:int,delivered:int,cancelled:int}>
	 */
	public function check( string $phone ): array {
		list( $status, $body ) = ( $this->http )(
			'POST',
			$this->url,
			array(
				'Authorization' => 'Bearer ' . $this->key,
				'Accept'        => 'application/json',
				'Content-Type'  => 'application/json',
			),
			(string) json_encode( array( 'phone' => $phone ) )
		);
		$json = json_decode( (string) $body, true );
		if ( $status < 200 || $status >= 300 || ! is_array( $json ) ) {
			$msg = is_array( $json ) ? (string) ( $json['message'] ?? $json['error'] ?? '' ) : '';
			throw new ValidationException( array(), 'Courier check failed' . ( $status ? " (HTTP {$status})" : '' ) . ( '' !== $msg ? ': ' . $msg : '. Check the service address and key.' ) );
		}
		return self::read( $json );
	}

	/**
	 * Pull per-courier counts out of any reasonably shaped response.
	 *
	 * @param array<mixed> $json Decoded body.
	 * @return array<int,array{name:string,total:int,delivered:int,cancelled:int}>
	 */
	public static function read( array $json ): array {
		$out = array();
		$walk = static function ( $node, string $name, int $depth ) use ( &$walk, &$out ): void {
			if ( ! is_array( $node ) || $depth > 5 ) {
				return;
			}
			$counts = self::counts( $node );
			if ( null !== $counts ) {
				$label = isset( $node['name'] ) && is_string( $node['name'] ) ? $node['name'] : ( isset( $node['courier'] ) && is_string( $node['courier'] ) ? $node['courier'] : $name );
				if ( ! preg_match( '/^(summary|total|overall|all|\d+)$/i', $label ) ) {
					$out[ strtolower( $label ) ] = array( 'name' => ucfirst( $label ) ) + $counts;
				}
				return;
			}
			foreach ( $node as $k => $child ) {
				$walk( $child, (string) $k, $depth + 1 );
			}
		};
		$walk( $json, '', 0 );
		return array_values( array_filter( $out, static fn( $c ) => $c['total'] > 0 || $c['delivered'] > 0 || $c['cancelled'] > 0 ) );
	}

	/**
	 * @param array<mixed> $n Object.
	 * @return array{total:int,delivered:int,cancelled:int}|null
	 */
	private static function counts( array $n ): ?array {
		$pick = static function ( array $keys ) use ( $n ): ?int {
			foreach ( $keys as $k ) {
				if ( isset( $n[ $k ] ) && is_numeric( $n[ $k ] ) ) {
					return (int) $n[ $k ];
				}
			}
			return null;
		};
		$total     = $pick( array( 'total_parcel', 'total_parcels', 'total', 'total_order', 'total_orders', 'total_delivery' ) );
		$delivered = $pick( array( 'success_parcel', 'success_parcels', 'success', 'delivered', 'delivered_parcel', 'successful', 'success_delivery' ) );
		$cancelled = $pick( array( 'cancelled_parcel', 'cancelled_parcels', 'cancel', 'cancelled', 'canceled', 'returned', 'cancel_parcel', 'failed' ) );
		if ( null === $delivered && null === $cancelled ) {
			return null;
		}
		$delivered = (int) $delivered;
		$cancelled = (int) $cancelled;
		return array(
			'total'     => max( (int) $total, $delivered + $cancelled ),
			'delivered' => $delivered,
			'cancelled' => $cancelled,
		);
	}
}
