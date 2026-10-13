<?php
/**
 * WordPress user directory.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tenancy;

use BizLedger\Support\ValidationException;

/**
 * Users are ordinary WordPress users. Password storage, hashing, reset and
 * two-factor plugins are all handled by WordPress core.
 */
final class WpUserDirectory implements UserDirectory {

	public function get( int $id ): ?array {
		$user = get_userdata( $id );
		if ( ! $user ) {
			return null;
		}
		return array(
			'id'    => (int) $user->ID,
			'name'  => (string) $user->display_name,
			'email' => (string) $user->user_email,
			'login' => (string) $user->user_login,
		);
	}

	public function findByEmail( string $email ): int {
		$user = get_user_by( 'email', $email );
		return $user ? (int) $user->ID : 0;
	}

	public function findByLogin( string $login ): int {
		$user = get_user_by( 'login', $login );
		return $user ? (int) $user->ID : 0;
	}

	public function create( string $email, string $name, string $login ): int {
		$login = sanitize_user( '' !== $login ? $login : strstr( $email, '@', true ), true );
		$base  = $login;
		$i     = 1;
		while ( username_exists( $login ) ) {
			$login = $base . ( ++$i );
		}
		$id = wp_insert_user(
			array(
				'user_login'   => $login,
				'user_email'   => $email,
				'display_name' => $name,
				'first_name'   => $name,
				'user_pass'    => wp_generate_password( 24, true, true ),
				'role'         => 'subscriber',
			)
		);
		if ( is_wp_error( $id ) ) {
			throw ValidationException::field( 'email', $id->get_error_message() );
		}
		wp_new_user_notification( (int) $id, null, 'user' );
		return (int) $id;
	}

	public function createClient( string $email, string $name, string $password, string $phone = '' ): int {
		$base  = sanitize_user( (string) strstr( $email, '@', true ), true );
		$base  = '' !== $base ? $base : 'shop';
		$login = $base;
		$i     = 1;
		while ( username_exists( $login ) ) {
			$login = $base . ( ++$i );
		}
		$id = wp_insert_user(
			array(
				'user_login'           => $login,
				'user_email'           => $email,
				'display_name'         => $name,
				'first_name'           => $name,
				'user_pass'            => $password,
				'role'                 => \BizLedger\Admin\ClientAccess::ROLE,
				'show_admin_bar_front' => 'false',
			)
		);
		if ( is_wp_error( $id ) ) {
			throw ValidationException::field( 'email', $id->get_error_message() );
		}
		if ( '' !== $phone ) {
			update_user_meta( (int) $id, 'billing_phone', $phone );
		}
		return (int) $id;
	}

	public function setPassword( int $id, string $password ): void {
		wp_set_password( $password, $id );
	}
}
