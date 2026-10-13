<?php
/**
 * Businesses and branches.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Tenancy;

use BizLedger\Accounting\AccountService;
use BizLedger\Audit\AuditLogger;
use BizLedger\Catalog\TaxonomyService;
use BizLedger\Catalog\TaxService;
use BizLedger\Database\Database;
use BizLedger\Security\Permissions;
use BizLedger\Settings\SettingsService;
use BizLedger\Support\Clock;
use BizLedger\Support\ConflictException;
use BizLedger\Support\Decimal;
use BizLedger\Support\Events;
use BizLedger\Support\Service;
use BizLedger\Support\Text;
use BizLedger\Support\ValidationException;

/**
 * Creates and maintains businesses (tenants) and their branches.
 */
final class BusinessService extends Service {

	public const TYPES = array(
		'retail'      => 'Retail Shop',
		'grocery'     => 'Grocery',
		'pharmacy'    => 'Pharmacy',
		'electronics' => 'Electronics',
		'clothing'    => 'Clothing',
		'restaurant'  => 'Restaurant',
		'wholesale'   => 'Wholesale',
		'service'     => 'Service Business',
		'ecommerce'   => 'E-commerce',
		'general'     => 'General Business',
	);

	private AccountService $accounts;
	private TaxonomyService $taxonomy;
	private TaxService $taxes;
	private SettingsService $settings;
	private Permissions $permissions;
	private AuditLogger $audit;

	public function __construct( Database $db, Clock $clock, Events $events, AccountService $accounts, TaxonomyService $taxonomy, TaxService $taxes, SettingsService $settings, Permissions $permissions, AuditLogger $audit ) {
		parent::__construct( $db, $clock, $events );
		$this->accounts    = $accounts;
		$this->taxonomy    = $taxonomy;
		$this->taxes       = $taxes;
		$this->settings    = $settings;
		$this->permissions = $permissions;
		$this->audit       = $audit;
	}

	/**
	 * Feature defaults per business type.
	 *
	 * @return array<string,mixed>
	 */
	public function typeDefaults( string $type ): array {
		$map = array(
			'pharmacy'    => array( 'features.batches' => true, 'features.expiry' => true ),
			'grocery'     => array( 'features.expiry' => true ),
			'electronics' => array( 'features.serials' => true ),
			'clothing'    => array( 'features.variants' => true ),
			'wholesale'   => array( 'features.wholesale' => true, 'sales.allow_credit_walkin' => false ),
			'restaurant'  => array( 'pos.paper' => '80mm', 'pos.auto_print' => true ),
			'service'     => array( 'features.variants' => false ),
		);
		return (array) $this->events->filter( 'bizledger/business_type_defaults', $map[ $type ] ?? array(), $type );
	}

	/**
	 * Create a business with its default branch, chart of accounts, units and
	 * owner membership. Returns the business id.
	 *
	 * @param array<string,mixed> $data Profile + optional settings (array) and tax {name, rate, is_inclusive}.
	 */
	public function create( int $owner_id, array $data ): int {
		$clean = $this->validate( $data );
		$now   = $this->now();

		$id = $this->db->transaction(
			function () use ( $owner_id, $clean, $data, $now ) {
				$id     = $this->db->insert(
					$this->db->table( 'businesses' ),
					array_merge(
						$clean,
						array(
							'uuid'       => Text::newUuid(),
							'owner_id'   => $owner_id,
							'plan'       => 'free',
							'status'     => 'active',
							'created_by' => $owner_id,
							'updated_by' => $owner_id,
							'created_at' => $now,
							'updated_at' => $now,
						)
					)
				);
				$branch = $this->db->insert(
					$this->db->table( 'branches' ),
					array(
						'business_id' => $id,
						'name'        => Text::line( $data['branch_name'] ?? '' ) ?: 'Main Branch',
						'code'        => 'MAIN',
						'address'     => $clean['address'],
						'phone'       => $clean['phone'],
						'email'       => $clean['email'],
						'is_default'  => 1,
						'status'      => 'active',
						'created_by'  => $owner_id,
						'updated_by'  => $owner_id,
						'created_at'  => $now,
						'updated_at'  => $now,
					)
				);
				$this->db->insert(
					$this->db->table( 'business_users' ),
					array(
						'business_id'       => $id,
						'user_id'           => $owner_id,
						'role'              => 'owner',
						'default_branch_id' => $branch,
						'status'            => 'active',
						'created_by'        => $owner_id,
						'updated_by'        => $owner_id,
						'created_at'        => $now,
						'updated_at'        => $now,
					)
				);
				$this->accounts->seed( $id, $owner_id );
				$this->taxonomy->seedUnits( $id, $owner_id );

				$ctx      = $this->systemContext( $id, $owner_id );
				$settings = array_merge( $this->typeDefaults( $clean['business_type'] ), is_array( $data['settings'] ?? null ) ? $data['settings'] : array() );
				if ( $settings ) {
					$this->settings->update( $ctx, $settings, false );
				}
				if ( ! empty( $data['tax']['rate'] ) ) {
					$this->taxes->save(
						$ctx,
						array(
							'name'         => $data['tax']['name'] ?? 'VAT',
							'rate'         => $data['tax']['rate'],
							'is_inclusive' => $data['tax']['is_inclusive'] ?? false,
							'is_default'   => true,
						)
					);
				}
				$this->audit->log( $ctx, 'create', 'business', $id, 'Business created: ' . $clean['name'] );
				return $id;
			}
		);
		$this->events->dispatch( 'bizledger/business/created', $id, $owner_id );
		return $id;
	}

	/**
	 * @param array<string,mixed> $data Profile fields.
	 * @return array<string,mixed>
	 */
	public function update( BusinessContext $ctx, array $data ): array {
		$ctx->authorize( 'business.manage' );
		$before = $this->get( $ctx->business_id );
		$clean  = $this->validate( array_merge( $before, $data ) );
		$clean['updated_by'] = $ctx->user_id;
		$clean['updated_at'] = $this->now();
		$this->db->update( $this->db->table( 'businesses' ), $clean, array( 'id' => $ctx->business_id ) );
		$this->audit->log( $ctx, 'update', 'business', $ctx->business_id, 'Business profile updated', \BizLedger\Audit\AuditLogger::diff( $before, $clean ) );
		return $this->get( $ctx->business_id );
	}

	/**
	 * @return array<string,mixed>
	 */
	public function get( int $id ): array {
		$t   = $this->db->table( 'businesses' );
		$row = $this->db->row( "SELECT * FROM {$t} WHERE id = %d AND deleted_at IS NULL", array( $id ) );
		if ( null === $row ) {
			throw new \BizLedger\Support\NotFoundException( 'Business not found.' );
		}
		$row['id']       = (int) $row['id'];
		$row['decimals'] = (int) $row['decimals'];
		$row['logo_url'] = (int) $row['logo_id'] && function_exists( 'wp_get_attachment_url' ) ? (string) wp_get_attachment_url( (int) $row['logo_id'] ) : '';
		return $row;
	}

	/**
	 * Businesses a user belongs to, with their role.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public function forUser( int $user_id ): array {
		$bt = $this->db->table( 'businesses' );
		$mt = $this->db->table( 'business_users' );
		return $this->db->rows(
			"SELECT b.id, b.name, b.business_type, b.currency_code, b.logo_id, m.role, m.default_branch_id FROM {$mt} m JOIN {$bt} b ON b.id = m.business_id
			WHERE m.user_id = %d AND m.status = 'active' AND b.status = 'active' AND b.deleted_at IS NULL ORDER BY b.name",
			array( $user_id )
		);
	}

	/* ------------------------------------------------------------------ Branches */

	/**
	 * @return array<int,array<string,mixed>>
	 */
	public function branches( BusinessContext $ctx ): array {
		$t    = $this->db->table( 'branches' );
		$rows = $this->db->rows( "SELECT * FROM {$t} WHERE business_id = %d AND deleted_at IS NULL ORDER BY is_default DESC, name", array( $ctx->business_id ) );
		return array_values( array_filter( $rows, static fn( $b ) => $ctx->canAccessBranch( (int) $b['id'] ) ) );
	}

	/**
	 * @param array<string,mixed> $data name, code, address, phone, email, status.
	 * @return array<string,mixed>
	 */
	public function saveBranch( BusinessContext $ctx, array $data, int $id = 0 ): array {
		$ctx->authorize( 'branches.manage' );
		$name = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			throw ValidationException::field( 'name', 'Branch name is required.' );
		}
		$t   = $this->db->table( 'branches' );
		$row = array(
			'name'       => $name,
			'code'       => strtoupper( Text::key( $data['code'] ?? '', 20 ) ),
			'address'    => Text::multiline( $data['address'] ?? '', 500 ),
			'phone'      => Text::phone( $data['phone'] ?? '' ),
			'email'      => Text::email( $data['email'] ?? '' ),
			'status'     => 'inactive' === ( $data['status'] ?? '' ) ? 'inactive' : 'active',
			'updated_by' => $ctx->user_id,
			'updated_at' => $this->now(),
		);
		if ( $id ) {
			$before = $this->findScoped( $ctx, 'branches', $id, 'Branch' );
			if ( (int) $before['is_default'] && 'inactive' === $row['status'] ) {
				throw ValidationException::field( 'status', 'The main branch cannot be deactivated.' );
			}
			$this->db->update( $t, $row, array( 'id' => $id, 'business_id' => $ctx->business_id ) );
		} else {
			$id = $this->db->insert( $t, array_merge( $row, array( 'business_id' => $ctx->business_id, 'is_default' => 0, 'created_by' => $ctx->user_id, 'created_at' => $this->now() ) ) );
		}
		$this->audit->log( $ctx, 'save', 'branch', $id, 'Branch saved: ' . $name );
		return (array) $this->db->row( "SELECT * FROM {$t} WHERE id = %d", array( $id ) );
	}

	public function deleteBranch( BusinessContext $ctx, int $id ): void {
		$ctx->authorize( 'branches.manage' );
		$branch = $this->findScoped( $ctx, 'branches', $id, 'Branch' );
		if ( (int) $branch['is_default'] ) {
			throw new ConflictException( 'The main branch cannot be deleted.' );
		}
		foreach ( array( 'sales', 'purchases', 'stock_movements', 'journal_lines' ) as $table ) {
			$t = $this->db->table( $table );
			if ( (int) $this->db->value( "SELECT COUNT(*) FROM {$t} WHERE business_id = %d AND branch_id = %d", array( $ctx->business_id, $id ) ) ) {
				throw new ConflictException( 'This branch has transactions. Deactivate it instead.' );
			}
		}
		$this->db->update( $this->db->table( 'branches' ), array( 'deleted_at' => $this->now(), 'deleted_by' => $ctx->user_id ), array( 'id' => $id ) );
		$this->audit->log( $ctx, 'delete', 'branch', $id, 'Branch deleted: ' . $branch['name'] );
	}

	/**
	 * Full-permission context used for seeding and background jobs.
	 */
	public function systemContext( int $business_id, int $user_id = 0, int $branch_id = 0 ): BusinessContext {
		$business = $this->db->row( 'SELECT * FROM ' . $this->db->table( 'businesses' ) . ' WHERE id = %d', array( $business_id ) );
		if ( ! $branch_id ) {
			$branch_id = (int) $this->db->value( 'SELECT id FROM ' . $this->db->table( 'branches' ) . ' WHERE business_id = %d AND is_default = 1', array( $business_id ) );
		}
		return new BusinessContext( (array) $business, $branch_id, $user_id, 'owner', $this->permissions->all() );
	}

	/**
	 * @param array<string,mixed> $data Raw.
	 * @return array<string,mixed>
	 */
	private function validate( array $data ): array {
		$errors = array();
		$name   = Text::line( $data['name'] ?? '' );
		if ( '' === $name ) {
			$errors['name'] = 'Business name is required.';
		}
		$currency = strtoupper( preg_replace( '/[^A-Za-z]/', '', (string) ( $data['currency_code'] ?? 'USD' ) ) ?? '' );
		if ( 3 !== strlen( $currency ) ) {
			$errors['currency_code'] = 'Use a 3-letter currency code (e.g. BDT, USD).';
		}
		$decimals = (int) ( $data['decimals'] ?? 2 );
		if ( $decimals < 0 || $decimals > 4 ) {
			$errors['decimals'] = 'Decimal places must be between 0 and 4.';
		}
		$tz = (string) ( $data['timezone'] ?? 'UTC' );
		try {
			new \DateTimeZone( $tz );
		} catch ( \Exception $e ) {
			$errors['timezone'] = 'Choose a valid timezone.';
		}
		$fy = (string) ( $data['fiscal_year_start'] ?? '01-01' );
		if ( ! preg_match( '/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/', $fy ) ) {
			$errors['fiscal_year_start'] = 'Use MM-DD, e.g. 07-01.';
		}
		$email = Text::email( $data['email'] ?? '' );
		if ( '' !== trim( (string) ( $data['email'] ?? '' ) ) && '' === $email ) {
			$errors['email'] = 'Enter a valid email.';
		}
		if ( $errors ) {
			throw new ValidationException( $errors );
		}
		$type = array_key_exists( (string) ( $data['business_type'] ?? '' ), self::TYPES ) ? (string) $data['business_type'] : 'general';
		$pos  = (string) ( $data['currency_position'] ?? 'before' );
		$pos  = in_array( $pos, array( 'before', 'after', 'before_space', 'after_space' ), true ) ? $pos : 'before';
		return array(
			'name'              => $name,
			'legal_name'        => Text::line( $data['legal_name'] ?? '' ),
			'business_type'     => $type,
			'logo_id'           => max( 0, (int) ( $data['logo_id'] ?? 0 ) ),
			'address'           => Text::multiline( $data['address'] ?? '', 500 ),
			'phone'             => Text::phone( $data['phone'] ?? '' ),
			'email'             => $email,
			'website'           => Text::url( $data['website'] ?? '' ),
			'tax_number'        => Text::line( $data['tax_number'] ?? '', 60 ),
			'currency_code'     => $currency,
			'currency_symbol'   => Text::line( $data['currency_symbol'] ?? '', 10 ) ?: $currency,
			'currency_position' => $pos,
			'decimals'          => $decimals,
			'timezone'          => $tz,
			'fiscal_year_start' => $fy,
		);
	}
}
