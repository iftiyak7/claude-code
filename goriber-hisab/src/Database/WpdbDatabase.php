<?php
/**
 * wpdb driver.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Database;

use GoriberHisab\Support\DatabaseException;

/**
 * Production driver backed by the global $wpdb. All parameterised SQL goes
 * through $wpdb->prepare().
 */
final class WpdbDatabase extends AbstractDatabase {

	private \wpdb $wpdb;

	public function __construct( \wpdb $wpdb ) {
		$this->wpdb = $wpdb;
		parent::__construct( $wpdb->prefix );
	}

	public function insert( string $table, array $data ): int {
		$data = array_map( array( $this, 'normalise' ), $data );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$ok = $this->wpdb->insert( $table, $data );
		if ( false === $ok ) {
			$this->fail();
		}
		return (int) $this->wpdb->insert_id;
	}

	public function row( string $sql, array $params = array() ): ?array {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		$row = $this->wpdb->get_row( $this->prepare( $sql, $params ), ARRAY_A );
		$this->check();
		return is_array( $row ) ? $row : null;
	}

	public function rows( string $sql, array $params = array() ): array {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		$rows = $this->wpdb->get_results( $this->prepare( $sql, $params ), ARRAY_A );
		$this->check();
		return is_array( $rows ) ? $rows : array();
	}

	public function execute( string $sql, array $params = array() ): int {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		$result = $this->wpdb->query( $this->prepare( $sql, $params ) );
		if ( false === $result ) {
			$this->fail();
		}
		return (int) $result;
	}

	public function forUpdate(): string {
		return $this->isSqliteIntegration() ? '' : ' FOR UPDATE';
	}

	public function supportsSavepoints(): bool {
		return ! $this->isSqliteIntegration();
	}

	/**
	 * The "SQLite Database Integration" drop-in (WordPress Playground, some
	 * hosts) translates MySQL to SQLite and supports a narrower dialect.
	 */
	private function isSqliteIntegration(): bool {
		return class_exists( 'WP_SQLite_DB', false ) && $this->wpdb instanceof \WP_SQLite_DB;
	}

	public function driver(): string {
		return 'mysql';
	}

	public function ddl( string $sql ): void {
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.NotPrepared
		$this->wpdb->query( $sql );
	}

	public function escapeLike( string $text ): string {
		return $this->wpdb->esc_like( $text );
	}

	protected function begin(): void {
		$this->wpdb->query( 'START TRANSACTION' );
	}

	protected function commit(): void {
		$this->wpdb->query( 'COMMIT' );
	}

	protected function rollback(): void {
		$this->wpdb->query( 'ROLLBACK' );
	}

	/**
	 * @param array<int,mixed> $params Params.
	 */
	private function prepare( string $sql, array $params ): string {
		if ( array() === $params ) {
			// No placeholders: unescape %% which callers write for literal percent.
			return str_replace( '%%', '%', $sql );
		}
		$params = array_map( array( $this, 'normalise' ), $params );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return (string) $this->wpdb->prepare( $sql, ...$params );
	}

	private function check(): void {
		if ( '' !== $this->wpdb->last_error ) {
			$this->fail();
		}
	}

	/**
	 * @return never
	 */
	private function fail(): void {
		$error = $this->wpdb->last_error;
		if ( function_exists( 'error_log' ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions
			error_log( 'Goriber Hisab DB error: ' . $error );
		}
		throw new DatabaseException( 'A database error occurred.' );
	}
}
