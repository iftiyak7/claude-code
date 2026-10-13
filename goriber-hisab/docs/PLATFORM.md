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

`/app/login`. With plain permalinks the clean URL is used when the server
passes unknown paths to WordPress (checked automatically); otherwise
`/?hisab=/login`. Email or username + password, authenticated by `wp_signon()`,
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

Hooks: `goriber_hisab/platform/shop_opened`, `goriber_hisab/platform/renewal_requested`,
`goriber_hisab/platform/payment_approved` — use them to send SMS/email or to
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

## Home page

When *Show the Goriber Hisab home page* is on (Shops → Prices & settings),
the site's front page shows a landing page: features, how to start, pricing
from the monthly/yearly prices and trial days, FAQ, and WhatsApp buttons for
the *WhatsApp number*. `?lang=en` / `?lang=bn` switches language (remembered
in the `gh_lang` cookie, shared with the login page and the app).

## Sign-up

`/app/signup` (on when *Let new shops sign up themselves* is ticked). The
form asks for shop name, owner name, mobile, email, address, business type
and a password; it is protected by a nonce, a honeypot field and a limit of 5
sign-ups per IP per hour. The new shop is created with status `pending`:
the person is logged in and sees a payment screen (your bKash / Nagad /
Rocket / bank details) where they submit the TrxID. You get an email for the
sign-up and for the payment. Approving the payment opens the shop for the
paid period; *Approve with free trial* opens it without a payment.

## Payment numbers

*Prices & settings → Where clients pay you*: bKash, Nagad and Rocket numbers
with account type (personal = Send Money, merchant = Payment, agent = Cash
Out), bank details and extra instructions. They appear on the renewal and
sign-up screens with copy buttons.

## Home page editor

*Shops → Home page* (also in the WordPress menu as *Home page editor*):
every text in Bangla and English, lists (features, steps, FAQ, comparison
rows, plan items) can be added, removed and reordered, and each section can
be hidden. Stored in the `goriber_hisab_landing` option; *Reset to original*
restores the defaults. The footer and hero show the company credit
("A product of NOORIYAH Group") with its logo.

### Free trial for sign-ups

The sign-up form offers "N-day free trial" (pre-selected from the home page
button) or "Pay now"; a pending shop also sees a *Start free trial* button on
its payment screen. *Free trial for new sign-ups* decides what happens:
`instant` (default — the shop opens at once on the `trial` plan), `approval`
(a zero-amount "Free trial" request waits in Payments for you to approve) or
`off`. Each shop gets one trial; paying afterwards extends from the trial's
end date.
