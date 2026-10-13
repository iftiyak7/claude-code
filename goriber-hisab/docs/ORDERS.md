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
