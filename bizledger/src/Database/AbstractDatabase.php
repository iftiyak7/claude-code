<?php
/**
 * Shared database helpers.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Database;

use BizLedger\Support\DatabaseException;
use BizLedger\Support\Json;

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

	public function transaction( callable $callback ) {
		$outer = 0 === $this->depth;
		if ( $outer ) {
			$this->begin();
		}
		++$this->depth;
		try {
			$result = $callback();
			--$this->depth;
			if ( $outer ) {
				$this->commit();
			}
			return $result;
		} catch ( \Throwable $e ) {
			--$this->depth;
			if ( $outer ) {
				$this->rollback();
			}
			throw $e;
		}
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

