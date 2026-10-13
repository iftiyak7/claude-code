<?php
/**
 * Optional AI reading of pasted order messages (Anthropic Claude API).
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Orders;

/**
 * Sends the message and the shop's product list to Claude and gets back the
 * order fields as JSON that matches a schema (structured outputs).
 *
 * Raw HTTP through the injected transport (WordPress HTTP API in
 * production): the plugin ships without Composer, so the PHP SDK is not
 * bundled. Any failure returns null and the caller falls back to the
 * built-in OrderParser.
 */
final class AiOrderReader {

	public const MODEL = 'claude-opus-5-5';
	private const URL  = 'https://api.anthropic.com/v1/messages';

	/**
	 * @var callable(string,string,array<string,string>,?string):array{0:int,1:string}
	 */
	private $http;
	private string $key;

	/**
	 * @param callable(string,string,array<string,string>,?string):array{0:int,1:string} $http Transport.
	 */
	public function __construct( callable $http, string $key ) {
		$this->http = $http;
		$this->key  = $key;
	}

	/**
	 * @param array<int,array{id:int,name:string,sku:string,price:string,decimal:bool,unit:string}> $catalogue Products.
	 * @return array<string,mixed>|null Same shape as OrderParser::parse(), or null on any failure.
	 */
	public function read( string $text, array $catalogue ): ?array {
		$products = implode(
			"\n",
			array_map(
				static fn( $p ) => sprintf( '%d | %s | %s | %s per %s', $p['id'], $p['name'], $p['sku'], $p['price'], $p['unit'] ?: 'pcs' ),
				array_slice( $catalogue, 0, 600 )
			)
		);
		$body = array(
			'model'         => self::MODEL,
			'max_tokens'    => 4000,
			'fallbacks'     => 'default',
			'output_config' => array(
				'effort' => 'low',
				'format' => array(
					'type'   => 'json_schema',
					'schema' => self::schema(),
				),
			),
			'system'        => 'You read online-shop order messages from Bangladesh (Bangla, English or Banglish) and fill an order form. '
				. 'Use only what the message says; leave a field empty when it is not there. Phone: an 11-digit Bangladeshi mobile number starting with 01. '
				. 'address: the full delivery address as written. area: the district or city. zone: "inside" for addresses in Dhaka city, "outside" for anywhere else, "" if unknown. '
				. 'items: match products to the product list by meaning (Bangla or English names, spelling mistakes); product_id 0 when nothing in the list fits. '
				. 'qty in the product\'s own unit (500 gram of a product sold per kg is 0.5). note: delivery time, size, colour or other instructions.',
			'messages'      => array(
				array(
					'role'    => 'user',
					'content' => "Product list (id | name | sku | price per unit):\n" . $products . "\n\nMessage:\n" . $text,
				),
			),
		);
		list( $status, $raw ) = ( $this->http )(
			'POST',
			self::URL,
			array(
				'x-api-key'         => $this->key,
				'anthropic-version' => '2023-06-01',
				'anthropic-beta'    => 'server-side-fallback-2026-07-01',
				'content-type'      => 'application/json',
			),
			(string) json_encode( $body, JSON_UNESCAPED_UNICODE )
		);
		$res = json_decode( $raw, true );
		if ( 200 !== $status || ! is_array( $res ) || 'end_turn' !== ( $res['stop_reason'] ?? '' ) ) {
			return null;
		}
		$json = null;
		foreach ( (array) ( $res['content'] ?? array() ) as $block ) {
			if ( 'text' === ( $block['type'] ?? '' ) ) {
				$json = json_decode( (string) $block['text'], true );
				break;
			}
		}
		if ( ! is_array( $json ) ) {
			return null;
		}
		$ids   = array_column( $catalogue, null, 'id' );
		$items = array();
		foreach ( (array) ( $json['items'] ?? array() ) as $it ) {
			$id = (int) ( $it['product_id'] ?? 0 );
			if ( ! isset( $ids[ $id ] ) || (float) ( $it['qty'] ?? 0 ) <= 0 ) {
				continue;
			}
			$qty     = (float) $it['qty'];
			$items[] = array(
				'product_id' => $id,
				'name'       => (string) $ids[ $id ]['name'],
				'qty'        => rtrim( rtrim( number_format( $ids[ $id ]['decimal'] ? $qty : max( 1, round( $qty ) ), 3, '.', '' ), '0' ), '.' ),
				'unit_price' => (string) $ids[ $id ]['price'],
			);
		}
		$zone = (string) ( $json['zone'] ?? '' );
		return array(
			'customer_name' => trim( (string) ( $json['customer_name'] ?? '' ) ),
			'phone'         => OrderParser::phone( (string) ( $json['phone'] ?? '' ) ),
			'address'       => trim( (string) ( $json['address'] ?? '' ) ),
			'area'          => trim( (string) ( $json['area'] ?? '' ) ),
			'zone'          => in_array( $zone, array( 'inside', 'outside' ), true ) ? $zone : '',
			'items'         => $items,
			'note'          => trim( (string) ( $json['note'] ?? '' ) ),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	private static function schema(): array {
		$str = array( 'type' => 'string' );
		return array(
			'type'                 => 'object',
			'additionalProperties' => false,
			'required'             => array( 'customer_name', 'phone', 'address', 'area', 'zone', 'items', 'note' ),
			'properties'           => array(
				'customer_name' => $str,
				'phone'         => $str,
				'address'       => $str,
				'area'          => $str,
				'zone'          => array(
					'type' => 'string',
					'enum' => array( 'inside', 'outside', '' ),
				),
				'items'         => array(
					'type'  => 'array',
					'items' => array(
						'type'                 => 'object',
						'additionalProperties' => false,
						'required'             => array( 'product_id', 'qty' ),
						'properties'           => array(
							'product_id' => array( 'type' => 'integer' ),
							'qty'        => array( 'type' => 'number' ),
						),
					),
				),
				'note'          => $str,
			),
		);
	}
}
