# Online orders & courier

`/orders` in the app. Permissions: `orders.view`, `orders.manage` (Sales Staff
have both); courier credentials need `settings.manage`.

| Status | Stock & books | How it gets there |
| --- | --- | --- |
| `pending` (New) | untouched | order saved |
| `confirmed` | sale created (channel `online`): stock out, receivable = COD, delivery charge → Shipping Income, advance → payment | Confirm |
| `packed` | — | Mark packed |
| `shipped` (With courier) | — | Book with Steadfast (API) or enter courier + consignment/tracking |
| `delivered` | — | Delivered, or Steadfast status says delivered |
| COD collected | customer payment against the sale; courier charge → Delivery expense | *COD received* (one or many orders) |
| `returned` / `cancelled` | sale voided: stock back, receivable reversed; optional return charge → Delivery expense | Returned / Cancel |

Customers are matched by phone number (an existing customer is reused).

## Paste to fill

On *New order*, paste the customer's message and press *Auto-fill*.
`POST /orders/parse` reads the phone (Bangla digits too), name, address,
district (inside / outside Dhaka, which sets the delivery charge), note and
products with quantities (500 gram of a product sold per kg becomes 0.5).

* Built-in reader (`OrderParser`): rule-based, free, works offline.
* Optional AI reader (`AiOrderReader`): when the site owner adds a Claude API
  key in *Prices & settings*, the message and product list are sent to
  Anthropic's Messages API (`claude-opus-5-5`, low effort, JSON-schema output,
  server-side refusal fallback). Limited to 120 reads per shop per hour; any
  error falls back to the built-in reader. Calls go through the WordPress HTTP
  API because the plugin ships without Composer.

## Steadfast

Orders → Courier settings: API key + secret from the Steadfast merchant
panel. *Save & test* checks the connection (shows your balance). Booking sends
invoice = order number, recipient, 11-digit phone, address and COD amount to
`https://portal.packzy.com/api/v1/create_order`; *Check delivery status* calls
`/status_by_cid/{id}`. Secrets are stored per business and never sent to the
browser.

## REST

`GET/POST /orders`, `GET/PUT /orders/{id}`, `POST /orders/{id}/confirm`,
`POST /orders/{id}/status` (`packed|shipped|delivered`, courier fields),
`POST /orders/{id}/steadfast`, `POST /orders/{id}/track`,
`POST /orders/{id}/close` (`cancelled|returned`, reason, return_charge),
`POST /orders/cod` (`ids`, `account_id`, `fees{id: amount}`, reference),
`GET/PUT /orders/courier`.
