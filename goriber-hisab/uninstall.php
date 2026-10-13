<?php
/**
 * Uninstall handler.
 *
 * Business data is financial record-keeping: it is only removed when the
 * site owner explicitly opted in (Settings → Danger zone sets the option).
 *
 * @package GoriberHisab
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

if ( ! get_option( 'bizledger_delete_data_on_uninstall' ) ) {
	return;
}

require_once __DIR__ . '/src/autoload.php';

global $wpdb;
$db = new \GoriberHisab\Database\WpdbDatabase( $wpdb );
foreach ( array_keys( \GoriberHisab\Database\Schema::tables() ) as $table ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . $db->table( $table ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
}
delete_option( 'bizledger_db_version' );
delete_option( 'bizledger_delete_data_on_uninstall' );
delete_option( 'bizledger_app_slug' );
wp_clear_scheduled_hook( 'goriber_hisab_daily' );
