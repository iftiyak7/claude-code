<?php
/**
 * User directory abstraction.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Tenancy;

/**
 * Lookup/creation of login accounts. Production uses WordPress users;
 * tests use an in-memory implementation.
 */
interface UserDirectory {

	/**
	 * @return array{id:int,name:string,email:string,login:string}|null
	 */
	public function get( int $id ): ?array;

	public function findByEmail( string $email ): int;

	public function findByLogin( string $login ): int;

	/**
	 * Create a login and return its id. Implementations send the
	 * "set your password" email; passwords are never handled by Goriber Hisab.
	 */
	public function create( string $email, string $name, string $login ): int;

	/**
	 * Create a shop-owner login (platform clients) with a password chosen by
	 * the platform owner. The account can only use the app, never wp-admin.
	 */
	public function createClient( string $email, string $name, string $password, string $phone = '' ): int;

	public function setPassword( int $id, string $password ): void;

	/**
	 * Site staff (can edit content or administer WordPress). Shop owners may
	 * never reset these accounts' passwords.
	 */
	public function isPrivileged( int $id ): bool;
}
