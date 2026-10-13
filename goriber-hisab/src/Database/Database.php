<?php
/**
 * Database contract.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Database;

/**
 * Minimal database API used by every repository/service.
 *
 * Placeholders follow wpdb conventions: %s (string), %d (int), %f (float),
 * and %% for a literal percent sign. Table names come from table(), which
 * applies the WordPress + plugin prefix; they are never user input.
 */
interface Database {

	/**
	 * Fully prefixed table name for a logical table ("sales" → "wp_bzl_sales").
	 */
	public function table( string $name ): string;

	/**
	 * Insert a row and return its auto-increment id.
	 *
	 * @param array<string,mixed> $data Column => value.
	 */
	public function insert( string $table, array $data ): int;

	/**
	 * Update rows. $where is column => value equality, combined with AND.
	 *
	 * @param array<string,mixed> $data  Column => value.
	 * @param array<string,mixed> $where Column => value.
	 * @return int Affected rows.
	 */
	public function update( string $table, array $data, array $where ): int;

	/**
	 * Delete rows matching $where (column => value, AND).
	 *
	 * @param array<string,mixed> $where Column => value.
	 */
	public function delete( string $table, array $where ): int;

	/**
	 * @param array<int,mixed> $params Placeholder values.
	 * @return array<string,mixed>|null
	 */
	public function row( string $sql, array $params = array() ): ?array;

	/**
	 * @param array<int,mixed> $params Placeholder values.
	 * @return array<int,array<string,mixed>>
	 */
	public function rows( string $sql, array $params = array() ): array;

	/**
	 * First column of the first row.
	 *
	 * @param array<int,mixed> $params Placeholder values.
	 * @return mixed
	 */
	public function value( string $sql, array $params = array() );

	/**
	 * First column of every row.
	 *
	 * @param array<int,mixed> $params Placeholder values.
	 * @return array<int,mixed>
	 */
	public function column( string $sql, array $params = array() ): array;

	/**
	 * Run a write statement; returns affected rows.
	 *
	 * @param array<int,mixed> $params Placeholder values.
	 */
	public function execute( string $sql, array $params = array() ): int;

	/**
	 * Run $callback inside a transaction. Nested calls join the outer
	 * transaction (an exception anywhere rolls everything back). Pass
	 * $savepoint = true to make a nested unit independently rollback-able;
	 * only honoured when supportsSavepoints().
	 *
	 * @template T
	 * @param callable():T $callback Work.
	 * @return T
	 */
	public function transaction( callable $callback, bool $savepoint = false );

	/**
	 * Whether nested savepoints are available (MySQL/MariaDB/SQLite yes; the
	 * WordPress SQLite-integration translator no).
	 */
	public function supportsSavepoints(): bool;

	/**
	 * Row-lock suffix for SELECT (" FOR UPDATE" on MySQL).
	 */
	public function forUpdate(): string;

	/**
	 * "mysql" or "sqlite".
	 */
	public function driver(): string;

	/**
	 * Escape a string for use inside LIKE (wildcards escaped).
	 */
	public function escapeLike( string $text ): string;

	/**
	 * Execute raw DDL (installer only).
	 */
	public function ddl( string $sql ): void;
}
