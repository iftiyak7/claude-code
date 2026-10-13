<?php
declare(strict_types=1);

namespace GoriberHisab\Tests;

use GoriberHisab\Tenancy\UserDirectory;

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

	/**
	 * @var array<int,string>
	 */
	public array $passwords = array();

	public function createClient( string $email, string $name, string $password, string $phone = '' ): int {
		if ( $this->findByEmail( $email ) ) {
			throw \GoriberHisab\Support\ValidationException::field( 'email', 'Sorry, that email address is already used!' );
		}
		$id                      = $this->add( $name, $email );
		$this->passwords[ $id ] = $password;
		return $id;
	}

	public function setPassword( int $id, string $password ): void {
		$this->passwords[ $id ] = $password;
	}
}
