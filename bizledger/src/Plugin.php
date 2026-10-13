<?php
/**
 * WordPress bootstrap.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger;

use BizLedger\Admin\AdminMenu;
use BizLedger\Admin\AppRoute;
use BizLedger\Core\Cron;
use BizLedger\Core\Installer;
use BizLedger\Database\WpdbDatabase;
use BizLedger\Http\Api;
use BizLedger\Support\Clock;
use BizLedger\Support\Events;
use BizLedger\Tenancy\WpUserDirectory;

/**
 * Wires the kernel into WordPress hooks.
 */
final class Plugin {

	private static ?Kernel $kernel = null;

	public static function kernel(): Kernel {
		if ( null === self::$kernel ) {
			global $wpdb;
			self::$kernel = new Kernel( new WpdbDatabase( $wpdb ), new Clock(), new Events(), new WpUserDirectory() );
		}
		return self::$kernel;
	}

	public static function boot(): void {
		load_plugin_textdomain( 'bizledger', false, dirname( plugin_basename( BIZLEDGER_FILE ) ) . '/languages' );
		Installer::maybeMigrate();

		$kernel = self::kernel();
		$kernel->notifications->subscribe();

		( new Api( $kernel ) )->register();
		( new AppRoute( $kernel ) )->register();
		( new AdminMenu() )->register();
		( new Cron( $kernel ) )->register();

		do_action( 'bizledger/loaded', $kernel );
	}
}
