<?php
declare(strict_types=1);

namespace GoriberHisab\Tests\Integration;

use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tests\IntegrationTestCase;

/**
 * The shop owner fixes a staff member's name, email, phone and password.
 */
final class MemberProfileTest extends IntegrationTestCase {

	public function testOwnerEditsStaffDetails(): void {
		$m = $this->k->members->add( $this->ctx, array( 'email' => 'rahim@shop.test', 'name' => 'Rahim', 'password' => 'secret123', 'role' => 'sales' ) );
		$u = $this->k->members->update( $this->ctx, $m['id'], array( 'name' => 'Rahim Uddin', 'email' => 'rahim2@shop.test', 'phone' => '01711000111', 'password' => 'newpass123' ) );
		$this->assertSame( 'Rahim Uddin', $u['name'] );
		$this->assertSame( 'rahim2@shop.test', $u['email'] );
		$this->assertSame( '01711000111', $u['phone'] );
		$this->assertSame( 'newpass123', $this->users->passwords[ $u['user_id'] ] );

		$this->assertThrows( ValidationException::class, fn() => $this->k->members->update( $this->ctx, $m['id'], array( 'email' => 'owner@example.com' ) ) );
		$this->assertThrows( ValidationException::class, fn() => $this->k->members->update( $this->ctx, $m['id'], array( 'email' => 'not-an-email' ) ) );

		// Site staff: only they can change their own details.
		$this->users->privileged[ $u['user_id'] ] = true;
		$this->assertThrows( ValidationException::class, fn() => $this->k->members->update( $this->ctx, $m['id'], array( 'name' => 'X' ) ) );
		// Unchanged values are fine.
		$this->k->members->update( $this->ctx, $m['id'], array( 'name' => 'Rahim Uddin', 'role' => 'sales' ) );
	}
}
