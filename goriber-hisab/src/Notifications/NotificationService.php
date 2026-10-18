<?php
/**
 * Notifications.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Notifications;

use GoriberHisab\Database\Database;
use GoriberHisab\Settings\SettingsService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * In-app inbox plus pluggable outbound channels.
 *
 * Domain events are translated into notifications by subscribe(); add-ons
 * can call notify() directly or add channels via a filter.
 */
final class NotificationService extends Service {

	private SettingsService $settings;

	/**
	 * @var array<int,NotificationChannel>|null
	 */
	private ?array $channels = null;

	public function __construct( Database $db, Clock $clock, Events $events, SettingsService $settings ) {
		parent::__construct( $db, $clock, $events );
		$this->settings = $settings;
	}

	/**
	 * Wire domain events to notifications.
	 */
	public function subscribe(): void {
		$this->events->listen(
			'goriber_hisab/stock/low',
			function ( BusinessContext $ctx, array $product, int $qty ) {
				if ( $this->settings->all( $ctx )['notifications.low_stock'] ) {
					$left = self::qty( Decimal::toString( $qty ) );
					$min  = self::qty( Decimal::toString( Decimal::of( $product['min_stock'] ) ) );
					$this->notify(
						$ctx,
						'low_stock',
						sprintf( 'Low stock: %s', $product['name'] ),
						sprintf( 'Only %s left (minimum %s).', $left, $min ),
						array(
							'product_id' => (int) $product['id'],
							'name'       => (string) $product['name'],
							'qty'        => $left,
							'min'        => $min,
						),
						'warning',
						'low_stock:' . $product['id']
					);
				}
			}
		);
		$this->events->listen(
			'goriber_hisab/sale/completed',
			function ( BusinessContext $ctx, array $sale ) {
				if ( $this->settings->all( $ctx )['notifications.sales'] ) {
					$this->notify( $ctx, 'sale', sprintf( 'Sale %s', $sale['number'] ), sprintf( 'Total %s', $sale['total'] ), array( 'sale_id' => $sale['id'] ) );
				}
			}
		);
		$this->events->listen(
			'goriber_hisab/purchase/completed',
			function ( BusinessContext $ctx, array $purchase ) {
				if ( $this->settings->all( $ctx )['notifications.purchases'] ) {
					$this->notify( $ctx, 'purchase', sprintf( 'Purchase %s added', $purchase['number'] ), sprintf( 'Total %s', $purchase['total'] ), array( 'purchase_id' => $purchase['id'] ) );
				}
			}
		);
		$this->events->listen(
			'goriber_hisab/payment/recorded',
			function ( BusinessContext $ctx, int $payment_id, string $direction, int $amount, int $contact_id ) {
				if ( 'in' === $direction && $contact_id > 0 && $this->settings->all( $ctx )['notifications.payments'] ) {
					$this->notify( $ctx, 'payment_received', 'Payment received', sprintf( 'Received %s', Decimal::toString( $amount, $ctx->decimals() ) ), array( 'payment_id' => $payment_id, 'contact_id' => $contact_id ), 'success' );
				}
			}
		);
	}

	/**
	 * Create a notification (user_id 0 = everyone in the business) and fan
	 * out to external channels.
	 *
	 * @param array<string,mixed> $data Extra data (ids for deep links).
	 */
	public function notify( BusinessContext $ctx, string $type, string $title, string $body = '', array $data = array(), string $severity = 'info', ?string $dedupe = null, int $user_id = 0 ): int {
		$t = $this->db->table( 'notifications' );
		if ( null !== $dedupe ) {
			$exists = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND dedupe_key = %s AND read_at IS NULL", array( $ctx->business_id, $dedupe ) );
			if ( $exists ) {
				return (int) $exists;
			}
		}
		$row = array(
			'business_id' => $ctx->business_id,
			'user_id'     => $user_id,
			'type'        => Text::key( $type, 40 ),
			'severity'    => in_array( $severity, array( 'info', 'success', 'warning', 'danger' ), true ) ? $severity : 'info',
			'title'       => Text::line( $title, 191 ),
			'body'        => Text::multiline( $body, 1000 ),
			'data'        => Json::encode( $data ),
			'dedupe_key'  => $dedupe,
			'created_at'  => $this->now(),
		);
		$id  = $this->db->insert( $t, $row );
		foreach ( $this->channels() as $channel ) {
			if ( $channel->accepts( $ctx, $type ) ) {
				try {
					$channel->send( $ctx, $row + array( 'id' => $id, 'data' => $data ) );
				} catch ( \Throwable $e ) {
					// A failing channel must never break the business transaction.
					if ( function_exists( 'error_log' ) ) {
						error_log( 'Goriber Hisab notification channel ' . $channel->id() . ' failed: ' . $e->getMessage() ); // phpcs:ignore
					}
				}
			}
		}
		return $id;
	}

	/** Notifications that also go to the phone as an alert (popup, sound, notification bar). */
	public const ALERT_TYPES = array( 'low_stock', 'low_stock_summary' );

	/**
	 * New unread alerts after a given id, worded for the shop's language — for
	 * the in-app popup and the Android notification bar.
	 *
	 * @return array{items:array<int,array<string,mixed>>,last_id:int}
	 */
	public function alerts( BusinessContext $ctx, int $after = 0, string $lang = '' ): array {
		$t    = $this->db->table( 'notifications' );
		$last = (int) $this->db->value( "SELECT COALESCE(MAX(id),0) FROM {$t} WHERE business_id = %d", array( $ctx->business_id ) );
		if ( $after <= 0 ) {
			return array( 'items' => array(), 'last_id' => $last ); // first call: start from now
		}
		$types = self::ALERT_TYPES;
		$rows  = $this->db->rows(
			"SELECT * FROM {$t} WHERE business_id = %d AND (user_id = 0 OR user_id = %d) AND read_at IS NULL AND id > %d AND type IN " . $this->inList( $types ) . ' ORDER BY id ASC LIMIT 20',
			array_merge( array( $ctx->business_id, $ctx->user_id, $after ), $types )
		);
		if ( ! in_array( $lang, array( 'bn', 'en' ), true ) ) {
			$lang = (string) ( $this->settings->all( $ctx )['general.language'] ?? 'bn' );
		}
		$out = array();
		foreach ( $rows as $r ) {
			$r['data'] = Json::decode( $r['data'] );
			$out[]     = $this->present( $r, $lang );
		}
		return array( 'items' => $out, 'last_id' => $last );
	}

	/**
	 * Title, text and in-app link for one notification.
	 *
	 * @param array<string,mixed> $n Row with decoded data.
	 * @return array{id:int,type:string,severity:string,title:string,body:string,link:string}
	 */
	public function present( array $n, string $lang = 'bn' ): array {
		$d     = is_array( $n['data'] ?? null ) ? $n['data'] : array();
		$bn    = 'en' !== $lang;
		$title = (string) $n['title'];
		$body  = (string) $n['body'];
		$link  = '/notifications';
		if ( 'low_stock' === $n['type'] ) {
			$link = ! empty( $d['product_id'] ) ? '/products/' . (int) $d['product_id'] : '/inventory?low=1';
			if ( $bn && isset( $d['name'] ) ) {
				$title = 'স্টক কম: ' . $d['name'];
				$body  = sprintf( 'আর মাত্র %sটি আছে (সর্বনিম্ন %s)। এখনই অর্ডার করুন।', self::digits( (string) $d['qty'] ), self::digits( (string) $d['min'] ) );
			}
		} elseif ( 'low_stock_summary' === $n['type'] ) {
			$link = '/inventory?low=1';
			if ( $bn && isset( $d['count'] ) ) {
				$title = sprintf( '%sটি পণ্যের স্টক কম', self::digits( (string) $d['count'] ) );
				$body  = (string) ( $d['names'] ?? '' );
			}
		}
		return array(
			'id'       => (int) $n['id'],
			'type'     => (string) $n['type'],
			'severity' => (string) $n['severity'],
			'title'    => $title,
			'body'     => $body,
			'link'     => $link,
		);
	}

	/**
	 * Daily reminder of everything still low on stock (the instant alert only fires
	 * when a product crosses its minimum).
	 */
	public function lowStockSummary( BusinessContext $ctx ): void {
		if ( ! $this->settings->all( $ctx )['notifications.low_stock'] ) {
			return;
		}
		$pt   = $this->db->table( 'products' );
		$st   = $this->db->table( 'stock_levels' );
		$rows = $this->db->rows(
			"SELECT p.name FROM {$pt} p
			WHERE p.business_id = %d AND p.deleted_at IS NULL AND p.track_stock = 1 AND p.status = 'active' AND p.min_stock > 0
			AND COALESCE((SELECT SUM(s.qty) FROM {$st} s WHERE s.business_id = p.business_id AND s.product_id = p.id),0) <= p.min_stock
			ORDER BY p.name",
			array( $ctx->business_id )
		);
		if ( ! $rows ) {
			return;
		}
		$names = array_column( $rows, 'name' );
		$list  = implode( ', ', array_slice( $names, 0, 6 ) ) . ( count( $names ) > 6 ? ' …' : '' );
		$this->notify( $ctx, 'low_stock_summary', sprintf( '%d products are low on stock', count( $names ) ), $list, array( 'count' => count( $names ), 'names' => $list ), 'warning', 'low_stock_summary:' . substr( $this->now(), 0, 10 ) );
	}

	/** "5.000" → "5", "2.50" → "2.5". */
	private static function qty( string $v ): string {
		return false !== strpos( $v, '.' ) ? rtrim( rtrim( $v, '0' ), '.' ) : $v;
	}

	private static function digits( string $v ): string {
		return strtr( $v, array_combine( str_split( '0123456789' ), array( '০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯' ) ) );
	}

	/**
	 * @param array<string,mixed> $args unread (bool), page, per_page.
	 * @return array<string,mixed>
	 */
	public function inbox( BusinessContext $ctx, array $args = array() ): array {
		list( $page, $per_page, $offset ) = $this->paging( $args, 100 );
		$t      = $this->db->table( 'notifications' );
		$where  = 'business_id = %d AND (user_id = 0 OR user_id = %d)';
		$params = array( $ctx->business_id, $ctx->user_id );
		if ( ! empty( $args['unread'] ) ) {
			$where .= ' AND read_at IS NULL';
		}
		$total  = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE {$where}", $params );
		$unread = (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND (user_id = 0 OR user_id = %d) AND read_at IS NULL", array( $ctx->business_id, $ctx->user_id ) );
		$rows   = $this->db->rows( "SELECT * FROM {$t} WHERE {$where} ORDER BY id DESC LIMIT %d OFFSET %d", array_merge( $params, array( $per_page, $offset ) ) );
		$lang = (string) ( $args['lang'] ?? '' );
		foreach ( $rows as &$r ) {
			$r['data'] = Json::decode( $r['data'] );
			if ( '' !== $lang ) {
				$shown      = $this->present( $r, $lang );
				$r['title'] = $shown['title'];
				$r['body']  = $shown['body'];
				$r['link']  = $shown['link'];
			}
		}
		$out           = $this->paged( $rows, $total, $page, $per_page );
		$out['unread'] = $unread;
		return $out;
	}

	/**
	 * Mark notifications read (empty list = all).
	 *
	 * @param array<int,int> $ids Ids.
	 */
	public function markRead( BusinessContext $ctx, array $ids = array() ): void {
		$t      = $this->db->table( 'notifications' );
		$params = array( $this->now(), $ctx->business_id, $ctx->user_id );
		$sql    = "UPDATE {$t} SET read_at = %s WHERE business_id = %d AND (user_id = 0 OR user_id = %d) AND read_at IS NULL";
		$ids    = array_values( array_filter( array_map( 'intval', $ids ) ) );
		if ( $ids ) {
			$sql   .= ' AND id IN ' . $this->inList( $ids );
			$params = array_merge( $params, $ids );
		}
		$this->db->execute( $sql, $params );
	}

	/**
	 * @return array<int,NotificationChannel>
	 */
	private function channels(): array {
		if ( null === $this->channels ) {
			$channels       = (array) $this->events->filter( 'goriber_hisab/notification_channels', array() );
			$this->channels = array_values( array_filter( $channels, static fn( $c ) => $c instanceof NotificationChannel ) );
		}
		return $this->channels;
	}
}
