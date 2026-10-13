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
