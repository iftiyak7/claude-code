<?php
/**
 * wp-admin integration.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Admin;

/**
 * A single admin menu entry that opens the full-screen app, plus the
 * activation redirect to the setup wizard.
 */
final class AdminMenu {

	public function register(): void {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'activationRedirect' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( GORIBER_HISAB_FILE ), array( $this, 'links' ) );
	}

	public function menu(): void {
		add_menu_page(
			__( 'Goriber Hisab', 'goriber-hisab' ),
			__( 'Goriber Hisab', 'goriber-hisab' ),
			'read',
			'goriber-hisab',
			array( $this, 'render' ),
			'dashicons-chart-area',
			3
		);
		if ( current_user_can( 'manage_options' ) ) {
			// Direct links into the app's owner screens.
			foreach ( array(
				array( __( 'Shops & payments', 'goriber-hisab' ), '#/platform' ),
				array( __( 'Home page editor', 'goriber-hisab' ), '#/platform?tab=home' ),
				array( __( 'Prices & payment numbers', 'goriber-hisab' ), '#/platform?tab=settings' ),
			) as $item ) {
				add_submenu_page( 'goriber-hisab', $item[0], $item[0], 'manage_options', AppRoute::adminUrl( $item[1] ) );
			}
		}
	}

	/**
	 * Normally never reached: AppRoute::serveAdmin() renders the full-screen
	 * app on admin_init. Shown only if that was prevented.
	 */
	public function render(): void {
		echo '<div class="wrap"><h1>' . esc_html__( 'Goriber Hisab', 'goriber-hisab' ) . '</h1><p><a class="button button-primary" href="' . esc_url( AppRoute::url() ) . '">' . esc_html__( 'Open Goriber Hisab', 'goriber-hisab' ) . '</a></p></div>';
	}

	public function activationRedirect(): void {
		if ( ! get_option( 'bizledger_activation_redirect' ) ) {
			return;
		}
		delete_option( 'bizledger_activation_redirect' );
		if ( wp_doing_ajax() || is_network_admin() || isset( $_GET['activate-multi'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		wp_safe_redirect( AppRoute::adminUrl( '#/setup' ) );
		exit;
	}

	/**
	 * @param array<int,string> $links Links.
	 * @return array<int,string>
	 */
	public function links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( AppRoute::adminUrl() ) . '">' . esc_html__( 'Open app', 'goriber-hisab' ) . '</a>' );
		return $links;
	}
}
