<?php
/**
 * Permission and role registry.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Security;

use BizLedger\Support\Events;

/**
 * Defines every granular permission and the built-in roles.
 *
 * Both lists pass through filters so add-ons can register their own
 * permissions ("bizledger/permissions") and roles ("bizledger/roles").
 */
final class Permissions {

	private Events $events;

	/**
	 * @var array<string,array<string,string>>|null
	 */
	private ?array $groups = null;

	/**
	 * @var array<string,array{label:string,permissions:array<int,string>}>|null
	 */
	private ?array $roles = null;

	public function __construct( Events $events ) {
		$this->events = $events;
	}

	/**
	 * Permissions grouped by module: group => [permission => label].
	 *
	 * @return array<string,array<string,string>>
	 */
	public function groups(): array {
		if ( null !== $this->groups ) {
			return $this->groups;
		}
		$groups = array(
			'dashboard'  => array(
				'dashboard.view' => 'View dashboard',
			),
			'sales'      => array(
				'sales.view'     => 'View sales',
				'sales.create'   => 'Create sales',
				'sales.edit'     => 'Edit sales',
				'sales.delete'   => 'Void/delete sales',
				'sales.return'   => 'Process sales returns',
				'sales.discount' => 'Give discounts',
				'sales.price'    => 'Change selling price',
				'pos.use'        => 'Use POS',
				'invoices.print' => 'Print invoices',
			),
			'purchases'  => array(
				'purchases.view'   => 'View purchases',
				'purchases.create' => 'Create purchases',
				'purchases.edit'   => 'Edit purchases',
				'purchases.delete' => 'Void/delete purchases',
				'purchases.return' => 'Process purchase returns',
			),
			'products'   => array(
				'products.view'   => 'View products',
				'products.create' => 'Create products',
				'products.edit'   => 'Edit products',
				'products.delete' => 'Delete products',
				'products.cost'   => 'View purchase cost',
			),
			'inventory'  => array(
				'inventory.view'   => 'View stock',
				'inventory.adjust' => 'Adjust stock',
			),
			'customers'  => array(
				'customers.view'   => 'View customers',
				'customers.create' => 'Create customers',
				'customers.edit'   => 'Edit customers',
				'customers.delete' => 'Delete customers',
			),
			'suppliers'  => array(
				'suppliers.view'   => 'View suppliers',
				'suppliers.create' => 'Create suppliers',
				'suppliers.edit'   => 'Edit suppliers',
				'suppliers.delete' => 'Delete suppliers',
			),
			'payments'   => array(
				'payments.view'    => 'View payments',
				'payments.receive' => 'Receive customer payments',
				'payments.pay'     => 'Pay suppliers',
				'payments.delete'  => 'Void payments',
			),
			'expenses'   => array(
				'expenses.view'   => 'View expenses',
				'expenses.create' => 'Create expenses',
				'expenses.edit'   => 'Edit expenses',
				'expenses.delete' => 'Void expenses',
			),
			'income'     => array(
				'income.view'   => 'View income',
				'income.create' => 'Create income',
				'income.edit'   => 'Edit income',
				'income.delete' => 'Void income',
			),
			'accounting' => array(
				'accounting.view'   => 'View accounts & ledgers',
				'accounting.manage' => 'Manage chart of accounts & journals',
			),
			'reports'    => array(
				'reports.view'   => 'View reports',
				'reports.profit' => 'View profit & cost figures',
				'data.export'    => 'Export data',
				'data.import'    => 'Import data',
			),
			'admin'      => array(
				'users.manage'    => 'Manage users & permissions',
				'branches.manage' => 'Manage branches',
				'settings.manage' => 'Manage settings',
				'business.manage' => 'Manage business profile (owner)',
				'audit.view'      => 'View audit log',
				'backup.manage'   => 'Backup & restore',
			),
		);

		$this->groups = (array) $this->events->filter( 'bizledger/permissions', $groups );
		return $this->groups;
	}

	/**
	 * Flat list of every permission.
	 *
	 * @return array<int,string>
	 */
	public function all(): array {
		$all = array();
		foreach ( $this->groups() as $perms ) {
			$all = array_merge( $all, array_keys( $perms ) );
		}
		return $all;
	}

	public function exists( string $permission ): bool {
		return in_array( $permission, $this->all(), true );
	}

	/**
	 * Built-in roles.
	 *
	 * @return array<string,array{label:string,permissions:array<int,string>}>
	 */
	public function roles(): array {
		if ( null !== $this->roles ) {
			return $this->roles;
		}

		$all     = $this->all();
		$without = static fn( array $exclude ) => array_values( array_diff( $all, $exclude ) );
		$prefix  = static fn( string ...$prefixes ) => array_values(
			array_filter(
				$all,
				static function ( string $p ) use ( $prefixes ): bool {
					foreach ( $prefixes as $pre ) {
						if ( str_starts_with( $p, $pre ) ) {
							return true;
						}
					}
					return false;
				}
			)
		);

		$roles = array(
			'owner'      => array(
				'label'       => 'Owner',
				'permissions' => $all,
			),
			'manager'    => array(
				'label'       => 'Admin / Manager',
				'permissions' => $without( array( 'business.manage', 'backup.manage' ) ),
			),
			'accountant' => array(
				'label'       => 'Accountant',
				'permissions' => array_merge(
					array( 'dashboard.view', 'sales.view', 'purchases.view', 'products.view', 'products.cost', 'inventory.view', 'customers.view', 'suppliers.view', 'invoices.print' ),
					$prefix( 'payments.', 'expenses.', 'income.', 'accounting.', 'reports.' ),
					array( 'data.export' )
				),
			),
			'sales'      => array(
				'label'       => 'Sales Staff',
				'permissions' => array( 'dashboard.view', 'sales.view', 'sales.create', 'sales.discount', 'pos.use', 'invoices.print', 'products.view', 'inventory.view', 'customers.view', 'customers.create', 'customers.edit', 'payments.view', 'payments.receive' ),
			),
			'purchase'   => array(
				'label'       => 'Purchase Manager',
				'permissions' => array_merge(
					array( 'dashboard.view', 'invoices.print', 'payments.view', 'payments.pay' ),
					$prefix( 'purchases.', 'suppliers.', 'products.', 'inventory.' )
				),
			),
			'staff'      => array(
				'label'       => 'Staff',
				'permissions' => array( 'dashboard.view' ),
			),
		);

		$this->roles = (array) $this->events->filter( 'bizledger/roles', $roles );
		return $this->roles;
	}

	/**
	 * Effective permission set for a member.
	 *
	 * @param array<int,string> $grants Extra permissions.
	 * @param array<int,string> $denies Removed permissions.
	 * @return array<int,string>
	 */
	public function resolve( string $role, array $grants = array(), array $denies = array() ): array {
		$roles = $this->roles();
		if ( 'owner' === $role ) {
			return $this->all();
		}
		$base  = $roles[ $role ]['permissions'] ?? array();
		$valid = $this->all();
		$set   = array_unique( array_merge( $base, array_intersect( $grants, $valid ) ) );
		$set   = array_diff( $set, $denies );
		// Owner-only permission can never be granted to non-owners.
		$set = array_diff( $set, array( 'business.manage' ) );
		return array_values( $set );
	}
}
