<?php
/**
 * Public landing page (site home) and the shared language choice.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Admin;

use GoriberHisab\Kernel;

/**
 * Marketing page shown on the site's home page (can be switched off in
 * Shops → Prices & settings). Bangla by default, English on request.
 */
final class Landing {

	public const COOKIE = 'gh_lang';

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public static function enabled(): bool {
		$config = get_option( 'bizledger_platform', array() );
		return ! is_array( $config ) || ! array_key_exists( 'landing', $config ) || ! empty( $config['landing'] );
	}

	/**
	 * Current public-page language: ?lang= (remembered in a cookie) → cookie → bn.
	 */
	public static function lang(): string {
		// phpcs:disable WordPress.Security.NonceVerification
		if ( isset( $_GET['lang'] ) && in_array( $_GET['lang'], array( 'bn', 'en' ), true ) ) {
			$lang = sanitize_key( $_GET['lang'] );
			if ( ! headers_sent() ) {
				setcookie( self::COOKIE, $lang, time() + YEAR_IN_SECONDS, COOKIEPATH ? COOKIEPATH : '/', COOKIE_DOMAIN ? (string) COOKIE_DOMAIN : '', is_ssl(), false );
			}
			$_COOKIE[ self::COOKIE ] = $lang;
			return $lang;
		}
		$cookie = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_key( $_COOKIE[ self::COOKIE ] ) : '';
		// phpcs:enable
		return 'en' === $cookie ? 'en' : 'bn';
	}

	public function render(): void {
		$lang     = self::lang();
		$config   = $this->k->platform->config();
		$login    = AppRoute::loginUrl();
		$app      = is_user_logged_in() ? AppRoute::url() : '';
		$L        = static fn( string $bn, string $en ): string => 'en' === $lang ? $en : $bn;
		$digits   = static fn( string $s ): string => 'en' === $lang ? $s : strtr( $s, array_combine( range( 0, 9 ), array( '০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯' ) ) );
		$phone    = (string) ( $config['whatsapp'] ?: $config['support_phone'] );
		$wa_num   = preg_replace( '/^0/', '880', preg_replace( '/[^0-9]/', '', $phone ) );
		$wa_text  = rawurlencode( $L( 'আসসালামু আলাইকুম, আমি গরিবের হিসাব ব্যবহার করতে চাই।', 'Hello, I would like to start using Goriber Hisab.' ) );
		$whatsapp = '' !== $wa_num ? 'https://wa.me/' . $wa_num . '?text=' . $wa_text : $login;
		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );
		include GORIBER_HISAB_DIR . 'templates/landing.php';
	}
}
