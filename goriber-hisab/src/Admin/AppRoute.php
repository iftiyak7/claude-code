<?php
/**
 * Full-screen app, PWA files and print views.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Admin;

use GoriberHisab\Http\Api;
use GoriberHisab\Kernel;
use GoriberHisab\Support\HisabException;

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
		$slug = sanitize_title( (string) get_option( 'bizledger_app_slug', 'app' ) );
		return '' !== $slug && 'goriber-hisab' !== $slug ? $slug : 'app';
	}

	/**
	 * Clean URLs (/app/) work whenever the web server hands unknown paths to
	 * WordPress — true for pretty permalinks and for most hosts even with
	 * plain permalinks (checked once with a loopback request). Otherwise the
	 * query form (/?hisab=/) is used.
	 */
	public static function pretty(): bool {
		if ( '' !== (string) get_option( 'permalink_structure' ) ) {
			return true;
		}
		return 'yes' === get_option( 'goriber_hisab_paths_ok' );
	}

	public static function url( string $suffix = '' ): string {
		if ( ! self::pretty() ) {
			return home_url( '/?hisab=/' ) . ltrim( $suffix, '/' );
		}
		return home_url( '/' . self::slug() . '/' ) . ltrim( $suffix, '/' );
	}

	/**
	 * The app hosted inside wp-admin. Always works: admin pages bypass page
	 * caches, themes and rewrite rules.
	 */
	public static function adminUrl( string $hash = '' ): string {
		return admin_url( 'admin.php?page=goriber-hisab' ) . $hash;
	}

	/**
	 * Branded login page for shop owners and staff.
	 */
	public static function loginUrl(): string {
		return self::url( 'login' );
	}

	public static function addRewrite(): void {
		add_rewrite_rule( '^' . preg_quote( self::slug(), '#' ) . '(?:/(.*))?/?$', 'index.php?hisab=/$matches[1]', 'top' );
	}

	public function register(): void {
		add_action( 'init', array( self::class, 'addRewrite' ) );
		add_filter(
			'query_vars',
			static function ( array $vars ): array {
				$vars[] = 'hisab';
				return $vars;
			}
		);
		// Match the URL path directly so the app works with plain permalinks,
		// stale rewrite rules, or a theme that interferes with query vars.
		add_action( 'parse_request', array( $this, 'serveFront' ), 0 );
		add_action( 'template_redirect', array( $this, 'serveFallback' ), 0 );
		add_action( 'admin_init', array( $this, 'serveAdmin' ), 0 );
		add_action( 'admin_init', array( self::class, 'checkPaths' ) );
	}

	/**
	 * Path of the current request relative to the site home, without slashes.
	 */
	public static function requestPath(): string {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		$path = rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) );
		$home = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		if ( '' !== $home && '/' !== $home && str_starts_with( $path, $home ) ) {
			$path = substr( $path, strlen( $home ) );
		}
		$path = trim( $path, '/' );
		return str_starts_with( $path, 'index.php' ) ? trim( substr( $path, 9 ), '/' ) : $path;
	}

	/**
	 * /{slug}/…, ?hisab=… (or the old ?bizledger_app=…, /bizledger/…) on the front end,
	 * plus the optional landing page on the home page.
	 */
	public function serveFront( \WP $wp ): void {
		unset( $wp );
		// phpcs:disable WordPress.Security.NonceVerification
		foreach ( array( 'hisab', 'bizledger_app' ) as $var ) {
			if ( isset( $_GET[ $var ] ) ) {
				$this->dispatch( sanitize_text_field( wp_unslash( $_GET[ $var ] ) ), 'front' );
			}
		}
		$slug = self::slug();
		$path = self::requestPath();
		if ( $path === $slug || str_starts_with( $path, $slug . '/' ) ) {
			if ( ! self::pretty() && '' === (string) get_option( 'permalink_structure' ) ) {
				// The server routed a clean path to us, so clean URLs work here.
				update_option( 'goriber_hisab_paths_ok', 'yes', true );
			}
			$this->dispatch( substr( $path, strlen( $slug ) ), 'front' );
		}
		if ( 'bizledger' === $path || str_starts_with( $path, 'bizledger/' ) || 'login' === $path ) {
			wp_safe_redirect( 'login' === $path ? self::loginUrl() : self::url() );
			exit;
		}
		$plain = array_diff( array_keys( $_GET ), array( 'lang', 'utm_source', 'utm_medium', 'utm_campaign', 'fbclid', 'gclid' ) );
		// phpcs:enable
		if ( '' === $path && array() === $plain && 'GET' === ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) && Landing::enabled() ) {
			$this->noCache();
			( new Landing( $this->k ) )->render();
			exit;
		}
	}

	public function serveFallback(): void {
		$path = (string) get_query_var( 'hisab' );
		if ( '' !== $path ) {
			$this->dispatch( $path, 'front' );
		}
	}

	/**
	 * wp-admin/admin.php?page=goriber-hisab[&bzl_path=print/sale/1]
	 */
	public function serveAdmin(): void {
		// phpcs:disable WordPress.Security.NonceVerification
		if ( wp_doing_ajax() || ! isset( $_GET['page'] ) ) {
			return;
		}
		if ( 'bizledger' === $_GET['page'] ) {
			wp_safe_redirect( self::adminUrl() );
			exit;
		}
		if ( 'goriber-hisab' !== $_GET['page'] ) {
			return;
		}
		$path = isset( $_GET['bzl_path'] ) ? sanitize_text_field( wp_unslash( $_GET['bzl_path'] ) ) : '';
		// phpcs:enable
		$this->dispatch( $path, 'admin' );
	}

	/**
	 * With plain permalinks, find out once (re-checked weekly) whether the
	 * server routes /app/ to WordPress, so links can use the clean form.
	 */
	public static function checkPaths(): void {
		if ( '' !== (string) get_option( 'permalink_structure' ) || 'yes' === get_option( 'goriber_hisab_paths_ok' ) || wp_doing_ajax() ) {
			return;
		}
		$last = (int) get_option( 'goriber_hisab_paths_checked', 0 );
		if ( $last > time() - WEEK_IN_SECONDS ) {
			return;
		}
		update_option( 'goriber_hisab_paths_checked', time(), false );
		$res = wp_remote_get(
			home_url( '/' . self::slug() . '/manifest.webmanifest' ),
			array(
				'timeout'   => 5,
				'sslverify' => false,
			)
		);
		if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) && str_contains( (string) wp_remote_retrieve_body( $res ), '"start_url"' ) ) {
			update_option( 'goriber_hisab_paths_ok', 'yes', true );
		}
	}

	private function noCache(): void {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		header( 'X-LiteSpeed-Cache-Control: no-cache' );
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
	}

	/**
	 * @return never
	 */
	private function dispatch( string $path, string $mode ): void {
		$path = trim( $path, '/' );
		// Never let a page cache store the app or print views.
		$this->noCache();

		if ( 'manifest.webmanifest' === $path ) {
			$this->manifest();
		} elseif ( 'sw.js' === $path ) {
			$this->serviceWorker();
		} elseif ( 'login' === $path ) {
			$this->login();
		} elseif ( preg_match( '#^print/(sale|purchase|payment|return|statement)/(\d+)$#', $path, $m ) ) {
			$this->print( $m[1], (int) $m[2] );
		} else {
			$this->shell( $mode );
		}
		exit;
	}

	private function shell( string $mode = 'front' ): void {
		if ( ! is_user_logged_in() ) {
			if ( 'front' === $mode ) {
				wp_safe_redirect( self::loginUrl() );
				exit;
			}
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
			'assetsUrl' => esc_url_raw( GORIBER_HISAB_URL . 'assets/' ),
			'version'   => GORIBER_HISAB_VERSION,
			'locale'    => $locale,
			'lang'      => Landing::lang(),
			'logoutUrl' => esc_url_raw( wp_logout_url( 'admin' === $mode ? self::adminUrl() : self::url() ) ),
			'adminUrl'  => esc_url_raw( admin_url() ),
			'appOnly'   => ( new ClientAccess( $this->k ) )->isAppOnly( (int) $user->ID ),
			'userName'  => $user->display_name,
		);
		$asset  = static fn( string $p ) => esc_url( GORIBER_HISAB_URL . 'assets/' . $p . '?v=' . GORIBER_HISAB_VERSION );
		?>
<!doctype html>
<html lang="<?php echo esc_attr( str_replace( '_', '-', $locale ) ); ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1a2e">
<meta name="robots" content="noindex, nofollow">
<title><?php esc_html_e( 'Goriber Hisab', 'goriber-hisab' ); ?></title>
<?php if ( 'front' === $mode ) : ?>
<link rel="manifest" href="<?php echo esc_url( self::url( 'manifest.webmanifest' ) ); ?>">
<?php endif; ?>
<link rel="icon" href="<?php echo $asset( 'img/icon.svg' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?php echo $asset( 'css/app.css' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">
<script>window.BZL = <?php echo wp_json_encode( $config ); ?>;</script>
<script type="module" src="<?php echo $asset( 'js/app.js' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>"></script>
</head>
<body>
<div id="app" aria-live="polite"><div class="boot"><div class="spinner" role="status" aria-label="<?php esc_attr_e( 'Loading', 'goriber-hisab' ); ?>"></div></div></div>
<noscript><?php esc_html_e( 'Goriber Hisab needs JavaScript enabled.', 'goriber-hisab' ); ?></noscript>
</body>
</html>
		<?php
	}

	/**
	 * Email + password login. Uses WordPress authentication (wp_signon), so
	 * password hashing, lockout and 2FA plugins all keep working.
	 */
	private function login(): void {
		$error = '';
		$login = '';
		$lang  = Landing::lang();
		$L     = static fn( string $bn, string $en ): string => 'en' === $lang ? $en : $bn;
		// phpcs:disable WordPress.Security.NonceVerification -- verified below.
		if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			$login = isset( $_POST['log'] ) ? sanitize_text_field( wp_unslash( $_POST['log'] ) ) : '';
			$pass  = isset( $_POST['pwd'] ) ? (string) wp_unslash( $_POST['pwd'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			$nonce = isset( $_POST['_gh'] ) ? sanitize_text_field( wp_unslash( $_POST['_gh'] ) ) : '';
			try {
				$this->k->limiter->hit( 'login:' . Api::clientIp(), 10, 600 );
				if ( ! wp_verify_nonce( $nonce, 'goriber_login' ) ) {
					$error = $L( 'পেজের মেয়াদ শেষ হয়েছে, আবার চেষ্টা করুন।', 'The page expired. Please try again.' );
				} else {
					$user = wp_signon(
						array(
							'user_login'    => $login,
							'user_password' => $pass,
							'remember'      => ! empty( $_POST['rememberme'] ),
						),
						''
					);
					if ( is_wp_error( $user ) ) {
						$error = $L( 'ইমেইল বা পাসওয়ার্ড মেলেনি। আবার দেখুন।', 'Wrong email or password. Please check and try again.' );
					} else {
						$to = isset( $_POST['redirect_to'] ) ? wp_validate_redirect( esc_url_raw( wp_unslash( $_POST['redirect_to'] ) ), '' ) : '';
						wp_safe_redirect( '' !== $to ? $to : self::url() );
						exit;
					}
				}
			} catch ( HisabException $e ) {
				$error = $L( 'অনেকবার চেষ্টা করা হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন।', 'Too many attempts. Please wait 10 minutes.' );
			}
		} elseif ( is_user_logged_in() ) {
			wp_safe_redirect( self::url() );
			exit;
		}
		$redirect = isset( $_REQUEST['redirect_to'] ) ? esc_url_raw( wp_unslash( $_REQUEST['redirect_to'] ) ) : '';
		// phpcs:enable
		$platform = $this->k->platform->config();
		$brand    = (string) $platform['brand'];
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		header( 'Referrer-Policy: same-origin' );
		status_header( '' !== $error ? 401 : 200 );
		include GORIBER_HISAB_DIR . 'templates/login.php';
	}

	private function manifest(): void {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode(
			array(
				'name'             => 'Goriber Hisab',
				'short_name'       => 'Goriber Hisab',
				'description'      => __( 'Accounting, inventory, sales and POS', 'goriber-hisab' ),
				'start_url'        => self::url( '#/' ),
				'scope'            => self::url(),
				'display'          => 'standalone',
				'background_color' => '#f8fafc',
				'theme_color'      => '#0b1a2e',
				'icons'            => array(
					array(
						'src'     => GORIBER_HISAB_URL . 'assets/img/icon.svg',
						'sizes'   => 'any',
						'type'    => 'image/svg+xml',
						'purpose' => 'any maskable',
					),
				),
				'shortcuts'        => array(
					array(
						'name' => __( 'POS', 'goriber-hisab' ),
						'url'  => self::url( '#/pos' ),
					),
					array(
						'name' => __( 'New purchase', 'goriber-hisab' ),
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
		$version = GORIBER_HISAB_VERSION;
		$assets  = GORIBER_HISAB_URL . 'assets/';
		echo 'const BZL_VERSION=' . wp_json_encode( $version ) . ';const BZL_ASSETS=' . wp_json_encode( $assets ) . ";\n";
		readfile( GORIBER_HISAB_DIR . 'assets/js/sw.js' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
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
			wp_die( esc_html__( 'This print link has expired. Please print again from the app.', 'goriber-hisab' ), 403 );
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
		} catch ( HisabException $e ) {
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
		$template = (string) apply_filters( 'goriber_hisab/print_template', GORIBER_HISAB_DIR . 'templates/print.php', $type, $view );
		( static function ( array $view ) use ( $template ) {
			include $template;
		} )( $view );
	}
}
