# BizLedger — System Architecture

BizLedger is a business management platform delivered as a WordPress plugin:
sales, POS, purchases, inventory, customers, suppliers, dues, double-entry
accounting, invoicing and reporting in one connected system.

This document is the blueprint. Database details live in
[DATABASE.md](DATABASE.md), accounting rules in [ACCOUNTING.md](ACCOUNTING.md),
the HTTP contract in [API.md](API.md), security in [SECURITY.md](SECURITY.md)
and the delivery plan in [ROADMAP.md](ROADMAP.md).

---

## 1. Guiding principles

| Principle | What it means in practice |
|---|---|
| **Accuracy** | Every financial event produces a balanced journal entry in the same DB transaction as the business record and the stock movement. The server recalculates every total; client numbers are only previews. |
| **Security** | Every request resolves a *business context* and a *permission*; every query is business-scoped and prepared. |
| **Speed** | Custom indexed tables, cached balances, paginated lists, a no-build ES-module frontend that loads only what the current screen needs. |
| **Simplicity** | New Sale → Customer → Product → Qty → Pay → Save → Print. Defaults everywhere (walk-in customer, default cash account, default tax). |
| **Scalability** | Multi-business and multi-branch from day one; tenant id on every row; service layer independent of WordPress so it can move to a SaaS backend. |
| **Extensibility** | Every service fires actions/filters (`bizledger/...`); roles, permissions, posting rules, report types, notification channels and print transports are registries. |

## 2. High-level architecture

```
┌──────────────────────────── Clients ────────────────────────────┐
│  Web app (SPA, PWA)   Android WebView/native   External POS/API │
└───────────────┬─────────────────────┬───────────────────────────┘
                │ cookie + X-WP-Nonce │ Application Password / token
┌───────────────▼─────────────────────▼───────────────────────────┐
│  HTTP layer   src/Http   REST controllers  /wp-json/bizledger/v1│
│               rate limiter · request validation · error mapping │
├─────────────────────────────────────────────────────────────────┤
│  Context      src/Tenancy   BusinessContext (business, branch,  │
│               user, permission set)  ← resolved once per request│
├─────────────────────────────────────────────────────────────────┤
│  Domain services (no WordPress calls, unit-testable)            │
│  Sales · Purchases · Returns · Payments · Expenses · Income ·    │
│  Inventory · Products · Contacts · Accounting(Journal/Posting) ·│
│  Reports · Numbering · Audit · Notifications · Settings         │
├─────────────────────────────────────────────────────────────────┤
│  Persistence  src/Database   Database interface                 │
│               WpdbDatabase (production) · PdoDatabase (tests/CLI)│
│               Schema registry → dbDelta / SQLite DDL            │
└─────────────────────────────────────────────────────────────────┘
```

* **Domain services never call WordPress functions directly.** WordPress
  concerns (current user, hooks, time, options) are injected through small
  adapters (`Clock`, `EventDispatcher`, `Database`). That makes the core
  testable on SQLite and portable to a future SaaS backend.
* **REST is the only write path for the UI.** The SPA, the future mobile apps
  and third-party integrations use the same versioned API.

## 3. Module map and dependencies

```
                    ┌──────────┐
                    │ Settings │◄──────────────── everything reads settings
                    └────┬─────┘
 ┌────────┐   ┌──────────▼──────────┐   ┌───────────┐
 │Tenancy │──►│ Accounting (Journal,│◄──│ Numbering │
 │Perms   │   │ Chart of Accounts)  │   └───────────┘
 └───┬────┘   └──────────▲──────────┘
     │         ┌─────────┴─────────┬───────────────┬───────────────┐
     │   ┌─────┴─────┐      ┌──────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
     │   │ Inventory │◄─────│   Sales    │   │ Payments  │   │ Expenses/ │
     │   │ (stock,   │◄──┐  │ Purchases  │──►│ (dues,    │   │ Income    │
     │   │ avg cost) │   └──│ Returns    │   │ allocation│   └───────────┘
     │   └─────▲─────┘      └──────▲─────┘   └─────▲─────┘
     │         │                   │               │
     │   ┌─────┴─────┐      ┌──────┴─────┐         │
     │   │ Products  │      │ Contacts   │─────────┘
     │   └───────────┘      └────────────┘
     ▼
  Audit log · Notifications · Reports (read-only over all of the above)
```

Rules:
1. Arrows point to dependencies. No cycles.
2. Only **Accounting/PostingService** writes `journal_*` tables.
3. Only **Inventory/StockService** writes `stock_levels`/`stock_movements`.
4. Only **Payments/PaymentService** writes `payments`/`payment_allocations`
   and moves document `paid/due` amounts.
5. Reports never write.

## 4. Request lifecycle (write)

1. `rest_api_init` → controller route → `permission_callback` checks the WP
   user is logged in and a member of the requested business
   (`X-BizLedger-Business` header or `business_id` param).
2. `BusinessContext` is built: business, branch (header `X-BizLedger-Branch`
   or member default), role, effective permission set.
3. Controller asserts the specific permission (e.g. `sales.create`).
4. Controller sanitizes input into a plain array → domain service.
5. Service validates (throws `ValidationException` with field errors),
   opens a DB transaction, writes document → stock → journal → payments →
   audit log, commits, then dispatches `bizledger/<module>/<event>`.
6. Exceptions map to HTTP: validation 422, permission 403, not found 404,
   conflict 409, everything else 500 (details logged, never leaked).

## 5. Multi-tenancy model

* `businesses` ← `business_users` (membership: WP user ↔ business, role,
  permission overrides, branch scope) → `branches`.
* A WordPress user can belong to several businesses with different roles.
* **Every business-owned row carries `business_id`**; most also carry
  `branch_id`. Repositories always add `business_id = %d` from the context,
  never from client input. Cross-business ids in payloads (customer, product,
  account) are re-validated against the current business.
* Consolidated reports aggregate across branches the user can see.

## 6. Roles and permissions

Permissions are fine-grained strings (`sales.create`, `reports.profit`, …).
Roles are named bundles of permissions. Effective permissions:

```
effective = (role.permissions ∪ member.grants) − member.denies
owner     = all permissions (cannot be reduced)
```

Built-in roles: `owner`, `manager`, `accountant`, `sales`, `purchase`,
`staff`. Both lists are filterable (`bizledger/permissions`,
`bizledger/roles`) so add-ons can register more. WordPress-level gate: a
single capability `bizledger_access` plus membership; WP administrators can
create the first business.

## 7. Accounting engine (summary)

Double-entry, accrual based, with a per-business chart of accounts seeded on
business creation. Posting rules translate each business event into journal
lines. See [ACCOUNTING.md](ACCOUNTING.md). Key invariants verified by tests:

* Σ debit = Σ credit for every entry and for the whole ledger.
* Inventory account balance = Σ `stock_levels.value`.
* Receivable account balance = Σ customer balances; payable likewise.
* Sale `due_amount` = total − allocated payments − returns credited.

Posted transactions are never destructively edited: an update reverses the
previous effects and re-applies new ones inside one transaction; a delete is
a *void* (soft delete + reversal entries), preserving the audit trail.

## 8. Inventory engine (summary)

Perpetual inventory, weighted-average cost per branch. `stock_levels` keeps
`qty`, `value` and `avg_cost`; each change appends a `stock_movements` row
with before/after quantities, unit cost, value, user and reference. Purchase
landed costs (shipping, other costs, discount) are allocated into item cost.
Negative stock is blocked unless the business enables it.

## 9. Money and quantities

* DB: `DECIMAL(20,4)` for money, `DECIMAL(18,4)` for quantity.
* PHP: integers scaled by 10⁴ (`Support\Decimal`), so no floating point in any
  calculation and no dependency on bcmath. Multiplication splits operands to
  stay inside 64-bit range.
* Rounding: line amounts rounded to the business currency precision (half
  up); document discounts are allocated across lines with the
  largest-remainder method so totals always reconcile exactly.

## 10. Frontend

* A full-screen single-page app served on its own URL (`/bizledger/`,
  slug configurable) and inside wp-admin. It is PWA-installable, with a
  service worker scoped to the app path.
* **No build step**: native ES modules, a tiny `h()` view helper, hash
  router, and one module per screen loaded on demand. That keeps the plugin
  installable from a zip and the app fast on low-end phones.
* Desktop: sidebar. Mobile: bottom navigation + "more" drawer; touch
  targets ≥ 44px.
* Offline: catalogue and customers cached in IndexedDB; POS sales queued
  with client UUIDs and replayed idempotently when online (server dedupes by
  `uuid`). Conflicts (e.g. stock insufficient at sync time) surface in a sync
  inbox; nothing is silently dropped.

## 11. Printing

* Server-rendered print views (A4, A5, 80 mm, 58 mm) for browser print.
* Thermal: a JS ESC/POS encoder with pluggable transports:
  `WebBluetoothTransport` (Chrome/Android), `NativeBridgeTransport`
  (`window.BizLedgerNative.print(base64)` for an Android WebView wrapper),
  and browser print fallback. Adding a native Android app only requires
  implementing the bridge.

## 12. Extensibility points

| Kind | Examples |
|---|---|
| Actions | `bizledger/sale/completed`, `bizledger/sale/voided`, `bizledger/purchase/completed`, `bizledger/payment/recorded`, `bizledger/stock/changed`, `bizledger/business/created` |
| Filters | `bizledger/permissions`, `bizledger/roles`, `bizledger/default_accounts`, `bizledger/sale/totals`, `bizledger/notification_channels`, `bizledger/rest_controllers` |
| Registries | posting rules, report types, notification channels, print transports (JS) |

## 13. Plugin folder structure

```
bizledger/
├── bizledger.php            bootstrap header, constants, autoloader
├── uninstall.php            opt-in data removal
├── src/
│   ├── Plugin.php           composition root (service container wiring)
│   ├── Container.php
│   ├── Core/                Installer, Migrator, Activator, Cron
│   ├── Database/            Database interface, Wpdb + PDO drivers, Schema
│   ├── Support/             Decimal, Clock, Events, exceptions, helpers
│   ├── Tenancy/             Businesses, Branches, Members, Context
│   ├── Security/            Permissions, Roles, RateLimiter
│   ├── Accounting/          Accounts, Journal, Posting rules
│   ├── Inventory/           StockService, adjustments
│   ├── Catalog/             Products, variants, categories, brands, units, tax
│   ├── Contacts/            Customers & suppliers
│   ├── Sales/               Sales, document calculator
│   ├── Purchases/           Purchases
│   ├── Returns/             Sales & purchase returns
│   ├── Payments/            Collections, supplier payments, allocations
│   ├── Finance/             Expenses, incomes
│   ├── Reports/             Dashboard, P&L, TB, BS, stock, dues …
│   ├── Audit/               Audit logger
│   ├── Notifications/       In-app + channel interface
│   ├── Settings/            Per-business settings with typed defaults
│   ├── Numbering/           Document number sequences
│   ├── Http/                REST controllers (v1), request helpers
│   └── Admin/               Menu, app shell route, print views, assets
├── assets/                  SPA (ES modules), CSS, service worker
├── templates/               PHP print templates
├── languages/               .pot / bn_BD translations
├── tests/                   unit + integration tests (SQLite)
└── docs/
```

## 14. Localization

All strings go through `__()` / `esc_html__()` with text domain `bizledger`
(PHP) and `wp.i18n` style JSON for JS. English and Bangla first. Currency
symbol/position, decimal precision, thousands/decimal separators, date
format and timezone are per-business settings.

## 15. SaaS readiness

* Tenant id everywhere, no global singletons in domain code.
* `businesses.plan` + a `Limits` service hook (`bizledger/limits`) so usage
  limits/subscriptions can be enforced later without touching modules.
* UUIDs on syncable documents for future cloud sync.
* API versioned (`bizledger/v1`); breaking changes go to `v2`.
