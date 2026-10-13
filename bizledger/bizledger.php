<?php
/**
 * Plugin Name:       BizLedger – Accounting, Inventory, Sales & POS
 * Plugin URI:        https://github.com/iftiyak7/claude-code
 * Description:       Business management for shops and companies: POS, sales, purchases, inventory, customers, suppliers, dues, double-entry accounting, invoices and reports.
 * Version:           1.0.2
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            BizLedger
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       bizledger
 * Domain Path:       /languages
 *
 * @package BizLedger
 */

defined( 'ABSPATH' ) || exit;

define( 'BIZLEDGER_VERSION', '1.0.2' );
define( 'BIZLEDGER_FILE', __FILE__ );
define( 'BIZLEDGER_DIR', plugin_dir_path( __FILE__ ) );
define( 'BIZLEDGER_URL', plugin_dir_url( __FILE__ ) );

if ( version_compare( PHP_VERSION, '8.1', '<' ) ) {
	add_action(
		'admin_notices',
		static function () {
			echo '<div class="notice notice-error"><p>' . esc_html__( 'BizLedger requires PHP 8.1 or newer.', 'bizledger' ) . '</p></div>';
		}
	);
	return;
}

require_once BIZLEDGER_DIR . 'src/autoload.php';

register_activation_hook( __FILE__, array( \BizLedger\Core\Installer::class, 'activate' ) );
register_deactivation_hook( __FILE__, array( \BizLedger\Core\Installer::class, 'deactivate' ) );

add_action( 'plugins_loaded', array( \BizLedger\Plugin::class, 'boot' ) );

/**
 * Access the BizLedger kernel (services) from add-ons:
 * bizledger()->sales->create( $ctx, $data ).
 */
function bizledger(): \BizLedger\Kernel {
	return \BizLedger\Plugin::kernel();
}
