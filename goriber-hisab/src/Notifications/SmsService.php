<?php
/**
 * SMS to customers through a Bangladeshi SMS gateway (Automas, BulkSMSBD,
 * Alpha SMS, GreenWeb, …).
 *
 * Where the gateway comes from: a shop can connect its own SMS account
 * (its own API key and masking name, paid by the shop). Without one, the
 * site owner's gateway is used, if the site has one.
 *
 * When SMS go out: domain events (sale completed, online order placed,
 * order shipped, due collected) each have a switch and an optional message
 * in the shop's settings. The listener only QUEUES the SMS — as a row in
 * sms_log written inside the same database transaction as the sale or
 * payment, so a rolled-back sale never sends one. The queue is sent once
 * the request has finished (the customer of the shop never waits for the
 * SMS company), and the cron job picks up anything left behind.
 * One SMS per document and event: a restored sale or a retried sync
 * never texts the customer twice.
 *
 * Gateways differ, so a gateway is a URL template with placeholders:
 * {api_key} {sender} {phone} (8801XXXXXXXXX) {phone_local} (01XXXXXXXXX)
 * {message} {type} (text|unicode) {smsformat} (8 for Bangla, left out
 * otherwise). Start the template with "POST " to send the query as a form.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Notifications;

use GoriberHisab\Database\Database;
use GoriberHisab\Orders\OrderService;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * SMS sender.
 */
final class SmsService extends Service {

	/** Ready-made URL templates for popular Bangladeshi gateways. */
	public const PRESETS = array(
		'automas'   => 'https://api.automas.com.bd/smsapiv3?apikey={api_key}&sender={sender}&msisdn={phone}&smstext={message}&smsformat={smsformat}',
		'bulksmsbd' => 'http://bulksmsbd.net/api/smsapi?api_key={api_key}&type=text&number={phone}&senderid={sender}&message={message}',
		'alpha'     => 'https://api.sms.net.bd/sendsms?api_key={api_key}&msg={message}&to={phone}',
		'greenweb'  => 'https://api.greenweb.com.bd/api.php?token={api_key}&to={phone}&message={message}',
	);

	/** Event => [on/off setting, message setting]. */
	public const EVENTS = array(
		'sale'    => array( 'sms.after_sale', 'sms.sale_template' ),
		'order'   => array( 'sms.order_placed', 'sms.order_template' ),
		'shipped' => array( 'sms.order_shipped', 'sms.shipped_template' ),
		'payment' => array( 'sms.payment_received', 'sms.payment_template' ),
	);

	private const DAILY_LIMIT = 1000;

	private SettingsService $settings;

	/** @var callable */
	private $http;

	/** @var callable():array{url:string,key:string,sender:string} */
	private $config;

	/** @var array<int,int> Rows queued in this request, sent when it ends. */
	private array $pending = array();

	private bool $hooked = false;

	/**
	 * @param callable                                                $http   Transport (method, url, headers, body) → [status, body].
	 * @param callable():array{url:string,key:string,sender:string} $config The site owner's gateway.
	 */
	public function __construct( Database $db, Clock $clock, Events $events, SettingsService $settings, callable $http, callable $config ) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
		$this->http     = $http;
		$this->config   = $config;
	}

	/* ------------------------------------------------------------ Gateway */

	/**
	 * Which gateway a shop sends through: its own account first, else the site's.
	 *
	 * @return array{url:string,key:string,sender:string,own:bool}
	 */
	public function gateway( int $business_id ): array {
		$own = $this->ownGateway( $business_id );
		if ( '' !== $own['url'] && '' !== $own['key'] ) {
			return array( 'url' => $own['url'], 'key' => $own['key'], 'sender' => $own['sender'], 'own' => true );
		}
		$c = ( $this->config )();
		return array( 'url' => trim( (string) ( $c['url'] ?? '' ) ), 'key' => trim( (string) ( $c['key'] ?? '' ) ), 'sender' => (string) ( $c['sender'] ?? '' ), 'own' => false );
	}

	public function available( ?BusinessContext $ctx = null ): bool {
		if ( null !== $ctx ) {
			$g = $this->gateway( $ctx->business_id );
		} else {
			$c = ( $this->config )();
			$g = array( 'url' => trim( (string) ( $c['url'] ?? '' ) ), 'key' => trim( (string) ( $c['key'] ?? '' ) ) );
		}
		return '' !== $g['url'] && '' !== $g['key'];
	}

	/**
	 * A valid template: http(s) address (optionally "POST " first) with {message} and a phone placeholder.
	 */
	public static function validTemplate( string $url ): bool {
		$bare = preg_replace( '/^POST\s+/i', '', trim( $url ) );
		return (bool) preg_match( '#^https?://#i', (string) $bare ) && str_contains( $url, '{message}' ) && ( str_contains( $url, '{phone}' ) || str_contains( $url, '{phone_local}' ) );
	}

	/**
	 * The shop's own SMS account, for its settings screen (key masked).
	 *
	 * @return array<string,mixed>
	 */
	public function shopGateway( BusinessContext $ctx ): array {
		$ctx->authorize( 'settings.manage' );
		$own  = $this->ownGateway( $ctx->business_id );
		$site = ( $this->config )();
		return array(
			'provider'  => $own['provider'],
			'url'       => $own['url'],
			'key'       => '' !== $own['key'] ? substr( $own['key'], 0, 4 ) . str_repeat( '•', 10 ) : '',
			'sender'    => $own['sender'],
			'connected' => '' !== $own['url'] && '' !== $own['key'],
			'site'      => '' !== trim( (string) ( $site['url'] ?? '' ) ) && '' !== trim( (string) ( $site['key'] ?? '' ) ),
			'presets'   => self::PRESETS,
		);
	}

	/**
	 * Connect, change or remove the shop's own SMS account.
	 *
	 * @param array<string,mixed> $data provider, url, key, sender, remove (bool).
	 * @return array<string,mixed>
	 */
	public function saveShopGateway( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'settings.manage' );
		$c = $this->ownGateway( $ctx->business_id );
		if ( ! empty( $data['remove'] ) ) {
			$c = array( 'provider' => '', 'url' => '', 'key' => '', 'sender' => '' );
		} else {
			$provider = Text::key( $data['provider'] ?? $c['provider'], 20 );
			$url      = trim( (string) ( $data['url'] ?? '' ) );
			if ( '' === $url && isset( self::PRESETS[ $provider ] ) ) {
				$url = self::PRESETS[ $provider ];
			}
			if ( ! self::validTemplate( $url ) ) {
				throw ValidationException::field( 'url', 'The address must start with http(s):// and contain {phone} and {message}.' );
			}
			$c['provider'] = isset( self::PRESETS[ $provider ] ) ? $provider : 'custom';
			$c['url']      = substr( $url, 0, 500 );
			// A masked key comes back unchanged from the form: keep the stored one.
			if ( isset( $data['key'] ) && ! str_contains( (string) $data['key'], '•' ) ) {
				$c['key'] = trim( Text::line( $data['key'], 300 ) );
			}
			if ( '' === $c['key'] ) {
				throw ValidationException::field( 'key', 'Enter the API key from your SMS company.' );
			}
			$c['sender'] = trim( Text::line( $data['sender'] ?? $c['sender'], 40 ) );
			if ( str_contains( $c['url'], '{sender}' ) && '' === $c['sender'] ) {
				throw ValidationException::field( 'sender', 'Enter your sender ID (masking name) approved by the SMS company.' );
			}
		}
		$t   = $this->db->table( 'settings' );
		$val = (string) Json::encode( $c );
		if ( $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND setting_key = 'secret.sms'", array( $ctx->business_id ) ) ) {
			$this->db->update( $t, array( 'setting_value' => $val, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ), array( 'business_id' => $ctx->business_id, 'setting_key' => 'secret.sms' ) );
		} else {
			$this->db->insert( $t, array( 'business_id' => $ctx->business_id, 'setting_key' => 'secret.sms', 'setting_value' => $val, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ) );
		}
		return $this->shopGateway( $ctx );
	}

	/**
	 * @return array{provider:string,url:string,key:string,sender:string}
	 */
	private function ownGateway( int $business_id ): array {
		$t   = $this->db->table( 'settings' );
		$raw = $this->db->value( "SELECT setting_value FROM {$t} WHERE business_id = %d AND setting_key = 'secret.sms'", array( $business_id ) );
		$c   = is_string( $raw ) ? json_decode( $raw, true ) : null;
		$c   = is_array( $c ) ? $c : array();
		return array(
			'provider' => (string) ( $c['provider'] ?? '' ),
			'url'      => (string) ( $c['url'] ?? '' ),
			'key'      => (string) ( $c['key'] ?? '' ),
			'sender'   => (string) ( $c['sender'] ?? '' ),
		);
	}

	/* ------------------------------------------------------------ Sending */

	/**
	 * Send one SMS now (due reminders, manual messages). Returns true when the gateway accepted it.
	 */
	public function send( BusinessContext $ctx, string $phone, string $message, string $ref_type = 'manual', int $ref_id = 0 ): bool {
		return $this->sendNow( $ctx, $phone, $message, $ref_type, $ref_id )['ok'];
	}

	/**
	 * Test from the settings screen: the gateway's own reply comes back so problems can be read.
	 *
	 * @return array{ok:bool,response:string}
	 */
	public function test( BusinessContext $ctx, string $phone ): array {
		$ctx->authorize( 'settings.manage' );
		$name = (string) ( $ctx->business['name'] ?? '' );
		$lang = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		$msg  = 'en' === $lang ? $name . ': Test SMS from Goriber Hisab.' : $name . ': গরিবের হিসাব থেকে পরীক্ষামূলক SMS।';
		return $this->sendNow( $ctx, $phone, $msg, 'test', 0 );
	}

	/**
	 * @return array{ok:bool,response:string}
	 */
	private function sendNow( BusinessContext $ctx, string $phone, string $message, string $ref_type, int $ref_id ): array {
		list( $local, $message ) = $this->check( $ctx, $phone, $message );
		list( $status, $body )   = $this->deliver( $this->gateway( $ctx->business_id ), $local, $message );
		$this->db->insert(
			$this->db->table( 'sms_log' ),
			array(
				'business_id' => $ctx->business_id,
				'phone'       => $local,
				'message'     => $message,
				'ref_type'    => Text::key( $ref_type, 20 ),
				'ref_id'      => $ref_id,
				'status'      => $status,
				'response'    => Text::line( $body, 255 ),
				'created_by'  => $ctx->user_id,
				'created_at'  => $this->now(),
			)
		);
		return array( 'ok' => 'sent' === $status, 'response' => Text::line( $body, 255 ) );
	}

	/**
	 * Queue an SMS for one document + event; sent when the request ends.
	 * Returns false (and queues nothing) when it was already sent or can't be.
	 */
	public function queue( BusinessContext $ctx, string $phone, string $message, string $ref_type, int $ref_id ): bool {
		try {
			list( $local, $message ) = $this->check( $ctx, $phone, $message );
		} catch ( ValidationException $e ) {
			return false;
		}
		$t        = $this->db->table( 'sms_log' );
		$ref_type = Text::key( $ref_type, 20 );
		if ( $ref_id > 0 && $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND ref_type = %s AND ref_id = %d AND status IN ('queued','sending','sent') LIMIT 1", array( $ctx->business_id, $ref_type, $ref_id ) ) ) {
			return false;
		}
		$id = $this->db->insert(
			$t,
			array(
				'business_id' => $ctx->business_id,
				'phone'       => $local,
				'message'     => $message,
				'ref_type'    => $ref_type,
				'ref_id'      => $ref_id,
				'status'      => 'queued',
				'response'    => '',
				'created_by'  => $ctx->user_id,
				'created_at'  => $this->now(),
			)
		);
		$this->pending[] = $id;
		$this->hookFlush();
		return true;
	}

	/**
	 * Whether an SMS for this document + event is queued or sent.
	 */
	public function queuedFor( BusinessContext $ctx, string $ref_type, int $ref_id ): bool {
		$t = $this->db->table( 'sms_log' );
		return (bool) $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND ref_type = %s AND ref_id = %d AND status IN ('queued','sending','sent') LIMIT 1", array( $ctx->business_id, $ref_type, $ref_id ) );
	}

	/**
	 * Send what this request queued; with $stale, also rows a past request left
	 * behind (cron). Each row is claimed first, so it is never sent twice.
	 *
	 * @return int SMS accepted by the gateway.
	 */
	public function flush( bool $stale = false ): int {
		$t   = $this->db->table( 'sms_log' );
		$ids = $this->pending;
		$this->pending = array();
		if ( $stale ) {
			$ids = array_merge(
				$ids,
				array_map( 'intval', $this->db->column( "SELECT id FROM {$t} WHERE status = 'queued' AND created_at <= %s AND created_at >= %s ORDER BY id LIMIT 200", array( $this->ago( 120 ), $this->ago( 86400 ) ) ) )
			);
		}
		$sent = 0;
		foreach ( array_unique( $ids ) as $id ) {
			// Gone = the sale was rolled back. Claimed elsewhere = someone else sends it.
			if ( 1 !== $this->db->execute( "UPDATE {$t} SET status = 'sending' WHERE id = %d AND status = 'queued'", array( $id ) ) ) {
				continue;
			}
			$row = $this->db->row( "SELECT business_id, phone, message FROM {$t} WHERE id = %d", array( $id ) );
			try {
				list( $status, $body ) = $this->deliver( $this->gateway( (int) $row['business_id'] ), (string) $row['phone'], (string) $row['message'] );
			} catch ( \Throwable $e ) {
				list( $status, $body ) = array( 'failed', $e->getMessage() );
			}
			$this->db->update( $t, array( 'status' => $status, 'response' => Text::line( $body, 255 ) ), array( 'id' => $id ) );
			$sent += 'sent' === $status ? 1 : 0;
		}
		return $sent;
	}

	/**
	 * Send the queue after WordPress has answered the request.
	 */
	private function hookFlush(): void {
		if ( $this->hooked || ! function_exists( 'add_action' ) ) {
			return;
		}
		$this->hooked = true;
		// Safety net: if this request dies before the end, cron sends what is left.
		if ( function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( 'goriber_hisab_sms_queue' ) ) {
			wp_schedule_single_event( time() + 300, 'goriber_hisab_sms_queue' );
		}
		add_action(
			'shutdown',
			function () {
				if ( ! $this->pending ) {
					return;
				}
				ignore_user_abort( true );
				if ( function_exists( 'fastcgi_finish_request' ) ) {
					fastcgi_finish_request();
				} elseif ( function_exists( 'litespeed_finish_request' ) ) {
					litespeed_finish_request();
				}
				try {
					$this->flush();
				} catch ( \Throwable $e ) {
					error_log( 'Goriber Hisab SMS: ' . $e->getMessage() ); // phpcs:ignore
				}
			},
			1000
		);
	}

	/**
	 * Validate phone + message and the daily limit.
	 *
	 * @return array{0:string,1:string} Local phone, clean message.
	 */
	private function check( BusinessContext $ctx, string $phone, string $message ): array {
		if ( ! $this->available( $ctx ) ) {
			throw new ValidationException( array(), 'SMS is not set up yet. Connect your SMS company in Settings → SMS.' );
		}
		$local = OrderService::phoneKey( $phone );
		if ( '' === $local ) {
			throw ValidationException::field( 'phone', 'Enter an 11-digit mobile number (01XXXXXXXXX).' );
		}
		$message = trim( Text::multiline( $message, 600 ) );
		if ( '' === $message ) {
			throw ValidationException::field( 'message', 'Write a message.' );
		}
		$t     = $this->db->table( 'sms_log' );
		$today = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND created_at >= %s", array( $ctx->business_id, substr( $this->now(), 0, 10 ) . ' 00:00:00' ) );
		if ( $today >= self::DAILY_LIMIT ) {
			throw new ValidationException( array(), 'Daily SMS limit reached for this shop.' );
		}
		return array( $local, $message );
	}

	/**
	 * Call the gateway.
	 *
	 * @param array{url:string,key:string,sender:string} $g Gateway.
	 * @return array{0:string,1:string} 'sent'|'failed', gateway reply.
	 */
	private function deliver( array $g, string $local, string $message ): array {
		if ( '' === $g['url'] || '' === $g['key'] ) {
			return array( 'failed', 'SMS is not set up.' );
		}
		$url     = trim( $g['url'] );
		$post    = (bool) preg_match( '/^POST\s+/i', $url );
		$url     = (string) preg_replace( '/^POST\s+/i', '', $url );
		$unicode = (bool) preg_match( '/[^\x00-\x7F]/', $message );
		if ( ! $unicode ) {
			// Plain text needs no format flag: leave the parameter out altogether.
			$url = (string) preg_replace( '/&[^=&?]+=\{smsformat\}/', '', $url );
			$url = (string) preg_replace( '/\?[^=&]+=\{smsformat\}&?/', '?', $url );
		}
		$url = strtr(
			$url,
			array(
				'{api_key}'     => rawurlencode( $g['key'] ),
				'{sender}'      => rawurlencode( $g['sender'] ),
				'{phone}'       => '88' . $local,
				'{phone_local}' => $local,
				'{message}'     => rawurlencode( $message ),
				'{type}'        => $unicode ? 'unicode' : 'text',
				'{smsformat}'   => '8',
			)
		);
		$body = '';
		try {
			if ( $post ) {
				list( $base, $query ) = array_pad( explode( '?', $url, 2 ), 2, '' );
				list( $code, $body )  = ( $this->http )( 'POST', $base, array( 'Accept' => 'application/json, text/plain', 'Content-Type' => 'application/x-www-form-urlencoded' ), $query );
			} else {
				list( $code, $body ) = ( $this->http )( 'GET', $url, array( 'Accept' => 'application/json, text/plain' ), null );
			}
		} catch ( \Throwable $e ) {
			return array( 'failed', $e->getMessage() );
		}
		$body = (string) $body;
		return array( self::accepted( (int) $code, $body ) ? 'sent' : 'failed', '' !== trim( $body ) ? $body : 'HTTP ' . (int) $code );
	}

	/**
	 * Did the gateway take the SMS? Gateways answer in many shapes:
	 * {"error":0}, {"response_code":202}, {"status":"SUCCESS"}, [{"status":"0"}], "Ok: sent"…
	 */
	public static function accepted( int $code, string $body ): bool {
		if ( $code < 200 || $code >= 300 ) {
			return false;
		}
		$json = json_decode( $body, true );
		if ( is_array( $json ) ) {
			if ( isset( $json['response'] ) && is_array( $json['response'] ) ) {
				$json = isset( $json['response'][0] ) && is_array( $json['response'][0] ) ? $json['response'][0] : $json['response'];
			} elseif ( isset( $json[0] ) && is_array( $json[0] ) ) {
				$json = $json[0];
			}
			$lower = array_change_key_case( $json, CASE_LOWER );
			$ok    = array( '0', '1', '200', '201', '202', 'SUCCESS', 'SUCCESSFUL', 'OK', 'SENT', 'ACCEPTED', 'SUBMITTED', 'TRUE' );
			if ( array_key_exists( 'error', $lower ) && ! is_array( $lower['error'] ) ) {
				return is_bool( $lower['error'] ) ? ! $lower['error'] : in_array( strtolower( trim( (string) $lower['error'] ) ), array( '0', '', 'false', 'none', 'null' ), true );
			}
			if ( ! empty( $lower['error_message'] ) || ! empty( $lower['errors'] ) ) {
				return false;
			}
			if ( isset( $lower['response_code'] ) ) {
				return in_array( (int) $lower['response_code'], array( 200, 201, 202 ), true );
			}
			foreach ( array( 'status', 'statuscode', 'status_code', 'code' ) as $k ) {
				if ( isset( $lower[ $k ] ) && ! is_array( $lower[ $k ] ) ) {
					return is_bool( $lower[ $k ] ) ? $lower[ $k ] : in_array( strtoupper( trim( (string) $lower[ $k ] ) ), $ok, true );
				}
			}
			if ( isset( $lower['success'] ) ) {
				return (bool) $lower['success'];
			}
		}
		return ! preg_match( '/error|fail|invalid|insufficient|denied|not allowed|unauthori[sz]ed|wrong/i', $body );
	}

	/* ------------------------------------------------------------ Events */

	/**
	 * Wire domain events to customer SMS.
	 */
	public function subscribe(): void {
		$this->events->listen(
			'goriber_hisab/sale/completed',
			function ( BusinessContext $ctx, array $sale ) {
				$this->guard( fn() => $this->afterSale( $ctx, $sale ) );
			}
		);
		foreach ( array( 'created', 'confirmed' ) as $what ) {
			$this->events->listen(
				'goriber_hisab/order/' . $what,
				function ( BusinessContext $ctx, int $id ) {
					$this->guard( fn() => $this->afterOrder( $ctx, $id ) );
				}
			);
		}
		$this->events->listen(
			'goriber_hisab/order/shipped',
			function ( BusinessContext $ctx, int $id ) {
				$this->guard( fn() => $this->afterShipped( $ctx, $id ) );
			}
		);
		$this->events->listen(
			'goriber_hisab/payment/recorded',
			function ( BusinessContext $ctx, int $payment_id, string $direction, int $amount, int $contact_id ) {
				if ( 'in' === $direction && $contact_id > 0 ) {
					$this->guard( fn() => $this->afterPayment( $ctx, $payment_id ) );
				}
			}
		);
	}

	/** An SMS problem never breaks the sale, order or payment. */
	private function guard( callable $fn ): void {
		try {
			$fn();
		} catch ( \Throwable $e ) {
			error_log( 'Goriber Hisab SMS: ' . $e->getMessage() ); // phpcs:ignore
		}
	}

	private function on( BusinessContext $ctx, string $event ): bool {
		return ! empty( $this->settings->all( $ctx )[ self::EVENTS[ $event ][0] ] ) && $this->available( $ctx );
	}

	private function template( BusinessContext $ctx, string $event ): string {
		$s = $this->settings->all( $ctx );
		$t = trim( (string) ( $s[ self::EVENTS[ $event ][1] ] ?? '' ) );
		return '' !== $t ? $t : self::defaultTemplate( $event, (string) ( $s['general.language'] ?? 'bn' ) );
	}

	/**
	 * The standard message of each event.
	 */
	public static function defaultTemplate( string $event, string $lang = 'bn' ): string {
		$en = array(
			'sale'    => '{shop}: Thank you {customer}! Bill {invoice}: total {total}, paid {paid}{due_text}.',
			'order'   => '{shop}: Thank you {customer}! Your order {order} is received. Total {total}.',
			'shipped' => '{shop}: Your order {order} is sent by {courier}.{tracking_text}{cod_text}',
			'payment' => '{shop}: {customer}, we received {amount} (receipt {receipt}).{due_text}',
		);
		$bn = array(
			'sale'    => '{shop}: ধন্যবাদ {customer}! বিল {invoice}: মোট {total}, পরিশোধ {paid}{due_text}।',
			'order'   => '{shop}: ধন্যবাদ {customer}! আপনার অর্ডার {order} গ্রহণ করা হয়েছে। মোট {total}।',
			'shipped' => '{shop}: আপনার অর্ডার {order} {courier}-এ পাঠানো হয়েছে।{tracking_text}{cod_text}',
			'payment' => '{shop}: {customer}, {amount} জমা পেয়েছি (রসিদ {receipt})।{due_text}',
		);
		return ( 'en' === $lang ? $en : $bn )[ $event ] ?? '';
	}

	/**
	 * After a sale: thank-you SMS with bill number, total, paid and due — if the shop turned it on.
	 * Online orders get the order SMS instead.
	 *
	 * @param array<string,mixed> $sale Sale as returned by SaleService::get().
	 */
	public function afterSale( BusinessContext $ctx, array $sale ): bool {
		if ( 'completed' !== ( $sale['status'] ?? '' ) || 'online' === ( $sale['channel'] ?? '' ) || ! $this->on( $ctx, 'sale' ) ) {
			return false;
		}
		$phone = (string) ( $sale['customer']['phone'] ?? '' );
		if ( '' === OrderService::phoneKey( $phone ) ) {
			return false;
		}
		return $this->queue( $ctx, $phone, $this->saleMessage( $ctx, $sale, $this->template( $ctx, 'sale' ) ), 'sale', (int) $sale['id'] );
	}

	public function afterOrder( BusinessContext $ctx, int $id ): bool {
		if ( ! $this->on( $ctx, 'order' ) ) {
			return false;
		}
		$o = $this->orderRow( $ctx, $id );
		if ( ! $o || 'cancelled' === $o['status'] ) {
			return false;
		}
		$msg = $this->fill( $ctx, $this->template( $ctx, 'order' ), array(
			'{customer}' => (string) $o['customer_name'],
			'{order}'    => (string) $o['number'],
			'{invoice}'  => (string) ( $o['sale_number'] ?: $o['number'] ),
			'{total}'    => self::money( $o['total'] ),
			'{advance}'  => self::money( $o['advance'] ),
			'{cod}'      => self::money( $o['cod_amount'] ),
		) );
		return $this->queue( $ctx, (string) $o['phone'], $msg, 'order', $id );
	}

	public function afterShipped( BusinessContext $ctx, int $id ): bool {
		if ( ! $this->on( $ctx, 'shipped' ) ) {
			return false;
		}
		$o = $this->orderRow( $ctx, $id );
		if ( ! $o ) {
			return false;
		}
		$lang     = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		$courier  = 'self' === $o['courier'] ? ( 'en' === $lang ? 'our delivery man' : 'আমাদের ডেলিভারি ম্যান' ) : ( OrderService::COURIERS[ $o['courier'] ] ?? (string) $o['courier'] );
		$tracking = '' !== (string) $o['tracking_code'] ? (string) $o['tracking_code'] : (string) $o['consignment_id'];
		$url      = OrderService::trackingUrl( (string) $o['courier'], (string) $o['tracking_code'], (string) $o['consignment_id'] );
		$cod      = Decimal::of( $o['cod_amount'] );
		$rider    = trim( (string) $o['rider_name'] . ( '' !== (string) $o['rider_phone'] ? ' ' . $o['rider_phone'] : '' ) );
		$track_tx = '';
		if ( '' !== $tracking ) {
			$track_tx = ( 'en' === $lang ? ' Tracking: ' : ' ট্র্যাকিং: ' ) . $tracking . ( '' !== $url ? ' ' . $url : '' ) . ( 'en' === $lang ? '.' : '।' );
		} elseif ( 'self' === $o['courier'] && '' !== $rider ) {
			$track_tx = ( 'en' === $lang ? ' Delivery man: ' : ' ডেলিভারি ম্যান: ' ) . $rider . ( 'en' === $lang ? '.' : '।' );
		}
		$cod_tx = $cod > 0 ? ( 'en' === $lang ? ' Pay ' . self::money( $o['cod_amount'] ) . ' on delivery.' : ' ডেলিভারিতে দিতে হবে ' . self::money( $o['cod_amount'] ) . '।' ) : '';
		$msg    = $this->fill( $ctx, $this->template( $ctx, 'shipped' ), array(
			'{customer}'      => (string) $o['customer_name'],
			'{order}'         => (string) $o['number'],
			'{invoice}'       => (string) ( $o['sale_number'] ?: $o['number'] ),
			'{courier}'       => $courier,
			'{tracking}'      => $tracking,
			'{tracking_url}'  => $url,
			'{tracking_text}' => $track_tx,
			'{rider}'         => $rider,
			'{total}'         => self::money( $o['total'] ),
			'{cod}'           => self::money( $o['cod_amount'] ),
			'{cod_text}'      => $cod_tx,
		) );
		return $this->queue( $ctx, (string) $o['phone'], $msg, 'shipped', $id );
	}

	/**
	 * Due collected from a customer (not the payment taken with a sale).
	 */
	public function afterPayment( BusinessContext $ctx, int $payment_id ): bool {
		if ( ! $this->on( $ctx, 'payment' ) ) {
			return false;
		}
		$pt = $this->db->table( 'payments' );
		$ct = $this->db->table( 'contacts' );
		$p  = $this->db->row(
			"SELECT p.number, p.amount, p.source, p.direction, p.note, c.name, c.phone, c.balance, c.type FROM {$pt} p JOIN {$ct} c ON c.id = p.contact_id AND c.business_id = p.business_id WHERE p.id = %d AND p.business_id = %d",
			array( $payment_id, $ctx->business_id )
		);
		// COD handed over by the courier (OrderService::collectCod) is not money from the customer today.
		if ( ! $p || 'collection' !== $p['source'] || 'in' !== $p['direction'] || 'customer' !== $p['type'] || str_starts_with( (string) $p['note'], 'COD for order' ) ) {
			return false;
		}
		$lang    = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		$balance = Decimal::of( $p['balance'] );
		$due_tx  = $balance > 0
			? ( 'en' === $lang ? ' Due now ' . self::money( $p['balance'] ) . '.' : ' এখন বাকি ' . self::money( $p['balance'] ) . '।' )
			: ( 'en' === $lang ? ' Nothing is due now. Thank you!' : ' এখন আর কোনো বাকি নেই। ধন্যবাদ!' );
		$msg     = $this->fill( $ctx, $this->template( $ctx, 'payment' ), array(
			'{customer}'  => (string) $p['name'],
			'{amount}'    => self::money( $p['amount'] ),
			'{receipt}'   => (string) $p['number'],
			'{due}'       => self::money( $balance > 0 ? $p['balance'] : 0 ),
			'{total_due}' => self::money( $balance > 0 ? $p['balance'] : 0 ),
			'{due_text}'  => $due_tx,
		) );
		return $this->queue( $ctx, (string) $p['phone'], $msg, 'payment', $payment_id );
	}

	/**
	 * @return array<string,mixed>|null
	 */
	private function orderRow( BusinessContext $ctx, int $id ): ?array {
		$ot  = $this->db->table( 'orders' );
		$st  = $this->db->table( 'sales' );
		$row = $this->db->row(
			"SELECT o.*, COALESCE(s.number, '') AS sale_number FROM {$ot} o LEFT JOIN {$st} s ON s.id = o.sale_id AND s.business_id = o.business_id WHERE o.id = %d AND o.business_id = %d AND o.deleted_at IS NULL",
			array( $id, $ctx->business_id )
		);
		return $row ?: null;
	}

	/**
	 * @param array<string,string> $vars Placeholder => value.
	 */
	private function fill( BusinessContext $ctx, string $template, array $vars ): string {
		return strtr( $template, array( '{shop}' => (string) ( $ctx->business['name'] ?? '' ) ) + $vars );
	}

	/**
	 * @param mixed $v Amount.
	 */
	private static function money( $v ): string {
		$x = Decimal::of( $v ?? 0 );
		return 'Tk ' . Decimal::toString( $x, 0 === (int) ( $x % 10000 ) ? 0 : 2 );
	}

	/**
	 * @param array<string,mixed> $sale Sale.
	 */
	public function saleMessage( BusinessContext $ctx, array $sale, string $template = '' ): string {
		$lang = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		if ( '' === trim( $template ) ) {
			$template = self::defaultTemplate( 'sale', $lang );
		}
		$due      = Decimal::of( $sale['due_amount'] ?? 0 );
		$balance  = Decimal::of( $sale['customer']['balance'] ?? 0 );
		$due_text = '';
		if ( $balance > 0 ) {
			$due_text = 'en' === $lang ? ', total due ' . self::money( Decimal::toString( $balance ) ) : ', মোট বাকি ' . self::money( Decimal::toString( $balance ) );
		} elseif ( $due > 0 ) {
			$due_text = 'en' === $lang ? ', due ' . self::money( Decimal::toString( $due ) ) : ', বাকি ' . self::money( Decimal::toString( $due ) );
		}
		return $this->fill(
			$ctx,
			$template,
			array(
				'{customer}'  => (string) ( $sale['customer']['name'] ?? '' ),
				'{invoice}'   => (string) $sale['number'],
				'{order}'     => (string) $sale['number'],
				'{total}'     => self::money( $sale['total'] ),
				'{paid}'      => self::money( $sale['paid_amount'] ),
				'{due}'       => self::money( $sale['due_amount'] ),
				'{total_due}' => self::money( Decimal::toString( $balance ) ),
				'{due_text}'  => $due_text,
			)
		);
	}

	/* ------------------------------------------------------------ Screens */

	/**
	 * Numbers for the settings screen.
	 *
	 * @return array{available:bool,own:bool,month:int,failed:int,queued:int}
	 */
	public function usage( BusinessContext $ctx ): array {
		$t    = $this->db->table( 'sms_log' );
		$from = substr( $this->now(), 0, 7 ) . '-01 00:00:00';
		$rows = $this->db->rows( "SELECT status, COUNT(*) AS n FROM {$t} WHERE business_id = %d AND created_at >= %s GROUP BY status", array( $ctx->business_id, $from ) );
		$n    = array();
		foreach ( $rows as $r ) {
			$n[ (string) $r['status'] ] = (int) $r['n'];
		}
		return array(
			'available' => $this->available( $ctx ),
			'own'       => $this->gateway( $ctx->business_id )['own'],
			'month'     => $n['sent'] ?? 0,
			'failed'    => $n['failed'] ?? 0,
			'queued'    => ( $n['queued'] ?? 0 ) + ( $n['sending'] ?? 0 ),
		);
	}

	/**
	 * Recent SMS with the gateway's reply.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function log( BusinessContext $ctx, int $limit = 30 ): array {
		$ctx->authorize( 'settings.manage' );
		$t = $this->db->table( 'sms_log' );
		return $this->db->rows( "SELECT id, phone, message, ref_type, ref_id, status, response, created_at FROM {$t} WHERE business_id = %d ORDER BY id DESC LIMIT %d", array( $ctx->business_id, max( 1, min( 100, $limit ) ) ) );
	}

	private function ago( int $seconds ): string {
		return gmdate( 'Y-m-d H:i:s', strtotime( $this->now() . ' UTC' ) - $seconds );
	}
}
