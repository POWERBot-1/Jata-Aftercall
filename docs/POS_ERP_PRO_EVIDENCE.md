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
| Domain libraries | `lib/erp/*.ts` (25 modules) — money, tax, accounting, invoicing, storefront, compliance, industry packs, entitlement, access, audit, sequences, automation, onboarding, bootstrap, workspace, loaders, team, etims, http, navigation |
| Messaging engine | `lib/messaging/*.ts` (10 modules) — segments, consent, templates, senderId, providers, billing, campaigns, pipeline, testSend, import |
| Schema | 46 new models in `prisma/schema.prisma`; six additive migrations (`…_pos_erp_pro`, `…_erp_tasks`, `…_erp_notifications`, `…_erp_approvals`, `…_erp_approval_consumption`, `…_erp_procurement`) |
| Screens | `app/dashboard/erp/**` (20 pages, including `/tasks`, `/notifications`, `/approvals` and `/procurement`), `app/store/**` (2 public pages) |
| API | 7 route handlers (status, messaging preview, campaign dispatch, accounting, export, public order, provider webhook) |
| Components | `components/erp/*` (4) |
| Unit tests | 23 suites for this product, **412 tests** (292 core + 22 task-domain + 9 task-page + 23 notifications-domain + 8 notification-page + 23 approvals-domain + 6 approvals-page) |
| Database tests | `erp-pro-postgres` (16), `erp-tasks-postgres` (13), `erp-notifications-postgres` (11), `erp-approvals-postgres` (13), `erp-procurement-postgres` (7) — **60 tests** against real PostgreSQL |
| Verification tooling | `scripts/erp/migrate-test-db.sh`, `scripts/erp/migration-verify.sh`, `scripts/erp/check-models.ts`, `scripts/erp/build-wasm-harness.sh`, `scripts/erp/tasks-page.check.mjs` |
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

### 2.5 The task spine slice (2026-10-28, `00cdd71`)

The first BOS module after the ERP Pro core: work that somebody owns. New model `ErpTask`, new
migration `20261028000000_erp_tasks`, new domain module `lib/erp/tasks.ts`, new screen `/tasks`,
two server actions, one sidebar entry, and `CREATE_TASK` automation rewritten to persist.

```bash
# schema/client
npx prisma generate --no-engine
# → "Generated Prisma Client (v5.22.0, engine=none)"; the schema is the input, so it parsed cleanly.
#   `prisma validate` itself is BLOCKED in this sandbox: it tries to fetch the schema engine from
#   binaries.prisma.sh, which is not on the allowed network. The migration run below is the stronger
#   check anyway — the generated SQL was applied by PostgreSQL.

# types and lint
npx tsc --noEmit                    # → exit 0
npm run lint                        # → 0 errors, 42 warnings (all pre-existing files)

# the slice's own suites
npx vitest run tests/unit/erp-tasks.test.ts tests/unit/erp-tasks-page.test.ts
# → Test Files 2 passed (2) / Tests 31 passed (31)
#   22 domain tests: input validation, the OPEN→IN_PROGRESS→DONE|CANCELLED machine and its terminal
#   states, bucketing, tenant scoping on every read/write, assignee must be a member, cancel reason,
#   idempotent replay, audit rows, automation preview vs execute, 200-row cap.
#    9 page tests: overdue-first ordering, KPI counts, owner form/controls, viewer gets no control
#   it cannot use, finished work has no controls, assignee/role/unassigned labels, empty board,
#   action notices, overdue date label.

# real PostgreSQL (22 migrations applied to a disposable database, DB `jata_erp`)
PRISMA_TEST_DATABASE_URL=postgresql://jata@127.0.0.1:5433/jata_erp?schema=public \
PRISMA_WASM_HARNESS_DIR=$PWD/node_modules/.erp-wasm-harness npm run test:db:erp
# → Test Files 2 passed (2) / Tests 29 passed (29)
#   16 pre-existing ERP Pro tests + 13 task tests (cross-tenant reads and writes refused, non-member
#   assignee refused, terminal state refuses further transitions, cancel needs a reason, concurrent
#   double submit, per-event idempotency, the same key in two tenants, audit rows with no leakage,
#   automation raises exactly one task and skips the replay, list cap).

# migrations, rollback and recovery (disposable database, 22 migrations, 39 ERP tables)
bash scripts/erp/migration-verify.sh all
# → 24 checks PASS, RESULT: PASS (all migration scenarios)
#   clean install 39 ERP tables + 87 pre-existing; upgrade over a populated previous release with
#   rows untouched; export → restore → row-count match → documented reverse drop → re-apply.

# schema/client agreement
npx tsx scripts/erp/check-models.ts
# → 125 generated models, 39 ERP/messaging models, 91 referenced by app code, consistency PASSED

# whole repository
npx vitest run
# → Test Files 263 passed | 17 skipped (280)
# → Tests      3433 passed | 150 skipped (3583)

npm run build                       # → [build] Build completed successfully
```

The 150 skips are the database-backed suites when no test URL is configured, including the 29 that
ran above — they are reported as skipped, never as passing.

| Acceptance item | Status | Evidence |
| --- | --- | --- |
| Data model + additive, reversible migration | **PASS** | `ErpTask` in `prisma/schema.prisma`; `20261028000000_erp_tasks/migration.sql` is `CREATE TABLE IF NOT EXISTS` + indexes + FK; `migration-verify.sh all` 24/24 |
| Persistence (create, transition, list) | **PASS** | `lib/erp/tasks.ts`; 13 PostgreSQL tests on a real database |
| Server-side tenant and role enforcement | **PASS** | `requireErpAccess` + `hasErpPermission(..., "MANAGE_TASKS")` in both actions; cross-tenant read *and* write refused in the PG suite; non-member assignee refused |
| Validation and error handling | **PASS** | `validateTaskInput` (title 3–140, detail ≤ 4000, priority enum, due date parse); errors surface as a notice, never a stack trace |
| UI | **PASS** | `/tasks` board; 9 render tests |
| Auditability | **PASS** | `TASK_CREATED`, `TASK_STATUS_CHANGED` rows asserted in both suites, tenant-scoped |
| Automation integration | **PASS** | `CREATE_TASK` persists with `automation-task:<idempotencyKey>`; replay raises no second task |
| Responsive layout | **NOT TESTED** | The board reuses the existing `erp-grid-3` / `erp-row` responsive primitives, but no visual review or viewport check ran in this environment (E4) |
| Full end-to-end browser run of `/tasks` | **BLOCKED** | `scripts/erp/tasks-page.check.mjs` seeds a tenant and asserts on real HTML, but the sandbox client is generated with `--no-engine` and the native query-engine binary cannot be downloaded here, so every authenticated request bounces to `/login`. The script detects this and reports BLOCKED rather than a false PASS. Run it where a native engine exists. |

---

### 2.6 The notification centre and the working dashboard (2026-10-29, `c57a3a3`)

Phase A of the BOS directive asked for two things: a task spine (delivered in §2.5) and a notification
foundation wired into the dashboard. `ErpNotification` existed but could only broadcast to a role and
carried one `readAt` — so one person opening a notice cleared it for the whole team, and there was
nowhere to record what raised it. This pass fixes that and adds the screen, the bell and the
dashboard widgets.

```bash
npx prisma generate --no-engine      # → 126 models (40 ERP/messaging, 1 new: ErpNotificationRead)
npx tsx scripts/erp/check-models.ts  # → 126 generated / 40 ERP / 92 referenced by app code — PASSED
npx tsc --noEmit                     # → exit 0
npm run lint                         # → 0 errors, 43 warnings (pre-existing files)

npx vitest run tests/unit/erp-notifications.test.ts tests/unit/erp-notifications-page.test.ts
# → 2 files, 31 tests passed
#   23 domain: validation (short title, empty body, links that leave the workspace, unknown kind),
#   visibility (personal / role broadcast / ALL / owners), per-person read state, legacy broadcast
#   flag, idempotent mark-read, cross-tenant and not-yours refusals, mark-all, unread filter,
#   delivery decisions (in-app, skipped, failed + audited), dedupe by key and by unique-index race,
#   per-tenant key scoping, assignment and overdue notices from the task module.
#    8 page: unread notice with destination and controls, no mark-read on a read notice, honest empty
#   inbox, separate empty-unread state, action notices, dashboard widgets (own work, counts, latest
#   notices), widget links, and no invented approval figure.

PRISMA_TEST_DATABASE_URL=… PRISMA_WASM_HARNESS_DIR=… npm run test:db:erp
# → 3 files, 39 tests passed (16 ERP core + 13 tasks + 10 notifications)
#   The notification tests prove on real PostgreSQL: the unique (businessId, dedupeKey) index stops a
#   second write, two concurrent writers leave exactly one row, read state is per person, a
#   cross-tenant mark-read is refused and writes no row, the list never contains another tenant's
#   row, mark-all is a no-op the second time, the overdue sweep raises one notice per task per day,
#   assignment notifies once and reassignment notifies the new owner, and a failed delivery is
#   recorded as FAILED with an audit row.

bash scripts/erp/migration-verify.sh all
# → 24 checks PASS · 23 migrations · 40 ERP tables · 87 pre-existing tables
#   clean install, upgrade over a populated previous release, export/restore/row-count match,
#   reverse-drop of all 40 tables, re-apply, business intact.

npx vitest run                       # → 265 files passed | 18 skipped · 3464 passed | 160 skipped
npm run build                        # → [build] Build completed successfully
```

| Phase A requirement | Status | Evidence |
| --- | --- | --- |
| Persistent tenant-scoped task model | **PASS** | §2.5; `ErpTask` |
| Assignment, creator, status, priority, due date, description, related record, completion metadata, timestamps | **PASS** | `ErpTask` columns; the board renders `href` as "Open the record this is about" |
| Server-side CRUD, validation, authorisation | **PASS** | `lib/erp/tasks.ts` + `MANAGE_TASKS` actions; deletion is expressed as a cancelled task with a reason, never a hard delete, so history survives |
| Pagination | **PASS** | Finished work is paginated (25 per page, Newer/Older links, total shown); open work is bounded at 200 and the board says so |
| Overdue / assigned / approval tasks, dashboard links | **PASS (overdue, assigned, links) / BLOCKED (approval tasks)** | Assignee filter and overdue sweep are live; approval tasks need the approvals object, which does not exist yet |
| `CREATE_TASK` connected to the real service | **PASS** | §2.5 + assignment notifications asserted against PostgreSQL |
| Transactional where necessary, idempotent on retry | **PASS** | Unique `(businessId, idempotencyKey)`, concurrent double-submit test |
| Cross-tenant access and unauthorised assignment/completion prevented | **PASS** | 13 task + 10 notification PostgreSQL tests |
| Persistent tenant-scoped notifications | **PASS** | `ErpNotification` + `ErpNotificationRead`, new migration |
| Recipients, type, priority, read/unread, linked record, created time, delivery status | **PASS** | Columns + domain module; delivery is recorded, not assumed |
| Task assignment, overdue work, approval events connected | **PASS (tasks, overdue) / BLOCKED (approvals)** | Approvals do not exist yet, so no approval notice can be raised; the kind is defined and unused |
| In-app notification centre with unread counts, destinations, mark-as-read, empty/error states | **PASS** | `/notifications` + shell bell; 8 render tests |
| Real delivery providers only when available; nothing faked | **PASS (honesty) / BLOCKED (sending)** | `deliveryDecision` refuses to claim a send; out-of-product delivery is not implemented and the UI says so |
| Deduplication, safe retries, auditable delivery failures | **PASS** | Unique key + race test; `NOTIFICATION_DELIVERY_FAILED` audit row asserted |
| Dashboard widgets on persisted data with server-side permission enforcement | **PASS** | `/dashboard/erp/[businessId]` "What needs you today"; every figure is a stored-row count |
| Responsive verification at 320×568 … 1366×768 | **NOT TESTED** | No browser ran in this sandbox (E4). The page uses the existing responsive primitives (`erp-grid-3`, `erp-row`, `erp-mobile-bar`) |

---

### 2.7 Approvals (2026-10-30, `0109e7c`)

Approval *limits* already existed (`ERP_APPROVAL_LIMITS_CENTS`), applied inline wherever money moves.
That is a check, not a workflow: nobody could be asked, and "who approved this" could only be inferred
from an audit row. This slice adds the request object the BOS directive asked for in module 7.

```bash
npx prisma generate --no-engine      # → 128 models (42 ERP/messaging)
npx tsx scripts/erp/check-models.ts  # → 128 generated / 42 ERP / 92 referenced by app code — PASSED
npx tsc --noEmit                     # → exit 0
npm run lint                         # → 0 errors, 42 warnings (pre-existing files)

npx vitest run tests/unit/erp-approvals.test.ts tests/unit/erp-approvals-page.test.ts
# → 2 files, 29 tests passed
#   23 domain: validation (short title, fractional cents, links that leave the workspace, a request
#   addressed to a viewer), authority (role + amount + per-tenant threshold + addressed-person +
#   terminal state + self-approval), idempotent raise, approve/reject with a required reason,
#   withdraw by the requester only, cross-tenant refusal, queue scoping, summary counts, and the two
#   notifications each transition raises.
#    6 page: Approve/Reject on a decidable request, Withdraw on your own, nothing on a decided one,
#   a role that may ask but not decide, the limit line, and action notices.

PRISMA_TEST_DATABASE_URL=… PRISMA_WASM_HARNESS_DIR=… npm run test:db:erp
# → 4 files, 49 tests passed (16 ERP core + 13 tasks + 10 notifications + 10 approvals)
#   The approval tests prove on real PostgreSQL: the request and its REQUESTED event are written
#   together, a cross-tenant decision is refused and leaves the request pending, self-approval is
#   refused, the manager limit and a per-tenant threshold both bite, two concurrent submissions with
#   one key leave exactly one row, the event history is append-only (REQUESTED → REJECTED with the
#   reason and the actor), withdrawal is restricted to the requester and to pending requests, and each
#   transition raises one deduplicated notification.

bash scripts/erp/migration-verify.sh all
# → 24 checks PASS · 25 migrations · 42 ERP tables · 87 pre-existing tables

npx vitest run                       # → 267 files passed | 19 skipped · 3493 passed | 170 skipped
npm run build                        # → [build] Build completed successfully
```

| Requirement (directive module 7) | Status | Evidence |
| --- | --- | --- |
| Submit a request | **PASS** | `createApprovalRequest`; `/approvals` form; idempotency key |
| Approve / reject with a reason | **PASS** | `decideApprovalRequest`; a rejection requires a note; audited |
| Comment / record the decision note | **PASS** | `decisionNote` + `ErpApprovalEvent` (REQUESTED → APPROVED/REJECTED/WITHDRAWN) |
| Withdraw | **PASS** | `withdrawApprovalRequest`, requester only, pending only |
| Separation of duties | **PASS** | self-approval refused in the domain, asserted in unit and PostgreSQL suites |
| Role limits and per-tenant thresholds | **PASS (limits) / PARTIAL (config)** | the limit is enforced; `thresholdCents` is honoured by the domain but there is no settings field to store a tenant-wide threshold yet |
| Delegate | **MISSING** | not built |
| Escalate | **MISSING** | not built: an unanswered request does not yet escalate to a higher role |
| Notifications on request and decision | **PASS** | `APPROVAL_REQUESTED` / `APPROVAL_DECIDED`, deduplicated |
| Server-side authorisation on every path | **PASS** | actions call `requireErpAccess` with `APPROVE_SPEND`; the domain re-derives authority per request |
| Responsive verification | **NOT TESTED** | no browser in this sandbox (E4) |

---

### 2.8 Spending a grant (2026-10-31, `b89fc59`)

Section 2.7 shipped approvals that could be *asked for* but nothing tied a grant to the action it
authorised, so "approved" was an opinion rather than a permission slip. This slice makes an approval
single-use and puts it in front of the money.

```bash
npx tsc --noEmit                     # → exit 0
npx vitest run tests/unit/erp-approvals.test.ts
# → 33 tests passed (10 new: the gate at every role and threshold, and eight ways to spend a grant,
#   including the replay, the wrong kind, the wrong amount, another tenant, a rejected request and a
#   retried submit that must not raise a second request)

PRISMA_TEST_DATABASE_URL=… PRISMA_WASM_HARNESS_DIR=… npm run test:db:erp
# → 4 files, 53 tests passed (16 ERP core + 13 tasks + 11 notifications + 13 approvals)
#   New on real PostgreSQL: two concurrent consumes of one grant leave exactly one CONSUMED event and
#   one audit row; a smaller grant cannot pay a larger bill; another tenant cannot spend it; and a
#   manager's over-limit journal is refused until the owner approves, then spends the grant.

bash scripts/erp/migration-verify.sh all
# → PASS · 25 migrations · 42 ERP tables (three nullable columns and one index, no new table)

npx vitest run                       # → 267 files passed | 19 skipped · 3507 passed | 174 skipped
npm run lint                         # → 0 errors, 42 warnings
npm run build                        # → [build] Build completed successfully
```

| Requirement (directive module 7) | Status | Evidence |
| --- | --- | --- |
| A granted approval authorises one action, not a policy | **PASS** | `consumedAt`/`consumedBy`/`consumedRef`; `consumeApproval` |
| Two submits cannot spend the same grant twice | **PASS** | guarded `updateMany` (`consumedAt IS NULL`); proven with two racing calls on real PostgreSQL |
| Above the limit, the action does not run | **PASS** | `requireApprovalFor` in `recordExpenseAction` and `postJournalAction`; nothing is posted, a request is raised, the reason is shown |
| Above the limit, the request goes to somebody who can decide it | **PASS** | `escalationRoleFor` (manager/finance → admin, everything else → owner) |
| Retried submit raises one request | **PASS** | idempotency key `gate:<ref>` |
| The trail runs both ways | **PASS** | `APPROVAL_CONSUMED` audit + `CONSUMED` event + `consumedRef`; the screen shows "Used on …" / "not used yet" |
| Applies to campaigns | **PARTIAL** | campaigns already require `APPROVE_CAMPAIGNS` with cost confirmation and separation of duties; they do not yet spend an approval grant |
| Responsive verification | **NOT TESTED** | no browser in this sandbox (E4) |

---

### 2.9 Procurement (2026-10-31, `5069990`)

The MGAS bulk-order half of the reference workflow: something is needed, somebody with authority agrees
to buy it, it arrives, and the supplier's invoice is posted against it. Before this slice the ERP could
invoice out and record expenses, but had no object for what it had decided to buy.

```bash
npx prisma generate                 # → 132 models (46 ERP/messaging)
npx tsx scripts/erp/check-models.ts # → 132 generated / 46 ERP / 94 referenced by app code — PASSED
npx tsc --noEmit                    # → exit 0
npx vitest run tests/unit/erp-procurement.test.ts tests/unit/erp-procurement-page.test.ts
# → 30 tests passed (22 domain, 8 screen)
#   Domain: line arithmetic and VAT rounding, validation (no supplier, no lines, zero quantity,
#   fractional cents, bad date), the state machine (no reopening a received or cancelled order), the
#   tenant sequence, an idempotent retry, a supplier from another tenant, submission inside/above the
#   limit, the second submit spending the owner's grant, refusal to receive an unapproved order, an
#   over-receipt refused per line, partial and complete deliveries, the retried delivery, cancellation
#   requiring a reason, and the request procurement raises appearing in the approvals queue.
#   Screen: empty state, draft/approved/ordered/received/cancelled controls, the outstanding quantity
#   per line, the bill form, and a viewer who sees the order but no controls.

PRISMA_TEST_DATABASE_URL=… PRISMA_WASM_HARNESS_DIR=… npm run test:db:erp -- tests/integration/erp-procurement-postgres.test.ts
# → 7 tests passed on real PostgreSQL: numbering comes from the tenant sequence (PO-000001, PO-000002)
#   and not from a row count; another tenant's supplier is refused; an over-limit order stays
#   AWAITING_APPROVAL until the owner decides, then approves and spends the grant; a delivery writes a
#   PURCHASE movement against the PO and moves PosInventoryItem by exactly the quantity received;
#   two racing submits with one key leave one receipt; another tenant cannot receive; the summary
#   counts only this tenant's orders.

bash scripts/erp/migration-verify.sh all
# → PASS · 26 migrations · 46 ERP tables · 87 pre-existing tables

npx vitest run                 # → 269 files passed | 20 skipped · 3537 passed | 181 skipped
npm run lint                   # → 0 errors, 43 warnings
npm run build                  # → [build] Build completed successfully
```

| Requirement (directive module 5) | Status | Evidence |
| --- | --- | --- |
| Purchase order with lines, supplier, expected date | **PASS** | `ErpPurchaseOrder`/`ErpPurchaseOrderLine`, `/procurement` |
| Approval thresholds | **PASS** | `requireApprovalFor` (module 7's single-use grant); over-limit orders wait |
| Document numbers that never repeat | **PASS** | `ErpSequence` (`PO-000001`), proven under concurrent inserts by the existing accounting suite |
| Goods received notes | **PASS** | `ErpGoodsReceipt`/line; over-receipt refused per line |
| Stock actually moves, once | **PASS** | POS `PosInventoryMovement` via `recordMovement`, asserted on real PostgreSQL |
| Supplier bill posted | **PASS** | `ErpSupplierBill` + `buildSupplierBillJournal` (inventory/COGS, VAT input, AP) |
| Variance against the order | **PASS (recorded)** | returned to the screen, audited, shown in the confirmation sentence |
| Three-way *matching* enforced | **MISSING** | the three documents exist and are linked; a bill is not blocked when it disagrees with the receipt |
| Requisition as a separate object | **MISSING** | a draft order is the requisition |
| Lead-time/price history, reorder proposals | **MISSING** | not built |
| Responsive verification | **NOT TESTED** | no browser in this sandbox (E4) |

---

### 2.10 CI status on this head (2026-10-31, `6c6a690`)

**All fourteen check-runs are `success`** on this head, plus the Vercel status: `mergeable=MERGEABLE`,
`mergeStateStatus=CLEAN`, base `main`.

Two heads in between were not fully green, and the reason matters more than the colour:

| Head | Result | What was red |
| --- | --- | --- |
| `aef3c04` | 13/14 | `Journey against a real database`, step 20 `Actual storefront Motion and immersive browser regressions`: `FAIL no JavaScript 360px phone: no horizontal overflow, canvas or global motion flag — overflow=488px` |
| `660e3ff` | 13/14 | the same sub-check, the same 488px |
| `6c6a690` | **14/14** | — |

That check exercises the **storefront** in a no-JS 360px viewport. No ERP file it touches changed
between the passing and failing heads (one of them was a docs-only commit), so it is recorded as an
intermittent storefront check — **E13** in `RELEASE_BLOCKERS.md` — and was not worked around: no
storefront code, assertion threshold or workflow was edited to make it green.

Where the ERP work was actually proven on CI, from the job's own reported output on `660e3ff`: the
native-engine suite ran **287 files / 3,678 tests with nothing skipped** (including
`erp-procurement.test.ts`, `erp-approvals.test.ts` and `erp-pro-postgres.test.ts`), `prisma migrate
deploy` applied all 26 migrations, the typecheck and lint passed, and the production build succeeded
against the isolated database.

### 2.11 Storefront 360px overflow: E13 root-caused (2026-10-28, harness fix on top of `6dbfd7a`)

E13 was carried as an "intermittent storefront check". It is now **root-caused, and the defect was in
the measurement, not in the storefront layout**. No storefront style, assertion, threshold or workflow
was changed.

**Reproduction.** Run locally against `next dev` (the same command CI uses for this step) with a
Chromium build whose libraries were unpacked from the bundled `al2023.tar.br`. Twelve unmodified runs
of the harness produced one failure; instrumenting it showed the measured document at that instant had
`document.styleSheets.length === 1` with the single `link[rel="stylesheet"]`
(`/_next/static/css/app/layout.css`) still `sheet === null`, `getComputedStyle(h1).fontSize === "24px"`
(browser default), and the hero illustration at its intrinsic `800px` width. `800 + 48` of container
padding `- 360` viewport `= 488px` — **exactly the CI value**.

**Deterministic proof.** Holding the stylesheet response back 3s at the network layer reproduces the
CI failure every time, and the same page one moment later is clean:

| Measurement point | overflow | stylesheets applied | hero width | h1 size |
| --- | --- | --- | --- | --- |
| image-decoded gate, stylesheet delayed 3s (old harness gate) | **488px** | 1 (`layout.css` pending) | 800px | 24px |
| same page once `layout.css` has applied | **0px** | 2 (incl. `layout.css`) | 360px | 38.4px |

**Why the harness could get there.** `page.goto` used `domcontentloaded`, and the only readiness gate
was `hero image naturalWidth > 0`. The server streams the SVG before the CSS chunk is fetched, so the
image gate could be satisfied while the layout stylesheet was still pending — and `contentChecks()`
then measured unstyled geometry. On a dev server whose CSS compile is cold, that window is wide enough
to lose the race occasionally, which is why the same assertion passed on most heads.

`readyState === "complete"` is **not** a usable gate here: the dev document keeps a request open, and
in testing the `load` event stalled past 30s (with no CSS dependency at all), so a `load`-based wait
would convert a rare wrong measurement into a rare hard timeout.

**Fix (measurement precondition only).**

1. `waitForStylesheets(page)` — no geometry is read until every `link[rel="stylesheet"]` has a loaded
   sheet with readable rules (30s budget; failure is an explicit scenario failure, never a pass).
2. The poller runs from Node via `page.evaluate`, not `page.waitForFunction`: in-page pollers are
   subject to background-tab timer throttling. Observed: the stylesheet finished at 112ms while the
   in-page poller had still not fired after 40s, which produced two false timeouts before the change.
3. `page.bringToFront()` on every scenario page so timers, rendering and IntersectionObserver
   delivery are not throttled. Each scenario owns its page, so this cannot disturb another one.

The `overflow <= 0` assertion, the exact-price check, the canvas/global-flag checks and every other
threshold are byte-identical to before.

**Evidence after the fix.** 5 consecutive full runs of `storefront-motion.check.mjs`: **124 passed,
0 failed** each. The complete browser suite CI runs in that job also passes locally against the same
dev server: immersive 22, layout 7, actionbar 37, families 167, media-local 29 — **386 checks, 0
failed**.

**Status:** **Closed.** The 5 local runs above were the local proof; the CI confirmation is two
consecutive green heads that contain the change — `4e98874` and `f7c4970`, **14/14 `success`** each,
with the storefront Motion/immersive browser step passing on both. The local runs used a Chromium
unpacked from the pinned `@sparticuz/chromium@131` build against a local dev server, not the CI
runner, so the CI heads are the authoritative evidence. The residual risk is the runner image, not
the product: a recurrence should be re-opened with its run id, never silenced by editing the
assertion.

### 2.12 Requisitions: the request to buy, as a first-class object (2026-10-28)

Directive item 1 asks for requisitions as a tenant-scoped object before the enforcement work on
three-way matching. This slice ships the object and the controls around it; it does **not** claim the
matching work.

**What exists now**

| Piece | Detail |
| --- | --- |
| Tables | `ErpRequisition` (20 columns) and `ErpRequisitionLine`, both cascading from `Business`; unique `(businessId, requisitionNumber)` and `(businessId, idempotencyKey)`; indexes on `(businessId, status, createdAt)` and `(businessId, requestedBy, createdAt)` |
| Numbering | `REQ-000001` from `ErpSequence` (new `requisition` key, prefix `REQ`), never a row count |
| States | `DRAFT → SUBMITTED → APPROVED | REJECTED → CONVERTED`, plus `CANCELLED`; an amendment returns `SUBMITTED` to `DRAFT`; `REJECTED`/`CONVERTED`/`CANCELLED` are terminal |
| Separation of duties | the requester can never decide their own request, including an owner; the attempt is refused with a plain-language message, not a hidden button |
| Authority | raising needs `MANAGE_INVENTORY`, deciding needs `APPROVE_SPEND`; both are re-checked in the domain module and again in the server action |
| Amendment | allowed only while draft or submitted, only by the requester, and it audits `beforeJson`/`afterJson` so an approver sees what actually changed |
| Conversion | only from `APPROVED`, only with a supplier, through `createPurchaseOrder` (same stock/tax/approval rules as the procurement screen), exactly once — a second call returns the order that already exists |
| Audit | `REQUISITION_CREATED`, `_SUBMITTED`, `_AMENDED`, `_APPROVED`, `_REJECTED`, `_CANCELLED`, `_CONVERTED`, each with actor, tenant, target and reason where one applies |
| Notifications | the requester is told the decision (dedupe key `requisition-decision:<id>:<status>`) |
| Screen | `/dashboard/erp/[businessId]/requisitions`, in the workspace navigation under `operate`, with the decision controls only on requests the signed-in role may actually decide |

**Evidence (all run locally on this head)**

| Gate | Command | Result |
| --- | --- | --- |
| Domain rules | `npx vitest run tests/unit/erp-requisitions.test.ts` | **PASS** — 23 tests |
| Real PostgreSQL | `PRISMA_TEST_DATABASE_URL=… npm run test:db:erp` | **PASS** — 67 tests across 6 files, including 7 new requisition tests (tenant isolation, cross-tenant refusal, supplier-of-another-tenant refused, one-row-under-concurrency, amendment audit, single conversion, per-tenant summary) |
| Migration forward | `bash scripts/erp/migration-verify.sh all` (via `PSQL`/`PG_DUMP`/`PG_RESTORE` pointing at the disposable cluster) | **PASS** — 27 migrations, **48 ERP tables**, 87 pre-existing tables, 55 ERP foreign keys, idempotent re-run |
| Migration rollback | same script, rollback scenario | **PASS** — all 48 ERP tables exported and restored into a scratch database, dropped in the documented order, POS rows intact, re-applied for recovery |
| Types | `npx tsc --noEmit` | **PASS** — exit 0 |
| Unit suite | `npx vitest run` | **PASS** — 291 files, 3748 tests (3560 passed, 188 skipped, 0 failed) |
| Lint | `npm run lint` | **PASS** — 0 errors, 44 warnings (pre-existing) |
| Model check | `npx tsx scripts/erp/check-models.ts` | **PASS** — 134 schema models = 134 client models, 48 ERP/messaging, 94 referenced |
| Build | `npm run build` | **PASS** — `/dashboard/erp/[businessId]/requisitions` compiled |

**NOT TESTED / limitations**

* **No live HTTP render of `/requisitions` in this sandbox.** The repository's Prisma client is
  generated with `--no-engine` because `binaries.prisma.sh` is unreachable, so a running Next server
  cannot query PostgreSQL here; the page compiles and the loaders are exercised only through the
  domain tests. A cookie-authenticated page check of the kind `scripts/erp/tasks-page.check.mjs`
  performs is therefore **NOT RUN** locally and remains to be added for requisitions.
* **Three-way matching is still only recorded, not enforced.** `recordPurchaseBill` computes and
  audits the variance against the order; it does not yet compare against the goods receipt, apply
  configurable price/quantity tolerances, or route exceptions through approval. That is the next
  slice of directive item 1 and is listed as open in the gap matrix.
* **No price or lead-time history, reorder proposals, or supplier scorecards** yet.
* Business-policy choices not made here: what the default tolerances should be, whether a rejected
  requisition may be cloned, and who besides the requester may amend. These are presented as options
  in the gap document rather than chosen silently.

### 2.13 CI on `4e98874`: fourteen of fourteen, and the first head carrying the E13 fix

`4e98874` (requisitions + the storefront-check fix from `db2ad23`) returned **14/14 `success`**:
`Schema, types, unit suite, build`, `Migrations and PostgreSQL suite`, `Migrations + schema on
PostgreSQL 18`, `Exact candidate applies on disposable PostgreSQL 18`, `Production build path on
PostgreSQL 18`, `Schema reconciliation proposal closes the drift`, `Real-Chrome six-viewport capture
on a disposable database`, `Failure paths actually fail`, `D2 — build, audit and controls on the
candidate tree`, `Journey against a real database`, `Migration target guard`, `Static (install,
generate, lint, typecheck, audit)`, `Release gate (aggregate)`, and the Vercel status.
PR #71 is `MERGEABLE` / `CLEAN` on that head, with **no approving review**.

This is the **first** green head that contains the E13 harness change, so E13 is at "confirmation 1
of 2" rather than closed. It also means the new migration ran twice on real PostgreSQL in CI — once
through `prisma migrate deploy` against `postgres:16`, and once through the PG18 candidate path —
after the same 27-migration / 48-table rehearsal passed locally.

`Journey against a real database` covers the browser journeys; it is **not** a live render of
`/requisitions`, which stays unverified over HTTP (E14).

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
| Follow-up commits | `0c93d45`, `595320e`, `f4121cc` (docs), `e500664` (build-mode fix — the reviewed head) |
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

### 9.5 Verification on the reviewed head (`e500664`)

```bash
npm run lint          # → 0 errors, 42 warnings (all pre-existing, none introduced here)
npx tsc --noEmit      # → exit 0
npx vitest run        # → Test Files 260 passed | 16 skipped (276)
                      #   Tests      3402 passed | 137 skipped (3539), exit 0
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

### 9.6 CI on the reviewed head

Every check below is green on **`e500664`** (`gh api …/commits/e500664/check-runs`: 14 check-runs,
all `success`, plus a `success` commit status for the Vercel deployment).

| Check (workflow) | Result on `e500664` |
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
| Journey against a real database | **PASS** |
| D2 — build, audit and controls on the candidate tree | **PASS** (was FAIL on `f4121cc`; root cause and proof in 9.7) |
| Vercel / Vercel Preview Comments | PASS — deployment produced |

### 9.7 The `f4121cc` D2 failure: root cause, fix, proof

`D2 — build, audit and controls on the candidate tree` went red on `f4121cc` at the step
**"The candidate tree was not modified"** (`FAIL: tracked files were modified by the run`).

**Log access: BLOCKED.** GitHub serves job logs and artifacts from
`productionresultssa18.blob.core.windows.net` / `results-receiver.actions.githubusercontent.com`,
which this sandbox cannot reach (connection EOF); `gh run rerun` is also refused with
`HTTP 403: Resource not accessible by integration`. The failure text above was read from the
check-run **annotations** API, which is reachable, and the job was then reproduced locally.

**Reproduced from a clean checkout of `f4121cc`:**

```
$ git status --porcelain          # clean
$ npm ci --ignore-scripts         # exit 0
$ npx prisma generate             # exit 0
$ npm run build                   # exit 0  … "[build] Build completed successfully"
$ git status --porcelain
 M next-env.d.ts
$ git diff next-env.d.ts
-import "./.next/dev/types/routes.d.ts";
-import "./.next/dev/types/root-params.d.ts";
+import "./.next/types/routes.d.ts";
+import "./.next/types/root-params.d.ts";
```

**Root cause.** `next-env.d.ts` is a tracked file that Next rewrites on every compile with a
mode-dependent path: `next dev` writes `./.next/dev/types/…`, `next build` writes
`./.next/types/…`. The committed file at `f4121cc` carried the **dev** paths: a local `next dev`
run (taken for the browser-evidence pass) rewrote the file and the following `git add -A` commit
captured it. D2's own `npm run build` then restored the build paths, so a tracked file changed
during the run and the clean-tree assertion failed. **The assertion was correct and was not
touched**, no control was bypassed and no migration hash was involved. `origin/main` carries the
build-mode content, confirming the branch had silently drifted from it.

**Fix (`e500664`).** `next-env.d.ts` now holds exactly `origin/main`'s build-mode content. Proof,
with `.next` deleted first and the full gate re-run from the clean checkout:

```
$ rm -rf .next && npm run build      # exit 0
$ git status --porcelain
(empty)                              # zero tracked modifications
```

**Regression guard.** `tests/unit/next-env-build-mode.test.ts` (3 assertions) fails if the
dev-server paths are committed again. It was checked in both directions: 3/3 pass on the fix, 3/3
fail against the dev-server content.

### 9.8 Local reproduction of the D2 sequence on `e500664`

| Step (mirrors the workflow) | Result |
| --- | --- |
| Clean checkout, `npm ci --ignore-scripts` | PASS, tree clean |
| `node scripts/lib/migration-target-guard.mjs check` | PASS — `OK_LOCAL … mode=enforce` |
| `npm run build` (guard → `prisma migrate deploy` → generate → `next build --webpack`) | PASS, `[migrate] Migrations deployed successfully`, `[build] Build completed successfully` |
| Tree after the build | **clean — 0 tracked modifications** |
| `npm audit --omit=dev` equivalent (`summarise-audit.mjs` inputs) | PASS — 0 production findings (CI) |

The parts of D2 that need a GitHub-hosted PostgreSQL 18 service, `psql` against it, and the
mutation controls (broken migration must fail the build, guard must refuse a Production-claimed
target) are **CI-verified, not locally re-run** — the job is green on `e500664`.

Earlier browser evidence remains valid for the same code paths: the six storefront browser scripts
were run against a real Chromium 153 and a `next dev --webpack` server, twice (with and without a
live database): motion 124, immersive 22, layout 7, actionbar 37, families 167, media-local 29 —
**386 assertions, 0 failures**. That run is what produced the dev-mode `next-env.d.ts` rewrite, and
the reason the guard now exists.

## 10. ERP pages, ERP screenshots and the provider-database rehearsal (2026-10-28)

Three gaps were closed far enough to change what can honestly be claimed, and one deployment defect
was found that is **not** fixed. Every number below was produced by the script named beside it; where a
number is missing, the reason is stated instead.

### 10.1 The ERP pages checked over real HTTP (blocker E14) — **PASS 24/24 and 19/19, local**

`scripts/erp/erp-pages.check.mjs` (new, `npm run test:erp:pages`) and `scripts/erp/tasks-page.check.mjs`
(19 checks, `npm run test:erp:tasks-page`) drive the **production build** over real HTTP with real signed
session cookies against a disposable PostgreSQL 16.2 database. Both were wired into
`interactive-business-e2e.yml`, immediately after the build step, and a `BLOCKED` result fails the job —
an environment that cannot run a check is never reported as a pass.

| What is proven | How |
| --- | --- |
| A signed-out visitor is redirected to `/login` (307), not shown ERP data | request without a cookie |
| The owner receives real rows on the workspace, tasks, requisitions and procurement pages | seeded rows + `h1` + marker text |
| Staff can raise a requisition but cannot approve their own request | server-side permission, not UI hiding |
| A manager who did not raise it sees Approve/Reject | approver ≠ requester |
| A viewer reads the page but is refused the write controls, and is told why | form absence + refusal copy |
| **Cross-tenant access discloses nothing, in both directions** | foreign title, foreign page marker and foreign record text must all be absent, *and* the response must be an explicit refusal (4xx, or the application's own refusal panel) |
| The workspace navigation links requisitions, procurement and the rest | link presence |

**The assertion was fixed, not weakened.** The old cross-tenant test demanded `status >= 400`. The ERP
layout deliberately renders a 200 refusal panel for a workspace the session may not open, so the test
contradicted the product — and it would also have accepted a 500 that leaked data, i.e. it could pass on
the worst outcome. It now asserts the security contract itself. A second flaw was found while fixing it:
`leakedId` was computed **after** the foreign id had been stripped from the body, so it could never fire.
That assertion was deleted rather than kept as evidence that cannot fail.

**CI confirmation (head `15020e3`):** run `40755507945`, job `123053226681` — `ERP pages over real HTTP
(authorisation, tenant isolation, refusal contract)` **success** and `ERP task board over real HTTP (role and
refusal contract)` **success**, both after `Production build against the isolated test database`, on a GitHub
runner where `prisma generate` produced the **native** engine. Neither step can pass while reporting
`BLOCKED`; the task-board step also fails on `SKIP`. So the numbers above are reproduced in the shipping
configuration, not only in this sandbox.

**Environment honesty:** the repo client is generated with `--no-engine` (binaries.prisma.sh is
unreachable here), so the local runs used a **temporary, never-committed** branch in `lib/db.ts` that
instantiates a locally generated **WASM query-engine client with `@prisma/adapter-pg`**. It is Prisma's
own query engine, not a mock, but it is *not* the pinned native-engine path. `lib/db.ts` is reverted to
HEAD afterwards (`git diff lib/db.ts` = 0 lines). CI supplies the native engine, so CI proves the
shipping configuration; the local numbers prove the page behaviour.

### 10.2 The ERP screens at six viewports (blocker E4) — **PASS 24/24, agent-reviewed, owner sign-off OPEN**

`scripts/erp/erp-visual.check.mjs` (`npm run test:erp:visual`) spawns `next start` on a free port with
`ERP_PRO_ENABLED=true`, seeds an owner, an ERP_PRO subscription, a supplier, a product, two tasks (one
overdue) and a submitted requisition plus an ordered purchase order, mints a `jata_session` cookie, and
captures four screens — workspace, tasks, requisitions, procurement — at **320×568, 360×800, 390×844,
430×932, 768×1024, 1366×768** with **HeadlessChrome/131.0.6778.0**.

| Measurement | Result |
| --- | --- |
| Captures | **24/24** `ok: true` in `evidence.json` |
| HTTP status | 200 on every capture |
| Expected heading present | yes on every capture |
| Horizontal overflow (`scrollWidth − clientWidth`) | **0px on every capture**, at every viewport |
| Main column width | exactly the viewport width at 320/360/390/430/768; 1312px at 1366 (sidebar visible) |
| Fixed-bottom mobile bar | `position:fixed; bottom:0` at ≤900px — present in the viewport, absent above 900px |

The 24 JPEGs are in `.cache/verification/erp-visual/` (git-ignored; regenerate with the command above).
Findings and the review record are in **`docs/POS_ERP_PRO_VISUAL_REVIEW.md`**. Two defects were found and
fixed: the duplicated sentence on the task-board empty state (V1) and five modules that were ready but
unreachable from every industry pack's navigation (V3). Three are **open questions for the owner**, recorded
with the options and no invented default: the ≤900px breakpoint also applying to 768px tablets (V5), KPI
cards stacking full-width below 900px (V6), and the crowded identity block at 320px (V7).

**CI confirmation (head `15020e3`):** run `40755507973`, job `123053227834` — the step
`ERP screens at six viewports, real Chrome (overflow, headings, HTTP 200)` **success**, and artifact
`erp-visual-71` (3.29 MB) was uploaded. The step exits non-zero if the check reports `BLOCKED` or fails to
print `RESULT: PASS`, so its success is the CI-side capture result. The images themselves live in the
artifact; the blob host is unreachable from this sandbox, so they were read locally instead.

**What this does not prove:** it is not a human or designer sign-off. The reviewer was the agent. No image,
finding or layout decision here is presented as an owner approval, and **E4 stays open** on that basis.

### 10.3 The provider database (blocker E8) — **OPEN, with a real deployment defect found**

**Defect (not fixed — it is a coordinated deployment change):** `prisma/schema.prisma` declares only
`url = env("DATABASE_URL")` and has **no `directUrl`**, while `DEPLOYMENT.md` §1 tells the operator to paste
Neon's **pooled** connection string into `DATABASE_URL`, and `scripts/build.sh` runs `prisma migrate deploy`
against that same URL during `npm run build`. Neon's pooled endpoint is PgBouncer in transaction mode, which
does not reliably hold the **session-level advisory lock** Prisma Migrate takes. The documented deployment
path therefore fails at build time with **P1002 (timeout acquiring pg_advisory_lock)** or leaves a migration
stuck and blocking later deploys (**P3009**). Fixing it needs `directUrl = env("DIRECT_URL")` **and**
`DIRECT_URL` present in every environment that runs `generate`/`migrate`, because Prisma hard-fails schema
validation (**P1012**) on a referenced-but-unset variable — so it is recorded for the owner, not applied here.

**What was actually rehearsed, on disposable PostgreSQL 16.2:**

| Check | Result |
| --- | --- |
| Full migration chain, forward + upgrade + rollback + recovery (`scripts/erp/migration-verify.sh all`) | **PASS** — 48 ERP tables after recovery, 87 pre-existing intact, POS rows survived the rollback |
| ERP database suite, **pooler mode** (`?pgbouncer=true`) | **67/67 pass**, 6 files |
| ERP database suite, `connection_limit=1` | **67/67 pass** |
| ERP database suite, `connection_limit=2` on a cluster capped at `max_connections=8` | **67/67 pass** |
| Migration chain re-applied under that same connection cap | **PASS** (all scenarios) |

`?pgbouncer=true` disables prepared statements, which is the runtime half of the PgBouncer problem; the
advisory-lock half only appears with a real pooler in front of the database.

**NOT TESTED, and why:** an actual Neon project (so: a real PgBouncer hop, Neon's extension set,
`sslmode=require`, branch/restore-from-snapshot, cold start after auto-suspend, and Neon's PostgreSQL
version). None of it exists in this environment, and provisioning a Neon project needs the owner's
authorization and would incur cost, which was neither given nor requested. **E8 therefore stays OPEN.** No
part of this section should be read as a Neon rehearsal.

### 10.4 Verification commands used for this section

```bash
# ERP pages over real HTTP (needs a production build + disposable DB)
ERP_PRO_ENABLED=true DATABASE_URL=... AUTH_SECRET=... npm run test:erp:pages      # RESULT: PASS (24/24)
BASE_URL=http://127.0.0.1:3100 npm run test:erp:tasks-page                        # RESULT: PASS (19/19)

# ERP screens at six viewports (needs Chromium; SHOT_DIR keeps images out of git)
CHROME_PATH=... SHOT_DIR=.cache/verification/erp-visual npm run test:erp:visual   # RESULT: PASS (24/24)

# provider-database rehearsal, pooler mode
PRISMA_TEST_DATABASE_URL="postgresql://...?pgbouncer=true&connection_limit=1" npm run test:db:erp
```

Both page checks and the visual check exit `2`/report `BLOCKED` when the environment cannot support them,
and the CI steps treat that as a failure.
