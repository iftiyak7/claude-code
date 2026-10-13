<?php
/**
 * Full-screen app, PWA files and print views.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Admin;

use BizLedger\Http\Api;
use BizLedger\Kernel;
use BizLedger\Support\BizLedgerException;

/**
 * Serves, under /{slug}/ (default "bizledger"):
 *   /                      the single-page app shell (login required)
 *   /manifest.webmanifest  PWA manifest
 *   /sw.js                 service worker (scoped to the app path)
 *   /print/{type}/{id}     printable documents (A4, A5, 80mm, 58mm)
 */
final class AppRoute {

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public static function slug(): string {
		$slug = sanitize_title( (string) get_option( 'bizledger_app_slug', 'bizledger' ) );
		return '' !== $slug ? $slug : 'bizledger';
	}

	public static function url( string $suffix = '' ): string {
		if ( '' === (string) get_option( 'permalink_structure' ) ) {
			// Plain permalinks: the server never routes /bizledger/ to WordPress.
			return home_url( '/?bizledger_app=/' ) . ltrim( $suffix, '/' );
		}
		return home_url( '/' . self::slug() . '/' ) . ltrim( $suffix, '/' );
	}

	/**
	 * The app hosted inside wp-admin. Always works: admin pages bypass page
	 * caches, themes and rewrite rules.
	 */
	public static function adminUrl( string $hash = '' ): string {
		return admin_url( 'admin.php?page=bizledger' ) . $hash;
	}

	public static function addRewrite(): void {
		add_rewrite_rule( '^' . preg_quote( self::slug(), '#' ) . '(?:/(.*))?/?$', 'index.php?bizledger_app=/$matches[1]', 'top' );
	}

	public function register(): void {
		add_action( 'init', array( self::class, 'addRewrite' ) );
		add_filter(
			'query_vars',
			static function ( array $vars ): array {
				$vars[] = 'bizledger_app';
				return $vars;
			}
		);
		// Match the URL path directly so the app works even when rewrite rules
		// are stale or another plugin/theme interferes with query vars.
		add_action( 'parse_request', array( $this, 'serveFront' ), 0 );
		add_action( 'template_redirect', array( $this, 'serveFallback' ), 0 );
		add_action( 'admin_init', array( $this, 'serveAdmin' ), 0 );
	}

	/**
	 * /{slug}/… or ?bizledger_app=… on the front end.
	 */
	public function serveFront( \WP $wp ): void {
		$slug = self::slug();
		$path = trim( (string) $wp->request, '/' );
		if ( $path === $slug || str_starts_with( $path, $slug . '/' ) ) {
			$this->dispatch( substr( $path, strlen( $slug ) ), 'front' );
		}
		if ( isset( $_GET['bizledger_app'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			$this->dispatch( sanitize_text_field( wp_unslash( $_GET['bizledger_app'] ) ), 'front' ); // phpcs:ignore WordPress.Security.NonceVerification
		}
	}

	public function serveFallback(): void {
		$path = (string) get_query_var( 'bizledger_app' );
		if ( '' !== $path ) {
			$this->dispatch( $path, 'front' );
		}
	}

	/**
	 * wp-admin/admin.php?page=bizledger[&bzl_path=print/sale/1]
	 */
	public function serveAdmin(): void {
		// phpcs:disable WordPress.Security.NonceVerification
		if ( wp_doing_ajax() || ! isset( $_GET['page'] ) || 'bizledger' !== $_GET['page'] ) {
			return;
		}
		$path = isset( $_GET['bzl_path'] ) ? sanitize_text_field( wp_unslash( $_GET['bzl_path'] ) ) : '';
		// phpcs:enable
		$this->dispatch( $path, 'admin' );
	}

	/**
	 * @return never
	 */
	private function dispatch( string $path, string $mode ): void {
		$path = trim( $path, '/' );
		// Never let a page cache store the app or print views.
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );

		if ( 'manifest.webmanifest' === $path ) {
			$this->manifest();
		} elseif ( 'sw.js' === $path ) {
			$this->serviceWorker();
		} elseif ( preg_match( '#^print/(sale|purchase|payment|return|statement)/(\d+)$#', $path, $m ) ) {
			$this->print( $m[1], (int) $m[2] );
		} else {
			$this->shell( $mode );
		}
		exit;
	}

	private function shell( string $mode = 'front' ): void {
		if ( ! is_user_logged_in() ) {
			auth_redirect();
		}
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		header( 'Referrer-Policy: same-origin' );
		$user   = wp_get_current_user();
		$locale = determine_locale();
		$config = array(
			'restUrl'   => esc_url_raw( rest_url( Api::NAMESPACE . '/' ) ),
			'nonce'     => wp_create_nonce( 'wp_rest' ),
			'mode'      => $mode,
			'appUrl'    => esc_url_raw( 'admin' === $mode ? self::adminUrl() : self::url() ),
			'frontUrl'  => esc_url_raw( self::url() ),
			'assetsUrl' => esc_url_raw( BIZLEDGER_URL . 'assets/' ),
			'version'   => BIZLEDGER_VERSION,
			'locale'    => $locale,
			'lang'      => str_starts_with( $locale, 'bn' ) ? 'bn' : 'en',
			'logoutUrl' => esc_url_raw( wp_logout_url( 'admin' === $mode ? self::adminUrl() : self::url() ) ),
			'adminUrl'  => esc_url_raw( admin_url() ),
			'userName'  => $user->display_name,
		);
		$asset  = static fn( string $p ) => esc_url( BIZLEDGER_URL . 'assets/' . $p . '?v=' . BIZLEDGER_VERSION );
		?>
<!doctype html>
<html lang="<?php echo esc_attr( str_replace( '_', '-', $locale ) ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#1d4ed8">
<meta name="robots" content="noindex, nofollow">
<title><?php esc_html_e( 'BizLedger', 'bizledger' ); ?></title>
<?php if ( 'front' === $mode ) : ?>
<link rel="manifest" href="<?php echo esc_url( self::url( 'manifest.webmanifest' ) ); ?>">
<?php endif; ?>
<link rel="icon" href="<?php echo $asset( 'img/icon.svg' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?php echo $asset( 'css/app.css' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">
<script>window.BZL = <?php echo wp_json_encode( $config ); ?>;</script>
<script type="module" src="<?php echo $asset( 'js/app.js' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>"></script>
</head>
<body>
<div id="app" aria-live="polite"><div class="boot"><div class="spinner" role="status" aria-label="<?php esc_attr_e( 'Loading', 'bizledger' ); ?>"></div></div></div>
<noscript><?php esc_html_e( 'BizLedger needs JavaScript enabled.', 'bizledger' ); ?></noscript>
</body>
</html>
		<?php
	}

	private function manifest(): void {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode(
			array(
				'name'             => 'BizLedger',
				'short_name'       => 'BizLedger',
				'description'      => __( 'Accounting, inventory, sales and POS', 'bizledger' ),
				'start_url'        => self::url( '#/' ),
				'scope'            => self::url(),
				'display'          => 'standalone',
				'background_color' => '#f8fafc',
				'theme_color'      => '#1d4ed8',
				'icons'            => array(
					array(
						'src'     => BIZLEDGER_URL . 'assets/img/icon.svg',
						'sizes'   => 'any',
						'type'    => 'image/svg+xml',
						'purpose' => 'any maskable',
					),
				),
				'shortcuts'        => array(
					array(
						'name' => __( 'POS', 'bizledger' ),
						'url'  => self::url( '#/pos' ),
					),
					array(
						'name' => __( 'New purchase', 'bizledger' ),
						'url'  => self::url( '#/purchases/new' ),
					),
				),
			)
		);
	}

	private function serviceWorker(): void {
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: ' . wp_parse_url( self::url(), PHP_URL_PATH ) );
		header( 'Cache-Control: no-cache' );
		$version = BIZLEDGER_VERSION;
		$assets  = BIZLEDGER_URL . 'assets/';
		echo 'const BZL_VERSION=' . wp_json_encode( $version ) . ';const BZL_ASSETS=' . wp_json_encode( $assets ) . ";\n";
		readfile( BIZLEDGER_DIR . 'assets/js/sw.js' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	}

	/**
	 * Printable document. Requires login, membership, a REST nonce (CSRF) and
	 * the document's own view permission.
	 */
	private function print( string $type, int $id ): void {
		if ( ! is_user_logged_in() ) {
			auth_redirect();
		}
		$nonce = isset( $_GET['_wpnonce'] ) ? sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			wp_die( esc_html__( 'This print link has expired. Please print again from the app.', 'bizledger' ), 403 );
		}
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- verified above.
		$business = isset( $_GET['b'] ) ? absint( $_GET['b'] ) : 0;
		$branch   = isset( $_GET['br'] ) ? absint( $_GET['br'] ) : 0;
		$paper    = isset( $_GET['paper'] ) ? sanitize_key( wp_unslash( $_GET['paper'] ) ) : '';
		$auto     = ! empty( $_GET['autoprint'] );
		$from     = isset( $_GET['from'] ) ? sanitize_text_field( wp_unslash( $_GET['from'] ) ) : '';
		$to       = isset( $_GET['to'] ) ? sanitize_text_field( wp_unslash( $_GET['to'] ) ) : '';
		// phpcs:enable

		try {
			$ctx = $this->k->contexts->forUser( get_current_user_id(), $business, $branch );
			$ctx->authorize( 'invoices.print' );
			$settings = $this->k->settings->all( $ctx );
			$doc      = match ( $type ) {
				'sale'      => $this->k->sales->get( $ctx, $id ),
				'purchase'  => $this->k->purchases->get( $ctx, $id ),
				'payment'   => $this->k->payments->get( $ctx, $id ),
				'return'    => $this->k->returns->get( $ctx, $id ),
				'statement' => $this->k->contacts->statement( $ctx, isset( $_GET['kind'] ) && 'supplier' === $_GET['kind'] ? 'supplier' : 'customer', $id, array( 'from' => $from, 'to' => $to ) ), // phpcs:ignore WordPress.Security.NonceVerification
			};
			$business_row = $this->k->businesses->get( $ctx->business_id );
		} catch ( BizLedgerException $e ) {
			wp_die( esc_html( $e->getMessage() ), (int) $e->status() );
		}

		$paper = in_array( $paper, array( 'a4', 'a5', '80mm', '58mm' ), true ) ? $paper : (string) ( 'sale' === $type ? $settings['invoice.paper'] : 'a4' );
		nocache_headers();
		$view = array(
			'type'     => $type,
			'doc'      => $doc,
			'business' => $business_row,
			'settings' => $settings,
			'paper'    => $paper,
			'auto'     => $auto,
			'ctx'      => $ctx,
		);
		$template = (string) apply_filters( 'bizledger/print_template', BIZLEDGER_DIR . 'templates/print.php', $type, $view );
		( static function ( array $view ) use ( $template ) {
			include $template;
		} )( $view );
	}
}
