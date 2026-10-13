<?php
declare(strict_types=1);

namespace BizLedger\Tests\Integration;

use BizLedger\Kernel;
use BizLedger\Platform\PlatformService;
use BizLedger\Support\Clock;
use BizLedger\Support\Events;
use BizLedger\Support\PermissionException;
use BizLedger\Support\SubscriptionException;
use BizLedger\Support\ValidationException;
use BizLedger\Tests\IntegrationTestCase;

final class PlatformTest extends IntegrationTestCase {

	/**
	 * The same database seen on another day.
	 */
	private function on( string $datetime ): Kernel {
		return new Kernel( $this->db, new Clock( new \DateTimeImmutable( $datetime, new \DateTimeZone( 'UTC' ) ) ), new Events(), $this->users );
	}

	private function open( array $extra = array() ): array {
		return $this->k->platform->openShop(
			$this->owner,
			$extra + array(
				'owner_name' => 'Rahim Mia',
				'email'      => 'rahim@gmail.com',
				'phone'      => '01711000000',
				'password'   => 'secret123',
				'shop_name'  => 'Rahim Store',
				'cycle'      => 'monthly',
			)
		);
	}

	public function testOpenShopValidatesAndStartsTrial(): void {
		$e = $this->assertThrows( ValidationException::class, fn() => $this->open( array( 'password' => 'short', 'email' => 'bad', 'shop_name' => '' ) ) );
		$this->assertTrue( isset( $e->errors()['password'], $e->errors()['email'], $e->errors()['shop_name'] ) );

		$shop = $this->open();
		$this->assertSame( 'trial', $shop['subscription']['status'] );
		$this->assertSame( '2026-03-22', $shop['subscription']['paid_until'] );
		$this->assertSame( 7, $shop['subscription']['days_left'] );
		$this->assertSame( 'rahim@gmail.com', $shop['owner']['email'] );
		$this->assertSame( 'secret123', $this->users->passwords[ $shop['owner_id'] ] );

		// The client owns their own, separate business.
		$ctx = $this->k->contexts->forUser( $shop['owner_id'], 0 );
		$this->assertSame( $shop['id'], $ctx->business_id );
		$this->assertSame( 'owner', $ctx->role );
		$this->assertSame( 'trial', $ctx->subscription['status'] );
		$this->assertThrows( PermissionException::class, fn() => $this->k->contexts->forUser( $shop['owner_id'], $this->ctx->business_id ) );

		// Same email cannot open a second account.
		$e = $this->assertThrows( ValidationException::class, fn() => $this->open( array( 'shop_name' => 'Again' ) ) );
		$this->assertTrue( isset( $e->errors()['email'] ) );

		// Shops made through the setup wizard never expire.
		$this->assertSame( 'unlimited', $this->ctx->subscription['status'] );
		$this->assertSame( 'unlimited', $this->on( '2030-01-01 00:00:00' )->contexts->forUser( $this->owner, $this->ctx->business_id )->subscription['status'] );
	}

	public function testExpiryGraceRenewalAndApproval(): void {
		$shop = $this->open( array( 'paid_amount' => '300', 'method' => 'bkash', 'reference' => 'TRX1' ) );
		$this->assertSame( 'active', $shop['subscription']['status'] );
		$this->assertSame( '2026-04-14', $shop['subscription']['paid_until'] );
		$this->assertSame( 1, count( $shop['payments'] ) );
		$this->assertSame( '300.00', $shop['collected'] );
		$uid = $shop['owner_id'];

		// Two days late: grace period, still usable.
		$late = $this->on( '2026-04-16 06:00:00' );
		$this->assertSame( 'grace', $late->contexts->forUser( $uid, 0 )->subscription['status'] );

		// Past grace: blocked everywhere except renewal.
		$later = $this->on( '2026-04-18 06:00:00' );
		$e     = $this->assertThrows( SubscriptionException::class, fn() => $later->contexts->forUser( $uid, 0 ) );
		$this->assertSame( 402, $e->status() );
		$this->assertSame( 'expired', $e->subscription()['status'] );
		$ctx = $later->contexts->forUser( $uid, 0, 0, true );

		$this->assertThrows( ValidationException::class, fn() => $later->platform->requestRenewal( $ctx, array( 'cycle' => 'yearly' ) ) );
		$req = $later->platform->requestRenewal( $ctx, array( 'cycle' => 'yearly', 'method' => 'bkash', 'reference' => 'TRX2', 'payer_phone' => '01711000000' ) );
		$this->assertSame( 'pending', $req['status'] );
		$this->assertSame( '3000.00', $req['amount'] );
		$this->assertSame( 12, $req['months'] );
		$this->assertSame( 1, $later->platform->stats()['pending'] );

		// Staff without business.manage cannot renew.
		$staff = $this->users->add( 'Cashier', 'c@example.com' );
		$later->members->add( $ctx, array( 'user_id' => $staff, 'role' => 'sales' ) );
		$sctx = $later->contexts->forUser( $staff, $shop['id'], 0, true );
		$this->assertThrows( PermissionException::class, fn() => $later->platform->requestRenewal( $sctx, array( 'reference' => 'X' ) ) );
		$this->assertThrows( SubscriptionException::class, fn() => $later->contexts->forUser( $staff, $shop['id'] ) );

		// Owner approves: a late renewal starts today.
		$ok = $later->platform->approve( $this->owner, $req['id'] );
		$this->assertSame( 'approved', $ok['status'] );
		$this->assertSame( '2026-04-18', $ok['period_from'] );
		$this->assertSame( '2027-04-17', $ok['period_to'] );
		$this->assertThrows( ValidationException::class, fn() => $later->platform->approve( $this->owner, $req['id'] ) );
		$this->assertSame( 'active', $later->contexts->forUser( $uid, 0 )->subscription['status'] );
		$this->assertSame( 'yearly', $later->platform->shop( $shop['id'] )['subscription']['cycle'] );

		// An early renewal keeps the remaining days.
		$p = $later->platform->recordPayment( $this->owner, $shop['id'], array( 'amount' => '300', 'cycle' => 'monthly', 'method' => 'cash' ) );
		$this->assertSame( '2027-04-18', $p['period_from'] );
		$this->assertSame( '2027-05-17', $p['period_to'] );

		// Rejected requests change nothing.
		$r = $later->platform->requestRenewal( $later->contexts->forUser( $uid, 0 ), array( 'cycle' => 'monthly', 'reference' => 'FAKE' ) );
		$r = $later->platform->reject( $this->owner, $r['id'], 'Not received' );
		$this->assertSame( 'rejected', $r['status'] );
		$this->assertSame( '2027-05-17', $later->platform->shop( $shop['id'] )['subscription']['paid_until'] );

		$stats = $later->platform->stats();
		$this->assertSame( 1, $stats['shops'] );
		$this->assertSame( 0, $stats['pending'] );
		$this->assertSame( '3600.00', $stats['collected_total'] );
	}

	public function testSuspendAndManualDates(): void {
		$shop = $this->open();
		$uid  = $shop['owner_id'];
		$this->k->platform->updateShop( $shop['id'], array( 'status' => 'suspended', 'note' => 'Asked to pause' ) );
		$e = $this->assertThrows( SubscriptionException::class, fn() => $this->k->contexts->forUser( $uid, 0 ) );
		$this->assertSame( 'suspended', $e->subscription()['status'] );
		$this->assertSame( 1, count( $this->k->platform->shops( array( 'status' => 'suspended' ) )['items'] ) );

		$this->k->platform->updateShop( $shop['id'], array( 'status' => 'active', 'paid_until' => '2026-03-01' ) );
		$this->assertThrows( SubscriptionException::class, fn() => $this->k->contexts->forUser( $uid, 0 ) );
		$this->assertSame( 1, count( $this->k->platform->shops( array( 'status' => 'expired' ) )['items'] ) );

		$this->k->platform->updateShop( $shop['id'], array( 'paid_until' => '2026-12-31' ) );
		$this->assertSame( 'active', $this->k->contexts->forUser( $uid, 0 )->subscription['status'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->updateShop( $shop['id'], array( 'paid_until' => 'tomorrow-ish' ) ) );

		$this->k->platform->resetPassword( $shop['id'], 'newpass123' );
		$this->assertSame( 'newpass123', $this->users->passwords[ $uid ] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->resetPassword( $shop['id'], '123' ) );
	}

	public function testConfigAndDateMath(): void {
		$c = $this->k->platform->saveConfig( array( 'monthly_price' => '250', 'yearly_price' => '2500.5', 'trial_days' => '14', 'grace_days' => '-3', 'payment_instructions' => "bKash 01700000000\nSend Money" ) );
		$this->assertSame( '250.00', $c['monthly_price'] );
		$this->assertSame( '2500.50', $c['yearly_price'] );
		$this->assertSame( 14, $c['trial_days'] );
		$this->assertSame( 0, $c['grace_days'] );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->saveConfig( array( 'monthly_price' => '-1' ) ) );
		$this->assertSame( '2026-03-29', $this->open()['subscription']['paid_until'] );

		$this->assertSame( '2026-02-28', PlatformService::addMonths( '2026-01-31', 1 ) );
		$this->assertSame( '2028-02-29', PlatformService::addMonths( '2028-01-31', 1 ) );
		$this->assertSame( '2027-03-15', PlatformService::addMonths( '2026-03-15', 12 ) );
		$this->assertSame( '2026-03-01', PlatformService::addDays( '2026-02-28', 1 ) );
	}
}
