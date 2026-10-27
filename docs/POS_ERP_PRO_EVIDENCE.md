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
| Prisma's native query engine (binaries.prisma.sh unreachable; GitHub release fallback empty) | `prisma generate` copies no native engine. Client **code** generates (verified, 111 models), and real SQL was executed through Prisma's WASM query engine + `@prisma/adapter-pg` (section 2.4). The native-engine path itself is only exercised in CI. |
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
What it does **not** prove: the native engine binary path (CI), row-lock concurrency (no two-connection
race test yet), or the production connection pooler (`sslmode`, Neon's `pgbouncer`).

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
| Independent CI | **PASS (workflow committed) / NOT TESTED (never executed)** — `.github/workflows/pos-erp-verify.yml` runs schema, generate, model check, types, unit suite, build, `migrate deploy`, the three migration scenarios and the database suite. It has not run on GitHub yet; see section 8. |

---

## 4. This pass: the ten database/verification items

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Inspect schema, migration history, DB scripts, guard tests | **PASS** | 111 models, 17 migration directories, `scripts/migrate.sh`, `tests/unit/erp-schema.test.ts`, `tests/unit/repair-guards.test.ts` reviewed |
| 2 | Disposable PostgreSQL using existing tooling | **PASS** | PostgreSQL 16.2 started from the `pgserver` wheel in a throw-away cluster under `/tmp`; no Docker, no root, no production credentials |
| 3 | Apply the migration: clean DB, upgrade path, rollback/recovery | **PASS** | `scripts/erp/migration-verify.sh all` → 24 PASS, 0 FAIL |
| 4 | Diagnose and resolve `prisma generate`; verify client matches schema | **PASS (client code) / BLOCKED (native engine)** | Cause: `binaries.prisma.sh` TLS reset + empty GitHub release list. `--no-engine` generation succeeds with stubbed engine paths; `check-models` compares 111 client models to 111 schema models and 76 call sites |
| 5 | Remove unsafe `any` typing in ERP query paths; make loaders match real models | **PASS (partial)** | `scripts/erp/check-models.ts` now gates every `prisma.<model>` reference and every `lib/db.ts` fallback entry; three real mismatches found and fixed (section 6). Remaining `any` is the deliberate `client: any` injection seam used to keep modules testable |
| 6 | Independent branch CI: validate, generate, types, migration, Vitest, build | **PASS (workflow) / NOT TESTED (run)** | `.github/workflows/pos-erp-verify.yml`; the existing E2E workflow only triggers on `main`, which is why PR #71 had no test job |
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
| 1 | CI workflow has never executed on GitHub | Watch the first run on PR #71; fix any environment drift it exposes |
| 2 | No real provider or KRA connection | Commercial decision: register an SMS/WhatsApp provider and a certified eTIMS adapter |
| 3 | No browser verification | Run the app in a browser (or a hosted preview) and capture the screens |
| 4 | External security review | Commission one; internal review is not a substitute |
| 5 | Rate limiter is per-instance memory | Move to a shared store before abuse protection is claimed |
| 6 | Payables / bank reconciliation / hardware adapters | Not built; disclosed in the UI as planned |
| 7 | Neon media storage and sale-price rule | Two owner decisions recorded in `RELEASE_DECISIONS.md` |
| 8 | Concurrency suite | Add two-connection tests for journals, orders and wallet reservations |

---

## 8. How to reproduce the CI result

```bash
gh workflow run "POS / ERP - PRO verify" --ref arena/7a3563c1-jata-aftercall
gh run list --workflow "POS / ERP - PRO verify" --limit 5
gh run watch <run-id>
```

The workflow is also triggered by any pull request. Its database job uses the `postgres:16` service
container, runs `prisma migrate deploy` and `prisma migrate status`, then the three migration
scenarios, then the database suite, and fails if the database suite skips.

Until that run is green, treat the CI row as `NOT TESTED`.
