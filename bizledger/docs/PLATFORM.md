# Hosted shops (SaaS)

Goriber Hisab can run as a small hosted service: the WordPress site owner
opens a shop for each paying client, and the client uses only that shop.

## Roles

| Who | Can |
| --- | --- |
| Site owner (`manage_options`) | *Shops (clients)* panel: open shops, record payments, approve/reject renewal requests, change dates, suspend, reset passwords, set prices. Never blocked by subscriptions. |
| Client (role `goriber_client`) | Logs in at the branded login page, uses only their own business. wp-admin and the admin bar are hidden; any wp-admin URL redirects to the app. |
| Client staff | Added by the client from *Users*; same app-only treatment (any user who cannot `edit_posts` and belongs to a business). |

## Login

`/bizledger/login` (pretty permalinks) or `/?bizledger_app=/login` (plain
permalinks). Email or username + password, authenticated by `wp_signon()`,
so WordPress password hashing, reset emails and 2FA/lockout plugins keep
working. 10 attempts per IP per 10 minutes. Visiting the app logged out
redirects here.

## Subscription rules

* `businesses.paid_until` (date) — `NULL` means no limit (shops made through
  the setup wizard).
* A new shop gets `trial_days` free (default 7) unless a payment is entered
  when it is opened.
* Statuses: `trial`, `active`, `grace` (up to `grace_days` after
  `paid_until`, still usable), `expired`, `suspended`, `unlimited`.
* When `expired`/`suspended`, `ContextFactory` throws
  `SubscriptionException` (HTTP 402) for every request except
  `GET /subscription` and `POST /subscription/renew`. The app then shows the
  renewal screen. Print views are blocked too.
* Approving a payment extends from the day after `paid_until` (early
  renewal keeps remaining days) or from today (late renewal), by 1 or 12
  calendar months.

## Payments

Online gateways need merchant credentials, so payments are manual:

1. The client pays to the number shown in *How clients should pay you*
   (bKash/Nagad/Rocket/bank) and submits the TrxID from the renewal screen.
2. The owner sees it under *Shops (clients) → Payments*, checks the
   statement and approves (shop extended) or rejects.

The owner can also record cash or other payments directly from a shop's
*Manage* dialog. All payments are kept in `bzl_subscription_payments`.

Hooks: `bizledger/platform/shop_opened`, `bizledger/platform/renewal_requested`,
`bizledger/platform/payment_approved` — use them to send SMS/email or to
plug in a payment gateway.

## REST

| Method | Path | Who |
| --- | --- | --- |
| GET | `/platform` | owner — config, stats, login URL |
| PUT | `/platform/config` | owner |
| GET/POST | `/platform/shops` | owner — list / open shop |
| GET/PUT | `/platform/shops/{id}` | owner — details / paid_until, cycle, status, note |
| POST | `/platform/shops/{id}/payments` | owner — record payment and extend |
| POST | `/platform/shops/{id}/password` | owner |
| GET | `/platform/payments` | owner — `status=pending|approved|rejected|all` |
| POST | `/platform/payments/{id}/approve` · `/reject` | owner |
| GET | `/subscription` | shop member (works after expiry) |
| POST | `/subscription/renew` | shop owner — `cycle, method, reference, payer_phone` |
