# TAWA tracked-file coverage register — forensic detail

**Source:** `b86b70a5b46654159e6afb823dedc5f55186ba8f` (branch `arena/019ffaa6-tawa`, detached clone at `/home/user/tawa-audit/source`).  
**Generated:** 2026-11-02 from `git ls-files` (106 tracked files, 17,382 lines + 976-byte tarball placeholder). Lines per file verified with `wc -l` 2026-11-02.  
**Destination base:** `19f11d9ecd8daad1db2aaf35cc1166425f871acc` (PR #80 open/draft, 2-file delta, local continuation docs untracked).  
**Honesty rule:** a row is **NOT TESTED** unless a code change + regression exists; *inventory* ≠ *review*. No row implies security/functional approval. This register records *what was looked at, what was found, what test exists, what gap remains* — not a readiness claim.

---

## How to read this register

Each file entry has:

- **Purpose** — one-line role.
- **Reviewed sections** — exact line ranges or `full file` read; `title scan only` means no substantive line review.
- **Findings** — `PASS` (no defect found in reviewed lines, with caveat), `FAIL` (defect with file:line, severity, scenario), `BLOCKED` (cannot test without real browser/PostgreSQL), `NOT TESTED` (no assertion). Every FAIL includes required regression.
- **Tests** — legacy suite coverage + controlled reproductions run in `/home/user/tawa-audit/browser` (jsdom 26) or in-memory SQLite. Legacy `npm test` = 43 passed (TAWA_DATA_DIR isolated DBs, no production data) — does **not** close defects.
- **Remaining gaps** — what exhaustive audit still must do.
- **Destination note** — Neon/Prisma compatibility hint where relevant.

Global caveat: exhaustive audit is **incomplete**; production readiness = **NO**.

---

## 1 — Repo / build / docs (13 files)

### `.dockerignore` — 13 lines
- Reviewed: title scan only.
- Findings: NOT TESTED — ignore list not evaluated for secret leakage.
- Tests: NOT TESTED.
- Gaps: verify no secret or data volume excluded incorrectly; compare with destination Dockerfile context.
- Destination: unrelated; JATA uses Vercel + Neon.

### `.env.example` — 39 lines
- Reviewed: full file (values, defaults, comments).
- Findings: FAIL P0 (configuration hygiene) — `server/config.js:22-31` shows `cookieSecure` false by default and sandbox webhook secrets (`whsec_mpesa_sandbox_default`, `whsec_card_sandbox_default`) present even outside sandbox; `.env.example` documents these defaults without fail-closed warning. Scenario: deploying with defaults leaves cookies non-Secure and webhook verification using known test secrets. Required regression: production startup must abort if `NODE_ENV=production` and `COOKIE_SECURE!=true` or webhook secrets are defaults.
- Tests: NOT TESTED (no config deployment test).
- Gaps: audit all env vars for default credentials, timeouts, rate-limit window; map to Vercel env.

### `.gitignore` — 24 lines
- Reviewed: full file.
- Findings: PASS (within reviewed scope) — ignores `node_modules`, `data`, `uploads`.
- Tests: NOT TESTED.
- Gaps: verify `data/` SQLite DBs never committed; ensure destination `.gitignore` equivalent for Neon/Prisma.

### `ARCHITECTURE.md` — 90 lines
- Reviewed: full file.
- Findings: NOT TESTED for correctness — describes TAWA multi-tenant OS, modules, § refs; not verified against code.
- Tests: NOT TESTED.
- Gaps: cross-check every § claim (e.g., §29 append-only, §40 CSRF) against source; this register does that per file.
- Destination: TAWA is reference only; do not import architecture verbatim. MJENGO_OS must be modelled separately.

### `Dockerfile` — 46 lines
- Reviewed: full file (base `node:20-alpine`, `npm ci`, `node server/index.js`, `EXPOSE 3000`).
- Findings: NOT TESTED for runtime security — static read only; no user, healthcheck, or secret handling review.
- Tests: NOT TESTED.
- Gaps: verify non-root user, read-only FS, healthcheck, secret injection; destination is not Docker (Vercel/Neon).

### `README.md` — 141 lines
- Reviewed: full file (run, demo, test instructions).
- Findings: NOT TESTED — documents `npm test` uses temp SQLite; not a security assertion.
- Tests: PASS — `TAWA_DATA_DIR=/home/user/tawa-audit/test-data npm test` → 43/43 passed (see `tawa-test-output.txt`).
- Gaps: verify demo accounts not present in destination.

### `docker-compose.yml` — 33 lines
- Reviewed: full file (app + sqlite volume `tawa-data`).
- Findings: NOT TESTED beyond structure — confirms SQLite file at `/data/tawa.db`, no Postgres.
- Tests: NOT TESTED.
- Gaps: compare with Neon Postgres deployment; document translation of `BEGIN IMMEDIATE` assumptions.

### `docs/ADMIN.md` — 46 lines
- Reviewed: full file.
- Findings: NOT TESTED — describes admin bootstrap.
- Tests: NOT TESTED.
- Gaps: verify admin creation requires existing tenancy; check destination `lib/auth.ts` platform-admin separation.

### `docs/API.md` — 312 lines
- Reviewed: full file (201 route declarations inventoried in `MJENGO_TAWA_ROUTE_INVENTORY.md`).
- Findings: PASS (inventory only) — API doc lists 201 routes; actual router registrations match in `server/app.js:14-23` imports. This is declaration presence, not behavior proof.
- Tests: NOT TESTED (route-to-handler-to-DB matrix pending).
- Gaps: build route→module→table→permission→test matrix; verify every documented route is registered and gated.

### `docs/AUDIT.md` — 163 lines
- Reviewed: full file.
- Findings: NOT TESTED — TAWA-authored audit claims; not accepted as proof (per standing instruction).
- Tests: NOT TESTED.
- Gaps: reproduce every claimed guarantee independently (this register does so for P0s).

### `docs/SECURITY.md` — 51 lines
- Reviewed: full file (threat model, CSP, rate limit claims).
- Findings: FAIL P1 — claims CSP and rate limiting; actual `web/index.html:1-24` has no `<meta http-equiv="Content-Security-Policy">`, `server/app.js:50-52` sets `X-Frame-Options: DENY` and `Referrer-Policy` but not CSP; rate-limit `server/app.js:25-35` is in-memory `Map` per process (not shared). Required regression: real-browser CSP header/meta test + distributed rate-limit test.
- Tests: BLOCKED — jsdom CSP not equivalent to real browser; no prod config inspected.
- Gaps: verify deployed CSP, HSTS, permission-policy, proxy trust.

### `package.json` — 20 lines
- Reviewed: full file (scripts `start`, `test`, deps `better-sqlite3` absent, uses `node:sqlite`).
- Findings: PASS (within scope) — no pre/postinstall scripts; test runner is `node --test`.
- Tests: NOT TESTED beyond running tests.
- Gaps: audit dependency versions for CVEs; verify no TAWA SQLite dep leaks into MJENGO.

### `product.manifest.json` — 46 lines
- Reviewed: full file (product `TAWA`, version `1.0.0`, entitlements).
- Findings: NOT TESTED — manifest not validated against code entitlements (`server/core/entitlements.js:93` Business plan price 20000 minor units = KES 200).
- Tests: NOT TESTED.
- Gaps: define MJENGO_OS manifest separately; do not reuse TAWA plan IDs.

---

## 2 — Release / scripts (7 files)

### `release/CHECKSUMS.txt` — 1 line
- Reviewed: full file (SHA256 placeholder).
- Findings: NOT TESTED — checksum not verified against tarball.
- Tests: NOT TESTED.
- Gaps: verify tarball reproducibility; destination needs no TAWA artifact.

### `release/manifest.json` — 32 lines
- Reviewed: full file (release metadata).
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: ensure no TAWA release artifact deployed to JATA.

### `release/tawa-1.0.0-20260814.tar.gz` — 976 lines (wc counts binary as lines; actual tarball)
- Reviewed: NOT TESTED — not unpacked; release tarball inspection outstanding per acceptance gate.
- Findings: BLOCKED (pending unpack).
- Tests: NOT TESTED.
- Gaps: unpack and compare tracked files vs tarball contents; check for extra seed/data.

### `scripts/backup.js` — 59 lines
- Reviewed: full file (SQLite backup via `VACUUM INTO`, encrypted with `age` if available).
- Findings: FAIL P1 — `tests/commercial.test.js:258-271` backup assertion uses `||` — `!row.foreignId || !row.credentials` passes even when foreign data exists; backup isolation not proven. Scenario: tenant A backup contains tenant B row → test still green. Required regression: assert foreign tenant ID absent AND secrets absent as independent assertions; use canary rows.
- Tests: FAIL (see above); isolated backup not integration-tested with real encryption.
- Gaps: verify backup restores with tenant isolation; Neon branching replaces SQLite backup.

### `scripts/gen-api-docs.js` — 68 lines
- Reviewed: full file (parses `server/routes/*.js` to generate `docs/API.md`).
- Findings: PASS (within scope) — generator reads router strings; not security-relevant.
- Tests: NOT TESTED.
- Gaps: ensure generator covers all routes; destination docs need separate generation.

### `scripts/package.js` — 75 lines
- Reviewed: full file (creates tarball, writes CHECKSUMS).
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify package excludes `data/`, `node_modules`, secrets.

### `scripts/validate.js` — 160 lines
- Reviewed: full file (validates `product.manifest.json` vs schema).
- Findings: NOT TESTED beyond syntax.
- Tests: NOT TESTED.
- Gaps: add JSON Schema validation in CI; destination needs own manifest validation.

---

## 3 — Server adapters / core / config / DB (22 files)

### `server/adapters/messaging.js` — 78 lines
- Reviewed: full file (WhatsApp/SMS sandbox, outbox).
- Findings: FAIL P1 — sandbox delivery (`console.log`) is not delivery; no durable outbox dedupe. Scenario: message “sent” but never delivered, no retry. Required regression: durable outbox, provider-confirmed delivery, retry with idempotency.
- Tests: NOT TESTED (messaging not in legacy suite).
- Gaps: audit consent, opt-in, webhook verification for WhatsApp; compare with `lib/messaging/` destination.

### `server/adapters/payments.js` — 179 lines
- Reviewed: lines 1-179 (all providers: `mpesa_sandbox`, `cash`, `card_sandbox`, `bank_manual`).
- Findings: FAIL P0 — `refundPayment()` for all providers manufactures success: `mpesa_sandbox` returns `WS_RE_*` without provider call, `cash`/`bank_manual` synthesize `TILL-R-*`/`BNK*`; `createOutboundPayout` in `server/modules/payouts.js:27-42` promotes sandbox `PENDING` to `SUCCESS` locally. Manual bank attestation is not bank confirmation. Required regression: provider-confirmed refund/payout lifecycle, idempotent retry, reconciliation job.
- Tests: NOT TESTED beyond ledger smoke; no provider-confirmed test.
- Gaps: review `lib/payments/providers/paystack.ts` — verify it does NOT synthesize success; require webhook/SDK confirmation.

### `server/app.js` — 146 lines
- Reviewed: lines 1-146 (middleware: `rateLimit` in-memory Map, `securityHeaders` sets `X-Frame-Options`/`Referrer-Policy` but no CSP, `csrfMiddleware` calls `enforceCsrf`, route registration for 12 modules).
- Findings: FAIL P0 — `clientIp()` trusts `x-forwarded-for` without proxy allowlist (`server/core/auth.js:88-90`); rate-limit keyed by that IP is spoofable. `enforceCsrf` skipped for bearer but `resolveAuth` accepts cookie+bearer combo. Required regression: proxy allowlist, spoofed-header denial, distributed throttling test.
- Tests: NOT TESTED (no auth/rate-limit integration test in legacy suite).
- Gaps: audit every middleware ordering; test 201 routes for authz.

### `server/config.js` — 40 lines
- Reviewed: full file (env parsing, `cookieSecure`, `webhookSecrets`, `rateLimit`).
- Findings: FAIL P0 — `cookieSecure = env.COOKIE_SECURE === 'true'` defaults false; sandbox webhook secrets default to known strings even when `NODE_ENV=production`. Required regression: fail-closed startup — abort if production and `COOKIE_SECURE!=true` or secrets equal defaults.
- Tests: NOT TESTED (no config gate test).
- Gaps: list all env vars, defaults, and production-required values; map to Vercel env.

### `server/core/audit.js` — 38 lines
- Reviewed: full file (append-only `audit_events` with triggers, `audit()` helper).
- Findings: PASS (within reviewed scope) — inserts with `id`, `tenant_id`, `actor_id`, `action`, `resource`, `created_at`; relies on DB triggers for immutability (see `001_tenancy_identity.sql:210-212`).
- Tests: NOT TESTED (no audit tamper test).
- Gaps: verify triggers exist in running DB; test UPDATE/DELETE denial; compare with `lib/erp/audit.ts` destination.

### `server/core/auth.js` — 188 lines
- Reviewed: full file (hash/verify with scrypt N=16384, session cookie `SameSite=Lax`, `resolveAuth` prefers cookie over bearer, `viaCookie` flag `!!cookie && !bearer`, `enforceCsrf` checks `x-tawa-csrf` only when `viaCookie`).
- Findings: FAIL P0 CSRF — controlled in-memory repro: valid cookie + arbitrary `Authorization: Bearer arbitrary` sets `viaCookie:false`, bypassing CSRF → `authenticated:true`. Also `clientIp` trusts forwarded IP; `failedAttempts` Map is per-process memory; 8 bad passwords → `status='LOCKED'` permanent DoS. Required regression: HTTP tests for (cookie only + valid CSRF = pass), (cookie + bearer = still CSRF-checked or bearer invalid rejected), (missing/invalid CSRF = 403), plus bearer-only legitimate flow, spoofed IP, and lockout-not-permanent.
- Tests: legacy suite has one lockout check but not CSRF matrix; repro confirmed in isolation (see continuation doc).
- Gaps: real browser test; bearer auth must be valid JWT/session or rejected; CSRF must be double-submit or same-site strict.

### `server/core/entitlements.js` — 150 lines
- Reviewed: full file (`PLANS` Business=20000 minor units, `PLAN_MATRIX`, `tenantEntitlements()` reads `subscriptions` + `plan_entitlements`, `enforcePlanLimit()` checks usage).
- Findings: FAIL P1 — expiry check in `tests/invariants.test.js:286-295` title claims expiry but tests `FREE`→upgrade, not past expiry; entitlement logic not tested for expired `GRACE` vs `ACTIVE`. Required regression: set `expires_at < now` on paid plan, assert gate denies.
- Tests: legacy entitlement tests cover plan counts but not expiry/upgrade downgrade safety.
- Gaps: audit all 201 routes for `enforcePlanLimit`/`mustPerm` before handler; compare with `lib/pricing.ts`/`lib/pos/entitlement.ts`/`lib/erp/entitlement.ts` separation (POS 499 vs MJENGO_OS 2000).

### `server/core/events.js` — 93 lines
- Reviewed: full file (outbox `domain_events`, `emitEvent` inserts, `processOutbox` stub).
- Findings: FAIL P1 — outbox is inserted but delivery is synchronous stub; no durable delivery/retry/dedupe. Required regression: outbox consumer with idempotent delivery, visibility timeout.
- Tests: NOT TESTED.
- Gaps: map to `lib/erp/notifications.ts` or new notification outbox; ensure Neon transaction includes outbox insert.

### `server/core/http.js` — 153 lines
- Reviewed: full file (helpers `ok`, `created`, `err` with `status`/`code`, `readBody` parses JSON, `reqStr`/`reqNum` validators).
- Findings: PASS (within scope) — validators reject empty strings, `reqNum` checks `min`/`max`.
- Tests: NOT TESTED (no unit tests for validators).
- Gaps: fuzz test validators, ensure `readBody` size limit, test error serialization does not leak stack.

### `server/core/rbac.js` — 129 lines
- Reviewed: full file (`ROLE_TEMPLATES`: Owner/Manager/Cashier, `PERMISSIONS` 40+ codes, `hasPermission` checks `role_permissions`).
- Findings: FAIL P1 — `users.manage`/`roles.manage` can elevate to Owner; no test that Cashier cannot `branding.manage`. Required regression: matrix test — each role × each permission × each route (201 routes).
- Tests: NOT TESTED (legacy suite checks 2 roles).
- Gaps: review destination `lib/auth.ts` RBAC separation; ensure MJENGO_OS perms distinct from POS.

### `server/core/tenancy.js` — 103 lines
- Reviewed: full file (`tenantByHost` parses `host`/`x-tenant-host`/`code`, fallback to first `ACTIVE` tenant).
- Findings: FAIL P1 — `server/routes/identity.js:15-26` `GET /api/v1/brand` falls back to `SELECT * FROM tenants WHERE status IN ('ACTIVE','TRIAL') ORDER BY created_at LIMIT 1` when `host`/`code` unknown → information disclosure / tenant confusion. `GET /api/v1/public/tenants` lists all active tenant codes/names/branding. Required regression: unknown host → 404, not fallback; public directory privacy policy.
- Tests: NOT TESTED (no host-isolation test).
- Gaps: verify destination `lib/tenant.ts` resolves from trusted server identity (session/JWT), never client-supplied ID.

### `server/db/connection.js` — 75 lines
- Reviewed: full file (`node:sqlite` Database, `BEGIN IMMEDIATE`, `q.one`/`q.all`/`q.run`, `tx()` helper).
- Findings: FAIL P0 — `BEGIN IMMEDIATE` single-writer assumption; Neon Postgres is multi-writer with MVCC + `SERIALIZABLE`/`REPEATABLE READ`. Code also uses SQLite `json_group_array`, `INSERT OR IGNORE`, `RETURNING next` scalar quirks. Required regression: Postgres transaction test with concurrent writers.
- Tests: NOT TESTED (SQLite only).
- Gaps: audit every `q.*` call for Postgres translation; use Prisma `$transaction` with isolation level.

### `server/db/migrate.js` — 40 lines
- Reviewed: full file (reads `server/db/migrations/*.sql`, tracks `migrations` table, applies in filename order).
- Findings: PASS (within scope) — in-memory test applied 7 migrations first run, 0 second run.
- Tests: PASS (idempotency smoke only); NOT TESTED for upgrade/rollback/crash.
- Gaps: test migration rollback, downgrade blocked, checksum drift detection; compare with `prisma migrate` workflow.

### `server/db/migrations/001_tenancy_identity.sql` — 292 lines
- Reviewed: lines 1-292 (tenants, users, roles, sessions, `audit_events` + `audit_no_update`/`audit_no_delete` triggers, `tenants` seed).
- Findings: PASS (triggers correct) — `audit_events` is append-only via `RAISE(ABORT)`. One concern: `sessions` stores `csrf` as plain text (not hashed) — but `server/core/auth.js:65` generates per-session csrf, stored server-side, so disclosure requires DB breach.
- Tests: NOT TESTED (no trigger tamper test for audit).
- Gaps: review all 292 lines for tenant FK completeness; verify destination `AuditLog` model has equivalent immutability.

### `server/db/migrations/002_catalog_inventory.sql` — 159 lines
- Reviewed: lines 1-159 (products, warehouses, `inventory_movements` + `moves_no_update`/`moves_no_delete`, `stock_levels` with `REAL` qty).
- Findings: FAIL P0 — `REAL` quantities (float) for stock; rounding errors accumulate. `product_id TEXT REFERENCES products(id)` without composite `(tenant_id, product_id)` → cross-tenant FK not prevented at DB layer. Required regression: integer minor units (or NUMERIC with scale), composite FK, concurrent reservation test.
- Tests: NOT TESTED for movement immutability.
- Gaps: full line-by-line DDL audit; compare with `prisma/schema.prisma` `PosProduct` Float qty (see below).

### `server/db/migrations/003_sales_money.sql` — 281 lines
- Reviewed: lines 1-281 (orders, `payment_intents` with `UNIQUE(tenant_id, idempotency_key)`, `payments`, `refunds`, `journal_entries` + `journal_no_update`/`journal_no_delete`, `journal_lines` + `jlines_no_update` only).
- Findings: FAIL P0 — `journal_lines` has UPDATE trigger but **no DELETE trigger** (`272-273` only `BEFORE UPDATE`). Isolated repro: delete both `journal_lines` for a posted entry → `verifyLedgerIntegrity` still `ok:true` because `ledger.js:203-210` inner-join misses zero-line entry. Also `payment_events.provider_event_id` nullable despite `UNIQUE(provider, provider_event_id)` → NULL≠NULL allows duplicate nulls. Required regression: DB DELETE block + integrity detects missing/orphan/unbalanced.
- Tests: legacy suite does not test direct SQL mutation; repro confirmed (see continuation).
- Gaps: also review `ledger.js:58-74` rounding-before-balance, `160-210` date filter bug (see Module section).

### `server/db/migrations/004_supply_workforce.sql` — 277 lines
- Reviewed: lines 1-277 (suppliers, POs, `po_items`, workers, payroll runs, `attendance` without tenant check in app).
- Findings: FAIL P1 — `attendance` FK to `workers(id)` single-col, not composite `(tenant_id, worker_id)`; `server/routes/workforce.js:56-65` accepts any `worker_id` without same-tenant lookup → cross-tenant attendance. `004` also has `purchase_orders.warehouse_id REFERENCES warehouses(id)` single-col. Required regression: cross-tenant worker/warehouse denied in transaction.
- Tests: NOT TESTED for procurement/workforce isolation.
- Gaps: full FK matrix; review `lib/erp/procurement.ts` destination for composite checks.

### `server/db/migrations/005_comms_intel.sql` — 152 lines
- Reviewed: full file (conversations, `ai_insights`, `ai_action_log`, `automation_rules`).
- Findings: FAIL P1 — `ai_action_log` not append-only (no triggers); insights generated by `server/modules/ai.js:192-203` use LEFT JOIN without date filter scoping (see Module finding). Required regression: velocity excludes out-of-window orders.
- Tests: NOT TESTED.
- Gaps: review insight generation ownership; file storage BLOB vs R2.

### `server/db/migrations/006_providers_autopay.sql` — 39 lines
- Reviewed: full file (`provider_health`, `sandbox_provider_records` with durable provider-side ledger).
- Findings: NOT TESTED beyond presence — sandbox ledger exists but is promoted to success without provider confirmation (see Payouts fail).
- Tests: NOT TESTED.
- Gaps: verify production provider tables require real credentials; sandbox must never be marked production.

### `server/db/migrations/007_item_tenancy.sql` — 37 lines
- Reviewed: full file (backfills `tenant_id` on `order_items`/`quote_items`/`po_items` via triggers `trg_*_tenant`).
- Findings: FAIL P1 — backfill copies `tenant_id` on INSERT but does not add composite FK or protect UPDATE; existing rows backfilled once, new writes could still mismatch. Required regression: FK `FOREIGN KEY (tenant_id, order_id) REFERENCES orders(tenant_id, id)` or app transaction recheck.
- Tests: NOT TESTED (no tenancy-propagation adversarial test).
- Gaps: verify destination `ErpJournalLine`/`ErpInvoiceLine` have composite tenancy.

### `server/index.js` — 23 lines
- Reviewed: full file (creates `Database`, runs `migrate`, starts `http.createServer`).
- Findings: NOT TESTED — startup does not fail-closed on insecure config (see `config.js` fail).
- Tests: NOT TESTED.
- Gaps: destination startup is Next.js, not TAWA server; do not import.

---

## 4 — Server modules (6 files)

### `server/modules/ai.js` — 336 lines
- Reviewed: lines 1-336 (copilot `answer()` builds `action_class`, `text`, `data`, `confidence`; 6 intents: sales today, cheapest supplier, slow products, etc.; velocity `SUM(order_items.qty)` with `LEFT JOIN orders ON ... AND date/status filters` → bug).
- Findings: FAIL P1 — `server/modules/ai.js:18-29,192-203` sums `order_items.qty` even when filtered LEFT JOIN has no matching `orders` → out-of-window/cancelled items counted. Also `web/js/pages/ai.js:48-59` inserts `answer` via `innerHTML` (see Frontend). Required regression: SQL must filter in WHERE or subquery, not LEFT JOIN; AI response must be text-rendered, never HTML.
- Tests: NOT TESTED (no AI accuracy test).
- Gaps: review all 6 intents; do not couple to JATA Qi/TANYA-AI.

### `server/modules/documents.js` — 172 lines
- Reviewed: full file (quote → order conversion, numbering).
- Findings: NOT TESTED — assumes tenant-scoped numbering but FKs not composite.
- Tests: NOT TESTED.
- Gaps: verify idempotent conversion, concurrent quote accept.

### `server/modules/inventory.js` — 159 lines
- Reviewed: full file (`reserveStock` 53-77 loops items without aggregation, `SELECT ... FOR UPDATE` absent, `on_hand` check per line not per product).
- Findings: FAIL P0 — duplicate-line exploit repro’d: 1+1 qty against 1 stock → `on_hand:1,reserved:2` (in-memory actual functions). Required regression: aggregate by `product_id` before compare, `UPDATE ... WHERE on_hand - reserved >= qty` or `SELECT FOR UPDATE`.
- Tests: legacy `acceptance.test.js` covers happy-path reserve but not duplicate/concurrent; repro confirmed.
- Gaps: test expiration, partial fulfil, race under Postgres.

### `server/modules/ledger.js` — 211 lines
- Reviewed: full file (COA 19 accounts, `postEntry()` balances before rounding, `trialBalance()` date filter on `e.posted_at` but sums all `journal_lines` due to LEFT JOIN placement, `verifyLedgerIntegrity()` inner-join misses empty entries).
- Findings: FAIL P0 — three defects: (1) `58-74` `Math.round(l.debit)` after `dr+=Number(l.debit)` vs `dr===cr` check → 0.4+0.4 vs 0.8 balances as 0 vs 1 cent; (2) `160-210` `LEFT JOIN journal_entries e ON e.id=l.entry_id AND e.posted_at BETWEEN ? AND ?` → outer join keeps lines even when entry outside range → 2024 debit appears in 2025 report; (3) `203-210` `JOIN` not `LEFT JOIN` → deleted-entry (0 lines) invisible to integrity check. Required regression: reject non-integer minor units, date filter in WHERE, integrity counts entries with 0 lines.
- Tests: legacy accounting tests cover happy path only; repros confirmed with isolated SQLite/arithmetic.
- Gaps: destination `lib/erp/accounting.ts:110-193` validates integer cents — must be gate; add DB-level `CHECK` on cents.

### `server/modules/payments.js` — 359 lines
- Reviewed: full file (`createIntent` checks idempotency but `payments.js:42-46` replay returns old intent without payload compare; `applyCreditRepayment` marks one random order PAID when `available==0`; `verifyAndSettle` trusts provider amount but `createOutbound` promotes sandbox to success).
- Findings: FAIL P0 — idempotency replay without fingerprint → conflicting body silently swallowed; credit repayment marks `ORDER BY created_at LIMIT 1` not allocation-aware. Required regression: same key+same body = replay, same key+conflicting body = 409; credit repayment must allocate per intent lines.
- Tests: NOT TESTED for replay conflict; legacy `invariants.test.js:199-208` title says repayment but only checks over-limit rejection.
- Gaps: review all 359 lines for provider confirmation, fee handling, reconciliation.

### `server/modules/payouts.js` — 60 lines
- Reviewed: full file (`createOutboundPayout` 13-42 fabricates success for `mpesa_sandbox`, `cash`, `bank_manual` by updating `sandbox_provider_records` to `SUCCESS` before `verifyAndSettle`).
- Findings: FAIL P0 — payouts “confirmed” without provider call; `bank_manual` attestation is local coin-flip, not bank webhook. Required regression: outbound must require external confirmation (webhook or poll with signature), distinct authorization, timeout.
- Tests: NOT TESTED (no payout confirmation test).
- Gaps: compare with `lib/erp/*` destination — must not synthesize payouts.

### `server/modules/sales.js` — 221 lines
- Reviewed: full file (cart, quote, order CRUD, `convertQuoteToOrder`).
- Findings: NOT TESTED beyond inventory call — shares same reservation defect via `reserveStock`.
- Tests: NOT TESTED.
- Gaps: audit discount, tax_category, delivery fee handling; test idempotency key uniqueness.

---

## 5 — Server routes (14 files, 201 routes inventoried)

### `server/routes/admin.js` — 178 lines
- Reviewed: title scan only + `provisionTenant` import.
- Findings: NOT TESTED — admin bootstrap creates tenant/user/roles; privilege escalation risk not audited.
- Tests: NOT TESTED.
- Gaps: full review of admin routes, permission checks, audit trail.

### `server/routes/catalog.js` — 170 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: audit product CRUD, pricing tiers, tenant isolation.

### `server/routes/comms.js` — 252 lines
- Reviewed: full file (conversations, message send, automation).
- Findings: NOT TESTED beyond structure — note `POST /api/v1/comms/messages` not rate-limited per thread.
- Tests: NOT TESTED.
- Gaps: verify consent, outbox dedupe.

### `server/routes/files.js` — 129 lines
- Reviewed: full file (upload `POST /api/v1/files` 10-28 stores BLOB in DB, validates extension not content, SVG allowed with denylist `onload` filter, `GET /api/v1/files/:id` serves with `Content-Type` from DB, CSP header set on `GET /brand/logo` but not on static HTML).
- Findings: FAIL P1 — BLOB in DB (not R2), MIME sniffing not enforced, SVG denylist bypassable (`<image href="javascript:...">`), private file access check missing `tenant_id` on serve. Required regression: content/MIME/size verification, SVG rejection or DOMPurify, private tenant check, lifecycle tests.
- Tests: NOT TESTED (no file upload adversarial test).
- Gaps: map to `lib/storage/` R2 — verify fail-closed, tenant-private.

### `server/routes/identity.js` — 251 lines
- Reviewed: full file (`GET /api/v1/brand` 15-40 public brand with fallback, `POST /api/v1/auth/login` with `failedAttempts` Map + permanent LOCKED, `POST /api/v1/tenants` provisioning).
- Findings: FAIL P1 — brand fallback discloses first tenant; `failedAttempts` in-memory not shared; 8 bad passwords → LOCKED forever (DoS). Required regression: no fallback, 404 on unknown host, distributed throttle, lockout expiry.
- Tests: NOT TESTED (no tenant-enumeration test).
- Gaps: audit password reset flow, session revocation.

### `server/routes/intel.js` — 251 lines
- Reviewed: lines 113-160 + full scan (insights, `POST /api/v1/ai/ask` 113+ requires `ai.use`, reads `body.tenant_id` but `assertSingleTenant` enforces match).
- Findings: FAIL P0 (reflected XSS downstream) — `POST /api/v1/ai/ask` returns `copilot()` answer containing user question verbatim; frontend `ai.js` renders it as HTML. Also `GET /api/v1/insights` generates on `?regenerate=1` without `mustPerm` beyond read. Required regression: AI answer text-rendered + CSP.
- Tests: legacy does not test AI injection; controlled jsdom reflected test confirmed (see continuation).
- Gaps: audit `assertSingleTenant` enforcement on every body tenant_id; test prompt injection.

### `server/routes/inventory.js` — 155 lines
- Reviewed: full file (stock list, movement, alerts).
- Findings: NOT TESTED beyond module call — relies on `inventory.js` reserve.
- Tests: NOT TESTED.
- Gaps: verify `warehouse_id` ownership on receipt, stock transfer isolation.

### `server/routes/keys.js` — 84 lines
- Reviewed: full file (API key create/list/revoke, `KEY_SENSITIVE_DENY`).
- Findings: PASS (within scope) — sensitive perms denied for `read` scope.
- Tests: NOT TESTED (no API key permission matrix).
- Gaps: test key rotation, expiry, revocation propagation.

### `server/routes/logistics.js` — 165 lines
- Reviewed: full file (shipments, delivery, tracking).
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: audit delivery pricing, status transitions.

### `server/routes/money.js` — 123 lines
- Reviewed: full file (expenses SUBMIT→APPROVE→PAY, accounting trial-balance/pnl/balance-sheet/reconcile CSV).
- Findings: NOT TESTED beyond `ledger.js` defects — routes call `postExpenseApproved`/`postExpensePaid` without period-open check.
- Tests: NOT TESTED.
- Gaps: test expense approval segregation (submitter ≠ approver), payroll segregation.

### `server/routes/payments.js` — 131 lines
- Reviewed: full file (intents, webhook, sandbox console `x-sandbox-mode` header gate).
- Findings: FAIL P1 — sandbox console `POST /sandbox/mpesa/outcome` accepts arbitrary `provider_ref` + `outcome` with only header check; no per-tenant authz. Required regression: sandbox console requires `payments.manage` + tenant ownership.
- Tests: NOT TESTED (no webhook signature test).
- Gaps: audit webhook HMAC, idempotency.

### `server/routes/procurement.js` — 226 lines
- Reviewed: lines 139-192 (receive PO, invoice creation).
- Findings: FAIL P1 — `POST /api/v1/procurement/orders/:id/receive` accepts `warehouse_id` without ownership check; `POST /invoices` accepts `po_id` without tenant/supplier match. Required regression: cross-tenant PO/warehouse mismatch denied in tx.
- Tests: NOT TESTED.
- Gaps: full procurement flow audit, concurrent receive.

### `server/routes/relationships.js` — 314 lines
- Reviewed: title scan + customer/credit endpoints spot-check.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: audit credit account creation, limit changes, tenant isolation.

### `server/routes/sales.js` — 248 lines
- Reviewed: full file (cart, POS, order fulfill/cancel, `POST /api/v1/sales/orders` with `idempotency_key`).
- Findings: FAIL P0 — duplicate-line reservation flows through here; `POST /orders/:id/fulfil` idempotent but `cancel` allows `PAID` without refund. Required regression: fulfil atomic, cancel blocked when paid.
- Tests: NOT TESTED for cancel/refund coupling.
- Gaps: test POS sale idempotency, credit sale limit.

### `server/routes/settings.js` — 274 lines
- Reviewed: full file (branding PUT 34-66, flags, billing, backup/restore).
- Findings: FAIL P0 — `PUT /api/v1/settings/branding` stores `business_name` via `String(body[f]).slice(0,200)` with **no sanitization**; public `GET /api/v1/brand` returns it. Stored payload executes via `ui.js` html sink (see Frontend). Also restore endpoint accepts arbitrary `tenant_id` without re-verification. Required regression: branding must be plain text, safe text rendering, CSP.
- Tests: legacy does not test branding injection; isolated jsdom stored repro confirmed.
- Gaps: audit all 274 lines, especially backup/restore tenant checks.

### `server/routes/workforce.js` — 245 lines
- Reviewed: full file (workers, attendance `POST /attendance` 56-65 accepts `worker_id` without tenant lookup, payroll run).
- Findings: FAIL P1 — cross-tenant attendance (see Migration 004). Required regression: `SELECT * FROM workers WHERE id=? AND tenant_id=?` inside tx.
- Tests: NOT TESTED.
- Gaps: audit payroll segregation, commission calc.

### `server/seed/catalog.js` — 172 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify no demo data in MJENGO seed.

### `server/seed/seed.js` — 379 lines
- Reviewed: lines 1-80, 340-379 (tenant `alpha`/`kilimani`, users `owner`/`manager`/`cashier`, products, promotions).
- Findings: NOT TESTED — demo seed contains credentials (`password: 'password123'` pattern).
- Tests: PASS for test-helper use (helpers.js creates isolated tenants, not seed tenants).
- Gaps: ensure destination never seeds demo credentials; audit promotion logic.

---

## 6 — Tests (4 files)

### `tests/acceptance.test.js` — 173 lines
- Reviewed: full file (smoke: login, product CRUD, order create/fulfil, accounting snapshot).
- Findings: FAIL P1 — smoke passes even with P0 defects (duplicate reservation not covered, CSRF not covered). Not a security proof.
- Tests: PASS in suite (part of 43) — but **not** proof of correctness (see continuation).
- Gaps: add adversarial tests; keep smoke as baseline.

### `tests/commercial.test.js` — 347 lines
- Reviewed: full file (billing, plan limits, backup, license).
- Findings: FAIL P1 — `258-271` backup `||` allows false pass; `199-208` repayment title tests-free not expiry; `286-295` expiry title tests FREE not past expiry. Required regression: independent assertions.
- Tests: PASS in suite (but misleading).
- Gaps: rewrite all 347 lines with precise assertions.

### `tests/helpers.js` — 114 lines
- Reviewed: full file (`makeStack` creates `Database(':memory:')`, runs `migrate`, seeds with `id()`, `makeTenant`, `login` returns `session` with `token`/`csrf`).
- Findings: PASS (test infra only) — isolated DBs, no prod data.
- Tests: PASS (helpers enable 43 tests).
- Gaps: add Postgres helpers, concurrent runner, real-browser harness.

### `tests/invariants.test.js` — 341 lines
- Reviewed: full file (RBAC, audit, inventory, ledger invariants).
- Findings: FAIL P1 — same expiry/repayment title mismatches as commercial; `199-208` expects over-limit rejection but no repayment; `286-295` tests upgrade not expiry.
- Tests: PASS in suite (but titles misleading).
- Gaps: add reservation, ledger trigger, CSRF tests.

---

## 7 — Frontend (30 files)

### `web/index.html` — 24 lines
- Reviewed: full file (`<script type="module" src="/js/main.js">`, no CSP meta).
- Findings: FAIL P0 — no CPS header/meta; static HTML served without `Content-Security-Policy`. Controlled fetch of TAWA root returned `null` CSP header; jsdom CSP not evaluated. Required regression: real-browser CSP test + header `default-src 'self'` + `script-src 'self'` etc.
- Tests: BLOCKED (needs real browser, not jsdom).
- Gaps: audit destination Next.js `next.config.js` headers for CSP.

### `web/css/app.css` — 626 lines
- Reviewed: title scan only.
- Findings: NOT TESTED (style only).
- Tests: NOT TESTED.
- Gaps: accessibility audit (contrast already checked server-side).

### `web/css/tokens.css` — 60 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: design token review.

### `web/favicon.svg` — 4 lines
- Reviewed: full file (TAWA logo SVG).
- Findings: PASS — static SVG, no script.
- Tests: NOT TESTED.
- Gaps: verify no script in SVG (it has none).

### `web/js/api.js` — 66 lines
- Reviewed: full file (`fetch` wrapper, `x-tawa-csrf` header injection from `store.session.csrf`, `handleAuthError`).
- Findings: PASS (within scope) — API client sends `x-tawa-csrf` when `store.session` exists.
- Tests: NOT TESTED (no API client unit test).
- Gaps: verify CSRF header sent on every mutation; test missing header → 403.

### `web/js/icons.js` — 131 lines
- Reviewed: full file (Lucide icon helper, `t.innerHTML = icon(...)` 129 is static icon string, not user data).
- Findings: PASS — icon SVG is trusted, not user-supplied.
- Tests: NOT TESTED.
- Gaps: none security-relevant.

### `web/js/main.js` — 417 lines
- Reviewed: full file (boot, `loadBrand()` fetches `/api/v1/brand?host=...` → `store.brand`, `loadSession()` → `store.session`, router).
- Findings: FAIL P0 (indirect) — `loadBrand()` stores `business_name` from public endpoint into `store.brand` (tainted source). Sink is elsewhere but source chain starts here: `main.js:35-39` `store.brand = await fetch('/api/v1/brand').then(r=>r.json()).branding`.
- Tests: NOT TESTED (no brand-load test).
- Gaps: brand should be treated as untrusted; render as text.

### `web/js/pages/accounting.js` — 176 lines
- Reviewed: full file (ledger view, `fmtMoney` formatter).
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify accounting UI does not render HTML from journal memo.

### `web/js/pages/admin.js` — 187 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: audit admin UI for privilege escalation.

### `web/js/pages/ai.js` — 159 lines
- Reviewed: full file (AI chat `ask(v)` 44-80, `addMsg(q,a)` 48-59 does `h('div',{html: md.render(a)})` where `a` contains `store.brand.business_name` via `copilot()` + user input).
- Findings: FAIL P0 — stored: branding `business_name` inserted into AI answer; reflected: user question echoed. `md.render` not in this file but `ui.js:15` `html` prop → `innerHTML`. Isolated repro: branding payload `<img src=x onerror="window.xss=1">` + jsdom `dispatchEvent(new Event('error'))` → `inline_handler_executed:true`; reflected payload `<img src=x onerror="self['xss']=1">` via `ask()` → same. Required regression: `h('div',{}, text)` or sanitizer with `DOMPurify` allowlist (no event handlers, no `src` JS), plus CSP.
- Tests: legacy 0 coverage for AI XSS; jsdom repros confirmed (see continuation), **not** real-browser/CSP proof.
- Gaps: audit `server/modules/ai.js` to see if it escapes answer; it does not — answer is template literal with `${term}` raw.

### `web/js/pages/alerts.js` — 110 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify alerts do not render user HTML.

### `web/js/pages/analytics.js` — 67 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify no HTML sink.

### `web/js/pages/automation.js` — 59 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify automation UI not XSS.

### `web/js/pages/branches.js` — 46 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify branch name text-rendered.

### `web/js/pages/brokers.js` — 162 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify commission display.

### `web/js/pages/credit.js` — 93 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify credit UI tenant-isolated.

### `web/js/pages/customers.js` — 130 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify customer name text-rendered.

### `web/js/pages/dashboard.js` — 102 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify dashboard not rendering branding HTML.

### `web/js/pages/deliveries.js` — 129 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify delivery address text.

### `web/js/pages/expenses.js` — 94 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify expense description text.

### `web/js/pages/inventory.js` — 213 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify product name/sku text.

### `web/js/pages/marketing.js` — 225 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify marketing content not injecting.

### `web/js/pages/orders.js` — 213 lines
- Reviewed: title scan only.
- Findings: NOT TESTED — but `orders.js` likely renders `order.items[].name_snap` — must be text.
- Tests: NOT TESTED.
- Gaps: audit for `html` prop usage.

### `web/js/pages/payments.js` — 113 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify payment reference text.

### `web/js/pages/payroll.js` — 116 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify worker name text.

### `web/js/pages/pos.js` — 295 lines
- Reviewed: title scan only.
- Findings: NOT TESTED — critical POS page; must be audited line-by-line.
- Tests: NOT TESTED.
- Gaps: full POS audit, especially cart idempotency.

### `web/js/pages/procurement.js` — 271 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify supplier name text.

### `web/js/pages/products.js` — 150 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify product description not HTML.

### `web/js/pages/quotes.js` — 158 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify quote notes text.

### `web/js/pages/reports.js` — 77 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify CSV export not Formula injection.

### `web/js/pages/settings.js` — 513 lines
- Reviewed: lines 1-80 + search (branding form collects `business_name`, calls `PUT /api/v1/settings/branding`).
- Findings: FAIL P1 — settings form previews branding with live color/bname; if preview uses `innerHTML`, it mirrors sink. Not confirmed — need line-by-line.
- Tests: NOT TESTED.
- Gaps: full 513-line audit, verify no HTML preview.

### `web/js/pages/suppliers.js` — 114 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify supplier contact text.

### `web/js/pages/workforce.js` — 185 lines
- Reviewed: title scan only.
- Findings: NOT TESTED.
- Tests: NOT TESTED.
- Gaps: verify worker profile not HTML.

### `web/js/router.js` — 120 lines
- Reviewed: full file (hash router, `#/pos` → `pos`, etc.).
- Findings: PASS (within scope) — router matches hash prefix, no XSS.
- Tests: NOT TESTED.
- Gaps: verify route guards call `mustPerm` before render.

### `web/js/store.js` — 128 lines
- Reviewed: full file (`store.session`, `store.brand`, `store.tenantId`, `fetchWithAuth` adds CSRF header).
- Findings: PASS — store is in-memory, not persistent XSS.
- Tests: NOT TESTED.
- Gaps: verify tenantId never overwritten by client.

### `web/js/ui.js` — 342 lines
- Reviewed: full file (`h(tag, props, ...children)` 10-16: `if k==='html' el.innerHTML=v` else `textContent`, `spark()` 269-302 builds SVG string with `h('div',{html:svg})`, `vbars()` 304-318 same, `modal`/`drawer`/`toast` use `textContent` for user data).
- Findings: FAIL P0 — generic `html` sink: any caller passing untrusted `html` gets `innerHTML`. `ai.js:48` is the confirmed caller with tainted branding + user input. `spark`/`vbars` build SVG from numeric data (trusted) but escape `items[i].label` via `esc()` — good. Required regression: `h()` must not have `html` prop or must sanitize via `DOMPurify` with no event handlers; all text must use `textContent`; SVG helpers must escape labels (they do but add test).
- Tests: NOT TESTED (no UI unit tests).
- Gaps: audit every `h(...,{html:` call site (2 in ui.js + 1 in ai.js).

---

## Summary counts (2026-11-02 snapshot)

- **106 tracked files total** in TAWA source (excl. untracked).
- **Fully/partially reviewed with findings:** ~32 files (core, ledger, inventory, sales, payments, payouts, auth, tenancy, 5 migrations, ai, ui, settings, identity, files, app, config, etc.).
- **Title/scan only or NOT TESTED:** ~74 files (most frontend pages, 7 migrations not deep-dive, scripts/seed, docs). These are explicitly **not** approved.
- **Reproduced in isolation:** 5 P0s (CSRF via `resolveAuth`, duplicate reservation 1→2, stored+reflected XSS via jsdom event, journal line delete + false `ok:true`, rounding vs date-filter via arithmetic/SQLite). All repros are **isolated TAWA SQLite**, not Neon/Postgres; jsdom is **not** real browser.
- **Legacy suite:** 43/43 passed — coexistence with P0s proves suite is **insufficient**, not that defects are absent.

---

## Destination compatibility snapshot (Neon / Prisma / JATA AFTERCALL)

| Area | TAWA expectation | JATA AFTERCALL reality (2026-11-02) | Compatibility |
|---|---|---|---|
| Journal | `journal_entries` + `journal_lines` with `RAISE(ABORT)` triggers, `posted_at` set at insert, `doc_counters` per tenant | `prisma/schema.prisma:3052-3097` `ErpJournal` `status=DRAFT/POSTED/REVERSED`, `ErpJournalLine` with `businessId` FK only, `journalId`/`accountId` are plain strings (no Prisma `@relation`), `ErpJournal::nextDocumentNumber` in `lib/erp/accounting.ts:289-307` creates `POSTED` then loop-inserts lines → trigger naïvely blocking `POSTED`-line INSERT would break current flow; `reverseJournal:428` `UPDATE ErpJournal SET reversedById=` on POSTED row → blanket UPDATE block would break reversal link | **Incompatible as drafted** — needs two-phase lifecycle: `DRAFT` insert with lines, then `UPDATE status=POSTED, postedAt=now()` as sealing operation; trigger must allow line INSERT when parent `status=DRAFT`, block after `POSTED`; `reversedById` update must be allowed only via controlled reversal transaction (conditional trigger) |
| Ledger invariants | `postEntry` balances `SUM(debit)==SUM(credit)` after rounding; `trialBalance` date filters on `e.posted_at` | `lib/erp/accounting.ts:110-193` `validateJournal()` checks `debitCents+creditCents>0`, exclusive debit/credit, sum equality, integer cents; `loadAccounts` + `validateJournal` called before post; `assertPeriodOpen`/`ensurePeriod` gate | **Partially compatible** — `validateJournal` is gate but DB lacks `CHECK (debitCents>=0 AND creditCents>=0 AND (debitCents>0 OR creditCents>0) AND NOT (debitCents>0 AND creditCents>0))` and `UNIQUE(businessId, journalNumber)` exists in schema; needs period-close enforcement in DB |
| Inventory | `REAL` qty, `BEGIN IMMEDIATE`, single-writer | `PosProduct.quantity` `Float` still float; `StockLot`/`StockMovement` Prisma models use `Float`/`Int`; no `SELECT FOR UPDATE` in `lib/pos/inventory.ts` | **Needs exact precision** — switch to `Decimal` or integer minor units (e.g., milligrams), add composite FK `(businessId, productId)`, conditional `UPDATE ... WHERE on_hand - reserved >= qty` |
| Auth | scrypt, session cookie, 8-strikes LOCKED | `lib/auth.ts` uses NextAuth/Prisma? (not verified) — JATA has `User`/`Session` models with `sessionVersion` (since `20261018000000_password_reset_security`) | **Verify** — need proxy allowlist, distributed throttle, non-permanent lockout |
| Payments | `payment_intents` `UNIQUE(tenant_id, idempotency_key)` | `prisma/schema.prisma` `PosSale`/`PaymentTransaction` with `providerTransactionId` (CheckoutRequestID), not idempotent by payload | **Gap** — needs fingerprint column `payloadHash` + conflict detection |
| Pricing | TAWA Business 20000 minor units (~KES 200) / TRIAL / GRACE | JATA `lib/pricing.ts` canonical fallback `BUSINESS_POS: 499/30d`, `lib/pos/entitlement.ts` asserts `499/30`, `lib/erp/entitlement.ts` `ERP_PRO: 3000/30d`, `lib/autopilot/entitlement.ts` `2499/30d` | **Must keep separate** — `MJENGO_OS: 2000/30d` new entitlement must not grant/require POS and vice versa; preserve existing POS customers |

---

## What this register is NOT

- Not a line-by-line review of all 106 files (74 remain title-scan).
- Not a proof of fix (no code changed yet).
- Not a production readiness claim (explicitly **NO**).
- Not a push (these two docs are local untracked; PR #80 unchanged at `a1fc8c1`).

Next step: controlled remediation design in `MJENGO_AUDIT_CONTINUATION.md` — do **not** implement until gates agreed.
