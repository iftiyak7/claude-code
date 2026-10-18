<?php
/**
 * Session bootstrap, setup, business, branches, members, settings, audit,
 * notifications and global search.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Admin\AppRoute;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\SubscriptionException;
use GoriberHisab\Support\Text;
use GoriberHisab\Tenancy\BusinessContext;
use GoriberHisab\Tenancy\BusinessService;

/**
 * Core routes.
 */
final class CoreController extends Controller {

	public function routes(): array {
		return array(
			$this->route( 'GET', '/me', array( $this, 'me' ), array( 'context' => false ) ),
			$this->route( 'POST', '/setup', array( $this, 'setup' ), array( 'context' => false, 'created' => true ) ),

			$this->route( 'GET', '/business', fn( BusinessContext $c ) => $this->k->businesses->get( $c->business_id ) ),
			$this->route( 'PUT', '/business', fn( BusinessContext $c, array $p ) => $this->k->businesses->update( $c, $p ) ),

			$this->route( 'GET', '/branches', fn( BusinessContext $c ) => $this->k->businesses->branches( $c ) ),
			$this->route( 'POST', '/branches', fn( BusinessContext $c, array $p ) => $this->k->businesses->saveBranch( $c, $p ), array( 'created' => true ) ),
			$this->route( 'PUT', '/branches/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $this->k->businesses->saveBranch( $c, $p, self::id( $r ) ) ),
			$this->route( 'DELETE', '/branches/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $this->deleted( $this->k->businesses->deleteBranch( $c, self::id( $r ) ) ) ),

			$this->route( 'GET', '/staff', fn( BusinessContext $c ) => $this->k->members->staff( $c ) ),
			$this->route( 'GET', '/members', fn( BusinessContext $c ) => $this->k->members->list( $c ) ),
			$this->route( 'POST', '/members', fn( BusinessContext $c, array $p ) => $this->k->members->add( $c, $p ), array( 'created' => true ) ),
			$this->route( 'PUT', '/members/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $this->k->members->update( $c, self::id( $r ), $p ) ),
			$this->route( 'DELETE', '/members/(?P<id>\d+)', fn( BusinessContext $c, array $p, $r ) => $this->deleted( $this->k->members->remove( $c, self::id( $r ) ) ) ),
			$this->route( 'GET', '/roles', array( $this, 'roles' ) ),

			$this->route( 'GET', '/settings', fn( BusinessContext $c ) => $this->k->settings->all( $c ) ),
			$this->route( 'PUT', '/settings', fn( BusinessContext $c, array $p ) => $this->k->settings->update( $c, (array) ( $p['settings'] ?? array() ) ) ),

			$this->route( 'GET', '/audit', array( $this, 'audit' ) ),

			$this->route( 'GET', '/notifications', fn( BusinessContext $c, array $p ) => $this->k->notifications->inbox( $c, $p ) ),
			$this->route( 'GET', '/notifications/alerts', fn( BusinessContext $c, array $p ) => $this->k->notifications->alerts( $c, (int) ( $p['after'] ?? 0 ), (string) ( $p['lang'] ?? '' ) ) ),
			$this->route( 'POST', '/notifications/device', array( $this, 'alertDevice' ) ),
			$this->route( 'POST', '/notifications/read', fn( BusinessContext $c, array $p ) => $this->deleted( $this->k->notifications->markRead( $c, (array) ( $p['ids'] ?? array() ) ) ) ),

			$this->route( 'GET', '/search', array( $this, 'search' ) ),
		);
	}

	/**
	 * A private link the Android app checks in the background (every ~15 minutes,
	 * even when closed) for low-stock alerts. The secret is stored hashed; each
	 * person keeps their 5 newest phones.
	 *
	 * @param array<string,mixed> $p lang.
	 * @return array{url:string,last_id:int}
	 */
	public function alertDevice( BusinessContext $ctx, array $p ): array {
		$secret = wp_generate_password( 40, false, false );
		$tokens = get_user_meta( $ctx->user_id, AppRoute::ALERT_TOKENS, true );
		$tokens = is_array( $tokens ) ? $tokens : array();
		$tokens[ hash( 'sha256', $secret ) ] = array(
			'b' => $ctx->business_id,
			't' => time(),
		);
		uasort( $tokens, static fn( $a, $b ) => $b['t'] <=> $a['t'] );
		update_user_meta( $ctx->user_id, AppRoute::ALERT_TOKENS, array_slice( $tokens, 0, 5, true ) );
		$lang = 'en' === ( $p['lang'] ?? '' ) ? 'en' : 'bn';
		return array(
			'url'     => add_query_arg(
				array(
					'token' => $ctx->user_id . '-' . $secret,
					'lang'  => $lang,
				),
				AppRoute::url( 'alerts' )
			),
			'last_id' => $this->k->notifications->alerts( $ctx )['last_id'],
		);
	}

	/**
	 * Everything the app needs on start, in one request.
	 *
	 * @param array<string,mixed> $p Params (business, branch).
	 * @return array<string,mixed>
	 */
	public function me( ?BusinessContext $none, array $p, \WP_REST_Request $request ): array {
		$user       = wp_get_current_user();
		$businesses = $this->k->businesses->forUser( (int) $user->ID );
		$out        = array(
			'user'        => array(
				'id'     => (int) $user->ID,
				'name'   => $user->display_name,
				'email'  => $user->user_email,
				'avatar' => get_avatar_url( $user->ID, array( 'size' => 64 ) ),
			),
			'businesses'  => $businesses,
			'needs_setup' => array() === $businesses,
			'can_setup'   => $this->canCreateBusiness(),
			'types'       => BusinessService::TYPES,
			'version'     => defined( 'GORIBER_HISAB_VERSION' ) ? GORIBER_HISAB_VERSION : 'dev',
			'platform'    => array_merge(
				array(
					'admin' => current_user_can( 'manage_options' ) || $this->k->platform->isTeam( (int) $user->ID ),
					'owner' => current_user_can( 'manage_options' ),
				),
				array_intersect_key( $this->k->platform->config(), array_flip( array( 'brand', 'support_phone' ) ) )
			),
		);
		if ( ! $businesses ) {
			return $out;
		}
		$business_id = (int) ( $request->get_header( 'x_hisab_business' ) ?: ( $p['business'] ?? 0 ) );
		$branch_id   = (int) ( $request->get_header( 'x_hisab_branch' ) ?: ( $p['branch'] ?? 0 ) );
		try {
			try {
				$ctx = $this->k->contexts->forUser( (int) $user->ID, $business_id, $branch_id );
			} catch ( PermissionException $e ) {
				$ctx = $this->k->contexts->forUser( (int) $user->ID, 0 );
			}
		} catch ( SubscriptionException $e ) {
			// Only the renewal screen is available until the shop is paid.
			$out['blocked'] = array_merge( $e->subscription(), array( 'message' => $e->getMessage() ) );
			return $out;
		}
		$business = $this->k->businesses->get( $ctx->business_id );
		unset( $business['platform_note'] );
		$out['subscription'] = $ctx->subscription;
		$out['context']      = array(
			'business'    => $business,
			'branch_id'   => $ctx->branch_id,
			'branches'    => $this->k->businesses->branches( $ctx ),
			'role'        => $ctx->role,
			'permissions' => $ctx->permissions(),
		);
		$out['settings']         = $this->k->settings->all( $ctx );
		$out['payment_accounts'] = array_map(
			static fn( $a ) => array_intersect_key( $a, array_flip( array( 'id', 'name', 'subtype', 'system_key', 'code' ) ) ),
			$this->k->accounts->list( $ctx, array( 'payment' => true ) )
		);
		$out['tax_rates']        = $this->k->taxes->list( $ctx );
		if ( $ctx->can( 'products.view' ) ) {
			$out['units']      = $this->k->taxonomy->list( $ctx, 'units' );
			$out['categories'] = $this->k->taxonomy->list( $ctx, 'categories' );
			$out['brands']     = $this->k->taxonomy->list( $ctx, 'brands' );
		}
		$out['unread'] = $this->k->notifications->inbox( $ctx, array( 'unread' => 1, 'per_page' => 1 ) )['unread'];
		return $out;
	}

	/**
	 * Setup wizard: create the first (or another) business for this user.
	 *
	 * @param array<string,mixed> $p Wizard payload.
	 * @return array<string,mixed>
	 */
	public function setup( ?BusinessContext $none, array $p ): array {
		if ( ! $this->canCreateBusiness() ) {
			throw new PermissionException( __( 'You are not allowed to create a business.', 'goriber-hisab' ) );
		}
		$user_id = get_current_user_id();
		$id      = $this->k->businesses->create( $user_id, $p );
		$ctx     = $this->k->contexts->forUser( $user_id, $id );

		if ( ! empty( $p['demo'] ) ) {
			( new \GoriberHisab\Data\DemoData( $this->k ) )->seed( $ctx );
		}
		return array(
			'business_id' => $id,
			'business'    => $this->k->businesses->get( $id ),
		);
	}

	/**
	 * Audit log with user display names.
	 *
	 * @param array<string,mixed> $p Filters.
	 * @return array<string,mixed>
	 */
	public function audit( BusinessContext $ctx, array $p ): array {
		$out   = $this->k->audit->search( $ctx, $p );
		$names = array();
		foreach ( $out['items'] as &$item ) {
			$uid = (int) $item['user_id'];
			if ( ! isset( $names[ $uid ] ) ) {
				$user          = $uid ? get_userdata( $uid ) : null;
				$names[ $uid ] = $user ? $user->display_name : __( 'System', 'goriber-hisab' );
			}
			$item['user_name'] = $names[ $uid ];
		}
		return $out;
	}

	/**
	 * @return array<string,mixed>
	 */
	public function roles( BusinessContext $ctx ): array {
		$ctx->authorize( 'users.manage' );
		return array(
			'roles'       => $this->k->permissions->roles(),
			'permissions' => $this->k->permissions->groups(),
		);
	}

	/**
	 * Global search across documents, contacts and products the user can see.
	 *
	 * @param array<string,mixed> $p q.
	 * @return array<string,array<int,array<string,mixed>>>
	 */
	public function search( BusinessContext $ctx, array $p ): array {
		$q   = Text::line( $p['q'] ?? '', 100 );
		$out = array();
		if ( mb_strlen( $q ) < 2 ) {
			return $out;
		}
		$args = array(
			'search'   => $q,
			'per_page' => 6,
		);
		if ( $ctx->can( 'sales.view' ) ) {
			$out['sales'] = array_map( static fn( $s ) => array( 'id' => (int) $s['id'], 'title' => $s['number'], 'subtitle' => trim( ( $s['customer_name'] ?? '' ) . ' · ' . $s['total'] ) ), $this->k->sales->list( $ctx, $args + array( 'status' => 'any' ) )['items'] );
		}
		if ( $ctx->can( 'purchases.view' ) ) {
			$out['purchases'] = array_map( static fn( $s ) => array( 'id' => (int) $s['id'], 'title' => $s['number'], 'subtitle' => (string) ( $s['supplier_name'] ?? '' ) ), $this->k->purchases->list( $ctx, $args + array( 'status' => 'any' ) )['items'] );
		}
		if ( $ctx->can( 'products.view' ) ) {
			$out['products'] = array_map( static fn( $s ) => array( 'id' => $s['id'], 'title' => $s['name'], 'subtitle' => trim( $s['sku'] . ' · ' . $s['selling_price'] ) ), $this->k->products->list( $ctx, $args + array( 'status' => 'any' ) )['items'] );
		}
		foreach ( array( 'customer', 'supplier' ) as $type ) {
			if ( $ctx->can( $type . 's.view' ) ) {
				$out[ $type . 's' ] = array_map( static fn( $s ) => array( 'id' => $s['id'], 'title' => $s['name'], 'subtitle' => trim( $s['phone'] . ' · ' . $s['balance'] ) ), $this->k->contacts->list( $ctx, $type, $args )['items'] );
			}
		}
		return array_filter( $out );
	}

	private function canCreateBusiness(): bool {
		return (bool) apply_filters( 'goriber_hisab/can_create_business', current_user_can( 'manage_options' ), get_current_user_id() );
	}

	/**
	 * @param mixed $ignored Service return value.
	 * @return array{ok:bool}
	 */
	private function deleted( $ignored = null ): array {
		unset( $ignored );
		return array( 'ok' => true );
	}
}
