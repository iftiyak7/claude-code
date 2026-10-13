<?php
/**
 * Import, export and backup.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Data;

use BizLedger\Database\Schema;
use BizLedger\Kernel;
use BizLedger\Support\BizLedgerException;
use BizLedger\Support\Json;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;
use BizLedger\Tenancy\BusinessContext;

/**
 * Bulk data in and out of a business.
 *
 * - Import goes through the normal services row by row, so every rule,
 *   permission and ledger posting applies exactly as in the UI. A dry run
 *   validates inside a transaction that is rolled back.
 * - Export produces CSV text for lists and reports.
 * - Backup produces a JSON document of every business-scoped table.
 */
final class DataService {

	public const IMPORTABLE = array( 'products', 'customers', 'suppliers' );
	public const EXPORTABLE = array( 'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'incomes', 'payments', 'stock' );

	private Kernel $k;

	public function __construct( Kernel $kernel ) {
		$this->k = $kernel;
	}

	/**
	 * Column map for import templates (header => field).
	 *
	 * @return array<string,array<int,string>>
	 */
	public static function templates(): array {
		return array(
			'products'  => array( 'name', 'sku', 'barcode', 'type', 'category', 'brand', 'unit', 'purchase_price', 'selling_price', 'wholesale_price', 'min_selling_price', 'min_stock', 'opening_qty', 'description' ),
			'customers' => array( 'name', 'code', 'phone', 'email', 'company', 'address', 'tax_number', 'opening_balance', 'credit_limit', 'notes' ),
			'suppliers' => array( 'name', 'code', 'phone', 'email', 'company', 'address', 'tax_number', 'opening_balance', 'notes' ),
		);
	}

	/**
	 * Import rows (already parsed from CSV by the client, header → value).
	 *
	 * @param array<int,array<string,mixed>> $rows Rows.
	 * @return array{created:int,errors:array<int,array<string,mixed>>,dry_run:bool}
	 */
	public function import( BusinessContext $ctx, string $type, array $rows, bool $dry_run ): array {
		if ( ! in_array( $type, self::IMPORTABLE, true ) ) {
			throw ValidationException::field( 'type', 'This data type cannot be imported.' );
		}
		$ctx->authorize( 'data.import' );
		if ( count( $rows ) > 5000 ) {
			throw ValidationException::field( 'rows', 'Import at most 5,000 rows at a time.' );
		}
		$created = 0;
		$errors  = array();
		$lookups = array();

		$importRow = function ( array $row ) use ( $ctx, $type, &$lookups ): void {
			if ( 'products' === $type ) {
				$refs = array(
					'category' => array( 'categories', 'category_id' ),
					'brand'    => array( 'brands', 'brand_id' ),
					'unit'     => array( 'units', 'unit_id' ),
				);
				foreach ( $refs as $field => list( $kind, $target ) ) {
					if ( '' !== ( $row[ $field ] ?? '' ) ) {
						$row[ $target ] = $this->lookup( $ctx, $kind, $row[ $field ], $lookups );
					}
				}
				$this->k->products->create( $ctx, $row );
			} else {
				$this->k->contacts->create( $ctx, rtrim( $type, 's' ), $row );
			}
		};

		$clean = array();
		foreach ( array_values( $rows ) as $i => $raw ) {
			$row = array();
			foreach ( (array) $raw as $key => $value ) {
				$row[ Text::key( str_replace( ' ', '_', (string) $key ) ) ] = is_scalar( $value ) ? trim( (string) $value ) : '';
			}
			if ( '' !== ( $row['name'] ?? '' ) ) {
				$clean[ $i ] = $row;
			}
		}

		// Duplicates inside the file are reported up front, so a dry run gives
		// the same answer whether or not the database supports savepoints.
		$unique = 'products' === $type ? array( 'sku', 'barcode' ) : array( 'phone', 'code' );
		$seen   = array();
		foreach ( $clean as $i => $row ) {
			foreach ( $unique as $field ) {
				$value = strtolower( (string) ( $row[ $field ] ?? '' ) );
				if ( '' === $value ) {
					continue;
				}
				if ( isset( $seen[ $field ][ $value ] ) ) {
					$errors[] = array(
						'row'     => $i + 2,
						'name'    => $row['name'],
						'message' => sprintf( 'Duplicate %1$s "%2$s" (same as row %3$d in this file).', $field, $row[ $field ], $seen[ $field ][ $value ] ),
						'errors'  => array( $field => 'Duplicate in file.' ),
					);
					unset( $clean[ $i ] );
					continue 2;
				}
				$seen[ $field ][ $value ] = $i + 2;
			}
		}

		$fail = static function ( int $i, array $row, BizLedgerException $e ) use ( &$errors ): void {
			$errors[] = array(
				'row'     => $i + 2, // +1 header, +1 human numbering.
				'name'    => $row['name'],
				'message' => $e->getMessage(),
				'errors'  => $e instanceof ValidationException ? $e->errors() : array(),
			);
		};

		if ( $this->k->db->supportsSavepoints() ) {
			// One outer transaction (rolled back for a dry run); each row is a
			// savepoint, so a bad row never leaves partial writes behind and
			// duplicates *within* the file are detected even in a dry run.
			try {
				$this->k->db->transaction(
					function () use ( $clean, $importRow, $fail, &$created, $dry_run ) {
						foreach ( $clean as $i => $row ) {
							try {
								$this->k->db->transaction( fn() => $importRow( $row ), true );
								++$created;
							} catch ( BizLedgerException $e ) {
								$fail( $i, $row, $e );
							}
						}
						if ( $dry_run ) {
							throw new DryRunRollback();
						}
					}
				);
			} catch ( DryRunRollback $e ) {
				unset( $e );
			}
		} else {
			// No savepoints: each row is its own transaction.
			foreach ( $clean as $i => $row ) {
				try {
					$this->k->db->transaction(
						function () use ( $row, $importRow, $dry_run ) {
							$importRow( $row );
							if ( $dry_run ) {
								throw new DryRunRollback();
							}
						}
					);
					++$created;
				} catch ( DryRunRollback $e ) {
					++$created;
				} catch ( BizLedgerException $e ) {
					$fail( $i, $row, $e );
				}
			}
		}
		usort( $errors, static fn( $a, $b ) => $a['row'] <=> $b['row'] );
		if ( ! $dry_run ) {
			$this->k->audit->log( $ctx, 'import', $type, 0, sprintf( 'Imported %d %s (%d errors)', $created, $type, count( $errors ) ) );
		}
		return array(
			'created' => $created,
			'errors'  => $errors,
			'dry_run' => $dry_run,
		);
	}

	/**
	 * Find or create a taxonomy term by name.
	 *
	 * @param array<string,array<string,int>> $cache Cache.
	 */
	private function lookup( BusinessContext $ctx, string $kind, string $name, array &$cache ): int {
		$key = strtolower( $name );
		if ( isset( $cache[ $kind ][ $key ] ) ) {
			return $cache[ $kind ][ $key ];
		}
		$t  = $this->k->db->table( $kind );
		$id = (int) $this->k->db->value( "SELECT id FROM {$t} WHERE business_id = %d AND name = %s AND deleted_at IS NULL", array( $ctx->business_id, Text::line( $name ) ) );
		if ( ! $id ) {
			$id = (int) $this->k->taxonomy->save( $ctx, $kind, array( 'name' => $name, 'short_name' => $name ) )['id'];
		}
		$cache[ $kind ][ $key ] = $id;
		return $id;
	}

	/**
	 * Export a list as CSV text.
	 *
	 * @param array<string,mixed> $args Filters passed to the list service.
	 * @return array{filename:string,csv:string,rows:int}
	 */
	public function export( BusinessContext $ctx, string $type, array $args ): array {
		if ( ! in_array( $type, self::EXPORTABLE, true ) ) {
			throw ValidationException::field( 'type', 'This data type cannot be exported.' );
		}
		$ctx->authorize( 'data.export' );
		$args['per_page'] = 200;
		$rows             = array();
		$page             = 1;
		do {
			$args['page'] = $page;
			switch ( $type ) {
				case 'products':
					$res = $this->k->products->list( $ctx, $args + array( 'status' => 'any' ) );
					break;
				case 'customers':
				case 'suppliers':
					$res = $this->k->contacts->list( $ctx, rtrim( $type, 's' ), $args );
					break;
				case 'sales':
					$res = $this->k->sales->list( $ctx, $args );
					break;
				case 'purchases':
					$res = $this->k->purchases->list( $ctx, $args );
					break;
				case 'expenses':
					$res = $this->k->finance->list( $ctx, 'expense', $args );
					break;
				case 'incomes':
					$res = $this->k->finance->list( $ctx, 'income', $args );
					break;
				case 'payments':
					$res = $this->k->payments->list( $ctx, $args );
					break;
				default:
					$res = $this->k->stock->levels( $ctx, $args );
			}
			foreach ( $res['items'] as $item ) {
				$rows[] = $this->flatten( $item );
			}
			++$page;
		} while ( $page <= $res['pages'] && count( $rows ) < 100000 );

		$this->k->audit->log( $ctx, 'export', $type, 0, sprintf( 'Exported %d %s', count( $rows ), $type ) );
		return array(
			'filename' => sprintf( '%s-%s.csv', $type, gmdate( 'Y-m-d' ) ),
			'csv'      => self::toCsv( $rows ),
			'rows'     => count( $rows ),
		);
	}

	/**
	 * Rows → CSV with spreadsheet-formula injection protection.
	 *
	 * @param array<int,array<string,scalar|null>> $rows Rows.
	 */
	public static function toCsv( array $rows ): string {
		if ( ! $rows ) {
			return '';
		}
		$h = fopen( 'php://temp', 'r+' );
		fwrite( $h, "\xEF\xBB\xBF" ); // UTF-8 BOM so Excel shows Bangla correctly.
		fputcsv( $h, array_keys( $rows[0] ), ',', '"', '\\' );
		foreach ( $rows as $row ) {
			fputcsv(
				$h,
				array_map(
					static function ( $v ) {
						$v = (string) $v;
						// Neutralise =, +, -, @ formulas (CSV injection) unless numeric.
						return ( '' !== $v && in_array( $v[0], array( '=', '+', '-', '@', "\t", "\r" ), true ) && ! is_numeric( $v ) ) ? "'" . $v : $v;
					},
					$row
				),
				',',
				'"',
				'\\'
			);
		}
		rewind( $h );
		$csv = (string) stream_get_contents( $h );
		fclose( $h );
		return $csv;
	}

	/**
	 * Full JSON backup of one business.
	 *
	 * @return array<string,mixed>
	 */
	public function backup( BusinessContext $ctx ): array {
		$ctx->authorize( 'backup.manage' );
		$out = array(
			'format'      => 'bizledger-backup',
			'version'     => Schema::VERSION,
			'created_at'  => gmdate( 'c' ),
			'business_id' => $ctx->business_id,
			'tables'      => array(),
		);
		foreach ( array_keys( Schema::tables() ) as $table ) {
			$t   = $this->k->db->table( $table );
			$col = 'businesses' === $table ? 'id' : 'business_id';
			if ( 'business_users' === $table || isset( Schema::tables()[ $table ]['columns']['business_id'] ) || 'businesses' === $table ) {
				$rows = array();
				$last = 0;
				do {
					// Keyset pagination keeps memory flat on large tables.
					$batch = $this->k->db->rows( "SELECT * FROM {$t} WHERE {$col} = %d AND id > %d ORDER BY id LIMIT 2000", array( $ctx->business_id, $last ) );
					foreach ( $batch as $r ) {
						$rows[] = $r;
						$last   = (int) $r['id'];
					}
				} while ( count( $batch ) === 2000 );
				$out['tables'][ $table ] = $rows;
			}
		}
		if ( function_exists( 'update_option' ) ) {
			update_option( 'bizledger_last_backup_' . $ctx->business_id, time(), false );
		}
		$this->k->audit->log( $ctx, 'backup', 'business', $ctx->business_id, 'Backup downloaded' );
		return $out;
	}

	/**
	 * @param array<string,mixed> $item Row.
	 * @return array<string,scalar|null>
	 */
	private function flatten( array $item ): array {
		$out = array();
		foreach ( $item as $k => $v ) {
			if ( is_array( $v ) || is_object( $v ) ) {
				$v = Json::encode( $v );
			}
			$out[ $k ] = is_bool( $v ) ? ( $v ? '1' : '0' ) : $v;
		}
		return $out;
	}
}

/**
 * Internal signal to roll back a dry run.
 */
final class DryRunRollback extends \RuntimeException {
}
