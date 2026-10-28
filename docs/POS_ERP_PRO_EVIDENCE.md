# POS / ERP - PRO — evidence report

Product: **POS / ERP - PRO**, a separate premium product beside the existing Business POS.
Plan: `ERP_PRO`, **KES 3,000 / 30 days**, grace window 3 days after a paid month lapses.
Existing Business POS (`KES 499 / 30 days`) is untouched.

Report date: **2026-10-27**. Branch: `arena/7a3563c1-jata-aftercall`, PR
[#71](https://github.com/POWERBot-1/Jata-Aftercall/pull/71) (open, not merged). The PR carries the
current tip and the commit list; this document deliberately does not pin a SHA to itself.

**This revision replaces the earlier "database blocked" revision.** A disposable PostgreSQL 16.2
database was provisioned inside the build sandbox, the migration was executed, and a real-database
suite was added. Three defects that the mocked suites could not see were found and fixed (section 6).
The branch now also has its own CI: run
[40585281750](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40585281750) is **green** on
both jobs (static and database), so the native-engine path and `prisma migrate deploy` have been
exercised too.

---

## 0. How to read this report

| Label | Meaning |
| --- | --- |
| **PASS** | Implemented, and proven by a command in this environment that anyone can re-run |
| **FAIL** | Implemented, but a test or a build shows it does not work |
| **BLOCKED** | Not implemented, or not verifiable, because something outside this repository is missing (a credential, a certified integration, a browser) |
| **NOT TESTED** | Code exists and type-checks, but nothing in this environment could exercise it |

**No PASS in this report exists without a command in section 2 or a named test file.** Where a
control is only reasoned about, it is `NOT TESTED`.

### What this environment still cannot do

| Missing | Consequence |
| --- | --- |
| Prisma's native query engine (binaries.prisma.sh unreachable; GitHub release fallback empty) | `prisma generate` copies no native engine **in this sandbox**. Client code generates (111 models) and real SQL was executed through Prisma's WASM query engine + `@prisma/adapter-pg`. CI supplies the native engine and passes (run 40585281750). |
| A browser binary | No screenshot could be captured. Layout is verified by compiling, by CSS review and by HTTP status, not by pixels. |
| Provider credentials (SMS, WhatsApp, KRA eTIMS) | No live message, no live callback, no eTIMS submission. |
| Any approval to spend money or deploy | Nothing was deployed, no message was sent, nothing was purchased. |
| A shared rate-limit store | The limiter is per-instance memory (residual risk 3 in the security review). |

---

## 1. Scope delivered

| Area | Files |
| --- | --- |
| Domain libraries | `lib/erp/*.ts` (22 modules) — money, tax, accounting, invoicing, storefront, compliance, industry packs, entitlement, access, audit, sequences, automation, onboarding, bootstrap, workspace, loaders, team, etims, http, navigation |
| Messaging engine | `lib/messaging/*.ts` (10 modules) — segments, consent, templates, senderId, providers, billing, campaigns, pipeline, testSend, import |
| Schema | 38 new models in `prisma/schema.prisma`; one additive migration (1,038 lines) |
| Screens | `app/dashboard/erp/**` (16 pages), `app/store/**` (2 public pages) |
| API | 7 route handlers (status, messaging preview, campaign dispatch, accounting, export, public order, provider webhook) |
| Components | `components/erp/*` (4) |
| Unit tests | 17 suites, **292 tests** |
| Database tests | `tests/integration/erp-pro-postgres.test.ts`, **16 tests** against real PostgreSQL |
| Verification tooling | `scripts/erp/migrate-test-db.sh`, `scripts/erp/migration-verify.sh`, `scripts/erp/check-models.ts`, `scripts/erp/build-wasm-harness.sh` |
| CI | `.github/workflows/pos-erp-verify.yml` (static / migrations / PostgreSQL gates) |
| Docs | this report, `POS_ERP_PRO_MIGRATION_PLAN.md`, `POS_ERP_PRO_PROVIDER_COSTS.md`, `POS_ERP_PRO_SECURITY_REVIEW.md` |

---

## 2. Reproducible commands and exact results

Run from the repository root.

```bash
# 1. Types
npx tsc --noEmit
# → exit 0, no output

# 2. Schema
npx prisma validate
# → "The schema at prisma/schema.prisma is valid 🚀"   (sandbox needs the engine-path workaround below)

# 3. Client generation and schema/client agreement
PRISMA_SCHEMA_ENGINE_BINARY=<any existing file> PRISMA_QUERY_ENGINE_LIBRARY=<any existing file> \
  npx prisma generate --no-engine
# → "✔ Generated Prisma Client (v5.22.0, engine=none) to ./node_modules/@prisma/client in 1.44s"
npx tsx scripts/erp/check-models.ts
# → schema models: 111 / generated client models: 111 / ERP & messaging models: 38 /
#    models referenced by app code: 76 / Model consistency check PASSED

# 4. Migration on a disposable PostgreSQL 16.2 database
DATABASE_URL=postgresql://jata@127.0.0.1:5433/jata_test?schema=public \
  bash scripts/erp/migration-verify.sh all
# → 24 PASS, 0 FAIL, "RESULT: PASS (all migration scenarios)", exit 0
#    clean install: 16 migrations, 38 ERP tables, 74 pre-existing tables, 38 ERP foreign keys
#    upgrade path: 15 previous migrations + seeded user/business/product, ERP added, rows untouched
#    rollback: 38 tables exported and restored into a scratch database, dropped in documented
#    order, POS tables+rows intact, migration re-applied and 38 tables back

# 5. The new product's unit suites
npx vitest run tests/unit/erp-*.test.ts tests/unit/messaging-*.test.ts
# → Test Files 17 passed (17) / Tests 292 passed (292)

# 6. Database suite (real PostgreSQL, Prisma WASM engine + adapter-pg)
bash scripts/erp/build-wasm-harness.sh                     # once per sandbox; CI uses the native engine
PRISMA_TEST_DATABASE_URL=postgresql://jata@127.0.0.1:5433/jata_test \
PRISMA_WASM_HARNESS_DIR=$PWD/node_modules/.erp-wasm-harness \
  npx vitest run tests/integration/erp-pro-postgres.test.ts
# → Test Files 1 passed (1) / Tests 16 passed (16)

# 7. The whole repository (regression gate, no database configured)
npx vitest run
# → Test Files 163 passed | 11 skipped (174)
# → Tests      2033 passed | 110 skipped (2143)
# the 110 skips are the pre-existing database-backed suites plus the new one when no URL is set

# 8. Production build (offline/preview path)
npm run build
# → [build] Build completed successfully   (exit 0)
```

Per-suite unit counts (all green, unchanged from the feature commit):

| Suite | Tests | What it pins |
| --- | --- | --- |
| `erp-money-tax` | 12 | integer cents, rounding, VAT in/exclusive, tax type codes |
| `erp-tax` | 10 | dated rule registry, 14% era, unknown key refused |
| `erp-accounting` | 14 | balanced journals, reversal, trial balance, period close |
| `erp-accounting-invoicing` | 17 | posting immutability, closed period, invoice ledger, over-allocation, ageing |
| `erp-invoicing` | 17 | issue/receipt/credit note lifecycle, idempotency |
| `erp-entitlement` | 15 | paid-payment provisioning, grace, no double-extend |
| `erp-entitlement-access` | 23 | 6 roles × 27 permissions, approval caps, denials audited, nav filtering |
| `erp-team` | 17 | ERP roles stored outside the POS column, no self-change, no ADMIN minting |
| `erp-storefront` | 20 | signed refs, server-side pricing, stock on confirm, order transitions |
| `erp-automation-onboarding` | 17 | preview-first engine, approval gate, kill switch, derived setup progress |
| `erp-etims` | 18 | fail-closed adapter, no acceptance without KRA control number, no duplicate fiscal doc |
| `erp-schema` | 13 | 38 tables, additive-only SQL, required unique indexes, stub parity |
| `messaging-core` | 30 | GSM-7/UCS-2 segments, tariffs, status machines, import |
| `messaging-segments-consent` | 18 | eligibility codes, consent evidence, suppression, quiet hours, frequency cap |
| `messaging-campaigns` | 19 | draft → approval, cost confirmation, reservation, tenancy |
| `messaging-dispatch` | 15 | CAS claim, UNKNOWN + reconcile, breaker, kill switch, HMAC callbacks |
| `messaging-sender-id` | 17 | 12-status machine, KYC items, fees disclosed not charged, outbound-only |
| **Total** | **292** | |

### 2.4 What "real PostgreSQL" means here

The database suite runs the production modules (`bootstrapErpWorkspace`, `requireErpAccess`,
`setTeamRole`, `placeStoreOrder`, `confirmStoreOrder`, `advanceStoreOrder`, `postJournal`,
`closePeriod`, `reopenPeriod`, `reverseJournal`, `createInvoice`, `issueInvoice`, `recordPayment`,
`creditWallet`, `reserveFunds`, `walletSummary`, `commitImport`, `submitInvoiceToEtims`) against a
migrated PostgreSQL 16.2 database, with **Prisma's own query engine compiled to WebAssembly** and the
official `@prisma/adapter-pg` driver.

What that proves: real SQL, real constraints, real unique indexes, real transactions and rollbacks.
The same suite also ran in CI with the **native** engine against a `postgres:16` service container
after `prisma migrate deploy`, and passed (run 40585281750), so both engine paths are covered.
What is still **not** proven: row-lock concurrency (no two-connection race test yet) and the
production connection pooler (Neon's pgbouncer, `sslmode`).

---

## 3. Item-by-item status

### 3.1 Commercial separation from the existing POS

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Distinct premium plan at KES 3,000/30d | **PASS** | `ERP_PLAN_COMMERCIALS`; asserted in `erp-entitlement` |
| Existing POS untouched (no rename, no behaviour change) | **PASS** | `repair-guards`; migration adds no `Pos*` table and alters none; upgrade-path rehearsal keeps the POS rows |
| Existing POS subscription still KES 499 | **PASS** | `erp-entitlement` asserts both price points side by side |
| Product off by default in production | **PASS** | `erpFeatureEnabled()`; screens return 503 `PRODUCT_DISABLED` |
| Entitlement only from a verified PAID payment | **PASS** | provisioning tests; a notification alone cannot activate |
| Grace window, then lock | **PASS** | grace only after expiry, never when `EXPIRED` |

### 3.2 Universal ERP core

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Customers, contacts, consent, suppression | **PASS** | messaging + consent suites; contact import de-duplication verified against real unique indexes |
| Catalogue and stock reuse (no second price list) | **PASS** | storefront reads `PosProduct`/`PosInventoryItem`; the pricing shape defect found by the database suite is fixed (section 6.2) |
| Suppliers, purchases | **BLOCKED** | surfaces reuse the POS screens; no ERP-specific procurement workflow was built |
| Branches, staff | **PASS (reuse)** | nav routes to the existing POS screens |
| Chart of accounts, journals, periods | **PASS** | accounting suites + database suite |
| Expenses | **PASS** | expense → journal tests |
| Payables / supplier bills | **BLOCKED** | model exists (`ErpSupplierBill`), no UI or workflow in this release |
| Bank reconciliation | **BLOCKED** | not implemented |
| Hardware adapter layer (printer, scale, drawer) | **BLOCKED** | not implemented; nav lists it as PLANNED with an honest note |
| 20 industry packs | **PASS (as scoped)** | 20 packs defined and selectable; only `retail` is marked TESTED, others disclosed as IN DEVELOPMENT/BLOCKED |

### 3.3 Accounting rules

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Debits = credits or nothing posts | **PASS** | `validateJournal` + database suite ("refuses an unbalanced journal") |
| Posted entries immutable; corrections by reversal | **PASS** | no update path; `reverseJournal` writes a mirrored `RJV-` and links it from the original; database suite asserts the original stays `POSTED` and a second reversal is refused |
| Closed period refuses new entries | **PASS** | `closePeriod` / `reopenPeriod` with a reason; database suite asserts `PERIOD_CLOSED` then a successful post after reopening |
| Trial balance, P&L, balance sheet | **PASS** | computed from posted lines; trial balance balances after real posts |
| Invoice/document numbers per tenant | **PASS** | `ErpSequence`; database suite asserts `INV-\d{6}`, `JV-\d{6}`, `RJV-` and a duplicate number rejected by the database (`P2002`) |
| Posting under two-connection concurrency | **NOT TESTED** | the database suite is sequential; no race test yet |

### 3.4 Tax (Kenya)

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| 16% / 0% / exempt handled, dated rules | **PASS** | `erp-tax`, `erp-money-tax`; 16% inclusive extraction verified end-to-end (KES 500.00 gross → KES 68.97 VAT) in the database suite |
| Historical 14% era | **PASS** | keyed `VAT_STANDARD_14` |
| Unknown tax key refuses the invoice | **PASS** | `TAX_RULE_MISSING` |
| eTIMS tax type codes A–E | **PASS** | `etimsTaxTypeCode` |
| Statutory correctness of the rates | **NOT TESTED** | defaults carry `verified: false`; no accountant review |
| VAT registration threshold logic | **BLOCKED** | not implemented — the product does not decide whether a merchant must register |

### 3.5 Messaging engine

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| GSM-7 160/153, UCS-2 70/67 segmentation | **PASS** | `messaging-core` |
| Cost estimation and confirmation before send | **PASS** | campaigns suite |
| Durable queue (in database) | **PASS** | `MsgCampaignRecipient` + CAS claim |
| Idempotency per recipient | **PASS** | dispatch suite; wallet credit idempotency verified against the real unique index in the database suite |
| Consent required for marketing | **PASS** | segments/consent suite |
| Suppression beats consent, re-checked at dispatch | **PASS** | dispatch suite |
| Quiet hours 08:00–20:00 Nairobi | **PASS** | delays, does not drop |
| Frequency cap | **PASS** | 4 per 30 days |
| Sender ID: 12-status machine, provider owns approval | **PASS** | sender-ID suite |
| Alphanumeric Sender ID = outbound only | **PASS** | `replyCapability`; asserted |
| Wallet: CAS, no auto top-up, no overspend | **PASS** | dispatch suite; database suite asserts one credit per idempotency key and an over-reservation refused |
| Unknown outcome → reconcile before retry | **PASS** | dispatch suite |
| Circuit breaker | **PASS** | pauses after repeated failures |
| Live sending | **BLOCKED** | refuses unless `MESSAGING_LIVE_ENABLED=true` and a live adapter is registered; none is |
| Live provider delivery | **NOT TESTED** | no credentials, no traffic |
| Campaign dispatch end-to-end against the database | **NOT TESTED** | needs an approved sender ID + channel connection + audience; covered by mocks only |

### 3.6 Public storefront

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Public ordering page per business | **PASS** | storefront suite; dev-server smoke test returned 200 for a closed shop |
| Signed product references (no ids in HTML) | **PASS** | 22-char HMAC refs |
| Server-side repricing | **PASS** | tampered basket ignored |
| Real catalogue pricing | **PASS** | database suite places an order against a real `PosProduct` row and asserts KES 500.00 subtotal + KES 68.97 tax |
| Stock deducted only on confirmation, once | **PASS** | database suite: stock 10 → 8 on confirm, unchanged on a repeated confirm, movement row written |
| Order state machine | **PASS** | database suite walks `PENDING → CONFIRMED → READY → FULFILLED` and refuses a terminal-state transition |
| Duplicate order prevention | **PASS** | database suite: same idempotency key returns the same order, one row |
| Customer order tracking page | **PASS** | `/store/order/[token]`, last-3-digits masking |
| Honeypot + rate limit | **PASS** | route + suite |
| Payments in the shop | **BLOCKED** | deliberately not enabled; customer pays on delivery/collection |
| Screenshots | **BLOCKED** | no browser binary in this environment |

### 3.7 Automations, approvals, RBAC, audit

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Rules engine, preview-first | **PASS** | automation suite |
| High-impact actions need a human | **PASS** | engine refuses even if a row is written directly |
| Daily run caps, kill switch | **PASS** | suite |
| Sending a message from automation | **BLOCKED** | `SEND_TEMPLATE` is marked unimplemented and refused at save time |
| 6 roles × 27 permissions | **PASS** | access suite; database suite asserts STAFF is denied `POST_JOURNAL` (403) and OWNER is allowed |
| Approval caps by role | **PASS** | access suite |
| Separation of duties | **PASS** | campaigns suite |
| Team role stored outside `BusinessMember.role` and read back | **PASS** | database suite: `setTeamRole` writes `ErpConfiguration.teamRolesJson`, `requireErpAccess` returns `FINANCE` for the same session |
| Audit trail with secret redaction | **PASS** | audit module + team suite asserting `TEAM_ROLE_CHANGED`; database suite asserts audit rows for order/journal actions |
| Role management UI + server action | **PASS** | settings page; `setTeamRole` tested |

### 3.8 Onboarding

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| 12 steps derived from stored facts | **PASS** | onboarding suite |
| Provider-dependent step shows "waiting", never blocks | **PASS** | suite |
| Bootstrap persists configuration, 24 accounts, tax rules, wallet | **PASS** | database suite asserts exact counts after `bootstrapErpWorkspace` |
| Bootstrap is idempotent | **PASS** | database suite: second call keeps one configuration and the same account count |
| Mobile-first guided setup screen | **PASS (rendered) / NOT TESTED (visually)** | `/dashboard/erp/[businessId]/onboarding` compiles and is in the build manifest; no screenshot |

### 3.9 eTIMS

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Prepared and validated locally | **PASS** | `validateEtimsPayload` + eTIMS suite |
| Submission enabled | **BLOCKED** | no certified adapter; flag + key required; both off |
| Acceptance claim requires KRA control number | **PASS** | `assertAuthoritativeAcceptance`; database suite asserts a self-reported acceptance is not recorded as accepted |
| Timeout never becomes a rejection | **PASS** | `UNCERTAIN`, persisted on the invoice row in the database suite |
| Duplicate fiscal document prevented | **PASS** | no `UNCERTAIN → SUBMITTING` edge |
| Any real KRA response | **NOT TESTED** | no credentials, no certification |
| Submission posture | **PASS** | `etimsSubmissionPosture().canSubmit === false` asserted |

### 3.10 Industry packs and sectors

| Item | Status |
| --- | --- |
| 20 packs defined, selectable, per-role nav filtered | **PASS** |
| `retail` pack marked TESTED | **PASS** (as a label; no sector was independently verified) |
| Restaurant, e-commerce, multi-entity | **IN DEVELOPMENT** (disclosed in the UI) |
| Pharmacy, property, hotel, healthcare, import-export, NGO, financial, utilities, public sector | **BLOCKED** (disclosed in the UI) |
| Independent verification of any sector | **NOT TESTED** |

### 3.11 Observability, backups, DR

| Item | Status | Limitation |
| --- | --- | --- |
| `/api/erp/[businessId]/status` | **PASS** | returns 401 unauthenticated (verified over HTTP) |
| Audit trail as an event log | **PASS** | write-side tested |
| Export of the ERP tables (`pg_dump`) | **PASS** | rollback rehearsal exported 38 tables and restored them into a scratch database with matching row counts |
| Backup and drill for the whole database | **BLOCKED** | no backup target, no schedule, no retention policy; the rehearsal covered the ERP tables only |
| Load / soak test | **NOT TESTED** | no environment |
| Alerting | **BLOCKED** | no APM added (no budget approval) |

### 3.12 Deliverables

| Deliverable | Status |
| --- | --- |
| Working implementation | **PASS** (code, 292 unit tests, 16 database tests, green build) |
| Distinct plan / entitlements | **PASS** |
| Schema + migration + rollback plan | **PASS** — executed on a disposable database: clean install, upgrade path, rollback and recovery |
| Tests with reproducible commands | **PASS** (section 2) |
| Responsive screenshots | **BLOCKED** — no browser binary; layout is CSS-verified only |
| Provider cost comparison | **PASS** — `POS_ERP_PRO_PROVIDER_COSTS.md`, rates unverified |
| Security review | **PASS (self-review)** — `POS_ERP_PRO_SECURITY_REVIEW.md`, internal only, no external audit |
| Independent CI | **PASS** — `.github/workflows/pos-erp-verify.yml` ran green on this branch: [run 40585281750](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40585281750), job "Schema, types, unit suite, build" 2m13s and job "Migrations and PostgreSQL suite" 1m13s. |

---

## 4. This pass: the ten database/verification items

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Inspect schema, migration history, DB scripts, guard tests | **PASS** | 111 models, 17 migration directories, `scripts/migrate.sh`, `tests/unit/erp-schema.test.ts`, `tests/unit/repair-guards.test.ts` reviewed |
| 2 | Disposable PostgreSQL using existing tooling | **PASS** | PostgreSQL 16.2 started from the `pgserver` wheel in a throw-away cluster under `/tmp`; no Docker, no root, no production credentials |
| 3 | Apply the migration: clean DB, upgrade path, rollback/recovery | **PASS** | `scripts/erp/migration-verify.sh all` → 24 PASS, 0 FAIL |
| 4 | Diagnose and resolve `prisma generate`; verify client matches schema | **PASS** | Cause: `binaries.prisma.sh` TLS reset + empty GitHub release list (sandbox only). `--no-engine` generation succeeds with stubbed engine paths; `check-models` compares 111 client models to 111 schema models and 76 call sites; CI generates with the real engine and passes |
| 5 | Remove unsafe `any` typing in ERP query paths; make loaders match real models | **PASS (partial)** | `scripts/erp/check-models.ts` now gates every `prisma.<model>` reference and every `lib/db.ts` fallback entry; three real mismatches found and fixed (section 6). Remaining `any` is the deliberate `client: any` injection seam used to keep modules testable |
| 6 | Independent branch CI: validate, generate, types, migration, Vitest, build | **PASS** | `.github/workflows/pos-erp-verify.yml` — green run [40585281750](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40585281750). The pre-existing E2E workflow only triggers on `main`, which is why PR #71 previously had no test job. Three earlier runs failed on workflow-file issues (unquoted step name, missing `DATABASE_URL` for validation); both are fixed and the fourth run is green |
| 7 | PostgreSQL integration tests for the eight named areas | **PASS** | 16 tests in `tests/integration/erp-pro-postgres.test.ts` covering onboarding persistence, role enforcement, tenant isolation, order transitions, accounting safeguards, messaging idempotency, eTIMS uncertainty and duplicate prevention |
| 8 | Browser E2E, or an honest limitation | **BLOCKED** | no browser binary is installed and none can be downloaded in this sandbox; no screenshot is claimed |
| 9 | Re-run everything and report exact commands, exit codes, counts | **PASS** | section 2 |
| 10 | Update `RELEASE_BLOCKERS.md` with evidence-based statuses | **PASS** | ERP section rewritten with the new evidence |

---

## 5. What the database work changed in the product (defects found)

The mocked suites could not see any of these; the real database did.

| # | Defect | Impact | Fix |
| --- | --- | --- | --- |
| 6.1 | `bootstrapErpWorkspace` wrote `ErpTaxRule.notes`, a column that did not exist | **Every new ERP workspace would fail to set up** (Prisma validation error → 500) | Column added to the model and to the migration's `ErpTaxRule` table definition |
| 6.2 | `placeStoreOrder`/`loadPublicCatalogue` passed a `PosProduct` (which stores `priceKES`) into a pricing helper that reads `basePriceKES` | **No catalogue item could ever be sold** — every product reported "no price right now" | `pricedProductForSale()` adapter with a comment naming the mismatch; the database suite now orders against a real product row |
| 6.3 | `lib/db.ts` had no offline fallback for `prisma.paymentEvent` | Offline/preview build of `/admin/payments/wallet` threw a `TypeError` instead of showing an empty history | Fallback entry added; `check-models` now fails CI if a referenced model has no fallback |

---

## 6. Limitations a reader must not skip

1. **No production database was touched.** All database evidence comes from a disposable local
   cluster. The rehearsal covers SQL and schema behaviour, not Neon's pooler, extensions, backup or
   restore-from-snapshot.
2. **The native Prisma engine never ran here.** Client code generation and real SQL execution are
   both proven, but through the WASM engine. The CI workflow is the first place the native path will
   run.
3. **No concurrency evidence.** No two-connection race test exists for journals, orders or wallet
   reservations; row locks and serialization are argued from the schema, not measured.
4. **No live messaging, payment or KRA traffic.** Delivery statistics are zero because nothing was
   sent.
5. **No screenshots.** Screens were verified by compiling them and by HTTP status/redirect
   behaviour, not by looking at them.
6. **Tax and statutory positions are unverified.** Default rates carry `verified: false`; no
   accountant or signed KRA source was used.
7. **Nothing was merged or deployed.** PR #71 is open against `arena/33ebb805-jata-aftercall`.

---

## 7. Remaining blockers before this is production-ready

| Priority | Blocker | Owner action |
| --- | --- | --- |
| 1 | No real provider or KRA connection | Commercial decision: register an SMS/WhatsApp provider and a certified eTIMS adapter |
| 2 | No browser verification | Run the app in a browser (or a hosted preview) and capture the screens |
| 3 | External security review | Commission one; internal review is not a substitute |
| 4 | Rate limiter is per-instance memory | Move to a shared store before abuse protection is claimed |
| 5 | Payables / bank reconciliation / hardware adapters | Not built; disclosed in the UI as planned |
| 6 | Neon media storage and sale-price rule | Two owner decisions recorded in `RELEASE_DECISIONS.md` |
| 7 | Concurrency suite | Add two-connection tests for journals, orders and wallet reservations |
| 8 | Rehearsal on the provider's PostgreSQL | The rehearsal used a local PG 16.2/CI container, not Neon's pooler or extensions |

---

## 8. CI result and how to reproduce it

**Green on this branch:** [run 40585281750](https://github.com/POWERBot-1/Jata-Aftercall/actions/runs/40585281750)
at `2baf9d5`.

| Job | Result | Steps |
| --- | --- | --- |
| Schema, types, unit suite, build | **pass** (2m13s) | install → `prisma validate` → `prisma generate` → `check-models` → typecheck → unit suite → production build |
| Migrations and PostgreSQL suite | **pass** (1m13s) | `postgres:16` service → create verification DB → `npm ci` → `prisma generate` → `prisma migrate deploy` + `migrate status` → migration scenarios (24 PASS) → ERP PostgreSQL suite (16 tests, no skips) → upload logs |

`gh pr checks 71` therefore shows four green checks: the two jobs above plus the Vercel deployment
and Vercel Preview Comments.

```bash
gh workflow run "POS / ERP - PRO verify" --ref arena/7a3563c1-jata-aftercall
gh run list --workflow "pos-erp-verify.yml" --limit 5
gh run watch <run-id> --exit-status
```

The workflow is triggered by any pull request. Its database job fails if the PostgreSQL suite
reports a skip, so a green check means the tests actually ran.

---

## 9. Merge with `main` — post-merge re-verification (2026-10-28)

The branch was rebased onto main by merging it, because main moved 358 commits ahead and the
review has to run on the runtime main ships.

| Item | Value |
| --- | --- |
| Merge commit | `c30ae8d` (parents `dc52390` on the branch, `a04124d` on `main`) |
| Follow-up commits | `0c93d45`, `595320e`, plus the documentation commit that carries this section |
| PR base | retargeted from `arena/33ebb805-jata-aftercall` to **`main`** (`PATCH /pulls/71 {base: main}`) |
| Runtime | Next **16.4.2**, React 18.3.1, Prisma **5.22.0**, Vitest **4.1.12**, Node 22.22.3 |
| Schema | 124 models (main's 86 + 38 ERP/messaging), `prisma validate` clean, 0 duplicates |
| Migrations | 21 in the chain; 87 pre-existing tables; 125 tables total after the ERP migration |

### 9.1 Conflicts and how each was resolved

| File | Resolution |
| --- | --- |
| `package.json`, `package-lock.json` | Union of scripts on main's lockfile (`next` 16.4.2, `vitest` 4.1.12) |
| `lib/db.ts` | Main's stubs plus the 38 ERP/messaging stubs; `passwordResetToken` was missing and was added |
| `prisma/schema.prisma` | Main's 86 models plus the 38-model ERP block |
| `tests/unit/repair-guards.test.ts` | Union of the migration lists (5 main + `20261027000000_pos_erp_pro`) |
| `.env.example` | ERP Pro block, then main's commented JATA Qi seam |
| `app/globals.css` | Main's stylesheet, **without** the ERP block (see 9.2) |
| `RELEASE_BLOCKERS.md` | Main's current-worktree disclaimer, then the ERP register |

### 9.2 Design restoration (owner correction)

Main withdrew the graphite/electric-lime rebrand and pinned the original espresso / cream / amber
identity with `tests/unit/original-design-restoration-2026.test.ts` (bans `#b6ff2e`, `#4d6b12`,
`#16181d`, `#1b1e24` in `app/globals.css`) and `tests/unit/workspace-status-tokens.test.ts`
(no hex literal after `.ws-notice {`). ERP Pro therefore no longer ships its own palette:

- the ERP stylesheet moved to **`app/erp.css`**, imported from `app/layout.tsx` after `globals.css`;
- every ERP colour is now a `--jata-*` alias (`--erp-ink`, `--erp-accent`, `--erp-espresso`,
  `--erp-on-espresso`, …), so the ERP follows the product theme in light and dark with no second
  palette to maintain;
- the withdrawn dark-mode override block is deleted (the aliases inherit the theme);
- the last lime literals (`rgba(182,255,46,…)` hero border, glow and chip) became
  `color-mix()` expressions over `--jata-accent`.

**Consequence, stated plainly:** ERP Pro is no longer "premium graphite". It renders in the
original brand identity because the owner withdrew that rebrand for the whole product.

### 9.3 Hydration determinism

`tests/unit/booking-time-display.test.ts` and `tests/unit/hydration-determinism.test.ts` ban
`toLocale*` in the ERP surfaces. All **33** call sites now use the pinned helpers:
`formatDate`, `formatDateTime`, `formatNumber`, `formatKES` and the new `nairobiHour()` in
`lib/dateFormat.ts` (re-exported from `lib/format.ts`) for the greeting hour.

### 9.4 Defects the merged gates found, and the fixes

| Gate | Finding | Fix |
| --- | --- | --- |
| `pos-erp-verify` static → `check-models` | `lib/password-reset.ts` (from main) calls `prisma.passwordResetToken`, which the merged offline fallback did not cover | added the stub: reads empty, writes throw |
| `migration-verify.sh` (local) | two rollback assertions pinned "74 pre-existing tables"; main's five new migrations make it 87, so a healthy migration reported FAIL | the baseline is now **measured** from the migrations that precede the ERP one |
| `Release Validation` → drift, reconciliation, candidate rehearsal | 76 findings, two per ERP table: `prisma migrate diff` saw a unique index on `id` that the datamodel never declares | removed the 38 redundant `"<Table>_id_key"` indexes — the primary key already guarantees uniqueness. The migration now creates 38 tables, **34** unique indexes, 64 plain indexes, 38 foreign keys |
| `Release Validation` → Static (lint) and `Journey` → lint | 4 `react-hooks/error-boundaries` errors: `app/store/[slug]` built JSX inside a `try` | fetch inside `try`, render after it; behaviour unchanged |
| `pos-erp-verify` static → unit suite | the suite asserts the runtime and a Node 20 runner is below it | the workflow now runs Node **22.22.3**, like main's own workflows |

### 9.5 Verification on the merged tree (`595320e`)

```bash
npm run lint          # → 0 errors, 42 warnings (all pre-existing, none introduced here)
npx tsc --noEmit      # → exit 0
npx vitest run        # → Test Files 260 passed | 16 skipped (276)
                      #   Tests      3399 passed | 137 skipped (3536), exit 0
npx tsx scripts/erp/check-models.ts
                      # → 124 schema models = 124 client models, 38 ERP/messaging, 90 referenced, PASSED
npm run build         # → "[build] Build completed successfully" (Next 16.4.2), 17 ERP routes in the manifest
bash scripts/erp/migration-verify.sh all
                      # → 24 PASS / 0 FAIL (21 migrations, 38 ERP tables, 87 pre-existing, 125 total)
PRISMA_TEST_DATABASE_URL=… PRISMA_WASM_HARNESS_DIR=… npx vitest run tests/integration/erp-pro-postgres.test.ts
                      # → 16 passed (16), WASM query engine + @prisma/adapter-pg
```

Local sandbox notes, unchanged in substance: the native Prisma engine still cannot be downloaded
here (so the database suite runs on the WASM engine, and the unit suite needs the `--no-engine`
client — a client generated against the missing native engine throws 42 unhandled
`PrismaClientInitializationError`s that are a sandbox artefact, not test failures). CI runs the
native path: `Migrations and PostgreSQL suite` executed `prisma migrate deploy` and the 16-test suite
with **no skips**.

### 9.6 CI on the merge head

| Check (workflow) | Result on `595320e` |
| --- | --- |
| Schema, types, unit suite, build (`pos-erp-verify`) | **PASS** |
| Migrations and PostgreSQL suite (`pos-erp-verify`) | **PASS** (native engine, 16 tests, no skips) |
| Static (install, generate, lint, typecheck, audit) | **PASS** |
| Migrations + schema on PostgreSQL 18 | **PASS** |
| Production build path on PostgreSQL 18 | **PASS** |
| Failure paths actually fail | **PASS** |
| Schema reconciliation proposal closes the drift | **PASS** |
| Exact candidate applies on disposable PostgreSQL 18 | **PASS** |
| D2 — build, audit and controls on the candidate tree | **PASS** |
| Migration target guard | **PASS** |
| Real-Chrome six-viewport capture on a disposable database | **PASS** — CI-captured browser evidence for the responsive layout |
| Release gate (aggregate) | **PASS** |
| **Journey against a real database** | **FAIL** — step "Actual storefront Motion and immersive browser regressions", exit 1 |
| Vercel / Vercel Preview Comments | PASS |

**The one red check is unresolved, and it is honest to say so.** The GitHub log and artifact
endpoints are not reachable from this sandbox (`results-receiver.actions.githubusercontent.com`
returns EOF, `gh run rerun` is refused), so the failing assertion inside that step could not be
read. The same six commands the step runs were executed here against a real Chromium 153
(`@sparticuz/chromium`, `LD_LIBRARY_PATH` from its `al2023` libs) and a `next dev --webpack` server,
**twice**: once with no database and once with a live migrated PostgreSQL. Both runs passed every
assertion:

| Script | Result |
| --- | --- |
| `test:browser:motion` | 124 passed, 0 failed |
| `test:browser:immersive` | 22 passed, 0 failed |
| `test:browser:layout` | 7 passed, 0 failed |
| `test:browser:actionbar` | 37 passed, 0 failed |
| `test:browser:families` | 167 passed, 0 failed |
| `test:browser:media-local` | 29 passed, 0 failed |

That is 386 assertions, 0 failures, on the same head. It makes an ERP-caused regression unlikely but
it does **not** prove the CI step can pass; the check stays red until a run shows it green, so the
merge gate below is BLOCKED rather than PASS.
