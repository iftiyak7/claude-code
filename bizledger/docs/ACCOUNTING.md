# Accounting Logic

BizLedger keeps a full double-entry general ledger. Users never post journals
for day-to-day work: every business event is translated into journal lines by
`Accounting\PostingService`, inside the same database transaction as the
business record.

## 1. Default chart of accounts

Seeded per business (filter `bizledger/default_accounts`). `system_key` lets
code find an account regardless of the code/name the user gives it.

| Code | Name | Type | system_key | Notes |
|---|---|---|---|---|
| 1000 | Cash in Hand | asset | `cash` | payment account |
| 1010 | Bank Account | asset | `bank` | payment account |
| 1020 | Mobile Banking | asset | `mobile` | payment account (bKash, Nagad…) |
| 1100 | Accounts Receivable | asset | `receivable` | sub-ledger by customer |
| 1200 | Inventory | asset | `inventory` | = Σ stock value |
| 1300 | Input Tax (VAT receivable) | asset | `tax_input` | |
| 2000 | Accounts Payable | liability | `payable` | sub-ledger by supplier |
| 2100 | Output Tax (VAT payable) | liability | `tax_output` | |
| 3000 | Owner's Capital | equity | `capital` | |
| 3100 | Owner's Drawings | equity | `drawings` | |
| 3200 | Opening Balance Equity | equity | `opening_balance` | |
| 3300 | Retained Earnings | equity | `retained_earnings` | |
| 4000 | Sales | income | `sales` | |
| 4010 | Sales Returns | income (contra) | `sales_returns` | debit balance |
| 4100 | Shipping Income | income | `shipping_income` | |
| 4900 | Other Income | income | `other_income` | income category |
| 4910 | Service Income | income | — | income category |
| 4920 | Commission Income | income | — | income category |
| 5000 | Cost of Goods Sold | expense | `cogs` | |
| 5100 | Inventory Adjustments | expense | `inventory_adjustment` | shrinkage/gain |
| 6000… | Rent, Salary, Electricity, Internet, Transport, Marketing, Packaging, Delivery, Maintenance, Other | expense | — | expense categories |

Users can add accounts (e.g. a second bank account, a new expense category).
Expense and income *categories are accounts*, so the P&L is always the ledger.

## 2. Posting rules

`T` = total, `P` = amount paid, `S` = net sales (after all discounts, excl.
tax), `X` = tax, `H` = shipping charged, `C` = cost (weighted average).

| Event | Debit | Credit |
|---|---|---|
| **Sale completed** | Receivable T (contact = customer) | Sales S, Output Tax X, Shipping Income H |
| | COGS C | Inventory C |
| **Payment received** (incl. POS tender) | Cash/Bank/Mobile | Receivable (contact = customer) |
| **Purchase completed** | Inventory (net + shipping + other costs) | Payable T (contact = supplier) |
| | Input Tax X (if recoverable, else capitalised into inventory) | |
| **Payment made** | Payable (contact = supplier) | Cash/Bank/Mobile |
| **Sales return** | Sales Returns (net), Output Tax (tax) | Receivable (contact = customer) |
| | Inventory (original unit cost × qty) | COGS |
| **Refund paid to customer** | Receivable | Cash/Bank |
| **Purchase return** | Payable (contact = supplier) | Inventory (purchase cost), Input Tax |
| **Refund received from supplier** | Cash/Bank | Payable |
| **Expense** | Expense category account | Cash/Bank/Mobile |
| **Other income** | Cash/Bank/Mobile | Income category account |
| **Opening stock** | Inventory | Opening Balance Equity |
| **Customer opening due** | Receivable | Opening Balance Equity |
| **Supplier opening payable** | Opening Balance Equity | Payable |
| **Stock adjustment (+)** | Inventory | Inventory Adjustments |
| **Stock adjustment (−)** | Inventory Adjustments | Inventory |
| **Void of any document** | exact reversal of every entry it produced | |

Why sales always go through Receivable, even for cash sales: the invoice and
each payment become separate, symmetric events. A cash sale nets the
customer's receivable to zero; a part-paid sale leaves exactly the due; split
payments are just several payment events. Customer statements read directly
from the receivable sub-ledger.

## 3. Payments and due allocation

* `payments` stores every money movement against a party: direction `in`
  (customer) or `out` (supplier), payment account, amount, date, reference.
* `payment_allocations` links a payment to documents (sale/purchase). A
  payment taken in POS is allocated to its sale. A due collection without an
  explicit invoice is allocated to the customer's open invoices oldest first;
  any remainder stays unallocated as an **advance** (customer balance goes
  negative = credit).
* Document `paid_amount`/`due_amount` and `payment_status` are derived from
  allocations and returns, and kept in sync by `PaymentService` only.

## 4. Inventory costing

Weighted average per branch and product/variant:

```
on receipt:  value += qty × landed_unit_cost ; qty += q ; avg = value / qty
on issue:    cost   = round(q × avg) (or remaining value when emptying)
             value -= cost ; qty -= q
```

Landed cost of a purchase line = net line amount + share of document
discount (negative) + share of shipping/other costs (+ non-recoverable tax),
allocated by line value with largest-remainder rounding.

The unit cost used for each sale line is stored on the line
(`sale_items.unit_cost`) so returns restore stock at exactly the cost that
left, and invoice/product profit is stable after later purchases.

## 5. Profit & Loss

```
Revenue        = Sales − Sales Returns + Shipping Income
Gross Profit   = Revenue − COGS
Net Profit     = Gross Profit + Other Income − Expenses (incl. adjustments)
Gross Margin % = Gross Profit / Revenue
Net Margin %   = Net Profit / Revenue
```

P&L is computed from journal lines, so it always agrees with the trial
balance. Product/invoice/customer profit uses `sale_items` (net amount −
cost amount) minus returns.

## 6. Edits, voids and periods

* Updating a completed sale/purchase = reverse all its effects + re-apply in
  one transaction (journal reversals are kept, audit log records the diff).
* Delete = void: status `void`, `voided_at/by`, full reversal. Voiding a sale
  that has returns is blocked (void the returns first).
* Payments allocated to a voided document become unallocated advances unless
  they were taken with the document (POS tenders), which are voided with it.
* Future: fiscal period locking (`accounting.lock_date` setting already
  reserved) — postings dated on/before the lock date will be rejected.

## 7. Invariants (checked by tests)

1. Every journal entry balances; the ledger balances.
2. Inventory account = Σ stock value.
3. Receivable account per customer = customer balance cache.
4. Payable account per supplier = supplier balance cache.
5. Sale `due = total − allocated payments − returned value (net of refunds)`.
6. Stock qty = Σ movements.
