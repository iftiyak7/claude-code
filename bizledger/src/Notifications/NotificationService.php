<?php
/**
 * Notifications.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Notifications;

use BizLedger\Database\Database;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Json;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Tenancy\BusinessContext;

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
			'bizledger/stock/low',
			function ( BusinessContext $ctx, array $product, int $qty ) {
				if ( $this->settings->all( $ctx )['notifications.low_stock'] ) {
					$this->notify(
						$ctx,
						'low_stock',
						sprintf( 'Low stock: %s', $product['name'] ),
						sprintf( 'Only %s left (minimum %s).', Decimal::toString( $qty, 2 ), Decimal::toString( Decimal::of( $product['min_stock'] ), 2 ) ),
						array( 'product_id' => (int) $product['id'] ),
						'warning',
						'low_stock:' . $product['id']
					);
				}
			}
		);
		$this->events->listen(
			'bizledger/sale/completed',
			function ( BusinessContext $ctx, array $sale ) {
				if ( $this->settings->all( $ctx )['notifications.sales'] ) {
					$this->notify( $ctx, 'sale', sprintf( 'Sale %s', $sale['number'] ), sprintf( 'Total %s', $sale['total'] ), array( 'sale_id' => $sale['id'] ) );
				}
			}
		);
		$this->events->listen(
			'bizledger/purchase/completed',
			function ( BusinessContext $ctx, array $purchase ) {
				if ( $this->settings->all( $ctx )['notifications.purchases'] ) {
					$this->notify( $ctx, 'purchase', sprintf( 'Purchase %s added', $purchase['number'] ), sprintf( 'Total %s', $purchase['total'] ), array( 'purchase_id' => $purchase['id'] ) );
				}
			}
		);
		$this->events->listen(
			'bizledger/payment/recorded',
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
						error_log( 'BizLedger notification channel ' . $channel->id() . ' failed: ' . $e->getMessage() ); // phpcs:ignore
					}
				}
			}
		}
		return $id;
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
		foreach ( $rows as &$r ) {
			$r['data'] = Json::decode( $r['data'] );
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
			$channels       = (array) $this->events->filter( 'bizledger/notification_channels', array() );
			$this->channels = array_values( array_filter( $channels, static fn( $c ) => $c instanceof NotificationChannel ) );
		}
		return $this->channels;
	}
}
