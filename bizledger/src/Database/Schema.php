<?php
/**
 * Table definitions.
 *
 * @package BizLedger
 */

declare(strict_types=1);

namespace BizLedger\Database;

/**
 * Single source of truth for the database schema.
 *
 * Tables are described with a small portable type vocabulary and rendered
 * either as dbDelta-compatible MySQL DDL or as SQLite DDL (tests). Bump
 * VERSION whenever a definition changes; the Migrator re-runs dbDelta and
 * any versioned data migrations.
 *
 * Column type shorthands:
 *   id        BIGINT UNSIGNED AUTO_INCREMENT primary key
 *   fk        BIGINT UNSIGNED NOT NULL DEFAULT 0
 *   fk_null   BIGINT UNSIGNED NULL
 *   str:N     VARCHAR(N) NOT NULL DEFAULT ''
 *   str_null:N VARCHAR(N) NULL
 *   text      TEXT NULL
 *   json      LONGTEXT NULL (JSON document)
 *   money     DECIMAL(20,4) NOT NULL DEFAULT 0
 *   qty       DECIMAL(18,4) NOT NULL DEFAULT 0
 *   rate      DECIMAL(12,6) NOT NULL DEFAULT 0
 *   int       INT NOT NULL DEFAULT 0
 *   bool      TINYINT(1) NOT NULL DEFAULT 0
 *   bool_true TINYINT(1) NOT NULL DEFAULT 1
 *   date      DATE NOT NULL
 *   date_null DATE NULL
 *   datetime  DATETIME NOT NULL
 *   datetime_null DATETIME NULL
 *   uuid      CHAR(36) NULL
 */
final class Schema {

	public const VERSION = '1.0.0';

	/**
	 * Common audit columns appended to document tables.
	 *
	 * @return array<string,string>
	 */
	private static function stamps(): array {
		return array(
			'created_by' => 'fk',
			'updated_by' => 'fk',
			'created_at' => 'datetime',
			'updated_at' => 'datetime',
		);
	}

	/**
	 * Soft-delete columns.
	 *
	 * @return array<string,string>
	 */
	private static function soft(): array {
		return array(
			'deleted_at' => 'datetime_null',
			'deleted_by' => 'fk',
		);
	}

	/**
	 * All tables: name => [columns, indexes].
	 *
	 * Index keys: "unique:<name>" for unique, otherwise a plain index.
	 *
	 * @return array<string,array{columns:array<string,string>,indexes:array<string,array<int,string>>}>
	 */
	public static function tables(): array {
		return array(

			/* ---------------------------------------------------------- Tenancy */

			'businesses'          => array(
				'columns' => array_merge(
					array(
						'id'                => 'id',
						'uuid'              => 'uuid',
						'name'              => 'str:191',
						'legal_name'        => 'str:191',
						'business_type'     => 'str:40',
						'logo_id'           => 'fk',
						'address'           => 'text',
						'phone'             => 'str:40',
						'email'             => 'str:100',
						'website'           => 'str:191',
						'tax_number'        => 'str:60',
						'currency_code'     => 'str:3',
						'currency_symbol'   => 'str:10',
						'currency_position' => 'str:12',
						'decimals'          => 'int',
						'timezone'          => 'str:64',
						'fiscal_year_start' => 'str:5',
						'owner_id'          => 'fk',
						'plan'              => 'str:40',
						'status'            => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'unique:uuid' => array( 'uuid' ),
					'owner'       => array( 'owner_id' ),
					'status'      => array( 'status' ),
				),
			),

			'branches'            => array(
				'columns' => array_merge(
					array(
						'id'          => 'id',
						'business_id' => 'fk',
						'name'        => 'str:191',
						'code'        => 'str:20',
						'address'     => 'text',
						'phone'       => 'str:40',
						'email'       => 'str:100',
						'is_default'  => 'bool',
						'status'      => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'business' => array( 'business_id', 'status' ),
				),
			),

			'business_users'      => array(
				'columns' => array_merge(
					array(
						'id'                => 'id',
						'business_id'       => 'fk',
						'user_id'           => 'fk',
						'role'              => 'str:40',
						'grants'            => 'json',
						'denies'            => 'json',
						'branch_ids'        => 'json',
						'default_branch_id' => 'fk',
						'status'            => 'str:20',
						'last_seen_at'      => 'datetime_null',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:member' => array( 'business_id', 'user_id' ),
					'user'          => array( 'user_id', 'status' ),
				),
			),

			'settings'            => array(
				'columns' => array(
					'id'            => 'id',
					'business_id'   => 'fk',
					'setting_key'   => 'str:100',
					'setting_value' => 'json',
					'updated_by'    => 'fk',
					'updated_at'    => 'datetime',
				),
				'indexes' => array(
					'unique:key' => array( 'business_id', 'setting_key' ),
				),
			),

			'sequences'           => array(
				'columns' => array(
					'id'          => 'id',
					'business_id' => 'fk',
					'branch_id'   => 'fk',
					'doc_type'    => 'str:30',
					'period'      => 'str:10',
					'next_number' => 'int',
				),
				'indexes' => array(
					'unique:seq' => array( 'business_id', 'branch_id', 'doc_type', 'period' ),
				),
			),

			/* ---------------------------------------------------------- Catalogue */

			'categories'          => array(
				'columns' => array_merge(
					array(
						'id'          => 'id',
						'business_id' => 'fk',
						'parent_id'   => 'fk',
						'name'        => 'str:191',
						'status'      => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array( 'business' => array( 'business_id', 'parent_id' ) ),
			),

			'brands'              => array(
				'columns' => array_merge(
					array(
						'id'          => 'id',
						'business_id' => 'fk',
						'name'        => 'str:191',
						'status'      => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array( 'business' => array( 'business_id' ) ),
			),

			'units'               => array(
				'columns' => array_merge(
					array(
						'id'            => 'id',
						'business_id'   => 'fk',
						'name'          => 'str:60',
						'short_name'    => 'str:20',
						'allow_decimal' => 'bool',
						'status'        => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array( 'business' => array( 'business_id' ) ),
			),

			'tax_rates'           => array(
				'columns' => array_merge(
					array(
						'id'          => 'id',
						'business_id' => 'fk',
						'name'        => 'str:100',
						'rate'        => 'rate',
						'is_inclusive' => 'bool',
						'is_default'  => 'bool',
						'status'      => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array( 'business' => array( 'business_id', 'status' ) ),
			),

			'products'            => array(
				'columns' => array_merge(
					array(
						'id'                => 'id',
						'business_id'       => 'fk',
						'type'              => 'str:20',
						'name'              => 'str:191',
						'sku'               => 'str:80',
						'barcode'           => 'str:80',
						'category_id'       => 'fk',
						'brand_id'          => 'fk',
						'unit_id'           => 'fk',
						'supplier_id'       => 'fk',
						'tax_rate_id'       => 'fk',
						'purchase_price'    => 'money',
						'selling_price'     => 'money',
						'wholesale_price'   => 'money',
						'min_selling_price' => 'money',
						'min_stock'         => 'qty',
						'track_stock'       => 'bool_true',
						'track_batch'       => 'bool',
						'track_expiry'      => 'bool',
						'track_serial'      => 'bool',
						'has_variants'      => 'bool',
						'image_id'          => 'fk',
						'description'       => 'text',
						'attributes'        => 'json',
						'status'            => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'business_name' => array( 'business_id', 'status', 'name' ),
					'sku'           => array( 'business_id', 'sku' ),
					'barcode'       => array( 'business_id', 'barcode' ),
					'category'      => array( 'business_id', 'category_id' ),
				),
			),

			'product_variants'    => array(
				'columns' => array_merge(
					array(
						'id'             => 'id',
						'business_id'    => 'fk',
						'product_id'     => 'fk',
						'name'           => 'str:191',
						'sku'            => 'str:80',
						'barcode'        => 'str:80',
						'attributes'     => 'json',
						'purchase_price' => 'money',
						'selling_price'  => 'money',
						'status'         => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'product' => array( 'business_id', 'product_id' ),
					'barcode' => array( 'business_id', 'barcode' ),
				),
			),

			/* ---------------------------------------------------------- Inventory */

			'stock_levels'        => array(
				'columns' => array(
					'id'          => 'id',
					'business_id' => 'fk',
					'branch_id'   => 'fk',
					'product_id'  => 'fk',
					'variant_id'  => 'fk',
					'qty'         => 'qty',
					'value'       => 'money',
					'avg_cost'    => 'money',
					'updated_at'  => 'datetime',
				),
				'indexes' => array(
					'unique:level' => array( 'business_id', 'branch_id', 'product_id', 'variant_id' ),
					'product'      => array( 'business_id', 'product_id' ),
				),
			),

			'stock_movements'     => array(
				'columns' => array(
					'id'             => 'id',
					'business_id'    => 'fk',
					'branch_id'      => 'fk',
					'product_id'     => 'fk',
					'variant_id'     => 'fk',
					'movement_type'  => 'str:30',
					'movement_date'  => 'date',
					'qty'            => 'qty',
					'unit_cost'      => 'money',
					'value'          => 'money',
					'qty_before'     => 'qty',
					'qty_after'      => 'qty',
					'reference_type' => 'str:30',
					'reference_id'   => 'fk',
					'reference_no'   => 'str:60',
					'note'           => 'str:255',
					'created_by'     => 'fk',
					'created_at'     => 'datetime',
				),
				'indexes' => array(
					'product_date' => array( 'business_id', 'product_id', 'movement_date' ),
					'branch_date'  => array( 'business_id', 'branch_id', 'movement_date' ),
					'reference'    => array( 'reference_type', 'reference_id' ),
				),
			),

			/* ---------------------------------------------------------- Contacts */

			'contacts'            => array(
				'columns' => array_merge(
					array(
						'id'              => 'id',
						'business_id'     => 'fk',
						'type'            => 'str:20',
						'code'            => 'str:40',
						'name'            => 'str:191',
						'company'         => 'str:191',
						'phone'           => 'str:40',
						'email'           => 'str:100',
						'address'         => 'text',
						'tax_number'      => 'str:60',
						'opening_balance' => 'money',
						'balance'         => 'money',
						'credit_limit'    => 'money',
						'notes'           => 'text',
						'last_activity_at' => 'datetime_null',
						'status'          => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'business_type' => array( 'business_id', 'type', 'status', 'name' ),
					'phone'         => array( 'business_id', 'phone' ),
					'code'          => array( 'business_id', 'code' ),
				),
			),

			/* ---------------------------------------------------------- Sales */

			'sales'               => array(
				'columns' => array_merge(
					array(
						'id'              => 'id',
						'uuid'            => 'uuid',
						'business_id'     => 'fk',
						'branch_id'       => 'fk',
						'number'          => 'str:40',
						'sale_date'       => 'date',
						'due_date'        => 'date_null',
						'customer_id'     => 'fk',
						'status'          => 'str:20',
						'channel'         => 'str:20',
						'price_type'      => 'str:20',
						'subtotal'        => 'money',
						'discount_type'   => 'str:10',
						'discount_value'  => 'money',
						'discount_amount' => 'money',
						'tax_amount'      => 'money',
						'shipping_amount' => 'money',
						'round_off'       => 'money',
						'total'           => 'money',
						'paid_amount'     => 'money',
						'return_amount'   => 'money',
						'due_amount'      => 'money',
						'cost_amount'     => 'money',
						'payment_status'  => 'str:20',
						'currency_code'   => 'str:3',
						'exchange_rate'   => 'rate',
						'notes'           => 'text',
						'meta'            => 'json',
						'voided_at'       => 'datetime_null',
						'voided_by'       => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:uuid'   => array( 'uuid' ),
					'unique:number' => array( 'business_id', 'number' ),
					'date'          => array( 'business_id', 'status', 'sale_date' ),
					'customer'      => array( 'business_id', 'customer_id', 'sale_date' ),
					'branch'        => array( 'business_id', 'branch_id', 'sale_date' ),
					'user'          => array( 'business_id', 'created_by', 'sale_date' ),
					'due'           => array( 'business_id', 'payment_status' ),
				),
			),

			'sale_items'          => array(
				'columns' => array(
					'id'              => 'id',
					'business_id'     => 'fk',
					'sale_id'         => 'fk',
					'product_id'      => 'fk',
					'variant_id'      => 'fk',
					'name'            => 'str:191',
					'sku'             => 'str:80',
					'qty'             => 'qty',
					'unit_price'      => 'money',
					'discount_type'   => 'str:10',
					'discount_value'  => 'money',
					'discount_amount' => 'money',
					'doc_discount'    => 'money',
					'tax_rate'        => 'rate',
					'tax_inclusive'   => 'bool',
					'tax_amount'      => 'money',
					'net_amount'      => 'money',
					'total'           => 'money',
					'unit_cost'       => 'money',
					'cost_amount'     => 'money',
					'returned_qty'    => 'qty',
					'sort_order'      => 'int',
				),
				'indexes' => array(
					'sale'    => array( 'sale_id' ),
					'product' => array( 'business_id', 'product_id' ),
				),
			),

			/* ---------------------------------------------------------- Purchases */

			'purchases'           => array(
				'columns' => array_merge(
					array(
						'id'               => 'id',
						'uuid'             => 'uuid',
						'business_id'      => 'fk',
						'branch_id'        => 'fk',
						'number'           => 'str:40',
						'supplier_invoice' => 'str:80',
						'purchase_date'    => 'date',
						'due_date'         => 'date_null',
						'supplier_id'      => 'fk',
						'status'           => 'str:20',
						'subtotal'         => 'money',
						'discount_type'    => 'str:10',
						'discount_value'   => 'money',
						'discount_amount'  => 'money',
						'tax_amount'       => 'money',
						'shipping_amount'  => 'money',
						'other_cost'       => 'money',
						'total'            => 'money',
						'paid_amount'      => 'money',
						'return_amount'    => 'money',
						'due_amount'       => 'money',
						'payment_status'   => 'str:20',
						'currency_code'    => 'str:3',
						'exchange_rate'    => 'rate',
						'notes'            => 'text',
						'attachment_id'    => 'fk',
						'meta'             => 'json',
						'voided_at'        => 'datetime_null',
						'voided_by'        => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:uuid'   => array( 'uuid' ),
					'unique:number' => array( 'business_id', 'number' ),
					'date'          => array( 'business_id', 'status', 'purchase_date' ),
					'supplier'      => array( 'business_id', 'supplier_id', 'purchase_date' ),
					'branch'        => array( 'business_id', 'branch_id', 'purchase_date' ),
				),
			),

			'purchase_items'      => array(
				'columns' => array(
					'id'              => 'id',
					'business_id'     => 'fk',
					'purchase_id'     => 'fk',
					'product_id'      => 'fk',
					'variant_id'      => 'fk',
					'name'            => 'str:191',
					'sku'             => 'str:80',
					'qty'             => 'qty',
					'unit_price'      => 'money',
					'discount_type'   => 'str:10',
					'discount_value'  => 'money',
					'discount_amount' => 'money',
					'doc_discount'    => 'money',
					'tax_rate'        => 'rate',
					'tax_inclusive'   => 'bool',
					'tax_amount'      => 'money',
					'net_amount'      => 'money',
					'total'           => 'money',
					'landed_cost'     => 'money',
					'unit_cost'       => 'money',
					'returned_qty'    => 'qty',
					'batch_no'        => 'str:60',
					'expiry_date'     => 'date_null',
					'sort_order'      => 'int',
				),
				'indexes' => array(
					'purchase' => array( 'purchase_id' ),
					'product'  => array( 'business_id', 'product_id' ),
				),
			),

			/* ---------------------------------------------------------- Returns */

			'returns'             => array(
				'columns' => array_merge(
					array(
						'id'                => 'id',
						'uuid'              => 'uuid',
						'business_id'       => 'fk',
						'branch_id'         => 'fk',
						'number'            => 'str:40',
						'return_type'       => 'str:20',
						'document_id'       => 'fk',
						'contact_id'        => 'fk',
						'return_date'       => 'date',
						'subtotal'          => 'money',
						'tax_amount'        => 'money',
						'total'             => 'money',
						'cost_amount'       => 'money',
						'refund_amount'     => 'money',
						'refund_account_id' => 'fk',
						'reason'            => 'text',
						'status'            => 'str:20',
						'voided_at'         => 'datetime_null',
						'voided_by'         => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:number' => array( 'business_id', 'number' ),
					'document'      => array( 'business_id', 'return_type', 'document_id' ),
					'date'          => array( 'business_id', 'return_type', 'return_date' ),
					'contact'       => array( 'business_id', 'contact_id' ),
				),
			),

			'return_items'        => array(
				'columns' => array(
					'id'               => 'id',
					'business_id'      => 'fk',
					'return_id'        => 'fk',
					'document_item_id' => 'fk',
					'product_id'       => 'fk',
					'variant_id'       => 'fk',
					'name'             => 'str:191',
					'qty'              => 'qty',
					'unit_price'       => 'money',
					'net_amount'       => 'money',
					'tax_amount'       => 'money',
					'total'            => 'money',
					'unit_cost'        => 'money',
					'cost_amount'      => 'money',
				),
				'indexes' => array(
					'return'  => array( 'return_id' ),
					'product' => array( 'business_id', 'product_id' ),
				),
			),

			/* ---------------------------------------------------------- Money */

			'payments'            => array(
				'columns' => array_merge(
					array(
						'id'          => 'id',
						'uuid'        => 'uuid',
						'business_id' => 'fk',
						'branch_id'   => 'fk',
						'number'      => 'str:40',
						'direction'   => 'str:5',
						'contact_id'  => 'fk',
						'account_id'  => 'fk',
						'amount'      => 'money',
						'payment_date' => 'date',
						'source'      => 'str:20',
						'source_id'   => 'fk',
						'reference'   => 'str:100',
						'note'        => 'text',
						'status'      => 'str:20',
						'voided_at'   => 'datetime_null',
						'voided_by'   => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:uuid'   => array( 'uuid' ),
					'unique:number' => array( 'business_id', 'number' ),
					'contact'       => array( 'business_id', 'contact_id', 'payment_date' ),
					'date'          => array( 'business_id', 'direction', 'payment_date' ),
					'source'        => array( 'business_id', 'source', 'source_id' ),
					'account'       => array( 'business_id', 'account_id', 'payment_date' ),
				),
			),

			'payment_allocations' => array(
				'columns' => array(
					'id'            => 'id',
					'business_id'   => 'fk',
					'payment_id'    => 'fk',
					'document_type' => 'str:20',
					'document_id'   => 'fk',
					'amount'        => 'money',
					'created_at'    => 'datetime',
				),
				'indexes' => array(
					'payment'  => array( 'payment_id' ),
					'document' => array( 'business_id', 'document_type', 'document_id' ),
				),
			),

			'expenses'            => array(
				'columns' => array_merge(
					array(
						'id'                 => 'id',
						'uuid'               => 'uuid',
						'business_id'        => 'fk',
						'branch_id'          => 'fk',
						'number'             => 'str:40',
						'expense_date'       => 'date',
						'account_id'         => 'fk',
						'payment_account_id' => 'fk',
						'contact_id'         => 'fk',
						'amount'             => 'money',
						'reference'          => 'str:100',
						'description'        => 'text',
						'attachment_id'      => 'fk',
						'status'             => 'str:20',
						'voided_at'          => 'datetime_null',
						'voided_by'          => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:uuid'   => array( 'uuid' ),
					'unique:number' => array( 'business_id', 'number' ),
					'date'          => array( 'business_id', 'status', 'expense_date' ),
					'account'       => array( 'business_id', 'account_id', 'expense_date' ),
				),
			),

			'incomes'             => array(
				'columns' => array_merge(
					array(
						'id'                 => 'id',
						'uuid'               => 'uuid',
						'business_id'        => 'fk',
						'branch_id'          => 'fk',
						'number'             => 'str:40',
						'income_date'        => 'date',
						'account_id'         => 'fk',
						'payment_account_id' => 'fk',
						'contact_id'         => 'fk',
						'amount'             => 'money',
						'reference'          => 'str:100',
						'description'        => 'text',
						'attachment_id'      => 'fk',
						'status'             => 'str:20',
						'voided_at'          => 'datetime_null',
						'voided_by'          => 'fk',
					),
					self::stamps()
				),
				'indexes' => array(
					'unique:uuid'   => array( 'uuid' ),
					'unique:number' => array( 'business_id', 'number' ),
					'date'          => array( 'business_id', 'status', 'income_date' ),
					'account'       => array( 'business_id', 'account_id', 'income_date' ),
				),
			),

			/* ---------------------------------------------------------- Ledger */

			'accounts'            => array(
				'columns' => array_merge(
					array(
						'id'           => 'id',
						'business_id'  => 'fk',
						'parent_id'    => 'fk',
						'code'         => 'str:20',
						'name'         => 'str:191',
						'type'         => 'str:20',
						'subtype'      => 'str:30',
						'system_key'   => 'str_null:40',
						'is_payment'   => 'bool',
						'is_system'    => 'bool',
						'is_contra'    => 'bool',
						'details'      => 'json',
						'status'       => 'str:20',
					),
					self::stamps(),
					self::soft()
				),
				'indexes' => array(
					'unique:system' => array( 'business_id', 'system_key' ),
					'type'          => array( 'business_id', 'type', 'status' ),
					'code'          => array( 'business_id', 'code' ),
				),
			),

			'journal_entries'     => array(
				'columns' => array(
					'id'             => 'id',
					'business_id'    => 'fk',
					'branch_id'      => 'fk',
					'entry_date'     => 'date',
					'source'         => 'str:30',
					'source_id'      => 'fk',
					'reference_no'   => 'str:60',
					'memo'           => 'str:255',
					'total'          => 'money',
					'is_reversal'    => 'bool',
					'reverses_id'    => 'fk',
					'is_reversed'    => 'bool',
					'created_by'     => 'fk',
					'created_at'     => 'datetime',
				),
				'indexes' => array(
					'date'   => array( 'business_id', 'entry_date' ),
					'source' => array( 'business_id', 'source', 'source_id' ),
				),
			),

			'journal_lines'       => array(
				'columns' => array(
					'id'          => 'id',
					'business_id' => 'fk',
					'branch_id'   => 'fk',
					'entry_id'    => 'fk',
					'entry_date'  => 'date',
					'account_id'  => 'fk',
					'contact_id'  => 'fk',
					'debit'       => 'money',
					'credit'      => 'money',
					'memo'        => 'str:255',
				),
				'indexes' => array(
					'entry'        => array( 'entry_id' ),
					'account_date' => array( 'business_id', 'account_id', 'entry_date' ),
					'contact'      => array( 'business_id', 'contact_id', 'account_id' ),
					'branch_date'  => array( 'business_id', 'branch_id', 'entry_date' ),
				),
			),

			/* ---------------------------------------------------------- System */

			'audit_logs'          => array(
				'columns' => array(
					'id'          => 'id',
					'business_id' => 'fk',
					'branch_id'   => 'fk',
					'user_id'     => 'fk',
					'action'      => 'str:40',
					'object_type' => 'str:40',
					'object_id'   => 'fk',
					'summary'     => 'str:255',
					'changes'     => 'json',
					'ip_address'  => 'str:45',
					'user_agent'  => 'str:255',
					'created_at'  => 'datetime',
				),
				'indexes' => array(
					'business_date' => array( 'business_id', 'created_at' ),
					'object'        => array( 'business_id', 'object_type', 'object_id' ),
					'user'          => array( 'business_id', 'user_id', 'created_at' ),
				),
			),

			'notifications'       => array(
				'columns' => array(
					'id'          => 'id',
					'business_id' => 'fk',
					'user_id'     => 'fk',
					'type'        => 'str:40',
					'severity'    => 'str:20',
					'title'       => 'str:191',
					'body'        => 'text',
					'data'        => 'json',
					'dedupe_key'  => 'str_null:100',
					'read_at'     => 'datetime_null',
					'created_at'  => 'datetime',
				),
				'indexes' => array(
					'inbox'  => array( 'business_id', 'user_id', 'read_at' ),
					'dedupe' => array( 'business_id', 'dedupe_key' ),
				),
			),
		);
	}

	/**
	 * MySQL DDL for dbDelta (formatting matters: two spaces after PRIMARY KEY).
	 *
	 * @return array<string,string> Table => CREATE statement.
	 */
	public static function mysql( Database $db, string $collate ): array {
		$out = array();
		foreach ( self::tables() as $name => $def ) {
			$table = $db->table( $name );
			$lines = array();
			foreach ( $def['columns'] as $col => $type ) {
				$lines[] = "{$col} " . self::mysqlType( $type );
			}
			$lines[] = 'PRIMARY KEY  (id)';
			foreach ( $def['indexes'] as $key => $cols ) {
				$unique  = str_starts_with( $key, 'unique:' );
				$iname   = $unique ? substr( $key, 7 ) : $key;
				$lines[] = ( $unique ? 'UNIQUE KEY ' : 'KEY ' ) . "{$iname} (" . implode( ',', $cols ) . ')';
			}
			$out[ $name ] = "CREATE TABLE {$table} (\n" . implode( ",\n", $lines ) . "\n) {$collate};";
		}
		return $out;
	}

	/**
	 * SQLite DDL (tests).
	 *
	 * @return array<int,string>
	 */
	public static function sqlite( Database $db ): array {
		$out = array();
		foreach ( self::tables() as $name => $def ) {
			$table = $db->table( $name );
			$lines = array();
			foreach ( $def['columns'] as $col => $type ) {
				$lines[] = "{$col} " . self::sqliteType( $type );
			}
			$out[] = "CREATE TABLE IF NOT EXISTS {$table} (" . implode( ', ', $lines ) . ')';
			foreach ( $def['indexes'] as $key => $cols ) {
				$unique = str_starts_with( $key, 'unique:' );
				$iname  = $table . '_' . ( $unique ? substr( $key, 7 ) : $key );
				$out[]  = 'CREATE ' . ( $unique ? 'UNIQUE ' : '' ) . "INDEX IF NOT EXISTS {$iname} ON {$table} (" . implode( ',', $cols ) . ')';
			}
		}
		return $out;
	}

	private static function mysqlType( string $type ): string {
		list( $base, $len ) = array_pad( explode( ':', $type, 2 ), 2, null );
		switch ( $base ) {
			case 'id':
				return 'bigint(20) unsigned NOT NULL AUTO_INCREMENT';
			case 'fk':
				return 'bigint(20) unsigned NOT NULL DEFAULT 0';
			case 'fk_null':
				return 'bigint(20) unsigned NULL';
			case 'str':
				return 'varchar(' . (int) $len . ") NOT NULL DEFAULT ''";
			case 'str_null':
				return 'varchar(' . (int) $len . ') NULL';
			case 'text':
				return 'text NULL';
			case 'json':
				return 'longtext NULL';
			case 'money':
				return 'decimal(20,4) NOT NULL DEFAULT 0';
			case 'qty':
				return 'decimal(18,4) NOT NULL DEFAULT 0';
			case 'rate':
				return 'decimal(12,6) NOT NULL DEFAULT 0';
			case 'int':
				return 'int(11) NOT NULL DEFAULT 0';
			case 'bool':
				return 'tinyint(1) NOT NULL DEFAULT 0';
			case 'bool_true':
				return 'tinyint(1) NOT NULL DEFAULT 1';
			case 'date':
				return "date NOT NULL DEFAULT '1970-01-01'";
			case 'date_null':
				return 'date NULL';
			case 'datetime':
				return "datetime NOT NULL DEFAULT '1970-01-01 00:00:00'";
			case 'datetime_null':
				return 'datetime NULL';
			case 'uuid':
				return 'char(36) NULL';
		}
		throw new \LogicException( "Unknown column type {$type}" );
	}

	private static function sqliteType( string $type ): string {
		list( $base ) = explode( ':', $type, 2 );
		switch ( $base ) {
			case 'id':
				return 'INTEGER PRIMARY KEY AUTOINCREMENT';
			case 'fk':
			case 'int':
			case 'bool':
				return 'INTEGER NOT NULL DEFAULT 0';
			case 'bool_true':
				return 'INTEGER NOT NULL DEFAULT 1';
			case 'fk_null':
				return 'INTEGER NULL';
			case 'str':
				return "TEXT NOT NULL DEFAULT ''";
			case 'money':
			case 'qty':
			case 'rate':
				return 'NUMERIC NOT NULL DEFAULT 0';
			case 'date':
				return "TEXT NOT NULL DEFAULT '1970-01-01'";
			case 'datetime':
				return "TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'";
			default:
				return 'TEXT NULL';
		}
	}
}
