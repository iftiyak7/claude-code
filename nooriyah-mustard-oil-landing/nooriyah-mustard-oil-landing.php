<?php
/**
 * Plugin Name:       Nooriyah Mustard Oil Landing Page
 * Plugin URI:        https://nooriyah.com.bd
 * Description:       নুরিয়াহ কাঠের ঘানিতে ভাঙানো ১ম চাপের দেশি সরিষার তেল (৫ লিটার) এর জন্য সুপার-ফাস্ট, মোশন গ্রাফিক্স সহ হাই-কনভার্টিং ল্যান্ডিং পেজ। সব লেখা, ছবি, দাম, রং ও অর্ডার ফর্ম ড্যাশবোর্ড থেকে এডিট করা যায়।
 * Version:           1.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Nooriyah
 * License:           GPL-2.0-or-later
 * Text Domain:       nooriyah-mustard-oil
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'NMO_VERSION', '1.1.0' );
define( 'NMO_FILE', __FILE__ );
define( 'NMO_DIR', plugin_dir_path( __FILE__ ) );
define( 'NMO_URL', plugin_dir_url( __FILE__ ) );
define( 'NMO_OPTION', 'nmo_settings' );
define( 'NMO_TEMPLATE', 'nmo-mustard-oil-landing.php' );

// Works with WooCommerce's High-Performance Order Storage.
add_action( 'before_woocommerce_init', function () {
	if ( class_exists( '\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil' ) ) {
		\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
	}
} );

require_once NMO_DIR . 'includes/fields.php';
require_once NMO_DIR . 'includes/helpers.php';
require_once NMO_DIR . 'includes/admin.php';
require_once NMO_DIR . 'includes/orders.php';

/**
 * Register the page template so it can be picked from Page > Template.
 */
add_filter( 'theme_page_templates', function ( $templates ) {
	$templates[ NMO_TEMPLATE ] = 'Mustard Oil Landing (Nooriyah)';
	return $templates;
} );

/**
 * Serve our own blank-canvas template for pages using it.
 */
add_filter( 'template_include', function ( $template ) {
	if ( is_singular( 'page' ) && NMO_TEMPLATE === get_page_template_slug( get_queried_object_id() ) ) {
		return NMO_DIR . 'templates/landing.php';
	}
	return $template;
}, 99 );

/**
 * On activation: seed defaults and create a landing page if none exists.
 */
register_activation_hook( __FILE__, function () {
	if ( false === get_option( NMO_OPTION ) ) {
		add_option( NMO_OPTION, nmo_defaults() );
	}
	nmo_register_order_cpt();
	flush_rewrite_rules();

	$existing = get_posts( array(
		'post_type'   => 'page',
		'meta_key'    => '_wp_page_template',
		'meta_value'  => NMO_TEMPLATE,
		'numberposts' => 1,
		'post_status' => 'any',
	) );
	if ( ! $existing ) {
		$page_id = wp_insert_post( array(
			'post_title'  => 'কাঠের ঘানির সরিষার তেল ৫ লিটার',
			'post_name'   => 'ghani-mustard-oil-5-litre',
			'post_status' => 'publish',
			'post_type'   => 'page',
		) );
		if ( $page_id && ! is_wp_error( $page_id ) ) {
			update_post_meta( $page_id, '_wp_page_template', NMO_TEMPLATE );
		}
	}
} );

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=nmo-settings' ) ) . '">Settings</a>' );
	return $links;
} );
