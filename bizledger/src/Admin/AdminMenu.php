<?php
/**
 * wp-admin integration.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Admin;

/**
 * A single admin menu entry that opens the full-screen app, plus the
 * activation redirect to the setup wizard.
 */
final class AdminMenu {

	public function register(): void {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'activationRedirect' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( BIZLEDGER_FILE ), array( $this, 'links' ) );
	}

	public function menu(): void {
		add_menu_page(
			__( 'BizLedger', 'bizledger' ),
			__( 'BizLedger', 'bizledger' ),
			'read',
			'bizledger',
			array( $this, 'render' ),
			'dashicons-chart-area',
			3
		);
	}

	public function render(): void {
		$url = AppRoute::url();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'BizLedger', 'bizledger' ); ?></h1>
			<p><?php esc_html_e( 'BizLedger runs as a full-screen app so it works like a native POS on desktop, tablet and phone.', 'bizledger' ); ?></p>
			<p><a class="button button-primary button-hero" href="<?php echo esc_url( $url ); ?>"><?php esc_html_e( 'Open BizLedger', 'bizledger' ); ?></a></p>
			<p class="description"><?php echo esc_html( $url ); ?></p>
			<script>setTimeout(function(){window.location.href=<?php echo wp_json_encode( esc_url_raw( $url ) ); ?>;},600);</script>
		</div>
		<?php
	}

	public function activationRedirect(): void {
		if ( ! get_option( 'bizledger_activation_redirect' ) ) {
			return;
		}
		delete_option( 'bizledger_activation_redirect' );
		if ( wp_doing_ajax() || is_network_admin() || isset( $_GET['activate-multi'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		wp_safe_redirect( AppRoute::url( '#/setup' ) );
		exit;
	}

	/**
	 * @param array<int,string> $links Links.
	 * @return array<int,string>
	 */
	public function links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( AppRoute::url() ) . '">' . esc_html__( 'Open app', 'bizledger' ) . '</a>' );
		return $links;
	}
}
