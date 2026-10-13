<?php
/**
 * Steadfast Courier (packzy) API client.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Orders;

use GoriberHisab\Support\ValidationException;

/**
 * Minimal client for https://portal.packzy.com/api/v1 — book a parcel and
 * read its delivery status. HTTP goes through an injected callable so the
 * class runs without WordPress in tests.
 */
final class Steadfast {

	public const BASE = 'https://portal.packzy.com/api/v1';

	/**
	 * @var callable(string,string,array<string,string>,?string):array{0:int,1:string}
	 */
	private $http;
	private string $key;
	private string $secret;

	/**
	 * @param callable(string,string,array<string,string>,?string):array{0:int,1:string} $http method, url, headers, body → [status, body].
	 */
	public function __construct( callable $http, string $key, string $secret ) {
		$this->http   = $http;
		$this->key    = $key;
		$this->secret = $secret;
	}

	/**
	 * @param array{invoice:string,name:string,phone:string,address:string,cod:string,note:string} $parcel Parcel.
	 * @return array{consignment_id:string,tracking_code:string,status:string}
	 */
	public function book( array $parcel ): array {
		$res = $this->call(
			'POST',
			'/create_order',
			array(
				'invoice'           => $parcel['invoice'],
				'recipient_name'    => $parcel['name'],
				'recipient_phone'   => $parcel['phone'],
				'recipient_address' => $parcel['address'],
				'cod_amount'        => (float) $parcel['cod'],
				'note'              => $parcel['note'],
			)
		);
		$c = is_array( $res['consignment'] ?? null ) ? $res['consignment'] : array();
		if ( empty( $c['consignment_id'] ) ) {
			throw new ValidationException( array(), 'Steadfast: ' . self::message( $res, 'the parcel could not be booked.' ) );
		}
		return array(
			'consignment_id' => (string) $c['consignment_id'],
			'tracking_code'  => (string) ( $c['tracking_code'] ?? '' ),
			'status'         => (string) ( $c['status'] ?? 'in_review' ),
		);
	}

	public function status( string $consignment_id ): string {
		$res = $this->call( 'GET', '/status_by_cid/' . rawurlencode( $consignment_id ), null );
		if ( empty( $res['delivery_status'] ) ) {
			throw new ValidationException( array(), 'Steadfast: ' . self::message( $res, 'status not available.' ) );
		}
		return (string) $res['delivery_status'];
	}

	public function balance(): string {
		$res = $this->call( 'GET', '/get_balance', null );
		if ( ! isset( $res['current_balance'] ) ) {
			throw new ValidationException( array(), 'Steadfast: ' . self::message( $res, 'could not connect. Check the API key and secret.' ) );
		}
		return (string) $res['current_balance'];
	}

	public static function trackingUrl( string $tracking_code ): string {
		return '' !== $tracking_code ? 'https://steadfast.com.bd/t/' . rawurlencode( $tracking_code ) : '';
	}

	/**
	 * @param array<string,mixed>|null $body JSON body.
	 * @return array<string,mixed>
	 */
	private function call( string $method, string $path, ?array $body ): array {
		if ( '' === $this->key || '' === $this->secret ) {
			throw new ValidationException( array(), 'Add your Steadfast API key and secret in Orders → Courier settings first.' );
		}
		list( $status, $raw ) = ( $this->http )(
			$method,
			self::BASE . $path,
			array(
				'Api-Key'      => $this->key,
				'Secret-Key'   => $this->secret,
				'Content-Type' => 'application/json',
				'Accept'       => 'application/json',
			),
			null === $body ? null : (string) json_encode( $body )
		);
		$data = json_decode( $raw, true );
		$data = is_array( $data ) ? $data : array();
		if ( $status < 200 || $status >= 300 || ( isset( $data['status'] ) && 200 !== (int) $data['status'] ) ) {
			throw new ValidationException( array(), 'Steadfast: ' . self::message( $data, 'request failed (HTTP ' . $status . ').' ) );
		}
		return $data;
	}

	/**
	 * @param array<string,mixed> $res Response.
	 */
	private static function message( array $res, string $fallback ): string {
		if ( ! empty( $res['errors'] ) && is_array( $res['errors'] ) ) {
			$first = reset( $res['errors'] );
			return is_array( $first ) ? (string) reset( $first ) : (string) $first;
		}
		return ! empty( $res['message'] ) ? (string) $res['message'] : $fallback;
	}
}
