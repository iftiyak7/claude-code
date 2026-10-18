<?php
/**
 * Activation, deactivation and schema migrations.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Core;

use GoriberHisab\Admin\AppRoute;
use GoriberHisab\Database\Schema;
use GoriberHisab\Database\WpdbDatabase;

/**
 * dbDelta-based installer plus versioned data migrations.
 */
final class Installer {

	public const OPTION = 'bizledger_db_version';

	public static function activate(): void {
		// The plugin used to live in the "bizledger" folder. Both share the
		// same tables, so switch the old copy off (its data stays).
		if ( ! function_exists( 'deactivate_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( is_plugin_active( 'bizledger/bizledger.php' ) ) {
			deactivate_plugins( 'bizledger/bizledger.php', true );
		}
		wp_clear_scheduled_hook( 'bizledger_daily' );
		delete_option( 'goriber_hisab_paths_checked' );
		self::migrate();
		AppRoute::addRewrite();
		flush_rewrite_rules();
		if ( ! wp_next_scheduled( 'goriber_hisab_daily' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'goriber_hisab_daily' );
		}
		add_option( 'bizledger_activation_redirect', 1 );
	}

	public static function deactivate(): void {
		wp_clear_scheduled_hook( 'goriber_hisab_daily' );
		flush_rewrite_rules();
	}

	/**
	 * Run on every load; cheap when already current.
	 */
	public static function maybeMigrate(): void {
		if ( get_option( self::OPTION ) !== Schema::VERSION ) {
			self::migrate();
		}
	}

	public static function migrate(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$db      = new WpdbDatabase( $wpdb );
		$collate = $wpdb->get_charset_collate();
		foreach ( Schema::mysql( $db, $collate ) as $sql ) {
			dbDelta( $sql );
		}

		$from = (string) get_option( self::OPTION, '0' );
		foreach ( self::migrations() as $version => $callback ) {
			if ( version_compare( $from, $version, '<' ) ) {
				$callback( $db );
			}
		}
		update_option( self::OPTION, Schema::VERSION, true );
	}

	/**
	 * Versioned data migrations (version => callable(Database)).
	 *
	 * @return array<string,callable>
	 */
	private static function migrations(): array {
		$builtin = array(
			// Orders get a normalised phone for the courier/fraud check.
			'1.3.0' => static function ( $db ): void {
				$t = $db->table( 'orders' );
				foreach ( $db->rows( "SELECT id, phone FROM {$t} WHERE phone_key = ''" ) as $r ) {
					$key = \GoriberHisab\Orders\OrderService::phoneKey( (string) $r['phone'] );
					if ( '' !== $key ) {
						$db->update( $t, array( 'phone_key' => $key ), array( 'id' => (int) $r['id'] ) );
					}
				}
			},
			// Stock "added" by adjustment before 1.6 was booked as a gain (profit). Shops used it
			// for stock they already had, so move those additions to opening balance equity.
			'1.4.0' => static function ( $db ): void {
				$a = $db->table( 'accounts' );
				$e = $db->table( 'journal_entries' );
				$l = $db->table( 'journal_lines' );
				foreach ( $db->rows( "SELECT business_id, id FROM {$a} WHERE system_key = 'inventory_adjustment'" ) as $adj ) {
					$open = (int) $db->value( "SELECT id FROM {$a} WHERE business_id = %d AND system_key = 'opening_balance'", array( (int) $adj['business_id'] ) );
					if ( ! $open ) {
						continue;
					}
					$lines = $db->rows(
						"SELECT l.id FROM {$l} l JOIN {$e} e ON e.id = l.entry_id
						WHERE l.business_id = %d AND l.account_id = %d AND l.credit > 0 AND e.source = 'stock_adjustment'",
						array( (int) $adj['business_id'], (int) $adj['id'] )
					);
					foreach ( $lines as $line ) {
						$db->update( $l, array( 'account_id' => $open ), array( 'id' => (int) $line['id'] ) );
					}
				}
			},
			// Delivery zone used to be written into the area text.
			'1.7.0' => static function ( $db ): void {
				$t = $db->table( 'orders' );
				foreach ( $db->rows( "SELECT id, area FROM {$t} WHERE zone = ''" ) as $r ) {
					if ( preg_match( '/inside|ভিতরে/i', (string) $r['area'] ) ) {
						$db->update( $t, array( 'zone' => 'inside', 'area' => trim( (string) preg_replace( '/,?\\s*(Inside Dhaka|ঢাকার ভিতরে)\\s*,?/u', '', (string) $r['area'] ), ', ' ) ), array( 'id' => (int) $r['id'] ) );
					}
				}
			},
		);
		return (array) apply_filters( 'goriber_hisab/migrations', $builtin );
	}
}
