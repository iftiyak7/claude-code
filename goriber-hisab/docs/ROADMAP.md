# Development Roadmap

Delivery is module-by-module. Each phase ends with its tests passing and the
accounting invariants (see ACCOUNTING.md §7) green.

Legend: ✅ done · 🟡 partial · ⬜ planned

## Phase 0 — Design ✅
* Requirements analysis, architecture, database schema, accounting rules,
  API contract, security model, folder structure (docs/).

## Phase 1 — Core platform (foundation)
| Module | Status |
|---|---|
| Plugin bootstrap, autoloader, service container | ✅ |
| Database abstraction (wpdb + PDO/SQLite for tests), schema registry, migrator | ✅ |
| Decimal money math, document calculator (line/invoice discount, tax incl./excl.) | ✅ |
| Businesses, branches, memberships, business context, data isolation | ✅ |
| Roles, granular permissions, per-user grant/deny overrides | ✅ |
| Settings (per business, typed defaults) | ✅ |
| Document numbering (prefix/format tokens, per branch) | ✅ |
| Audit log | ✅ |
| Chart of accounts, journal engine, posting service | ✅ |
| Inventory engine (weighted average, movements, adjustments, low-stock) | ✅ |
| Products (+ categories, brands, units, tax rates, variants) | ✅ |
| Customers / suppliers with opening balances and statements | ✅ |
| Sales (complete, hold, update, void) | ✅ |
| Purchases with landed cost | ✅ |
| Payments: POS tenders, split payment, due collection, supplier payment, FIFO allocation | ✅ |
| Sales & purchase returns with refunds | ✅ |
| Expenses & other income | ✅ |
| Reports: dashboard KPIs, P&L, trial balance, balance sheet, ledger, cash/bank book, stock valuation, low stock, dues, sales by product/customer/user/day | ✅ |
| REST API v1 | ✅ |
| SPA shell (sidebar / bottom nav), dashboard, POS, CRUD screens, reports | ✅ |
| Print views A4/A5/80mm/58mm, ESC/POS encoder, Web Bluetooth + native bridge transports | ✅ |
| In-app notifications (low stock, sale/purchase/payment events, daily due & backup reminders) | ✅ |
| Setup wizard (first business) | ✅ |
| Integration tests for accounting synchronisation | ✅ |

## Phase 2 — Operations
* ✅ CSV import (products, customers, suppliers) with dry run, in-file
  duplicate detection and per-row rollback
* 🟡 Export: CSV for every list/report ✅, PDF via print ✅, native XLSX ⬜
* 🟡 Backup ✅ (per-business JSON) · Restore ⬜ (needs id remapping into an
  empty business)
* 🟡 Barcodes: Code 128 generation on invoices, product pages and label
  sheets ✅ · QR codes ⬜
* 🟡 Camera scanning via BarcodeDetector (Chrome/Android) ✅ · ZXing fallback
  for iOS/Firefox ⬜
* ✅ Offline POS: IndexedDB catalogue snapshot, queued sales with UUIDs,
  automatic sync, sync inbox for rejected sales
* ⬜ Stock transfer between branches
* 🟡 Invoice design: colour, font, logo, footer, terms, signature, 3 layout
  presets ✅ · drag-and-drop designer ⬜
* ⬜ Per-user read state for broadcast notifications

## Phase 3 — Depth
* ⬜ Batch / expiry / serial tracking (tables `product_batches`,
  `product_serials`; expiry report)
* ⬜ Multi-price lists & customer groups
* ⬜ Fiscal period locking, year-end closing to retained earnings
* ⬜ Multi-currency documents (exchange rate columns already reserved)
* ⬜ Tax reports per rate and period; tax-inclusive purchase handling options
* ⬜ Email/SMS/WhatsApp notification channels
* 🟡 Dashboard widgets: show/hide per device ✅ · drag-to-reorder ⬜

## Phase 4 — Intelligence & SaaS
* ⬜ Sales trends, slow movers, low-stock prediction, customer patterns,
  business score (read models over existing tables)
* ⬜ Plans/limits/subscriptions, cloud sync, white-label build
* ⬜ Native Android wrapper with Bluetooth printing bridge

## Verified so far
* `php tests/run.php`: 53 tests / ~5,400 assertions (unit, integration,
  security, randomized ledger property test across seeds), on SQLite, with
  savepoints disabled, and on MariaDB 10.11 in strict mode with
  ONLY_FULL_GROUP_BY (`BZL_TEST_MYSQL="mysql:host=…;dbname=…;user=…;password=…"`).
* `tests/e2e/smoke.mjs` run against WordPress 6.5 on both MariaDB 10.11 and
  the SQLite integration: login, setup wizard, POS sale, 26 screens, A4 +
  80 mm print, mobile viewport — all passing. Upgrade from 1.0.0 → 1.0.1
  verified (missing tables are created on the next page load).
* Not yet verified: MySQL 8 specifically, real shared hosting, Web Bluetooth with a
  physical printer, Safari/iOS, very large data volumes.

## Testing plan per phase
* Unit: Decimal, calculator, permissions, numbering.
* Integration (SQLite): each posting rule, then end-to-end scenarios
  (purchase → sale → partial pay → collect → return → void) asserting all
  invariants after every step.
* Security: permission matrix tests per endpoint, cross-business access tests.
* Manual: responsive (360px, 768px, 1280px), printers (58/80 mm), browsers
  (Chrome, Firefox, Safari, Chrome Android).
* Load: seed script for 100k sales; report queries must use indexes
  (`EXPLAIN` check) and stay paginated.
