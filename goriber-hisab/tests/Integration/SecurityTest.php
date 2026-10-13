<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ConflictException;
use GoriberHisab\Support\NotFoundException;
use GoriberHisab\Support\PermissionException;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

final class SecurityTest extends IntegrationTestCase {

	public function testBusinessesAreIsolated(): void {
		$p = $this->product( 'Secret product', '10', '5', '3' );
		$c = $this->customer( 'Secret customer' );

		$other_user = $this->users->add( 'Other', 'other@example.com' );
		$other_biz  = $this->k->businesses->create( $other_user, array( 'name' => 'Other Shop', 'currency_code' => 'USD' ) );
		$other      = $this->k->contexts->forUser( $other_user, $other_biz );

		$this->assertThrows( NotFoundException::class, fn() => $this->k->products->get( $other, $p ) );
		$this->assertThrows( NotFoundException::class, fn() => $this->k->contacts->get( $other, 'customer', $c ) );
		$this->assertSame( 0, $this->k->products->list( $other )['total'] );
		// Cross-tenant ids inside payloads are rejected, not silently used.
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $other, array( 'customer_id' => $c, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ) ) ) );
		$this->assertTrue( isset( $e->errors()['customer_id'] ) && isset( $e->errors()['items.0.product_id'] ) );
		// No membership → no context.
		$this->assertThrows( PermissionException::class, fn() => $this->k->contexts->forUser( $other_user, $this->ctx->business_id ) );
		$this->assertSame( '3.0000', $this->qty( $p ) );
	}

	public function testRolePermissionsAndOverrides(): void {
		$staff  = $this->users->add( 'Cashier', 'cashier@example.com' );
		$member = $this->k->members->add( $this->ctx, array( 'user_id' => $staff, 'role' => 'sales' ) );
		$cash   = $this->k->contexts->forUser( $staff, $this->ctx->business_id );
		$p      = $this->product( 'Cola', '25', '18', '50' );

		$sale = $this->k->sales->create( $cash, array( 'items' => array( array( 'product_id' => $p, 'qty' => '2' ) ), 'payments' => array( array( 'amount' => '50' ) ) ) );
		$this->assertTrue( ! isset( $sale['cost_amount'] ), 'cost hidden without reports.profit' );
		$this->assertSame( null, $this->k->products->get( $cash, $p )['purchase_price'], 'purchase price hidden' );
		$this->assertThrows( PermissionException::class, fn() => $this->k->sales->void( $cash, $sale['id'] ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->reports->profitLoss( $cash, array() ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->settings->update( $cash, array( 'tax.enabled' => true ) ) );
		$e = $this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $cash, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1', 'unit_price' => '1' ) ), 'payments' => array( array( 'amount' => '1' ) ) ) ) );
		$this->assertTrue( isset( $e->errors()['items.0.unit_price'] ), 'price change needs sales.price' );

		// Owner revokes discounts, grants voids.
		$this->k->members->update( $this->ctx, $member['id'], array( 'denies' => array( 'sales.discount' ), 'grants' => array( 'sales.delete', 'business.manage' ) ) );
		$cash = $this->k->contexts->forUser( $staff, $this->ctx->business_id );
		$this->assertFalse( $cash->can( 'sales.discount' ) );
		$this->assertFalse( $cash->can( 'business.manage' ), 'owner-only permission cannot be granted' );
		$this->k->sales->void( $cash, $sale['id'] );

		// Suspended members lose access.
		$this->k->members->update( $this->ctx, $member['id'], array( 'status' => 'suspended' ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->contexts->forUser( $staff, $this->ctx->business_id ) );
	}

	public function testOwnerSafeguards(): void {
		$members = $this->k->members->list( $this->ctx );
		$this->assertThrows( ConflictException::class, fn() => $this->k->members->update( $this->ctx, $members[0]['id'], array( 'role' => 'manager' ) ) );
		$mgr_user = $this->users->add( 'Manager', 'm@example.com' );
		$this->k->members->add( $this->ctx, array( 'user_id' => $mgr_user, 'role' => 'manager' ) );
		$mgr = $this->k->contexts->forUser( $mgr_user, $this->ctx->business_id );
		$this->assertThrows( ValidationException::class, fn() => $this->k->members->add( $mgr, array( 'email' => 'x@example.com', 'name' => 'X', 'role' => 'owner' ) ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->members->update( $mgr, $members[0]['id'], array( 'status' => 'suspended' ) ) );
		$this->assertThrows( PermissionException::class, fn() => $this->k->businesses->update( $mgr, array( 'name' => 'Hijacked' ) ) );
		// Invite by email creates a login.
		$added = $this->k->members->add( $mgr, array( 'email' => 'new@example.com', 'name' => 'New Person', 'role' => 'accountant' ) );
		$this->assertSame( 'new@example.com', $added['email'] );
	}

	public function testBranchScoping(): void {
		$branch = $this->k->businesses->saveBranch( $this->ctx, array( 'name' => 'Chittagong' ) );
		$user   = $this->users->add( 'Branch staff', 'b@example.com' );
		$this->k->members->add( $this->ctx, array( 'user_id' => $user, 'role' => 'sales', 'branch_ids' => array( (int) $branch['id'] ) ) );
		$ctx = $this->k->contexts->forUser( $user, $this->ctx->business_id );
		$this->assertSame( (int) $branch['id'], $ctx->branch_id );
		$this->assertThrows( PermissionException::class, fn() => $this->k->contexts->forUser( $user, $this->ctx->business_id, $this->ctx->branch_id ) );

		// Stock is per branch.
		$p = $this->product( 'Branch item', '10', '5', '7' );
		$this->assertSame( '0.0000', \GoriberHisab\Support\Decimal::toString( $this->k->stock->onHand( $ctx, $p ) ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->sales->create( $ctx, array( 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '10' ) ) ) ) );
	}

	public function testIdempotentOfflineSync(): void {
		$p    = $this->product( 'Bread', '40', '25', '10' );
		$uuid = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
		$a    = $this->k->sales->create( $this->ctx, array( 'uuid' => $uuid, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '40' ) ) ) );
		$b    = $this->k->sales->create( $this->ctx, array( 'uuid' => $uuid, 'items' => array( array( 'product_id' => $p, 'qty' => '1' ) ), 'payments' => array( array( 'amount' => '40' ) ) ) );
		$this->assertSame( $a['id'], $b['id'] );
		$this->assertSame( '9.0000', $this->qty( $p ) );
		$this->assertBooksBalanced( 'idempotent' );
	}

	public function testAuditTrail(): void {
		$p = $this->product( 'Audited', '10', '5', '1' );
		$this->k->products->update( $this->ctx, $p, array( 'selling_price' => '12' ) );
		$log = $this->k->audit->search( $this->ctx, array( 'object_type' => 'product', 'object_id' => $p ) );
		$this->assertSame( 2, $log['total'] );
		$this->assertSame( 'update', $log['items'][0]['action'] );
		$this->assertMoney( '12', $log['items'][0]['changes']['selling_price'][1] );
	}
}
