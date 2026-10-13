<?php
declare(strict_types=1);

namespace BizLedger\Tests;

use BizLedger\Tenancy\UserDirectory;

/**
 * In-memory user directory for tests.
 */
final class MemoryUsers implements UserDirectory {

	/**
	 * @var array<int,array{id:int,name:string,email:string,login:string}>
	 */
	public array $users = array();

	public function add( string $name, string $email ): int {
		$id                 = count( $this->users ) + 1;
		$this->users[ $id ] = array(
			'id'    => $id,
			'name'  => $name,
			'email' => $email,
			'login' => strtolower( $name ),
		);
		return $id;
	}

	public function get( int $id ): ?array {
		return $this->users[ $id ] ?? null;
	}

	public function findByEmail( string $email ): int {
		foreach ( $this->users as $u ) {
			if ( $u['email'] === $email ) {
				return $u['id'];
			}
		}
		return 0;
	}

	public function findByLogin( string $login ): int {
		foreach ( $this->users as $u ) {
			if ( $u['login'] === $login ) {
				return $u['id'];
			}
		}
		return 0;
	}

	public function create( string $email, string $name, string $login ): int {
		return $this->add( $name, $email );
	}
}
