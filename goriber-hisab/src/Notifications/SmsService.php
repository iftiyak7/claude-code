<?php
/**
 * SMS to customers through a Bangladeshi SMS gateway (BulkSMSBD, Alpha SMS,
 * GreenWeb, …). The site owner sets the gateway once; each shop decides
 * whether customers get an SMS after every sale.
 *
 * Gateways differ, so the owner gives a URL template with placeholders:
 * {api_key} {sender} {phone} (8801XXXXXXXXX) {phone_local} (01XXXXXXXXX) {message}.
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
		'bulksmsbd' => 'http://bulksmsbd.net/api/smsapi?api_key={api_key}&type=text&number={phone}&senderid={sender}&message={message}',
		'alpha'     => 'https://api.sms.net.bd/sendsms?api_key={api_key}&msg={message}&to={phone}',
		'greenweb'  => 'https://api.greenweb.com.bd/api.php?token={api_key}&to={phone}&message={message}',
	);

	private SettingsService $settings;

	/** @var callable */
	private $http;

	/** @var callable():array{url:string,key:string,sender:string} */
	private $config;

	/**
	 * @param callable                                                $http   Transport (method, url, headers, body) → [status, body].
	 * @param callable():array{url:string,key:string,sender:string} $config Gateway settings.
	 */
	public function __construct( Database $db, Clock $clock, Events $events, SettingsService $settings, callable $http, callable $config ) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
		$this->http     = $http;
		$this->config   = $config;
	}

	public function available(): bool {
		$c = ( $this->config )();
		return '' !== trim( (string) $c['url'] ) && '' !== trim( (string) $c['key'] );
	}

	/**
	 * Send one SMS. Returns true when the gateway accepted it.
	 */
	public function send( BusinessContext $ctx, string $phone, string $message, string $ref_type = 'manual', int $ref_id = 0 ): bool {
		if ( ! $this->available() ) {
			throw new ValidationException( array(), 'SMS is not set up yet. The site owner can add an SMS gateway in Shops (clients) → Settings.' );
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
		if ( $today >= 1000 ) {
			throw new ValidationException( array(), 'Daily SMS limit reached for this shop.' );
		}
		$c   = ( $this->config )();
		$url = strtr(
			(string) $c['url'],
			array(
				'{api_key}'     => rawurlencode( (string) $c['key'] ),
				'{sender}'      => rawurlencode( (string) $c['sender'] ),
				'{phone}'       => '88' . $local,
				'{phone_local}' => $local,
				'{message}'     => rawurlencode( $message ),
			)
		);
		$status = 'failed';
		$body   = '';
		try {
			list( $code, $body ) = ( $this->http )( 'GET', $url, array( 'Accept' => 'application/json, text/plain' ), null );
			$status              = ( $code >= 200 && $code < 300 && ! preg_match( '/"?(error|status)"?\s*[:=]\s*"?(error|failed|invalid)|invalid api|insufficient/i', (string) $body ) ) ? 'sent' : 'failed';
		} catch ( \Throwable $e ) {
			$body = $e->getMessage();
		}
		$this->db->insert(
			$t,
			array(
				'business_id' => $ctx->business_id,
				'phone'       => $local,
				'message'     => $message,
				'ref_type'    => Text::key( $ref_type, 20 ),
				'ref_id'      => $ref_id,
				'status'      => $status,
				'response'    => Text::line( (string) $body, 255 ),
				'created_by'  => $ctx->user_id,
				'created_at'  => $this->now(),
			)
		);
		return 'sent' === $status;
	}

	/**
	 * After a sale: thank-you SMS with total, paid and due — if the shop turned it on.
	 *
	 * @param array<string,mixed> $sale Sale as returned by SaleService::get().
	 */
	public function afterSale( BusinessContext $ctx, array $sale ): bool {
		$s = $this->settings->all( $ctx );
		if ( empty( $s['sms.after_sale'] ) || ! $this->available() || 'completed' !== ( $sale['status'] ?? '' ) ) {
			return false;
		}
		$phone = (string) ( $sale['customer']['phone'] ?? '' );
		if ( '' === OrderService::phoneKey( $phone ) ) {
			return false;
		}
		try {
			return $this->send( $ctx, $phone, $this->saleMessage( $ctx, $sale, (string) $s['sms.sale_template'] ), 'sale', (int) $sale['id'] );
		} catch ( \Throwable $e ) {
			return false; // never block a sale because of SMS
		}
	}

	/**
	 * @param array<string,mixed> $sale Sale.
	 */
	public function saleMessage( BusinessContext $ctx, array $sale, string $template = '' ): string {
		$lang = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		if ( '' === trim( $template ) ) {
			$template = 'en' === $lang
				? "{shop}: Thank you {customer}! Bill {invoice}: total {total}, paid {paid}{due_text}."
				: '{shop}: ধন্যবাদ {customer}! বিল {invoice}: মোট {total}, পরিশোধ {paid}{due_text}।';
		}
		$m        = static fn( $v ): string => 'Tk ' . Decimal::toString( Decimal::of( $v ?? 0 ), 0 === (int) ( Decimal::of( $v ?? 0 ) % 10000 ) ? 0 : 2 );
		$due      = Decimal::of( $sale['due_amount'] ?? 0 );
		$balance  = Decimal::of( $sale['customer']['balance'] ?? 0 );
		$due_text = '';
		if ( $balance > 0 ) {
			$due_text = 'en' === $lang ? ', total due ' . $m( Decimal::toString( $balance ) ) : ', মোট বাকি ' . $m( Decimal::toString( $balance ) );
		} elseif ( $due > 0 ) {
			$due_text = 'en' === $lang ? ', due ' . $m( Decimal::toString( $due ) ) : ', বাকি ' . $m( Decimal::toString( $due ) );
		}
		return strtr(
			$template,
			array(
				'{shop}'      => (string) ( $ctx->business['name'] ?? '' ),
				'{customer}'  => (string) ( $sale['customer']['name'] ?? '' ),
				'{invoice}'   => (string) $sale['number'],
				'{total}'     => $m( $sale['total'] ),
				'{paid}'      => $m( $sale['paid_amount'] ),
				'{due}'       => $m( $sale['due_amount'] ),
				'{total_due}' => $m( Decimal::toString( $balance ) ),
				'{due_text}'  => $due_text,
			)
		);
	}

	/**
	 * Numbers for the settings screen.
	 *
	 * @return array{available:bool,month:int,failed:int}
	 */
	public function usage( BusinessContext $ctx ): array {
		$t    = $this->db->table( 'sms_log' );
		$from = substr( $this->now(), 0, 7 ) . '-01 00:00:00';
		return array(
			'available' => $this->available(),
			'month'     => (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND status = 'sent' AND created_at >= %s", array( $ctx->business_id, $from ) ),
			'failed'    => (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND status = 'failed' AND created_at >= %s", array( $ctx->business_id, $from ) ),
		);
	}
}
