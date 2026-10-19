<?php
/**
 * Plugin Name:       Goriber Hisab – Accounting, Inventory, Sales & POS
 * Plugin URI:        https://github.com/iftiyak7/claude-code
 * Description:       Business management for shops and companies: POS, sales, purchases, inventory, customers, suppliers, dues, double-entry accounting, invoices and reports.
 * Version:           1.17.1
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Goriber Hisab
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       goriber-hisab
 * Domain Path:       /languages
 *
 * @package GoriberHisab
 */

defined( 'ABSPATH' ) || exit;

define( 'GORIBER_HISAB_VERSION', '1.17.1' );
define( 'GORIBER_HISAB_FILE', __FILE__ );
define( 'GORIBER_HISAB_DIR', plugin_dir_path( __FILE__ ) );
define( 'GORIBER_HISAB_URL', plugin_dir_url( __FILE__ ) );

if ( version_compare( PHP_VERSION, '8.1', '<' ) ) {
	add_action(
		'admin_notices',
		static function () {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'Goriber Hisab requires PHP 8.1 or newer.', 'goriber-hisab' ) . '</p></div>';
		}
	);
	return;
}

require_once GORIBER_HISAB_DIR . 'src/autoload.php';

register_activation_hook( __FILE__, array( \GoriberHisab\Core\Installer::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \GoriberHisab\Core\Installer::class, 'deactivate' ) );

add_action( 'plugins_loaded', array( \GoriberHisab\Plugin::class, 'boot' ) );

/**
 * Access the Goriber Hisab kernel (services) from add-ons:
 * goriber_hisab()->sales->create( $ctx, $data ).
 */
function goriber_hisab(): \GoriberHisab\Kernel {
	return \GoriberHisab\Plugin::kernel();
}
