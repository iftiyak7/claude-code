<?php
/**
 * WordPress bootstrap.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab;

use GoriberHisab\Admin\AdminMenu;
use GoriberHisab\Admin\AppRoute;
use GoriberHisab\Admin\ClientAccess;
use GoriberHisab\Core\Cron;
use GoriberHisab\Core\Installer;
use GoriberHisab\Database\WpdbDatabase;
use GoriberHisab\Http\Api;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Events;
use GoriberHisab\Tenancy\WpUserDirectory;

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
		load_plugin_textdomain( 'goriber-hisab', false, dirname( plugin_basename( GORIBER_HISAB_FILE ) ) . '/languages' );
		Installer::maybeMigrate();

		$kernel = self::kernel();
		$kernel->notifications->subscribe();

		( new Api( $kernel ) )->register();
		( new AppRoute( $kernel ) )->register();
		( new AdminMenu() )->register();
		( new ClientAccess( $kernel ) )->register();
		( new Cron( $kernel ) )->register();

		do_action( 'goriber_hisab/loaded', $kernel );
	}
}
