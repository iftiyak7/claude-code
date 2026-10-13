# BizLedger — Accounting, Inventory, Sales & POS for WordPress

A business management platform delivered as a WordPress plugin: POS, sales,
purchases, inventory, customers, suppliers, dues, double-entry accounting,
invoices, thermal printing and reports — in one connected system, for one
shop or many branches.

> Products → Purchase → Stock → Sales → Customers → Suppliers → Payments →
> Due → Expenses → Accounting → Profit/Loss → Invoice → Reports

## Highlights
* **Accurate by construction.** Every sale, purchase, payment, return,
  expense and stock adjustment posts a balanced double-entry journal entry
  in the same database transaction as the document and the stock movement.
  Integer fixed-point money math; the server recalculates every total.
* **Verified invariants.** Tests assert after every step that the ledger
  balances, inventory account = stock value, customer/supplier balances =
  their sub-ledgers, invoice dues = total − payments − returns, and stock =
  sum of movements — including a randomized test that runs hundreds of mixed
  operations.
* **Multi-business, multi-branch, multi-user.** Six built-in roles,
  53 granular permissions, per-user grant/deny overrides, branch scoping,
  strict tenant isolation.
* **Fast POS.** Barcode (USB/Bluetooth scanners and phone camera), hold/resume,
  split payments, change calculation, due sales, works offline with
  automatic, duplicate-proof sync.
* **Printing.** A4/A5 invoices and 58/80 mm receipts; ESC/POS over Web
  Bluetooth or an Android native bridge; Bangla text printed as raster.
* **Reports.** Dashboard, P&L, balance sheet, trial balance, cash flow, cash
  & bank books, ledgers, sales/purchases by day/month/product/customer/
  staff/branch/category, invoice profit, dues aging, tax, stock valuation,
  slow movers — with CSV export and print/PDF.
* **Modern app.** Full-screen PWA at `/bizledger/`, mobile-first (bottom
  navigation, touch targets, phone tables become cards), dark mode,
  English + বাংলা.
* **Open for extension.** REST API v1, actions/filters on every event,
  registries for roles, permissions, reports, notification channels and
  print transports.

## Requirements
WordPress 6.4+, PHP 8.1+, MySQL 5.7+/MariaDB 10.3+ (InnoDB). Also runs on
the WordPress SQLite integration (e.g. WordPress Playground).

## Install
1. Copy the `bizledger` folder to `wp-content/plugins/` (or upload a zip).
2. Activate **BizLedger**. You are taken to the setup wizard.
3. Open the app any time at `https://your-site/bizledger/` or from the
   *BizLedger* admin menu. Staff log in with their WordPress accounts.

## Development
```bash
php tests/run.php                 # unit + integration tests (SQLite, no WordPress needed)
php tests/run.php Sales           # filter
BZL_SEED=7 php tests/run.php Randomized
BZL_NO_SAVEPOINTS=1 php tests/run.php   # simulate the SQLite-integration driver
BZL_TEST_MYSQL="mysql:host=localhost;dbname=bzl_test;user=u;password=p" php tests/run.php  # real MySQL/MariaDB
```
No build step: the front end is native ES modules in `assets/js`.

## Documentation
* [Architecture](docs/ARCHITECTURE.md)
* [Database](docs/DATABASE.md)
* [Accounting rules](docs/ACCOUNTING.md)
* [REST API](docs/API.md)
* [Security](docs/SECURITY.md)
* [Roadmap](docs/ROADMAP.md)

## License
GPL-2.0-or-later
