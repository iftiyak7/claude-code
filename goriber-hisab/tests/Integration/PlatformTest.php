<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Kernel;
use GoriberHisab\Platform\PlatformService;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\SubscriptionException;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

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

	public function testSignupStaysPendingUntilApproved(): void {
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->platform->signup( array( 'shop_name' => 'X', 'owner_name' => 'Y', 'email' => 'y@gmail.com', 'password' => 'secret123' ) ) );
		$this->assertTrue( isset( $e->errors()['phone'] ) );
		$r   = $this->k->platform->signup( array( 'shop_name' => 'Karim Traders', 'owner_name' => 'Karim', 'phone' => '01811111111', 'email' => 'karim@gmail.com', 'address' => 'Bogura', 'password' => 'secret123', 'business_type' => 'grocery' ) );
		$uid = $r['user_id'];
		$sh  = $this->k->platform->shop( $r['business_id'] );
		$this->assertSame( 'pending', $sh['subscription']['status'] );
		$this->assertSame( 'Bogura', $this->k->businesses->get( $r['business_id'] )['address'] );
		$this->assertSame( 1, $this->k->platform->stats()['signups'] );
		$this->assertSame( 1, count( $this->k->platform->shops( array( 'status' => 'pending' ) )['items'] ) );
		$ex = $this->assertThrows( SubscriptionException::class, fn() => $this->k->contexts->forUser( $uid, 0 ) );
		$this->assertSame( 'pending', $ex->subscription()['status'] );

		// They pay and submit the TrxID while still pending; approving opens the shop.
		$ctx = $this->k->contexts->forUser( $uid, 0, 0, true );
		$req = $this->k->platform->requestRenewal( $ctx, array( 'cycle' => 'monthly', 'reference' => 'TRXSIGN', 'method' => 'bkash' ) );
		$this->k->platform->approve( $this->owner, $req['id'] );
		$ok = $this->k->contexts->forUser( $uid, 0 );
		$this->assertSame( 'active', $ok->subscription['status'] );
		$this->assertSame( '2026-04-14', $ok->subscription['paid_until'] );

		// Approving without payment starts the free trial.
		$r2 = $this->k->platform->signup( array( 'shop_name' => 'Two', 'owner_name' => 'T', 'phone' => '01822222222', 'email' => 'two@gmail.com', 'password' => 'secret123' ) );
		$this->k->platform->updateShop( $r2['business_id'], array( 'status' => 'active' ) );
		$this->assertSame( 'trial', $this->k->contexts->forUser( $r2['user_id'], 0 )->subscription['status'] );

		$this->k->platform->saveConfig( array( 'signup' => false ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->platform->signup( array( 'shop_name' => 'Three', 'owner_name' => 'T', 'phone' => '01833333333', 'email' => 'three@gmail.com', 'password' => 'secret123' ) ) );
	}

	public function testPaymentNumbersAndMaskedAiKey(): void {
		$this->k->platform->saveConfig( array( 'pay_bkash' => '01711-000000', 'pay_bkash_type' => 'merchant', 'pay_nagad_type' => 'bogus', 'ai_key' => 'sk-ant-secret-value' ) );
		$pub = $this->k->platform->publicConfig();
		$this->assertSame( '01711-000000', $pub['pay_bkash'] );
		$this->assertSame( 'merchant', $pub['pay_bkash_type'] );
		$this->assertSame( 'personal', $pub['pay_nagad_type'] );
		$this->assertFalse( isset( $pub['ai_key'] ) );
		$admin = $this->k->platform->adminConfig();
		$this->assertSame( 'sk-ant-••••••••••', $admin['ai_key'] );
		$this->k->platform->saveConfig( array( 'ai_key' => $admin['ai_key'] ) );
		$this->assertSame( 'sk-ant-secret-value', $this->k->platform->config()['ai_key'] );
	}

	public function testSignupFreeTrialInstantApprovalAndOff(): void {
		$mk = fn( string $email ) => $this->k->platform->signup( array( 'shop_name' => 'Shop ' . $email, 'owner_name' => 'O', 'phone' => '01700000000', 'email' => $email, 'password' => 'secret123' ) );

		// Default: the trial starts at once, once per shop.
		$a   = $mk( 'a@gmail.com' );
		$ctx = $this->k->contexts->forUser( $a['user_id'], 0, 0, true );
		$t   = $this->k->platform->startTrial( $ctx );
		$this->assertSame( 'approved', $t['status'] );
		$sub = $this->k->contexts->forUser( $a['user_id'], 0 )->subscription;
		$this->assertSame( 'trial', $sub['status'] );
		$this->assertSame( '2026-03-22', $sub['paid_until'] );
		$this->assertTrue( $this->k->platform->trialUsed( $a['business_id'] ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->startTrial( $ctx ) );

		// Approval mode: the trial waits like a payment request.
		$this->k->platform->saveConfig( array( 'signup_trial' => 'approval' ) );
		$b   = $mk( 'b@gmail.com' );
		$req = $this->k->platform->trialFor( $b['business_id'], $b['user_id'] );
		$this->assertSame( 'pending', $req['status'] );
		$this->assertThrows( SubscriptionException::class, fn() => $this->k->contexts->forUser( $b['user_id'], 0 ) );
		$this->k->platform->approve( $this->owner, $req['id'] );
		$this->assertSame( 'trial', $this->k->contexts->forUser( $b['user_id'], 0 )->subscription['status'] );

		// Paying after the trial extends from the trial end.
		$p = $this->k->platform->recordPayment( $this->owner, $b['business_id'], array( 'amount' => '300', 'cycle' => 'monthly' ) );
		$this->assertSame( '2026-03-23', $p['period_from'] );
		$this->assertSame( 'monthly', $this->k->contexts->forUser( $b['user_id'], 0 )->business['plan'] );

		$this->k->platform->saveConfig( array( 'signup_trial' => 'off' ) );
		$c = $mk( 'c@gmail.com' );
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->trialFor( $c['business_id'], $c['user_id'] ) );
	}

	public function testArchiveRestoreAndDeleteForEver(): void {
		$shop = $this->open();
		$id   = (int) $shop['id'];
		$ctx  = $this->k->businesses->systemContext( $id, $this->owner );
		$this->k->contacts->create( $ctx, 'customer', array( 'name' => 'Karim', 'phone' => '01811000000' ) );
		$tables = array();
		foreach ( \GoriberHisab\Database\Schema::tables() as $key => $def ) {
			if ( isset( $def['columns']['business_id'] ) ) {
				$tables[] = $key;
			}
		}

		// Only archived shops can be deleted.
		$this->assertThrows( ValidationException::class, fn() => $this->k->platform->deleteShop( $id, 'Rahim Store', $tables ) );

		$this->k->platform->archiveShop( $this->owner, $id );
		$this->assertSame( 0, count( array_filter( $this->k->platform->shops()['items'], static fn( $s ) => $s['id'] === $id ) ) );
		$this->assertSame( $id, $this->k->platform->shops( array( 'status' => 'archived' ) )['items'][0]['id'] );
		$this->assertThrows( \Throwable::class, fn() => $this->k->contexts->forUser( $this->owner, $id ) );

		$this->k->platform->restoreShop( $id );
		$this->assertSame( 1, count( array_filter( $this->k->platform->shops()['items'], static fn( $s ) => $s['id'] === $id ) ) );
		$this->assertSame( 0, (int) $this->k->platform->shops( array( 'status' => 'archived' ) )['total'] );

		$this->k->platform->archiveShop( $this->owner, $id );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->platform->deleteShop( $id, 'rahim store', $tables ) );
		$this->assertTrue( isset( $e->errors()['confirm'] ) );
		$out = $this->k->platform->deleteShop( $id, 'Rahim Store', $tables );
		$this->assertTrue( $out['deleted'] );
		$this->assertTrue( $out['rows'] > 3 );
		$this->assertSame( 0, (int) $this->db->value( 'SELECT COUNT(*) FROM ' . $this->db->table( 'contacts' ) . ' WHERE business_id = %d', array( $id ) ) );
		$this->assertSame( 0, (int) $this->db->value( 'SELECT COUNT(*) FROM ' . $this->db->table( 'businesses' ) . ' WHERE id = %d', array( $id ) ) );
		$this->assertThrows( \Throwable::class, fn() => $this->k->platform->shop( $id ) );
	}
}
