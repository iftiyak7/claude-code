<?php
/**
 * Per-request tenant context.
 *
 * @package GoriberHisab
 */

declare(strict_types=1);

namespace GoriberHisab\Tenancy;

use GoriberHisab\Support\PermissionException;

/**
 * Who is acting, for which business and branch, with which permissions.
 *
 * Every domain service method receives a context; the business id used in
 * queries always comes from here, never from request payloads.
 */
final class BusinessContext {

	public int $business_id;
	public int $branch_id;
	public int $user_id;
	public string $role;

	/**
	 * Business row (currency, decimals, timezone, …).
	 *
	 * @var array<string,mixed>
	 */
	public array $business;

	/**
	 * Branch ids the member may access; empty = all branches.
	 *
	 * @var array<int,int>
	 */
	public array $branch_ids;

	/**
	 * @var array<string,bool>
	 */
	private array $permissions;

	/**
	 * Subscription state for hosted shops (null when no platform policy).
	 *
	 * @var array<string,mixed>|null
	 */
	public ?array $subscription = null;

	public string $ip = '';
	public string $user_agent = '';

	/**
	 * @param array<string,mixed> $business    Business row.
	 * @param array<int,string>   $permissions Effective permissions.
	 * @param array<int,int>      $branch_ids  Allowed branches (empty = all).
	 */
	public function __construct( array $business, int $branch_id, int $user_id, string $role, array $permissions, array $branch_ids = array() ) {
		$this->business    = $business;
		$this->business_id = (int) $business['id'];
		$this->branch_id   = $branch_id;
		$this->user_id     = $user_id;
		$this->role        = $role;
		$this->permissions = array_fill_keys( $permissions, true );
		$this->branch_ids  = array_map( 'intval', $branch_ids );
	}

	public function can( string $permission ): bool {
		return isset( $this->permissions[ $permission ] );
	}

	/**
	 * @throws PermissionException When the permission is missing.
	 */
	public function authorize( string $permission ): void {
		if ( ! $this->can( $permission ) ) {
			throw new PermissionException( sprintf( 'You do not have permission to perform this action (%s).', $permission ) );
		}
	}

	/**
	 * @return array<int,string>
	 */
	public function permissions(): array {
		return array_keys( $this->permissions );
	}

	public function canAccessBranch( int $branch_id ): bool {
		return array() === $this->branch_ids || in_array( $branch_id, $this->branch_ids, true );
	}

	/**
	 * Currency decimal places for rounding.
	 */
	public function decimals(): int {
		return max( 0, min( 4, (int) ( $this->business['decimals'] ?? 2 ) ) );
	}

	public function timezone(): string {
		return (string) ( $this->business['timezone'] ?? 'UTC' ) ?: 'UTC';
	}

	public function currency(): string {
		return (string) ( $this->business['currency_code'] ?? 'USD' );
	}

	/**
	 * Copy of this context switched to another branch.
	 */
	public function withBranch( int $branch_id ): self {
		$clone            = clone $this;
		$clone->branch_id = $branch_id;
		return $clone;
	}
}
