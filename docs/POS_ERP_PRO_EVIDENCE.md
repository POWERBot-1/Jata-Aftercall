# POS / ERP - PRO — evidence report

Product: **POS / ERP - PRO**, a separate premium product beside the existing Business POS.
Plan: `ERP_PRO`, **KES 3,000 / 30 days**, grace window 3 days after a paid month lapses.
Existing Business POS (`KES 499 / 30 days`) is untouched.

Report date: **2026-10-27**. Branch: `arena/7a3563c1-jata-aftercall`. Base commit: `77e35ce`.
Feature commit: `367032c`. Pull request: [#71](https://github.com/POWERBot-1/Jata-Aftercall/pull/71)
(open, mergeable, not merged). Later commits on the branch are documentation-only, so check the PR
for the current tip.

---

## 0. How to read this report

Every row is labelled one of:

| Label | Meaning |
| --- | --- |
| **PASS** | Implemented, and proven by a command in this environment that anyone can re-run |
| **FAIL** | Implemented, but a test or a build shows it does not work |
| **BLOCKED** | Not implemented, or not verifiable, because something outside this repository is missing (a database, a credential, a certified integration) |
| **NOT TESTED** | Code exists and type-checks, but nothing in this environment could exercise it |

**This report contains no PASS that is not backed by a command in section 2.** Where a control is
only reasoned about, it is `NOT TESTED`, not `PASS`.

### What this environment could not do

| Missing | Consequence |
| --- | --- |
| A PostgreSQL database | The migration has never run. No DAO-level integration test could run. All 94 database-backed tests **skipped**. |
| `prisma generate` (blocked binary download) | The Prisma client used by loaders and server actions is an offline stub, so their query shapes are **unverified at runtime**. |
| A browser binary | No screenshot could be captured. Layout is verified by reading CSS and by HTTP responses, not by pixels. |
| Provider credentials (SMS, WhatsApp, M-PESA, KRA eTIMS) | No live message, no live callback, no eTIMS submission. |
| Any approval to spend money or deploy | Nothing was deployed, no message was sent, nothing was purchased. |

---

## 1. Scope delivered

| Area | Files |
| --- | --- |
| Domain libraries | `lib/erp/*.ts` (21 modules) — money, tax, accounting, invoicing, storefront, compliance, industry packs, entitlement, access, audit, sequences, automation, onboarding, bootstrap, workspace, loaders, team, etims, http, navigation |
| Messaging engine | `lib/messaging/*.ts` (10 modules) — segments, consent, templates, senderId, providers, billing, campaigns, pipeline, testSend, import |
| Schema | 38 new models in `prisma/schema.prisma`; one additive migration |
| Screens | `app/dashboard/erp/**` (16 pages incl. guided setup, orders, campaigns), `app/store/**` (2 public pages) |
| API | 7 route handlers (status, messaging preview, campaign dispatch, accounting, export, public order, provider webhook) |
| Components | `components/erp/*` (4) |
| Tests | 17 new suites, **292 tests** |
| Docs | this report, `POS_ERP_PRO_MIGRATION_PLAN.md`, `POS_ERP_PRO_PROVIDER_COSTS.md`, `POS_ERP_PRO_SECURITY_REVIEW.md` |

---

## 2. Reproducible commands and their exact results

Run from the repository root.

```bash
# 1. Types
npx tsc --noEmit
# → exit 0, no output

# 2. The new product's suites
npx vitest run tests/unit/erp-*.test.ts tests/unit/messaging-*.test.ts
# → Test Files 17 passed (17)
# → Tests      292 passed (292)

# 3. The whole repository (regression gate)
npx vitest run
# → Test Files 163 passed | 10 skipped (173)
# → Tests      2033 passed | 94 skipped (2127)
# the 94 skips are the pre-existing DATABASE_URL-backed suites

# 4. Production build (type-check + lint + compile)
npm run build
# → ✓ Compiled successfully in 27.1s
# → Linting and checking validity of types ...
# → [build] Build completed successfully
```

Per-suite counts (all green):

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

---

## 3. Item-by-item status

### 3.1 Commercial separation from the existing POS

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Distinct premium plan at KES 3,000/30d | **PASS** | `ERP_PLAN_COMMERCIALS`; asserted in `erp-entitlement` |
| Existing POS untouched (no rename, no behaviour change) | **PASS** | `repair-guards` asserts all `Pos*` models still exist and the migration creates no `Pos*` table and alters none; full suite green |
| Existing POS subscription still KES 499 | **PASS** | `erp-entitlement` asserts both price points side by side |
| Product off by default in production | **PASS** | `erpFeatureEnabled()`; screens return 503 `PRODUCT_DISABLED` |
| Entitlement only from a verified PAID payment | **PASS** | provisioning tests; a notification alone cannot activate |
| Grace window, then lock | **PASS** | grace only after expiry, never when `EXPIRED` |

### 3.2 Universal ERP core

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Customers, contacts, consent, suppression | **PASS** | messaging + consent suites |
| Catalogue and stock reuse (no second price list) | **PASS** | storefront reads `PosProduct`/`PosInventoryItem`; sale-price window logic untouched |
| Suppliers, purchases | **BLOCKED** | surfaces reuse the POS screens; no ERP-specific procurement workflow was built |
| Branches, staff | **PASS (reuse)** | nav routes to the existing POS screens |
| Chart of accounts, journals, periods | **PASS** | accounting suites |
| Expenses | **PASS** | expense → journal tests |
| **Payables / supplier bills** | **BLOCKED** | model exists (`ErpSupplierBill`), no UI or workflow in this release |
| **Bank reconciliation** | **BLOCKED** | not implemented |
| **Hardware adapter layer (printer, scale, drawer)** | **BLOCKED** | not implemented; nav lists it as PLANNED with an honest note |
| **20+ industry packs** | **PASS (as scoped)** | 20 packs defined and selectable; only `retail` is marked TESTED, others `IN DEVELOPMENT`/`BLOCKED` — see 3.10 |

### 3.3 Accounting rules

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Debits = credits or nothing posts | **PASS** | `validateJournal` |
| Posted entries immutable; corrections by reversal | **PASS** | no update path; `reverseJournal` writes a mirrored `RJV-` |
| Closed period refuses new entries | **PASS** | `closePeriod` / `reopenPeriod` with a reason |
| Trial balance, P&L, balance sheet | **PASS** | computed from posted lines |
| Posting under database concurrency | **NOT TESTED** | needs a real PostgreSQL; the fake DB is not a transaction engine |

### 3.4 Tax (Kenya)

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| 16% / 0% / exempt handled, dated rules | **PASS** | `erp-tax`, `erp-money-tax` |
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
| Idempotency per recipient | **PASS** | dispatch suite |
| Consent required for marketing | **PASS** | segments/consent suite |
| Suppression beats consent, re-checked at dispatch | **PASS** | dispatch suite |
| Quiet hours 08:00–20:00 Nairobi | **PASS** | delays, does not drop |
| Frequency cap | **PASS** | 4 per 30 days |
| Sender ID: 12-status machine, provider owns approval | **PASS** | sender-ID suite |
| Alphanumeric Sender ID = outbound only | **PASS** | `replyCapability`; asserted |
| Live sending | **BLOCKED** | refuses unless `MESSAGING_LIVE_ENABLED=true` and a live adapter is registered; none is |
| **Live provider delivery** | **NOT TESTED** | no credentials, no traffic |
| Wallet: CAS, no auto top-up | **PASS** | dispatch suite |
| Unknown outcome → reconcile before retry | **PASS** | dispatch suite |
| Circuit breaker | **PASS** | pauses after repeated failures |

### 3.6 Public storefront

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Public ordering page per business | **PASS** | storefront suite; `/store/[slug]` returns 200 with the "shop not found" state when closed |
| Signed product references (no ids in HTML) | **PASS** | 22-char HMAC refs |
| Server-side repricing | **PASS** | tampered basket ignored |
| Stock deducted only on confirmation | **PASS** | `confirmStoreOrder`, once |
| Customer order tracking page | **PASS** | `/store/order/[token]`, last-3-digits masking |
| Honeypot + rate limit | **PASS** | route + suite |
| **Payments in the shop** | **BLOCKED** | deliberately not enabled; customer pays on delivery/collection |
| **Screenshots** | **BLOCKED** | no browser binary in this environment |

### 3.7 Automations, approvals, RBAC, audit

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Rules engine, preview-first | **PASS** | automation suite |
| High-impact actions need a human | **PASS** | engine refuses even if a row is written directly |
| Daily run caps, kill switch | **PASS** | suite |
| **Sending a message from automation** | **BLOCKED** | `SEND_TEMPLATE` is marked unimplemented and refused at save time |
| 6 roles × 27 permissions | **PASS** | access suite |
| Approval caps by role | **PASS** | access suite |
| Separation of duties | **PASS** | campaigns suite |
| Audit trail with secret redaction | **PASS** | audit module + team suite asserting `TEAM_ROLE_CHANGED` |
| Role management UI + server action | **PASS** | settings page; `setTeamRole` tested |

### 3.8 Onboarding

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| 12 steps derived from stored facts | **PASS** | onboarding suite |
| Provider-dependent step shows "waiting", never blocks | **PASS** | suite |
| Mobile-first guided setup screen | **PASS (rendered) / NOT TESTED (visually)** | `/dashboard/erp/[businessId]/onboarding` compiles and is in the build manifest; no screenshot |
| Bootstrap is idempotent | **PASS** | `bootstrapErpWorkspace` creates in one transaction; tested at the module level |

### 3.9 eTIMS

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Prepared and validated locally | **PASS** | `validateEtimsPayload` + eTIMS suite |
| Submission enabled | **BLOCKED** | no certified adapter; flag + key required; both off |
| Acceptance claim requires KRA control number | **PASS** | `assertAuthoritativeAcceptance` |
| Timeout never becomes a rejection | **PASS** | `UNCERTAIN` |
| Duplicate fiscal document prevented | **PASS** | no `UNCERTAIN → SUBMITTING` edge |
| **Any real KRA response** | **NOT TESTED** | no credentials, no certification |

### 3.10 Industry packs and sectors

| Item | Status |
| --- | --- |
| 20 packs defined, selectable, per-role nav filtered | **PASS** |
| `retail` pack marked TESTED | **PASS** (as a label, with the caveat that no sector was independently verified) |
| Restaurant, e-commerce, multi-entity | **IN DEVELOPMENT** (disclosed in the UI) |
| Pharmacy, property, hotel, healthcare, import-export, NGO, financial, utilities, public sector | **BLOCKED** (disclosed in the UI) |
| **Independent verification of any sector** | **NOT TESTED** |

### 3.11 Observability, backups, DR

| Item | Status | Limitation |
| --- | --- | --- |
| `/api/erp/[businessId]/status` | **PASS** | returns 401 unauthenticated (verified over HTTP) |
| Audit trail as an event log | **PASS** | write-side tested |
| **Backup and drill** | **BLOCKED** | no database, no backup target |
| **Load / soak test** | **NOT TESTED** | no environment |
| **Alerting** | **BLOCKED** | no APM added (no budget approval) |

### 3.12 Deliverables

| Deliverable | Status |
| --- | --- |
| Working implementation | **PASS** (code + 292 tests + green build); runtime with a database: **NOT TESTED** |
| Distinct plan / entitlements | **PASS** |
| Schema + migration + rollback plan | **PASS** (written, additive, asserted by test); applied: **NOT TESTED** |
| Tests with reproducible commands | **PASS** (section 2) |
| Responsive screenshots | **BLOCKED** — no browser binary; layout is CSS-verified only |
| Provider cost comparison | **PASS** — `POS_ERP_PRO_PROVIDER_COSTS.md`, rates unverified |
| Security review | **PASS (self-review)** — `POS_ERP_PRO_SECURITY_REVIEW.md`, 6 findings, no external audit |
| PR links / SHAs / CI results | **PASS (partial)** — feature commit `367032c` plus documentation commits, PR [#71](https://github.com/POWERBot-1/Jata-Aftercall/pull/71) (mergeable), Vercel preview check `pass`. The repository has no test workflow that runs on this branch, so **no CI test result exists** — the green suite is from the local run in section 2. |

---

## 4. Limitations a reader must not skip

1. **The migration has never run.** It is reviewed line by line, guarded and idempotent, and a test
   asserts it is additive-only, but "reviewed" is not "executed".
2. **`prisma generate` never succeeded here.** Every loader and server action compiles against
   `any`, so a wrong field name in a Prisma query would compile and fail at runtime. This is the
   single largest untested surface.
3. **The fake database is a filter, not a transaction engine.** Isolation and rollback semantics are
   asserted only where the engine guarantees them without a rollback.
4. **No live messaging, payment or KRA traffic was produced.** Delivery statistics in this report
   are zero because nothing was sent.
5. **No screenshots.** Screens were verified by compiling them and by HTTP status/redirect
   behaviour, not by looking at them.
6. **Tax and statutory positions are unverified.** The default rates carry `verified: false`; no
   accountant or KRA publication was used as a signed source.
7. **Nothing was merged or deployed.** The work is committed as `367032c` (plus documentation commits) and pushed to
   `arena/7a3563c1-jata-aftercall`; PR #71 is open against `arena/33ebb805-jata-aftercall` and has not
   been merged. The only automated check on the PR is a Vercel preview deployment; there is no test
   workflow wired to this branch, so CI has not independently run the suite.
8. **Automation cannot send messages**, by design; the action is listed as planned and refused.

---

## 5. What would turn the remaining rows green

| Priority | Task | Unblocks |
| --- | --- | --- |
| 1 | Run `prisma generate` and `prisma migrate deploy` against a scratch PostgreSQL | migration, loaders, DAO integration |
| 2 | Seed one business and walk the flows in a browser | screenshots, all runtime `NOT TESTED` rows |
| 3 | Re-run the 94 skipped database suites | concurrency, isolation, rollback |
| 4 | Implement bank reconciliation and supplier bills | payables row |
| 5 | Register a certified eTIMS adapter and reconcile one invoice against the KRA portal | eTIMS rows |
| 6 | Move the rate limiter to a shared store | security finding F-1 |
| 7 | External security review + dependency scan | security row |
| 8 | Wire a test workflow to the branch, then let CI run the suite | CI evidence row |
