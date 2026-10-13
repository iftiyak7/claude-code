<?php
/**
 * Per-business settings.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Settings;

use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Json;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Typed key/value settings stored per business. Defaults define both the
 * fallback value and the type each key is coerced to.
 */
final class SettingsService extends Service {

	private AuditLogger $audit;

	/**
	 * Request cache: business id => settings.
	 *
	 * @var array<int,array<string,mixed>>
	 */
	private array $cache = array();

	public function __construct( Database $db, Clock $clock, Events $events, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->audit = $audit;
	}

	/**
	 * @return array<string,mixed>
	 */
	public function defaults(): array {
		$defaults = array(
			// General / formatting.
			'general.date_format'            => 'd/m/Y',
			'general.thousand_sep'           => ',',
			'general.decimal_sep'            => '.',
			'general.language'               => 'en',

			// Tax.
			'tax.enabled'                    => false,
			'tax.label'                      => 'VAT',
			'tax.mode'                       => 'line',
			'tax.purchase_recoverable'       => true,

			// Inventory.
			'inventory.allow_negative'       => false,
			'inventory.low_stock_alerts'     => true,

			// Sales & POS.
			'sales.default_payment_account'  => 0,
			'sales.allow_below_min_price'    => false,
			'sales.allow_credit_walkin'      => false,
			'sales.enforce_credit_limit'     => true,
			'pos.auto_print'                 => false,
			'pos.paper'                      => '80mm',
			'pos.show_images'                => true,

			// Numbering.
			'numbering.sale'                 => 'INV-{SEQ:6}',
			'numbering.purchase'             => 'PUR-{SEQ:6}',
			'numbering.payment_in'           => 'RCV-{SEQ:6}',
			'numbering.payment_out'          => 'PAY-{SEQ:6}',
			'numbering.expense'              => 'EXP-{SEQ:6}',
			'numbering.income'               => 'INC-{SEQ:6}',
			'numbering.sale_return'          => 'SRT-{SEQ:6}',
			'numbering.purchase_return'      => 'PRT-{SEQ:6}',
			'numbering.customer'             => 'C-{SEQ:5}',
			'numbering.supplier'             => 'S-{SEQ:5}',
			'numbering.reset'                => 'never',

			// Invoice.
			'invoice.template'               => 'classic',
			'invoice.paper'                  => 'a4',
			'invoice.color'                  => '#16a34a',
			'invoice.font'                   => 'system',
			'invoice.show_logo'              => true,
			'invoice.show_signature'         => true,
			'invoice.signature_label'        => 'Authorized Signature',
			'invoice.footer'                 => 'Thank you for your business!',
			'invoice.terms'                  => '',
			'invoice.show_due'               => true,

			// Printer.
			'printer.type'                   => 'browser',
			'printer.width'                  => 80,
			'printer.copies'                 => 1,
			'printer.auto_cut'               => true,
			'printer.open_drawer'            => false,

			// Accounting.
			'accounting.lock_date'           => '',

			// Audit / privacy.
			'audit.log_ip'                   => true,

			// Notifications.
			'notifications.low_stock'        => true,
			'notifications.sales'            => false,
			'notifications.purchases'        => true,
			'notifications.payments'         => true,
			'notifications.backup_reminder_days' => 7,

			// Dashboard.
			'dashboard.widgets'              => array( 'sales', 'purchases', 'expenses', 'profit', 'collection', 'due', 'stock', 'cash' ),

			// Feature toggles (driven by business type).
			'features.batches'               => false,
			'features.expiry'                => false,
			'features.serials'               => false,
			'features.variants'              => true,
			'features.wholesale'             => false,
			'features.branches'              => false,
		);
		return (array) $this->events->filter( 'goriber_hisab/settings_defaults', $defaults );
	}

	/**
	 * All settings for the business, defaults merged.
	 *
	 * @return array<string,mixed>
	 */
	public function all( BusinessContext $ctx ): array {
		return $this->forBusiness( $ctx->business_id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function forBusiness( int $business_id ): array {
		if ( isset( $this->cache[ $business_id ] ) ) {
			return $this->cache[ $business_id ];
		}
		$t        = $this->db->table( 'settings' );
		$rows     = $this->db->rows( "SELECT setting_key, setting_value FROM {$t} WHERE business_id = %d", array( $business_id ) );
		$defaults = $this->defaults();
		$values   = $defaults;
		foreach ( $rows as $row ) {
			$key = (string) $row['setting_key'];
			if ( array_key_exists( $key, $defaults ) ) {
				$decoded        = json_decode( (string) $row['setting_value'], true );
				$values[ $key ] = $this->coerce( $defaults[ $key ], $decoded );
			}
		}
		$this->cache[ $business_id ] = $values;
		return $values;
	}

	/**
	 * @return mixed
	 */
	public function get( BusinessContext $ctx, string $key ) {
		return $this->all( $ctx )[ $key ] ?? null;
	}

	/**
	 * Update many settings. Unknown keys are rejected.
	 *
	 * @param array<string,mixed> $values Key => value.
	 * @return array<string,mixed> New full settings.
	 */
	public function update( BusinessContext $ctx, array $values, bool $authorize = true ): array {
		if ( $authorize ) {
			$ctx->authorize( 'settings.manage' );
		}
		$defaults = $this->defaults();
		$errors   = array();
		foreach ( array_keys( $values ) as $key ) {
			if ( ! array_key_exists( $key, $defaults ) ) {
				$errors[ $key ] = 'Unknown setting.';
			}
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}

		$before = $this->all( $ctx );
		$t      = $this->db->table( 'settings' );
		$this->db->transaction(
			function () use ( $ctx, $values, $defaults, $t ) {
				foreach ( $values as $key => $raw ) {
					$value = $this->coerce( $defaults[ $key ], $raw );
					$this->validate( $key, $value );
					$json   = Json::encode( $value );
					$exists = $this->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND setting_key = %s", array( $ctx->business_id, $key ) );
					if ( $exists ) {
						$this->db->update( $t, array( 'setting_value' => $json, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ), array( 'id' => (int) $exists ) );
					} else {
						$this->db->insert( $t, array( 'business_id' => $ctx->business_id, 'setting_key' => $key, 'setting_value' => $json, 'updated_by' => $ctx->user_id, 'updated_at' => $this->now() ) );
					}
				}
			}
		);
		unset( $this->cache[ $ctx->business_id ] );
		$after   = $this->all( $ctx );
		$changes = array();
		foreach ( $values as $key => $_ ) {
			if ( $before[ $key ] !== $after[ $key ] ) {
				$changes[ $key ] = array( $before[ $key ], $after[ $key ] );
			}
		}
		if ( $changes ) {
			$this->audit->log( $ctx, 'update', 'settings', 0, 'Settings changed: ' . implode( ', ', array_keys( $changes ) ), $changes );
			$this->events->dispatch( 'goriber_hisab/settings/updated', $ctx, $changes );
		}
		return $after;
	}

	public function flush(): void {
		$this->cache = array();
	}

	/**
	 * Coerce $value to the type of $default.
	 *
	 * @param mixed $default Default.
	 * @param mixed $value   Raw.
	 * @return mixed
	 */
	private function coerce( $default, $value ) {
		if ( is_bool( $default ) ) {
			return Text::bool( $value );
		}
		if ( is_int( $default ) ) {
			return is_numeric( $value ) ? (int) $value : $default;
		}
		if ( is_array( $default ) ) {
			return is_array( $value ) ? array_values( array_map( array( Text::class, 'key' ), $value ) ) : $default;
		}
		return is_scalar( $value ) ? Text::multiline( $value, 2000 ) : $default;
	}

	/**
	 * Key-specific validation.
	 *
	 * @param mixed $value Coerced value.
	 * @throws ValidationException When invalid.
	 */
	private function validate( string $key, $value ): void {
		$enums = array(
			'tax.mode'         => array( 'line', 'invoice' ),
			'pos.paper'        => array( '58mm', '80mm', 'a4', 'a5' ),
			'invoice.paper'    => array( '58mm', '80mm', 'a4', 'a5' ),
			'invoice.template' => array( 'classic', 'modern', 'compact' ),
			'printer.type'     => array( 'browser', 'bluetooth', 'native' ),
			'numbering.reset'  => array( 'never', 'yearly', 'monthly' ),
			'general.language' => array( 'en', 'bn' ),
		);
		if ( isset( $enums[ $key ] ) && ! in_array( $value, $enums[ $key ], true ) ) {
			throw ValidationException::field( $key, 'Invalid value.' );
		}
		if ( 'invoice.color' === $key && ! preg_match( '/^#[0-9a-fA-F]{6}$/', (string) $value ) ) {
			throw ValidationException::field( $key, 'Use a hex colour like #2563eb.' );
		}
		if ( 'printer.width' === $key && ! in_array( $value, array( 58, 80 ), true ) ) {
			throw ValidationException::field( $key, 'Printer width must be 58 or 80.' );
		}
		if ( str_starts_with( $key, 'numbering.' ) && 'numbering.reset' !== $key && ! str_contains( (string) $value, '{SEQ' ) ) {
			throw ValidationException::field( $key, 'Number format must contain {SEQ} or {SEQ:n}.' );
		}
		if ( 'accounting.lock_date' === $key && '' !== $value && null === Text::date( $value ) ) {
			throw ValidationException::field( $key, 'Use a YYYY-MM-DD date.' );
		}
	}
}
