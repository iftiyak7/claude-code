# Security Model

## Threats considered
Cross-tenant data access, privilege escalation by staff, CSRF, XSS, SQL
injection, malicious uploads, CSV/formula injection, replayed or duplicated
writes, tampering with financial history, brute-force API use.

## Controls

| Area | Control | Where |
|---|---|---|
| Authentication | WordPress login (cookies) for the app; Application Passwords for apps/integrations. BizLedger never stores passwords. | `Http\Api`, `Tenancy\WpUserDirectory` |
| CSRF | REST requests require `X-WP-Nonce` (core cookie auth check). Print views require a `wp_rest` nonce in the URL. | `assets/js/core/api.js`, `Admin\AppRoute::print` |
| Tenant isolation | `ContextFactory` builds the context only for an *active member* of an *active business*; `business_id` in payloads is discarded; every query adds `business_id = %d` from the context; foreign ids in payloads (customer, product, account…) are re-validated against the business. Tested in `SecurityTest::testBusinessesAreIsolated`. | `Tenancy\ContextFactory`, `Support\Service::findScoped` |
| Authorisation | Granular permissions checked in **services** (not only controllers), so CLI/add-on callers are covered too. Owner-only `business.manage` can never be granted. Last owner can't be demoted. Branch scope enforced on context. | `Security\Permissions`, `Tenancy\MemberService` |
| Sensitive fields | Cost prices, stock values, profit hidden unless `products.cost` / `reports.profit`. | Product/Sale/Stock services |
| SQL injection | All values bound through `$wpdb->prepare` (or PDO binds). Identifiers (table/column names) only come from code and are validated by regex. | `Database\*` |
| XSS | PHP templates escape every value (`esc_html`, `esc_attr`, `esc_url`); the SPA never uses `innerHTML` — all text goes through `textContent`. | `templates/print.php`, `assets/js/core/dom.js` |
| Input validation | Services normalise input (strip tags/control chars, typed decimals, strict dates, enums) and return field-level errors. | `Support\Text`, services |
| Money integrity | Integer fixed-point math; server recomputes every total; journal entries must balance or the transaction aborts. | `Support\Decimal`, `Accounting\JournalService` |
| History integrity | No hard deletes of financial records; voids create reversal entries; lock date blocks back-dated postings; audit log is append-only and written in the same transaction. | Services, `Audit\AuditLogger` |
| Idempotency | Client UUIDs on documents/payments: retries (offline sync, double taps) return the existing record. | Sale/Purchase/Payment/Return/Finance services |
| Rate limiting | Per-user write (240/min) and read (900/min) limits, filterable. | `Security\RateLimiter` |
| Uploads | BizLedger permission check, 5 MB limit, extension **and** real MIME check (`wp_check_filetype_and_ext`), images/PDF only, stored as private attachments tagged with the business. | `Http\Controllers\DataController::upload` |
| CSV export | Cells beginning with `= + - @` (non-numeric) are prefixed with `'` to stop formula injection. | `Data\DataService::toCsv` |
| Privacy | IP/user-agent logging can be switched off per business (`audit.log_ip`). Proxy headers are ignored unless a site opts in via filter. | `Audit\AuditLogger`, `Http\Api::clientIp` |
| Headers | App shell sends `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, no-cache; `noindex`. | `Admin\AppRoute` |
| Uninstall | Data is only dropped when the owner explicitly opted in. | `uninstall.php` |

## Reporting
Security issues should be reported privately to the maintainers, not in
public issues.
