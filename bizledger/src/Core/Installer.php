<?php
/**
 * Activation, deactivation and schema migrations.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Core;

use BizLedger\Admin\AppRoute;
use BizLedger\Database\Schema;
use BizLedger\Database\WpdbDatabase;

/**
 * dbDelta-based installer plus versioned data migrations.
 */
final class Installer {

	public const OPTION = 'bizledger_db_version';

	public static function activate(): void {
		self::migrate();
		AppRoute::addRewrite();
		flush_rewrite_rules();
		if ( ! wp_next_scheduled( 'bizledger_daily' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'bizledger_daily' );
		}
		add_option( 'bizledger_activation_redirect', 1 );
	}

	public static function deactivate(): void {
		wp_clear_scheduled_hook( 'bizledger_daily' );
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
		return (array) apply_filters( 'bizledger/migrations', array() );
	}
}
