# Database Schema

The schema is defined once in `src/Database/Schema.php` and rendered to
dbDelta DDL (MySQL/MariaDB, InnoDB, site charset) or SQLite (tests). All
tables use the prefix `{wp_prefix}bzl_`. Bump `Schema::VERSION` on any change;
`Installer::maybeMigrate()` re-runs dbDelta and versioned data migrations.

## Conventions

| Convention | Rule |
|---|---|
| Keys | `id BIGINT UNSIGNED AUTO_INCREMENT`; foreign keys are `BIGINT UNSIGNED NOT NULL DEFAULT 0` (0 = none) |
| Tenancy | every business-owned table has `business_id`; most also `branch_id`. Every index on such a table **starts with `business_id`** so per-tenant queries are index range scans. |
| Money | `DECIMAL(20,4)`; quantities `DECIMAL(18,4)`; rates `DECIMAL(12,6)` |
| Dates | business-local `DATE` for document dates; UTC `DATETIME` for `created_at/updated_at` |
| Soft delete | master data: `deleted_at`, `deleted_by`. Financial documents are never deleted: `status = 'void'` + `voided_at/by` + reversal entries |
| Idempotency | `uuid CHAR(36)` unique on syncable documents (sales, purchases, payments, returns, expenses, incomes) |
| Referential integrity | enforced by services inside transactions (dbDelta cannot manage FK constraints reliably across hosts); cross-tenant references are re-validated on every write |

## Tables

### Tenancy & system
| Table | Purpose | Key indexes |
|---|---|---|
| `businesses` | tenant profile, currency, decimals, timezone, fiscal year, plan | uuid (unique), owner_id |
| `branches` | outlets/warehouses per business; one `is_default` | (business_id, status) |
| `business_users` | membership: role, `grants`/`denies` JSON, `branch_ids` JSON, default branch | (business_id, user_id) unique |
| `settings` | typed per-business key/value (JSON) | (business_id, setting_key) unique |
| `sequences` | document number counters per business/branch/type/period | unique (business_id, branch_id, doc_type, period) |
| `audit_logs` | append-only who/what/when/diff/IP | (business_id, created_at), (business_id, object_type, object_id) |
| `notifications` | in-app inbox, `dedupe_key` | (business_id, user_id, read_at) |

### Catalogue & stock
| Table | Purpose |
|---|---|
| `categories`, `brands`, `units` | lookups (`units.allow_decimal`) |
| `tax_rates` | name, rate, inclusive flag, default |
| `products` | type (standard/service), codes, 4 price levels, min stock, tracking flags, JSON attributes |
| `product_variants` | size/colour/weight attributes, own SKU/barcode/prices |
| `stock_levels` | **one row per business+branch+product+variant**: qty, value, avg_cost (unique) |
| `stock_movements` | every change: type, qty ±, unit cost, value ±, qty before/after, reference, user |

### Parties
| Table | Purpose |
|---|---|
| `contacts` | customers and suppliers (`type`), opening balance, cached `balance`, credit limit |

### Documents
| Table | Purpose |
|---|---|
| `sales` / `sale_items` | header totals (subtotal, discount, tax, shipping, total, paid, returned, due, cost) and lines with per-line allocated discount, tax, net, unit cost and returned qty |
| `purchases` / `purchase_items` | as above plus shipping/other costs and per-line `landed_cost` / `unit_cost`, batch/expiry (reserved) |
| `returns` / `return_items` | sale or purchase returns against a document item, value, cost, refund |
| `payments` | every money movement with a party: direction, account, amount, source |
| `payment_allocations` | payment → document links (FIFO or explicit) |
| `expenses`, `incomes` | category account, payment account, amount, receipt attachment |

> The prompt suggested separate `invoices` / `invoice_items` tables. A sale
> *is* the invoice (its number is the invoice number), so a second copy
> would only create a synchronisation risk. Invoice presentation (templates,
> paper sizes, branding) lives in settings and the print template.

### Ledger
| Table | Purpose |
|---|---|
| `accounts` | chart of accounts; `system_key` for accounts code depends on; `is_payment` for cash/bank/mobile |
| `journal_entries` | header: date, source/source_id, reference, total, reversal links |
| `journal_lines` | debit/credit per account (+ `contact_id` for AR/AP sub-ledgers), denormalised `entry_date`/`branch_id` for fast reports |

## Relationships (logical)

```
businesses 1─* branches
businesses 1─* business_users *─1 wp_users
products 1─* product_variants
products 1─* stock_levels / stock_movements
contacts(customer) 1─* sales 1─* sale_items ─1 products
contacts(supplier) 1─* purchases 1─* purchase_items ─1 products
sales/purchases 1─* returns 1─* return_items ─1 sale_items/purchase_items
payments 1─* payment_allocations *─1 sales/purchases
journal_entries 1─* journal_lines *─1 accounts
any document 1─* journal_entries (source, source_id)
```

## Planned (Phase 3)
`product_batches` (batch, expiry, qty per branch), `product_serials`,
`price_lists`, `stock_transfers`, `period_closings`.

## Scaling notes
* All lists are paginated (max 200–500 per page); exports page through.
* Report queries aggregate on `(business_id, …date)` indexes; journal lines
  carry `entry_date` and `branch_id` to avoid joins.
* Backups use keyset pagination (`id > last`) to keep memory flat.
* For very large tenants a nightly `account_balances` snapshot table can be
  added without changing the posting API.
