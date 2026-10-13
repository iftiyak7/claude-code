<?php
/**
 * Shared database helpers.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Database;

use GoriberHisab\Support\DatabaseException;
use GoriberHisab\Support\Json;

/**
 * Implements the parts of Database that are driver independent.
 */
abstract class AbstractDatabase implements Database {

	protected string $prefix;

	private int $depth = 0;

	public function __construct( string $prefix ) {
		$this->prefix = $prefix;
	}

	public function table( string $name ): string {
		if ( ! preg_match( '/^[a-z_]+$/', $name ) ) {
			throw new DatabaseException( 'Invalid table name.' );
		}
		return $this->prefix . 'bzl_' . $name;
	}

	public function update( string $table, array $data, array $where ): int {
		if ( array() === $data ) {
			return 0;
		}
		$set    = array();
		$params = array();
		foreach ( $data as $col => $value ) {
			$set[] = $this->column_name( $col ) . ' = ' . $this->placeholder( $value );
			if ( null !== $value ) {
				$params[] = $value;
			}
		}
		list( $where_sql, $where_params ) = $this->where( $where );
		return $this->execute( "UPDATE {$table} SET " . implode( ', ', $set ) . " WHERE {$where_sql}", array_merge( $params, $where_params ) );
	}

	public function delete( string $table, array $where ): int {
		list( $where_sql, $params ) = $this->where( $where );
		return $this->execute( "DELETE FROM {$table} WHERE {$where_sql}", $params );
	}

	public function value( string $sql, array $params = array() ) {
		$row = $this->row( $sql, $params );
		return null === $row ? null : reset( $row );
	}

	public function column( string $sql, array $params = array() ): array {
		return array_map(
			static fn( array $r ) => reset( $r ),
			$this->rows( $sql, $params )
		);
	}

	public function transaction( callable $callback, bool $savepoint = false ) {
		$outer = 0 === $this->depth;
		$point = ( ! $outer && $savepoint && $this->supportsSavepoints() ) ? 'bzl_sp_' . $this->depth : null;
		if ( $outer ) {
			$this->begin();
		} elseif ( null !== $point ) {
			$this->ddl( "SAVEPOINT {$point}" );
		}
		++$this->depth;
		try {
			$result = $callback();
			--$this->depth;
			if ( $outer ) {
				$this->commit();
			} elseif ( null !== $point ) {
				$this->ddl( "RELEASE SAVEPOINT {$point}" );
			}
			return $result;
		} catch ( \Throwable $e ) {
			--$this->depth;
			if ( $outer ) {
				$this->rollback();
			} elseif ( null !== $point ) {
				$this->ddl( "ROLLBACK TO SAVEPOINT {$point}" );
			}
			throw $e;
		}
	}

	public function supportsSavepoints(): bool {
		return true;
	}

	/**
	 * True while inside a transaction.
	 */
	public function inTransaction(): bool {
		return $this->depth > 0;
	}

	public function escapeLike( string $text ): string {
		return addcslashes( $text, '_%\\' );
	}

	abstract protected function begin(): void;

	abstract protected function commit(): void;

	abstract protected function rollback(): void;

	/**
	 * @param mixed $value Value.
	 */
	protected function placeholder( $value ): string {
		if ( null === $value ) {
			return 'NULL';
		}
		if ( is_int( $value ) || is_bool( $value ) ) {
			return '%d';
		}
		if ( is_float( $value ) ) {
			return '%f';
		}
		return '%s';
	}

	/**
	 * @param array<string,mixed> $where Column => value.
	 * @return array{0:string,1:array<int,mixed>}
	 */
	protected function where( array $where ): array {
		if ( array() === $where ) {
			throw new DatabaseException( 'Refusing to run an unconditional write.' );
		}
		$parts  = array();
		$params = array();
		foreach ( $where as $col => $value ) {
			if ( null === $value ) {
				$parts[] = $this->column_name( $col ) . ' IS NULL';
				continue;
			}
			$parts[]  = $this->column_name( $col ) . ' = ' . $this->placeholder( $value );
			$params[] = $value;
		}
		return array( implode( ' AND ', $parts ), $params );
	}

	protected function column_name( string $col ): string {
		if ( ! preg_match( '/^[a-zA-Z_][a-zA-Z0-9_]*$/', $col ) ) {
			throw new DatabaseException( 'Invalid column name.' );
		}
		return $col;
	}

	/**
	 * Normalise values for binding.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	protected function normalise( $value ) {
		if ( is_bool( $value ) ) {
			return $value ? 1 : 0;
		}
		if ( is_array( $value ) || is_object( $value ) ) {
			return Json::encode( $value );
		}
		return $value;
	}
}

