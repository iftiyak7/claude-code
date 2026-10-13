# REST API (v1)

Base: `https://example.com/wp-json/bizledger/v1/`

## Authentication
* **Web app:** WordPress login cookie + `X-WP-Nonce: <wp_rest nonce>`.
* **Mobile apps / POS terminals / integrations:** WordPress
  [Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
  (HTTP Basic over HTTPS), or any WP REST auth plugin (JWT/OAuth).

## Tenant headers
| Header | Meaning |
|---|---|
| `X-BizLedger-Business: 12` | business to act on (default: the user's first) |
| `X-BizLedger-Branch: 3` | branch for stock/cash/document scope (default: member default branch) |

Non-members get `403`. Ids of other businesses inside payloads are rejected
with `422`.

## Conventions
* Money and quantities are **decimal strings** (`"1250.5000"`); send strings
  too. The server recalculates every total.
* Dates `YYYY-MM-DD` (business local); timestamps are UTC.
* Lists: `?page=1&per_page=25&search=…` →
  `{ items, total, page, per_page, pages, summary? }`.
* Writes accept an optional `uuid` (v4). Re-sending the same UUID returns the
  existing record — safe for retries and offline sync.
* Errors:
  ```json
  { "code": "bizledger_validation", "message": "Select a customer for a sale with due amount.",
    "data": { "status": 422, "errors": { "customer_id": "Select a customer for a sale with due amount." } } }
  ```
  `400` bad request · `403` permission · `404` not found · `409` conflict
  (e.g. voiding a sale with returns) · `422` validation · `429` rate limit.

## Endpoints

### Session & setup
| Method | Path | Notes |
|---|---|---|
| GET | `/me` | user, businesses, context (business, branch, role, permissions), settings, payment accounts, tax rates, units, categories |
| POST | `/setup` | create a business: profile, `settings{}`, `tax{name,rate,is_inclusive}`, `demo` |
| GET/PUT | `/business` | profile (PUT needs `business.manage`) |
| GET/POST, PUT/DELETE | `/branches`, `/branches/{id}` | |
| GET/POST, PUT/DELETE | `/members`, `/members/{id}` | `{email,name,role,grants[],denies[],branch_ids[],status}` |
| GET | `/roles` | roles + grouped permission catalogue |
| GET/PUT | `/settings` | PUT `{ "settings": { "tax.enabled": true } }` |
| GET | `/audit` | `object_type, object_id, user_id, action, from, to` |
| GET | `/notifications`, POST `/notifications/read` | `{ids:[]}` (empty = all) |
| GET | `/search?q=` | invoices, purchases, products, customers, suppliers |

### Catalogue
| Method | Path |
|---|---|
| GET/POST | `/products` (`search, category_id, brand_id, status, type, orderby`) |
| GET | `/products/lookup?code=` (barcode/SKU, products and variants) |
| GET/PUT/DELETE | `/products/{id}` |
| POST, PUT/DELETE | `/products/{id}/variants`, `/products/{id}/variants/{vid}` |
| GET/POST, PUT/DELETE | `/taxonomies/{categories|brands|units}`, `/…/{id}` |
| GET/POST, PUT/DELETE | `/tax-rates`, `/tax-rates/{id}` |

Product create accepts `opening_qty`, `opening_cost`, `auto_barcode`.

### Contacts
`/customers` and `/suppliers` share: GET/POST list/create (`quick=1` reuses a
match by phone), GET/PUT/DELETE `/{id}`, GET `/{id}/statement?from&to`.

### Sales & returns
| Method | Path | Body |
|---|---|---|
| GET | `/sales` | `status (completed|held|draft|void|any), payment_status, customer_id, from, to, search, unpaid` |
| POST | `/sales` | see below |
| POST | `/sales/quote` | same body, returns computed totals without saving |
| GET/PUT | `/sales/{id}` | PUT = edit (reverse + re-post) |
| POST | `/sales/{id}/complete` | complete a held/draft sale (+ payments) |
| POST | `/sales/{id}/void` | `{reason}` |
| GET/POST | `/returns` | `{type: sale|purchase, document_id, items:[{item_id, qty}], refund_amount, refund_account_id, reason}` |
| GET | `/returns/{id}`, POST `/returns/{id}/void` | |

Sale body:
```json
{
  "uuid": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  "customer_id": 5,
  "sale_date": "2026-03-15",
  "status": "completed",
  "channel": "pos",
  "items": [
    { "product_id": 10, "variant_id": 0, "qty": "2", "unit_price": "120", "discount_type": "percent", "discount_value": "5", "tax_rate_id": 1 }
  ],
  "discount_type": "fixed", "discount_value": "10",
  "shipping_amount": "60",
  "payments": [ { "account_id": 1, "amount": "200" }, { "account_id": 3, "amount": "100", "reference": "bKash TX9" } ],
  "notes": "",
  "meta": { "tendered": "500" }
}
```
`unit_price` is optional (defaults to the product price; changing it needs
`sales.price`). Paid < total leaves a due (requires a customer unless the
business allows walk-in credit).

### Purchases & payments
| Method | Path |
|---|---|
| GET/POST | `/purchases` (body like sales + `supplier_id, supplier_invoice, other_cost`, item `update_price`) |
| GET/PUT | `/purchases/{id}`; POST `/purchases/{id}/void` |
| GET | `/payments` (`direction, contact_id, account_id, from, to`) |
| GET | `/payments/{id}` |
| POST | `/payments/receive` `{contact_id, account_id, amount, date, reference, note, sale_id?}` |
| POST | `/payments/pay` `{contact_id, account_id, amount, …, purchase_id?}` |
| POST | `/payments/{id}/void` |

### Accounting, expenses, income
| Method | Path |
|---|---|
| GET/POST | `/accounts` (`type, payment, with_balance, as_of`) |
| GET/PUT/DELETE | `/accounts/{id}` |
| GET/POST | `/journal` (POST manual entry `{date, memo, lines:[{account_id, debit, credit}]}`) |
| GET | `/journal/{id}`; POST `/journal/{id}/void` |
| GET/POST | `/expenses`, `/incomes` `{account_id, payment_account_id, amount, date, reference, description, attachment_id}` |
| GET/PUT | `/expenses/{id}`, `/incomes/{id}`; POST `…/{id}/void` |

### Inventory
GET `/stock` (`search, category_id, low, branch_id|all`) · GET `/stock/movements`
(`product_id, type, from, to`) · POST `/stock/adjust`
`{product_id, variant_id, mode: add|remove|set, qty, unit_cost, reason, date}`.

### Reports
GET `/reports/{name}` with `range` (`today, yesterday, 7d, 30d, this_month,
last_month, this_year, fiscal_year`) or `from`/`to`, and `branch_id`
(id or `all`):

`dashboard · profit-loss · balance-sheet (as_of) · trial-balance (as_of) ·
ledger (account_id) · cash-flow · sales (group_by: day|month|product|customer|user|branch|category) ·
invoice-profit · purchases (group_by: supplier|product|day|month) · expenses ·
income · dues (type, as_of) · tax · slow-movers · stock`

Add-ons register more with the `bizledger/reports` filter.

### Data
GET `/export/{products|customers|suppliers|sales|purchases|expenses|incomes|payments|stock}` → `{filename, csv}` ·
GET `/import/templates` · POST `/import/{products|customers|suppliers}` `{rows:[{header: value}], dry_run}` ·
GET `/backup` (JSON, `backup.manage`) · POST `/uploads` (multipart `file`, `purpose: logo|product|receipt`).

## Versioning
Breaking changes ship under `/bizledger/v2/`; v1 stays until clients move.
