<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Unit;

use GoriberHisab\Security\Permissions;
use GoriberHisab\Support\Events;
use GoriberHisab\Tests\TestCase;

final class PermissionsTest extends TestCase {

	public function testOwnerHasEverything(): void {
		$p = new Permissions( new Events() );
		$this->assertSame( count( $p->all() ), count( $p->resolve( 'owner', array(), array( 'sales.view' ) ) ) );
	}

	public function testGrantsDeniesAndOwnerOnly(): void {
		$p     = new Permissions( new Events() );
		$sales = $p->resolve( 'sales', array( 'reports.view', 'not.a.permission', 'business.manage' ), array( 'sales.discount' ) );
		$this->assertTrue( in_array( 'reports.view', $sales, true ), 'grant applied' );
		$this->assertFalse( in_array( 'sales.discount', $sales, true ), 'deny applied' );
		$this->assertFalse( in_array( 'not.a.permission', $sales, true ), 'unknown ignored' );
		$this->assertFalse( in_array( 'business.manage', $sales, true ), 'owner-only never granted' );
		$this->assertFalse( in_array( 'business.manage', $p->resolve( 'manager' ), true ) );
	}

	public function testRoleScopes(): void {
		$p = new Permissions( new Events() );
		$acc = $p->resolve( 'accountant' );
		$this->assertTrue( in_array( 'accounting.manage', $acc, true ) );
		$this->assertFalse( in_array( 'sales.create', $acc, true ) );
		$pur = $p->resolve( 'purchase' );
		$this->assertTrue( in_array( 'purchases.create', $pur, true ) );
		$this->assertTrue( in_array( 'inventory.adjust', $pur, true ) );
		$this->assertFalse( in_array( 'sales.view', $pur, true ) );
		$this->assertSame( array( 'dashboard.view' ), $p->resolve( 'staff' ) );
	}
}
