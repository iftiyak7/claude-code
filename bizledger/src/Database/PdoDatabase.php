<?php
/**
 * PDO driver (SQLite for tests/CLI, MySQL for tooling).
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Database;

use BizLedger\Support\DatabaseException;

/**
 * Translates wpdb-style placeholders to PDO bound parameters.
 */
final class PdoDatabase extends AbstractDatabase {

	private \PDO $pdo;

	/**
	 * Executed statements (when logging is on), for query-count tests.
	 *
	 * @var array<int,string>
	 */
	public array $log = array();

	public bool $logging = false;

	public function __construct( \PDO $pdo, string $prefix = 'wp_' ) {
		$this->pdo = $pdo;
		$this->pdo->setAttribute( \PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION );
		$this->pdo->setAttribute( \PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC );
		if ( 'sqlite' === $this->driver() ) {
			$this->pdo->exec( 'PRAGMA foreign_keys = OFF' );
		}
		parent::__construct( $prefix );
	}

	public static function sqliteMemory(): self {
		return new self( new \PDO( 'sqlite::memory:' ) );
	}

	public function insert( string $table, array $data ): int {
		$cols   = array_map( array( $this, 'column_name' ), array_keys( $data ) );
		$values = array_map( array( $this, 'normalise' ), array_values( $data ) );
		$sql    = "INSERT INTO {$table} (" . implode( ', ', $cols ) . ') VALUES (' . implode( ', ', array_fill( 0, count( $cols ), '?' ) ) . ')';
		$this->run( $sql, $values, false );
		return (int) $this->pdo->lastInsertId();
	}

	public function row( string $sql, array $params = array() ): ?array {
		$stmt = $this->run( $sql, $params );
		$row  = $stmt->fetch();
		return is_array( $row ) ? $row : null;
	}

	public function rows( string $sql, array $params = array() ): array {
		return $this->run( $sql, $params )->fetchAll();
	}

	public function execute( string $sql, array $params = array() ): int {
		return $this->run( $sql, $params )->rowCount();
	}

	public function forUpdate(): string {
		return 'sqlite' === $this->driver() ? '' : ' FOR UPDATE';
	}

	public function driver(): string {
		return 'sqlite' === $this->pdo->getAttribute( \PDO::ATTR_DRIVER_NAME ) ? 'sqlite' : 'mysql';
	}

	public function ddl( string $sql ): void {
		$this->pdo->exec( $sql );
	}

	public function escapeLike( string $text ): string {
		return addcslashes( $text, '_%\\' );
	}

	protected function begin(): void {
		$this->pdo->beginTransaction();
	}

	protected function commit(): void {
		$this->pdo->commit();
	}

	protected function rollback(): void {
		if ( $this->pdo->inTransaction() ) {
			$this->pdo->rollBack();
		}
	}

	/**
	 * @param array<int,mixed> $params Values.
	 */
	private function run( string $sql, array $params, bool $translate = true ): \PDOStatement {
		if ( $translate ) {
			$sql = $this->translate( $sql );
		}
		if ( $this->logging ) {
			$this->log[] = $sql;
		}
		try {
			$stmt = $this->pdo->prepare( $sql );
			$i    = 1;
			foreach ( $params as $value ) {
				$value = $this->normalise( $value );
				$type  = is_int( $value ) ? \PDO::PARAM_INT : ( null === $value ? \PDO::PARAM_NULL : \PDO::PARAM_STR );
				$stmt->bindValue( $i++, is_float( $value ) ? (string) $value : $value, $type );
			}
			$stmt->execute();
			return $stmt;
		} catch ( \PDOException $e ) {
			throw new DatabaseException( 'Database error: ' . $e->getMessage() . ' SQL: ' . $sql, 0, $e );
		}
	}

	/**
	 * wpdb placeholders → "?" ; "%%" → "%".
	 */
	private function translate( string $sql ): string {
		return (string) preg_replace_callback(
			'/%%|%[sdf]/',
			static fn( array $m ) => '%%' === $m[0] ? '%' : '?',
			$sql
		);
	}
}
