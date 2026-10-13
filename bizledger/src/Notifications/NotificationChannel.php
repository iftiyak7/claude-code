<?php
/**
 * Notification channel contract.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Notifications;

use BizLedger\Tenancy\BusinessContext;

/**
 * A delivery mechanism (email, SMS, WhatsApp, push…). Register extra
 * channels with the "bizledger/notification_channels" filter.
 */
interface NotificationChannel {

	public function id(): string;

	/**
	 * Whether this channel wants a given notification type for the business.
	 */
	public function accepts( BusinessContext $ctx, string $type ): bool;

	/**
	 * @param array<string,mixed> $notification type, severity, title, body, data.
	 */
	public function send( BusinessContext $ctx, array $notification ): void;
}
