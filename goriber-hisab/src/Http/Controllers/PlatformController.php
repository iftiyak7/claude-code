<?php
/**
 * Hosted shops: platform owner panel + client renewal.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Http\Controllers;

use GoriberHisab\Admin\AppRoute;
use GoriberHisab\Admin\LandingContent;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * /platform/* is for the site owner (manage_options) only.
 * /subscription/* is for a shop's owner and works even after expiry.
 */
final class PlatformController extends Controller {

	public function routes(): array {
		$admin = array( 'context' => false );
		return array(
			$this->route( 'GET', '/platform', fn() => $this->guard( fn() => $this->overview() ), $admin ),
			$this->route( 'PUT', '/platform/config', fn( $n, array $p ) => $this->ownerOnly( fn() => $this->saveConfig( $p ) ), $admin ),
			$this->route( 'GET', '/platform/landing', fn() => $this->ownerOnly( fn() => $this->landing() ), $admin ),
			$this->route( 'PUT', '/platform/landing', fn( $n, array $p ) => $this->ownerOnly( fn() => array( 'content' => LandingContent::save( (array) ( $p['content'] ?? array() ) ) ) ), $admin ),
			$this->route( 'POST', '/platform/landing/reset', fn() => $this->ownerOnly( fn() => $this->resetLanding() ), $admin ),
			$this->route( 'GET', '/platform/team', fn() => $this->ownerOnly( fn() => $this->k->platform->team() ), $admin ),
			$this->route( 'POST', '/platform/team', fn( $n, array $p ) => $this->ownerOnly( fn() => $this->k->platform->addTeamMember( $p ) ), $admin + array( 'created' => true ) ),
			$this->route( 'DELETE', '/platform/team/(?P<id>\d+)', fn( $n, array $p, $r ) => $this->ownerOnly( fn() => $this->k->platform->removeTeamMember( self::id( $r ) ) ), $admin ),
			$this->route( 'POST', '/platform/team/(?P<id>\d+)/password', fn( $n, array $p, $r ) => $this->ownerOnly( fn() => $this->teamPassword( self::id( $r ), (string) ( $p['password'] ?? '' ) ) ), $admin ),
			$this->route( 'GET', '/platform/shops', fn( $n, array $p ) => $this->guard( fn() => $this->k->platform->shops( $p ) ), $admin ),
			$this->route( 'POST', '/platform/shops', fn( $n, array $p ) => $this->guard( fn() => $this->k->platform->openShop( get_current_user_id(), $p ) ), $admin + array( 'created' => true ) ),
			$this->route( 'GET', '/platform/shops/(?P<id>\d+)', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->shop( self::id( $r ) ) ), $admin ),
			$this->route( 'PUT', '/platform/shops/(?P<id>\d+)', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->updateShop( self::id( $r ), $p ) ), $admin ),
			$this->route( 'POST', '/platform/shops/(?P<id>\d+)/archive', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->archiveShop( get_current_user_id(), self::id( $r ) ) ), $admin ),
			$this->route( 'POST', '/platform/shops/(?P<id>\d+)/restore', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->restoreShop( self::id( $r ) ) ), $admin ),
			$this->route( 'POST', '/platform/shops/(?P<id>\d+)/delete', fn( $n, array $p, $r ) => $this->ownerOnly( fn() => $this->deleteShop( self::id( $r ), (string) ( $p['confirm'] ?? '' ) ) ), $admin ),
			$this->route( 'POST', '/platform/shops/(?P<id>\d+)/password', fn( $n, array $p, $r ) => $this->guard( fn() => $this->password( self::id( $r ), (string) ( $p['password'] ?? '' ) ) ), $admin ),
			$this->route( 'POST', '/platform/shops/(?P<id>\d+)/payments', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->recordPayment( get_current_user_id(), self::id( $r ), $p ) ), $admin + array( 'created' => true ) ),
			$this->route( 'GET', '/platform/payments', fn( $n, array $p ) => $this->guard( fn() => $this->k->platform->payments( $p ) ), $admin ),
			$this->route( 'POST', '/platform/payments/(?P<id>\d+)/approve', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->approve( get_current_user_id(), self::id( $r ) ) ), $admin ),
			$this->route( 'POST', '/platform/payments/(?P<id>\d+)/reject', fn( $n, array $p, $r ) => $this->guard( fn() => $this->k->platform->reject( get_current_user_id(), self::id( $r ), (string) ( $p['reason'] ?? '' ) ) ), $admin ),

			$this->route( 'GET', '/subscription', array( $this, 'subscription' ), array( 'context' => 'expired_ok' ) ),
			$this->route( 'POST', '/subscription/trial', fn( BusinessContext $c ) => $this->k->platform->startTrial( $c ), array( 'context' => 'expired_ok', 'created' => true ) ),
			$this->route( 'POST', '/subscription/renew', fn( BusinessContext $c, array $p ) => $this->k->platform->requestRenewal( $c, $p ), array( 'context' => 'expired_ok', 'created' => true ) ),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	public function subscription( BusinessContext $ctx ): array {
		return array(
			'business'     => array(
				'id'   => $ctx->business_id,
				'name' => (string) $ctx->business['name'],
			),
			'subscription' => $ctx->subscription ?? $this->k->platform->subscription( $ctx->business ),
			'config'       => $this->k->platform->publicConfig(),
			'payments'     => $this->k->platform->ownPayments( $ctx ),
			'is_owner'     => 'owner' === $ctx->role || $ctx->can( 'business.manage' ),
			'trial_used'   => $this->k->platform->trialUsed( $ctx->business_id ),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	private function overview(): array {
		return array(
			'config'    => current_user_can( 'manage_options' ) ? $this->k->platform->adminConfig() : $this->k->platform->publicConfig(),
			'owner'     => current_user_can( 'manage_options' ),
			'stats'     => $this->k->platform->stats(),
			'login_url' => AppRoute::loginUrl(),
			'home_url'  => home_url( '/' ),
			'signup_url' => AppRoute::signupUrl(),
			'types'     => \GoriberHisab\Tenancy\BusinessService::TYPES,
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	private function landing(): array {
		return array(
			'content' => LandingContent::load(),
			'schema'  => LandingContent::schema(),
			'icons'   => LandingContent::ICONS,
			'url'     => home_url( '/' ),
		);
	}

	/**
	 * @return array<string,mixed>
	 */
	private function resetLanding(): array {
		LandingContent::reset();
		return $this->landing();
	}

	/**
	 * @param array<string,mixed> $p Config fields.
	 * @return array<string,mixed>
	 */
	private function saveConfig( array $p ): array {
		$this->k->platform->saveConfig( $p );
		return $this->k->platform->adminConfig();
	}

	/**
	 * @return array{ok:bool}
	 */
	private function password( int $business_id, string $password ): array {
		$owner = (int) $this->k->platform->shop( $business_id )['owner_id'];
		if ( user_can( $owner, 'manage_options' ) || ( $this->k->platform->isTeam( $owner ) && ! current_user_can( 'manage_options' ) ) ) {
			throw new PermissionException( __( 'Change an administrator password from your WordPress profile instead.', 'goriber-hisab' ) );
		}
		$this->k->platform->resetPassword( $business_id, $password );
		return array( 'ok' => true );
	}

	/**
	 * @param callable():mixed $fn Handler.
	 * @return mixed
	 */
	private function guard( callable $fn ) {
		if ( ! current_user_can( 'manage_options' ) && ! $this->k->platform->isTeam( get_current_user_id() ) ) {
			throw new PermissionException( __( 'Only the site owner and their team can manage shops.', 'goriber-hisab' ) );
		}
		return $fn();
	}

	/**
	 * Prices, payment numbers, API keys, home page and the team itself.
	 *
	 * @param callable():mixed $fn Handler.
	 * @return mixed
	 */
	private function ownerOnly( callable $fn ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			throw new PermissionException( __( 'Only the site owner can change this.', 'goriber-hisab' ) );
		}
		return $fn();
	}

	/**
	 * Every table that holds this shop's records.
	 *
	 * @return array{deleted:bool,rows:int}
	 */
	private function deleteShop( int $id, string $confirm ): array {
		$tables = array();
		foreach ( \GoriberHisab\Database\Schema::tables() as $key => $def ) {
			if ( isset( $def['columns']['business_id'] ) ) {
				$tables[] = $key;
			}
		}
		$out = $this->k->platform->deleteShop( $id, $confirm, $tables );
		delete_option( 'bizledger_last_backup_' . $id );
		return $out;
	}

	/**
	 * @return array{ok:bool}
	 */
	private function teamPassword( int $user_id, string $password ): array {
		$this->k->platform->resetTeamPassword( $user_id, $password );
		return array( 'ok' => true );
	}
}
