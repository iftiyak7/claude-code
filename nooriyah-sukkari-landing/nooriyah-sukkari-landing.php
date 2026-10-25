<?php
/**
 * Plugin Name:       Nooriyah Sukkari Landing Page
 * Plugin URI:        https://nooriyah.com.bd
 * Description:       সুক্কারি মুফাত্তাল খেজুরের জন্য সুপার-ফাস্ট, মোশন গ্রাফিক্স সহ হাই-কনভার্টিং ল্যান্ডিং পেজ। সব লেখা, ছবি, দাম, রং ও অর্ডার ফর্ম ড্যাশবোর্ড থেকে এডিট করা যায়।
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Nooriyah
 * License:           GPL-2.0-or-later
 * Text Domain:       nooriyah-sukkari
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'NSL_VERSION', '1.0.0' );
define( 'NSL_FILE', __FILE__ );
define( 'NSL_DIR', plugin_dir_path( __FILE__ ) );
define( 'NSL_URL', plugin_dir_url( __FILE__ ) );
define( 'NSL_OPTION', 'nsl_settings' );
define( 'NSL_TEMPLATE', 'nsl-sukkari-landing.php' );

require_once NSL_DIR . 'includes/fields.php';
require_once NSL_DIR . 'includes/helpers.php';
require_once NSL_DIR . 'includes/admin.php';
require_once NSL_DIR . 'includes/orders.php';

/**
 * Register the page template so it can be picked from Page > Template.
 */
add_filter( 'theme_page_templates', function ( $templates ) {
	$templates[ NSL_TEMPLATE ] = 'Sukkari Landing (Nooriyah)';
	return $templates;
} );

/**
 * Serve our own blank-canvas template for pages using it.
 */
add_filter( 'template_include', function ( $template ) {
	if ( is_singular( 'page' ) && NSL_TEMPLATE === get_page_template_slug( get_queried_object_id() ) ) {
		return NSL_DIR . 'templates/landing.php';
	}
	return $template;
}, 99 );

/**
 * On activation: seed defaults and create a landing page if none exists.
 */
register_activation_hook( __FILE__, function () {
	if ( false === get_option( NSL_OPTION ) ) {
		add_option( NSL_OPTION, nsl_defaults() );
	}
	nsl_register_order_cpt();
	flush_rewrite_rules();

	$existing = get_posts( array(
		'post_type'   => 'page',
		'meta_key'    => '_wp_page_template',
		'meta_value'  => NSL_TEMPLATE,
		'numberposts' => 1,
		'post_status' => 'any',
	) );
	if ( ! $existing ) {
		$page_id = wp_insert_post( array(
			'post_title'  => 'সুক্কারি মুফাত্তাল খেজুর',
			'post_name'   => 'sukkari-mufattal',
			'post_status' => 'publish',
			'post_type'   => 'page',
		) );
		if ( $page_id && ! is_wp_error( $page_id ) ) {
			update_post_meta( $page_id, '_wp_page_template', NSL_TEMPLATE );
		}
	}
} );

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=nsl-settings' ) ) . '">Settings</a>' );
	return $links;
} );
