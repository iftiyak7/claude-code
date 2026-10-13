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
| In-app notifications (low stock, sale/purchase/payment events) | ✅ |
| Setup wizard (first business) | ✅ |
| Integration tests for accounting synchronisation | ✅ |

## Phase 2 — Operations
* ⬜ CSV/Excel import (products, customers, suppliers) with dry-run preview
* 🟡 CSV export of lists and reports (CSV done; XLSX/PDF pending)
* ⬜ Backup & restore (chunked JSON export per business, scheduled via
  Action Scheduler/WP-Cron, restore into empty business)
* ⬜ Barcode label printing, QR code generation
* 🟡 Camera barcode scanning (BarcodeDetector API done; ZXing fallback pending)
* ⬜ Offline POS queue + sync inbox (UUID idempotency already on the server)
* ⬜ Stock transfer between branches
* ⬜ Invoice template designer (colors, fonts, layout presets beyond the
  current settings)

## Phase 3 — Depth
* ⬜ Batch / expiry / serial tracking (tables `product_batches`,
  `product_serials`; expiry report)
* ⬜ Multi-price lists & customer groups
* ⬜ Fiscal period locking, year-end closing to retained earnings
* ⬜ Multi-currency documents (exchange rate columns already reserved)
* ⬜ Tax reports per rate and period; tax-inclusive purchase handling options
* ⬜ Email/SMS/WhatsApp notification channels
* ⬜ Draggable dashboard widgets (visibility toggles done in Phase 1)

## Phase 4 — Intelligence & SaaS
* ⬜ Sales trends, slow movers, low-stock prediction, customer patterns,
  business score (read models over existing tables)
* ⬜ Plans/limits/subscriptions, cloud sync, white-label build
* ⬜ Native Android wrapper with Bluetooth printing bridge

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
