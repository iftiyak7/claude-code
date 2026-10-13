<?php
/**
 * Keeps shop owners and staff inside the app.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Admin;

use GoriberHisab\Kernel;

/**
 * "App-only" users — the goriber_client role, or any user who cannot edit
 * posts and belongs to a business — never see wp-admin or the admin bar,
 * and land in the app after logging in.
 */
final class ClientAccess {

	public const ROLE = 'goriber_client';

	private Kernel $k;

	/**
	 * @var array<int,bool>
	 */
	private array $cache = array();

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	public function register(): void {
		add_action( 'init', array( self::class, 'ensureRole' ) );
		add_action( 'admin_init', array( $this, 'blockAdmin' ), 1 );
		add_filter( 'show_admin_bar', array( $this, 'adminBar' ) );
		add_filter( 'login_redirect', array( $this, 'loginRedirect' ), 20, 3 );
		add_action( 'goriber_hisab/platform/signup', array( $this, 'notifySignup' ), 10, 2 );
		add_action( 'goriber_hisab/platform/renewal_requested', array( $this, 'notifyPayment' ), 10, 2 );
	}

	/**
	 * Email the site owner about a new sign-up.
	 */
	public function notifySignup( int $business_id, int $user_id ): void {
		$shop = $this->k->platform->shop( $business_id );
		$this->mailOwner(
			'New shop sign-up: ' . $shop['name'],
			sprintf(
				"%s signed up.\n\nOwner: %s\nPhone: %s\nEmail: %s\n\nIt stays locked until you approve it (approve their payment, or Approve with free trial):\n%s",
				$shop['name'],
				$shop['owner']['name'] ?? '',
				$shop['phone'],
				$shop['email'],
				AppRoute::adminUrl( '#/platform?tab=shops&status=pending' )
			)
		);
		unset( $user_id );
	}

	/**
	 * Email the site owner about a payment waiting for approval.
	 */
	public function notifyPayment( int $payment_id, int $business_id ): void {
		$shop = $this->k->platform->shop( $business_id );
		$pay  = null;
		foreach ( $shop['payments'] as $p ) {
			if ( (int) $p['id'] === $payment_id ) {
				$pay = $p;
			}
		}
		$this->mailOwner(
			'Payment to check: ' . $shop['name'],
			sprintf(
				"%s says they paid %s by %s.\nTrxID: %s\nFrom: %s\n\nCheck your statement, then approve or reject:\n%s",
				$shop['name'],
				$pay['amount'] ?? '',
				$pay['method'] ?? '',
				$pay['reference'] ?? '',
				$pay['payer_phone'] ?? '',
				AppRoute::adminUrl( '#/platform?tab=payments' )
			)
		);
	}

	private function mailOwner( string $subject, string $body ): void {
		$to = (string) get_option( 'admin_email' );
		if ( '' !== $to && function_exists( 'wp_mail' ) ) {
			wp_mail( $to, '[Goriber Hisab] ' . $subject, $body );
		}
	}

	public static function ensureRole(): void {
		if ( null === get_role( self::ROLE ) ) {
			add_role( self::ROLE, 'Goriber Hisab shop owner', array( 'read' => true ) );
		}
	}

	public function isAppOnly( int $user_id ): bool {
		if ( $user_id <= 0 ) {
			return false;
		}
		if ( ! isset( $this->cache[ $user_id ] ) ) {
			$user = get_userdata( $user_id );
			if ( ! $user ) {
				$this->cache[ $user_id ] = false;
			} elseif ( in_array( self::ROLE, (array) $user->roles, true ) ) {
				$this->cache[ $user_id ] = true;
			} else {
				$this->cache[ $user_id ] = ! user_can( $user, 'edit_posts' ) && array() !== $this->k->businesses->forUser( $user_id );
			}
		}
		return $this->cache[ $user_id ];
	}

	/**
	 * Any wp-admin screen other than the app itself sends app-only users back
	 * to the app. AJAX and admin-post requests are left alone.
	 */
	public function blockAdmin(): void {
		if ( wp_doing_ajax() || ( defined( 'DOING_CRON' ) && DOING_CRON ) || ! $this->isAppOnly( get_current_user_id() ) ) {
			return;
		}
		$script = isset( $_SERVER['SCRIPT_NAME'] ) ? basename( sanitize_text_field( wp_unslash( $_SERVER['SCRIPT_NAME'] ) ) ) : '';
		if ( 'admin-post.php' === $script ) {
			return;
		}
		wp_safe_redirect( AppRoute::url() );
		exit;
	}

	public function adminBar( bool $show ): bool {
		return $show && ! $this->isAppOnly( get_current_user_id() );
	}

	/**
	 * @param string            $to        Requested redirect.
	 * @param string            $requested Original redirect_to.
	 * @param \WP_User|\WP_Error $user      User.
	 */
	public function loginRedirect( $to, $requested, $user ): string {
		unset( $requested );
		if ( $user instanceof \WP_User && $this->isAppOnly( (int) $user->ID ) ) {
			return AppRoute::url();
		}
		return (string) $to;
	}
}
