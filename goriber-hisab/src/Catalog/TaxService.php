<?php
/**
 * Tax rates.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Catalog;

use GoriberHisab\Audit\AuditLogger;
use GoriberHisab\Database\Database;
use GoriberHisab\Support\Clock;
use GoriberHisab\Support\Decimal;
use GoriberHisab\Support\Events;
use GoriberHisab\Support\Service;
use GoriberHisab\Support\Text;
use GoriberHisab\Support\ValidationException;
use GoriberHisab\Tenancy\BusinessContext;

/**
 * Configurable tax/VAT rates. Nothing about a country's rules is hard-coded:
 * rates, inclusive/exclusive behaviour and the tax label are all data.
 */
final class TaxService extends Service {

	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->audit = $audit;
	}

	/**
	 * @return array<int,array<string,mixed>>
	 */
	public function list( BusinessContext $ctx ): array {
		$t = $this->db->table( 'tax_rates' );
		return array_map(
			static function ( $r ) {
				$r['id']           = (int) $r['id'];
				$r['is_inclusive'] = (bool) (int) $r['is_inclusive'];
				$r['is_default']   = (bool) (int) $r['is_default'];
				return $r;
			},
			$this->db->rows( "SELECT * FROM {$t} WHERE business_id = %d AND deleted_at IS NULL ORDER BY rate", array( $ctx->business_id ) )
		);
	}

	/**
	 * Rate row by id (business scoped) or null.
	 *
	 * @return array<string,mixed>|null
	 */
	public function find( BusinessContext $ctx, int $id ): ?array {
		if ( $id <= 0 ) {
			return null;
		}
		$t = $this->db->table( 'tax_rates' );
		return $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND business_id = %d AND deleted_at IS NULL", array( $id, $ctx->business_id ) );
	}

	/**
	 * @return array<string,mixed>|null
	 */
	public function default( BusinessContext $ctx ): ?array {
		$t = $this->db->table( 'tax_rates' );
		return $this->db->row( "SELECT * FROM {$t} WHERE business_id = %d AND is_default = 1 AND deleted_at IS NULL AND status = 'active' LIMIT 1", array( $ctx->business_id ) );
	}

	/**
	 * @param array<string,mixed> $data name, rate, is_inclusive, is_default.
	 * @return array<string,mixed>
	 */
	public function save( BusinessContext $ctx, array $data, int $id = 0 ): array {
		$ctx->authorize( 'settings.manage' );
		$name = Text::line( $data['name'] ?? '', 100 );
		if ( '' === $name ) {
			throw ValidationException::field( 'name', 'Name is required.' );
		}
		try {
			$rate = Decimal::of( $data['rate'] ?? 0 );
		} catch ( \InvalidArgumentException $e ) {
			throw ValidationException::field( 'rate', 'Enter a valid rate.' );
		}
		if ( $rate < 0 || $rate > Decimal::of( 100 ) ) {
			throw ValidationException::field( 'rate', 'Rate must be between 0 and 100.' );
		}
		$t   = $this->db->table( 'tax_rates' );
		$row = array(
			'name'         => $name,
			'rate'         => Decimal::toString( $rate ),
			'is_inclusive' => Text::bool( $data['is_inclusive'] ?? false ) ? 1 : 0,
			'is_default'   => Text::bool( $data['is_default'] ?? false ) ? 1 : 0,
			'status'       => 'active',
			'updated_by'   => $ctx->user_id,
			'updated_at'   => $this->now(),
		);
		return $this->db->transaction(
			function () use ( $ctx, $id, $row, $t, $name ) {
				if ( $row['is_default'] ) {
					$this->db->execute( "UPDATE {$t} SET is_default = 0 WHERE business_id = %d", array( $ctx->business_id ) );
				}
				if ( $id ) {
					$this->findScoped( $ctx, 'tax_rates', $id, 'Tax rate' );
					$this->db->update( $t, $row, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
				} else {
					$id = $this->db->insert( $t, array_merge( $row, array( 'business_id' => $ctx->business_id, 'created_by' => $ctx->user_id, 'created_at' => $this->now() ) ) );
				}
				$this->audit->log( $ctx, 'save', 'tax_rate', $id, 'Tax rate saved: ' . $name );
				return (array) $this->find( $ctx, $id );
			}
		);
	}

	public function delete( BusinessContext $ctx, int $id ): void {
		$ctx->authorize( 'settings.manage' );
		$this->findScoped( $ctx, 'tax_rates', $id, 'Tax rate' );
		$this->db->update( $this->db->table( 'tax_rates' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id, 'is_default' => 0 ), array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		$pt = $this->db->table( 'products' );
		$this->db->execute( "UPDATE {$pt} SET tax_rate_id = 0 WHERE business_id = %d AND tax_rate_id = %d", array( $ctx->business_id, $id ) );
		$this->audit->log( $ctx, 'delete', 'tax_rate', $id, 'Tax rate deleted' );
	}
}
