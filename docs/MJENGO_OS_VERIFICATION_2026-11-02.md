# MJENGO OS — Integration Verification, 2026-11-02

**Branch** `arena/bc5b7fd6-jata-aftercall` @ `9f61005` · **PR** [#80](https://github.com/POWERBot-1/Jata-Aftercall/pull/80) — **draft**, **open**, **not merged**, **not deployed**
**Destination** `https://jataaftercall.co.ke` · **No production database, no production migration, no production write, no paid infrastructure, no provider call, no money moved.**

Every status is exactly one of **PASS**, **FAIL**, **BLOCKED** or **NOT TESTED**. Where a check could
not run, it says so and does not borrow a neighbouring result. Quoted output is real output.

---

## 0. Headline — is PR #80 release-ready?

**No.** PR #80 is a reviewable, self-consistent change with strong database evidence, but it is **not
release-ready**, and it should not be merged on this document. Three independent reasons, none of them
cosmetic:

1. **The hosted-database gate has never run.** Everything in §2 is PostgreSQL 18.6 compiled to WASM
   running in-process (PGlite). It is real PostgreSQL semantics — triggers, constraints, `NOT VALID`
   foreign keys, `convalidated`, savepoints — but it is **not** Neon, not a server, not the deployment
   target. No Neon branch was created (no credentials, and provisioning costs money: stopped and asked).
2. **The repository's own build/typecheck gate is red — on `main` as well as here.** `next build` fails
   at the type step on three pre-existing test files because `prisma generate` cannot download its
   engine in this environment (§7). I did not paper over that, and I do not call a failed build a pass.
3. **The money path has never been exercised against a provider.** No Paystack credentials, and I will
   not simulate a successful charge. Everything about settlement below is unit-level plus static
   evidence (§3).

Additional blockers recorded in §11: browser-level XSS/CSRF evidence (**NOT TESTED**, no Chromium
obtainable), the remaining 74-file source audit (**BLOCKED** by scope), payroll and refunds
(**BLOCKED** by missing functionality, labelled as such in the UI).

---

## 1. The PR diff — reconciled, including the `+179,826 / −7,267` figure

### 1.1 What GitHub says now (fresh, after `9f61005` was pushed)

```
$ gh api repos/POWERBot-1/Jata-Aftercall/pulls/80 \
    --jq '"base=\(.base.sha) head=\(.head.sha) files=\(.changed_files) +\(.additions) -\(.deletions) commits=\(.commits) draft=\(.draft) state=\(.mergeable_state)"'
base=19f11d9ecd8daad1db2aaf35cc1166425f871acc head=9f610055fa0b025bc6ef7fb543a8ea5fcb74638f
files=56 +6136 -26 commits=8 draft=true state=blocked
```

### 1.2 What git says locally, same head

```
$ git rev-parse HEAD
9f610055fa0b025bc6ef7fb543a8ea5fcb74638f
$ git diff origin/main...HEAD --shortstat
 56 files changed, 6136 insertions(+), 26 deletions(-)
$ git diff origin/main..HEAD --shortstat
 56 files changed, 6136 insertions(+), 26 deletions(-)
```

**Agreement: exact.** API `56 / +6136 / −26`; git three-dot `56 / +6136 / −26`; two-dot identical
because `origin/main` is an ancestor of HEAD (0 commits behind, `merge-base = 19f11d9`).

An earlier fresh read in this session returned `files=27 +2486 −15` against head `71ea5af`. That was
**not a discrepancy**: the work in this turn (settlement coverage, nav audit, confirmation fix,
migration header, report) was still local and unpushed. After the push, GitHub reported
`27 → 52 → 56` as each batch landed. The API and git have never disagreed at a fixed head.

### 1.3 Where `+179,826 / −7,267` comes from — measured, not guessed

That figure is real, and it is **not** the PR diff. It is the diff of this branch against
`77e35cec`, the *pre-fork* commit this session branched from:

```
$ git diff 77e35cec..HEAD --shortstat
 1415 files changed, 180139 insertions(+), 7270 deletions(-)     # at today's HEAD, 9f61005
$ git diff 77e35cec..4a1aea0 --shortstat
 1413 files changed, 179282 insertions(+), 7269 deletions(-)     # at the previous commit
$ git diff 77e35cec..2696a00 --shortstat
 1410 files changed, 178668 insertions(+), 7265 deletions(-)
```

The `+179,826 / −7,267` pair falls between those snapshots — i.e. it is a **moving count of everything
that changed between the fork point and a mid-session commit**, not of this PR. Its size comes from
`main` itself, which moved 1,372 files / +174,016 / −7,257 after the fork:

```
$ git merge-base --is-ancestor 77e35cec origin/main && echo yes
yes
$ git rev-list --count origin/main..HEAD   → 8      # commits unique to this branch
$ git rev-list --count HEAD..origin/main   → 0
$ git diff 77e35cec..origin/main --shortstat
 1372 files changed, 174016 insertions(+), 7257 deletions(-)
```

So the number decomposes as **`main`'s own post-fork churn (~174.0k) + this PR's 6.1k**, and the two
file sets overlap in only 10 files:

```
main-side files: 1372   pr-side files: 56   overlap: 10   union: 1415
```

(overlap = `app/api/checkout/route.ts`, `lib/erp/accounting.ts`, `lib/paystack.ts`, `lib/pricing.ts`,
`next.config.js`, `package.json`, `package-lock.json`, `prisma/schema.prisma`, `prisma/seed.ts`,
`tests/unit/repair-guards.test.ts`)

Two mechanically different reasons the number wobbles by a few lines between snapshots, both measured:

| Variant of `git diff 77e35cec..HEAD` | Result | Why |
|---|---|---|
| default (Myers) | 1414 files, +179,828 / −7,269 | one canonical answer |
| `--ignore-space-at-eol` | 1414 files, +179,825 / −7,266 | 3 whitespace-only lines collapse |
| `-c diff.algorithm=patience` | 1414 files, +178,651 / −6,092 | different hunk alignment |
| `-c diff.algorithm=histogram` | 1414 files, +178,671 / −6,112 | same |
| `-c diff.algorithm=minimal` | 1414 files, +178,601 / −6,042 | same |
| `git diff --no-renames` / `-M` | identical to default | no renames in the range |

**Conclusion (PASS, with the correction recorded):** the PR is **56 files / +6136 / −26**, base
`19f11d9…`, head `9f61005…`, and it contains no vendored tree, no lockfile churn beyond 8 lines, and no
generated artefacts. `+179,826 / −7,267` is a fork-point-relative measurement of the whole branch
history (**1415 files**), which is dominated by `main`'s own movement — anyone quoting it as "the PR
diff" is describing 1,415 files, not 56. The previous version of this report explained a `176k` figure
as the byte size of the patch text; that explanation was wrong for this pair of numbers and is
withdrawn. (`gh pr diff 80 | wc -c` = 378,061 bytes today, which is a *byte* count and should never be
compared with an insertion count.)

### 1.4 Scope of the 56 files

| Group | Files |
|---|---|
| MJENGO library | `lib/mjengo/{entitlement,access,navigation,sanitize,csrf,settlement,workspace}.ts` |
| MJENGO API | `app/api/mjengo/{branding,journal}/route.ts` |
| MJENGO workspace | `app/dashboard/mjengo/**` (11 files) |
| MJENGO tests | 10 `tests/unit/mjengo-*.test.ts` |
| Shared code touched for MJENGO | `lib/pricing.ts`, `lib/pos/inventory.ts`, `lib/erp/accounting.ts`, `lib/paystack.ts`, `app/api/checkout/route.ts`, `app/checkout/callback/page.tsx`, `app/dashboard/subscription/page.tsx`, `next.config.js`, `prisma/schema.prisma`, `prisma/seed.ts`, `package.json`, `prisma/migrations/**` (3) |
| Verification tooling | `scripts/verify/mjengo-postgres-verify.mjs`, `scripts/verify/mjengo-nav-audit.mjs`, `tests/unit/repair-guards.test.ts` (allowlist only) |
| Docs | `docs/MJENGO_*` |

**Highest-risk files, called out for the reviewer:** `app/api/checkout/route.ts`, `lib/paystack.ts`,
`app/checkout/callback/page.tsx`, `app/dashboard/subscription/page.tsx`. Each change is an additional
branch keyed on `plan.key === "MJENGO_OS"` or on the product's own row; every other plan takes the
identical path it took before (§10 records the non-regression evidence).

### 1.5 PR state

`draft = true`, `mergeable = true`, `mergeable_state = blocked`. The blocking checks are inherited
GitHub workflows that require a hosted PostgreSQL and a downloadable Prisma engine (both unavailable
here, and the **baseline `main` fails them the same way**). The PR stays draft. **No merge, no
deploy, no production migration was performed.**

---

## 2. Database verification — **PASS on PostgreSQL 18.6 (WASM); hosted PostgreSQL BLOCKED**

### 2.1 Environment, stated precisely

| Thing | Value |
|---|---|
| Engine | `PostgreSQL 18.6` compiled to `wasm32`, via `@electric-sql/pglite@0.5.14` (saved devDependency) |
| Host OS | Linux sandbox, Node.js, offline except an allowlist |
| Neon | **not used** — no credentials, `api.neon.tech` unreachable, provisioning costs money → stopped, did not create |
| Production | **never contacted** |

PGlite is genuine PostgreSQL server code (the real parser, planner, executor, trigger and RI
machinery) linked as a WASM module. What it is **not**: a client/server deployment, and therefore it
does not prove network, connection-pool, `migrate deploy`-over-TLS, or Neon-branch behaviour. That
distinction is the reason gate 34 in §11 is BLOCKED rather than PASS.

### 2.2 The run

```
$ npm run verify:mjengo:pg           # node scripts/verify/mjengo-postgres-verify.mjs
$ echo $?
0
```

29 checks. Abridged, verbatim:

```
PASS  migrate deploy: every migration in prisma/migrations applies in order — 60/60 applied
PASS  migration status: every MJENGO OS migration is in the chain and applied —
      20261127000000_mjengo_os_product, 20261127000001_ledger_immutability, 20261127000002_ledger_line_integrity
PASS  migration status: ledger triggers, integrity view and the line foreign key exist after deploy —
      20 triggers, 1 integrity view, 1 line FK
PASS  foreign key state: ErpJournalLine_journalId_fkey is present and NOT VALID
      (new writes enforced, historic rows unscanned) — convalidated = false
PASS  orphan inventory: pre-existing orphaned lines counted (none can exist in a fresh database) —
      0 orphaned line(s) — on a deployed database this number must be 0 before VALIDATE CONSTRAINT
PASS  pricing: BUSINESS_POS is KES 499 / 30 days — {"key":"BUSINESS_POS","priceKES":499,"durationDays":30}
PASS  pricing: MJENGO_OS is KES 2,000 / 30 days — {"key":"MJENGO_OS","priceKES":2000,"durationDays":30}
PASS  pricing: ERP_PRO is untouched at KES 3,000 / 30 days — {"key":"ERP_PRO","priceKES":3000,"durationDays":30}
PASS  lifecycle: DRAFT → lines → POSTED commits with both lines — POSTED, 2 lines
PASS  immutability: INSERT a line into a POSTED journal is refused — journal line late_line is immutable: parent journal j_1 is POSTED
PASS  immutability: UPDATE a posted line amount is refused — …
PASS  immutability: DELETE a posted line is refused — …
PASS  immutability: rewriting the description of a POSTED journal is refused — …
PASS  immutability: re-dating a POSTED journal is refused — …
PASS  immutability: moving a POSTED journal to another tenant is refused — …
PASS  lifecycle: POSTED → DRAFT is refused — journal j_1 cannot return from POSTED to DRAFT; reverse it instead
PASS  immutability: deleting a POSTED journal is refused — posted journal j_1 cannot be deleted; reverse it instead
PASS  lifecycle: REVERSED marker is the one permitted write on a POSTED journal — original.reversedById = j_2
PASS  database-enforced vs application-enforced: reversedById IS overwritable in the database
      (double reversal is blocked in lib/erp/accounting.ts, not by a trigger) — UPDATE affected 1 row
PASS  integrity: a balanced posted journal is not flagged — {"journalId":"j_1","balanced":true,"empty":false,"lineCount":2}
PASS  integrity: an empty posted journal is flagged empty — {"journalId":"j_3","balanced":false,"empty":true,"lineCount":0}
PASS  integrity: an unbalanced posted journal is flagged unbalanced — {"journalId":"j_4","balanced":false,"empty":false,"lineCount":2}
PASS  integrity: a line cannot be orphaned — the foreign key refuses a missing journal —
      insert or update on table "ErpJournalLine" violates foreign key constraint "ErpJournalLine_journalId_fkey"
PASS  foreign key validation: VALIDATE CONSTRAINT succeeds on clean data and flips convalidated to true
      — convalidated = true after the documented repair-then-validate step
PASS  atomicity: a refused line write rolls the whole journal transaction back — …
PASS  atomicity: nothing from the failed transaction survives — 0 rows
PASS  tenancy: a tenant-scoped read cannot see another tenant's journal — 0 rows for bizA
PASS  tenancy: the owning tenant can read its own journal — 1 row
PASS  separation: an ACTIVE BUSINESS_POS subscription creates no MJENGO_OS entitlement —
      MJENGO rows for bizA: 0; POS entitlement rows: 0

29/29 checks passed
```

The same invariants also run as a vitest suite on the repository's own migrations:

```
$ npx vitest run tests/unit/mjengo-ledger-sql-postgres.test.ts
✓ tests/unit/mjengo-ledger-sql-postgres.test.ts (11 tests | 1 skipped)
```

(1 skipped = the assertion that needs a real server-side concurrency harness.)

### 2.3 `20261127000002_ledger_line_integrity` — audited as asked

**Why it exists.** `ErpJournalLine.journalId` was a bare `String` with only `@@index([journalId])`.
The POS/ERP PRO migration created the column with **no reference at all**, so a line could point at a
journal id that never existed. This was found because the check *"a line cannot be orphaned"* **failed**
against a real database — it was a defect in the schema, not in the test.

The definition as shipped:

```sql
ALTER TABLE "ErpJournalLine"
  ADD CONSTRAINT "ErpJournalLine_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "ErpJournal"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;
```

| Question | Answer |
|---|---|
| Foreign key definition | `journalId → ErpJournal(id)`, `ON DELETE RESTRICT`, `ON UPDATE CASCADE` |
| Why `RESTRICT` | mirrors the delete guard in `20261127000001`: a journal with lines is never deleted, so `CASCADE` would silently contradict it |
| `NOT VALID` behaviour | enforced for **every new INSERT** and **every UPDATE of `journalId`**; existing rows are **not scanned**. Chosen deliberately: a validating constraint would make `prisma migrate deploy` fail on a database that already holds orphans, converting a data-repair job into a failed deploy on a live system |
| Has `VALIDATE CONSTRAINT` been run? | **No — not on any real database.** `pg_constraint.convalidated = false` after the migration chain, asserted by the script. What *is* proven: the documented repair→validate step **succeeds** on clean data and flips `convalidated` to `true` (see the check above), so the runbook is executable, not aspirational |
| Existing orphan count | **unknown for any deployed database — that is the honest answer.** In the fresh PGlite database the count is `0`, but that database has no history. §2.2 reports the number explicitly so nobody can read `NOT VALID` as "proven clean" |
| Migration content | additive only: one constraint. No `DROP`, no `UPDATE`, no `DELETE`; header carries inspect → repair → validate → rollback |

**Therefore: no claim of existing-data integrity is made anywhere in this document.** The correct
statement is "new writes are enforced; historical rows are unproven until an operator runs the count
and `VALIDATE CONSTRAINT`".

The check that previously read *"a reversed journal cannot be reversed again"* and passed while its
own detail said *"marker overwrite accepted by the database; application-level only"* was misleading
and has been replaced by an explicit statement of which layer enforces what:

| Invariant | Enforced by | Proof |
|---|---|---|
| No line under a POSTED/REVERSED journal (insert/update/delete) | **database trigger** | 3 refusals above |
| POSTED header identity immutable (description, date, tenant, amounts) | **database trigger** | 3 refusals above |
| `POSTED → DRAFT` impossible | **database trigger** | refusal above |
| Posted or non-empty journal cannot be deleted | **database trigger** | refusal above |
| A line cannot reference a missing journal | **database FK** (`NOT VALID`) | FK violation above |
| A journal cannot be **reversed twice** | **application only** — `reverseJournal`'s `ALREADY_REVERSED` guard. The database *permits* overwriting `reversedById`; it is the designated mutable column | explicit PASS line recording the overwrite succeeds; plus `mjengo-ledger-lifecycle.test.ts` pins the application guard |

### 2.4 Other database defects this found and fixed

**The first trigger migration would have broken the repo's own guard and the write path.** It used
`DROP TRIGGER IF EXISTS` (the additive-migration guard forbids `DROP`) and it *permitted* inserting
lines into POSTED journals "for compatibility". Because `postJournalTx` writes lines while DRAFT, that
permission was unnecessary and left open the exact hole the migration exists to close. Rewritten as:
lines immutable for any POSTED/REVERSED parent, one trigger name per rule, `CREATE FUNCTION` /
`CREATE TRIGGER` / `CREATE VIEW` only.

### 2.5 Database status table

| Target | Status |
|---|---|
| Full 60-migration chain + ledger invariants on PostgreSQL 18.6 (WASM, in-process) | **PASS** |
| Same on a disposable Neon branch via `prisma migrate deploy` / `migrate status` | **BLOCKED** — no credentials, no network, provisioning costs money |
| Orphan count + `VALIDATE CONSTRAINT` on a database that holds history | **NOT TESTED** — needs such a database |
| `npm run test:db:erp` (11 `*-postgres` suites through the Prisma client) | **BLOCKED** — needs `PRISMA_TEST_DATABASE_URL` **and** `prisma generate` (`binaries.prisma.sh` unreachable) |

---

## 3. Payment settlement — **PASS at unit level; provider path NOT TESTED**

### 3.1 The chain, and a real defect found in it this turn

`app/api/checkout` (`mjengoCheckoutRefusal` before `initializeTransaction`) → Paystack → callback →
`/api/paystack/verify` → `lib/paystack.ts` dispatch → `settleMjengoPayment` → `ErpSubscription` +
`ErpEntitlement` (`planKey/packageKey = 'MJENGO_OS'`) → `deriveMjengoEntitlement` → workspace gate.

While gathering this turn's evidence I found that **the confirmation path read the wrong table**:
`/api/paystack/verify` resolved the ordinary AFTERCALL `Subscription` for every non-POS, non-Autopilot
plan — which for a MJENGO payment is always empty. A customer who had just paid KES 2,000 would have
seen "no subscription", the endpoint would have re-entered the repair path on every refresh, and the
callback's only link was `/dashboard`, with no route from there into the MJENGO workspace. Fixed:

* `/api/paystack/verify` now reads `ErpSubscription` for `MJENGO_OS` payments and returns a
  `mjengoBusinessId` only when the stored row's `planKey` really is `MJENGO_OS` (a shared ERP row for
  another product reports nothing rather than a false ACTIVE).
* `app/checkout/callback/page.tsx` sends a MJENGO buyer to `/dashboard/mjengo/{id}` with the label
  "Go to MJENGO OS", via a shape-checked id (server-derived, never from the URL).
* `app/dashboard/subscription/page.tsx` no longer reports the shared `ErpSubscription` row as
  `ERP_PRO` status when the row's key is in fact `MJENGO_OS`; `MJENGO_OS` gets an honest catalogue
  note saying it is bought inside its own workspace, never from this page.

This is the difference between "the settlement function is correct" and "a payment produces access".

### 3.2 Settlement test evidence

```
$ npx vitest run tests/unit/mjengo-settlement.test.ts
✓ tests/unit/mjengo-settlement.test.ts (19 tests)
```

| Ask | Test | Result |
|---|---|---|
| Verified payment activates the **MJENGO** entitlement, not an ordinary subscription | *end to end: a verified MJENGO payment activates MJENGO OS and not an ordinary subscription* — asserts exactly 2 writes, both `ErpSubscription` + `ErpEntitlement`, `planKey/packageKey = MJENGO_OS`, `paymentId`/`paymentReference` bound, and that no `subscription`/`posSubscription` write occurs | **PASS** |
| …and the derived state is actually ACTIVE | *end to end: the settled payment derives an ACTIVE MJENGO entitlement* — `entitled: true`, `status: ACTIVE`, `priceKES: 2000` | **PASS** |
| A POS payment can never become MJENGO | *a POS (BUSINESS_POS) plan key can never settle into a MJENGO subscription* — `MJENGO_PLAN_KEY_MISMATCH`, zero writes | **PASS** |
| Failure handling | *a failed / cancelled payment never activates MJENGO OS* — `FAILED`, `CANCELLED`, `EXPIRED`, `PENDING` without evidence all refused (`PAYMENT_EVIDENCE_REQUIRED`), zero writes | **PASS** |
| Malformed evidence | *rejects malformed provider evidence instead of trusting a hand-written id* | **PASS** |
| Idempotency (replay) | *is idempotent: a replayed webhook returns alreadySettled and does not extend the window*; `processedWebhook` written once | **PASS** |
| Idempotency (race) | *resolves a lost compare-and-set race idempotently instead of double-extending* — `updateMany({ where: { id, status: <read state> } })` CAS, `count !== 1` → resolves to already-settled | **PASS** |
| Tenant isolation | *settlement only ever writes the paying business's rows* — every write target is `biz_tenant_a`, never `biz_tenant_b`; *a payment with no business context is refused before any write* (`PAYMENT_CONTEXT_INVALID`) | **PASS** |
| Money rule | checkout refuses before charging on: disabled deployment, missing plan, wrong key, 499 terms, 3000 terms, 31 days, inactive row; allows exactly 2,000/30d | **PASS** |
| Renewal maths | extends from `max(now, expiresAt)` — an early renewal never shortens a paid period; 30 days + 3-day grace | **PASS** |
| Provider payment → settlement → workspace in a browser | — | **NOT TESTED** — no Paystack credentials, no database, and money movement must not be simulated |
| Refund targeting MJENGO OS | — | **BLOCKED** — no refund flow targets this product; labelled BLOCKED in Settings |

### 3.3 Two limitations of this evidence, stated

* The settlement tests use an in-memory transaction double. They prove **branching and guards**, not
  that PostgreSQL accepts the writes. The database-level separation proof is the PGlite check
  *"an ACTIVE BUSINESS_POS subscription creates no MJENGO_OS entitlement"*.
* `ErpSubscription.businessId` and `ErpEntitlement.businessId` are `@unique`: one business cannot hold
  both ERP_PRO and MJENGO_OS rows. A business already on ERP_PRO is refused at checkout
  (`STORAGE_CONFLICT`) rather than having its BOS PRO row overwritten — the payment is recorded but
  not activated, which requires human reconciliation. Dedicated `Mjengo*` tables remove the conflict;
  that is an owner schema decision and is **not** in this change.

---

## 4. Workspace — connected workflows, every nav link audited for 404

### 4.1 Static 404 audit of every navigation link

```
$ npm run verify:mjengo:nav
  OK   nav
  OK   nav  /sales
  OK   nav  /inventory
  OK   nav  /procurement
  OK   nav  /customers
  OK   nav  /accounting
  OK   nav  /workforce
  OK   nav  /reports
  OK   nav  /settings
  OK   link app/dashboard/mjengo/page.tsx → /dashboard/mjengo/${encodeURIComponent(id)}
  OK   link app/dashboard/mjengo/page.tsx → /onboarding
11/11 navigation targets resolve to a real route
PASS — no navigation entry or link resolves to a 404
```

The audit (`scripts/verify/mjengo-nav-audit.mjs`) parses `lib/mjengo/navigation.ts` **and** every
literal `<Link href>` in `app/dashboard/mjengo/**`, then requires an actual `page.tsx`/`route.ts` on
disk. It is mirrored by a vitest case so `npm test` catches a broken link too.

### 4.2 The same links, over HTTP from a real production build

```
$ npx next start -p 3102 -H 0.0.0.0
/                        307         /sales      307        /inventory    307
/procurement             307         /customers  307        /accounting   307
/workforce               307         /reports    307        /settings     307
/dashboard/mjengo/biz1/nope   404     ← control: a route that does not exist really 404s
```

All nine nav targets answer `307 → /login` anonymously: no link is a 404, and none is reachable
without a session. The control proves the 307s are not a catch-all.

### 4.3 What each page is connected to

| Page | Backed by | State |
|---|---|---|
| Overview | `loadSalesOverview`, `loadInventoryOverview`, `loadProcurementOverview`, `loadCustomerCreditOverview`, `loadAccountingOverview` — real tenant-scoped counts, links into each section | **PASS** |
| Sales & orders | `PosSale` + `Order` (last 30 days), revenue and unpaid totals, receipt list | **PASS** |
| Inventory | `PosInventoryItem` + `PosProduct` aggregated per product, low-stock flags | **PASS** |
| Procurement | `PosSupplier`, `ErpPurchaseOrder`, `ErpRequisition`, payable total | **PASS** |
| Customers | `PosCustomer` balances, `ErpInvoice` ageing | **PASS** |
| Accounting | `ErpJournal`, `ErpPeriod`, `ErpJournalIntegrity` view; view absence renders "not available (database not migrated)", never a false "healthy" | **PASS** |
| Reports | aggregates of the loaders above | **PASS** |
| Plan & settings | stored plan row, entitlement state, storage conflict, real `/checkout?businessId&planId` POST target, branding note, refund BLOCKED label | **PASS** |
| Workforce — staff | `PosStaff` | **PASS** |
| **Workforce — payroll** | no payroll/payslip/statutory table exists | **BLOCKED** — labelled in the page; no wage figure computed or displayed |
| **Refunds** | no provider refund path targets MJENGO OS | **BLOCKED** — labelled in Settings |

Nothing is fabricated: every loader is tenant-scoped, and a failed read returns "unavailable", not a
number. The pages are **read views** of data the POS/ERP modules already own; sale entry, stock
adjustment and journal posting deliberately stay behind the existing `/api/pos/*` and `/api/erp/*`
authorization rather than being duplicated here.

### 4.4 The gate and the HTTP security evidence

The access check runs once, in `app/dashboard/mjengo/[businessId]/layout.tsx`, before any child renders
(`requireMjengoAccess` → session → `canAccessBusiness` → `assertBusinessOwnership` →
`deriveMjengoEntitlement`); children never re-decide it, and a refusal returns *only* the refusal.

```
POST /api/mjengo/branding  (anonymous)       401
GET  /api/mjengo/journal   (anonymous)       401
POST /api/mjengo/branding  (foreign origin)  403   Origin check failed: origin-host evil.example != request-host 127.0.0.1:3102
workspace CSP: Content-Security-Policy: frame-ancestors 'none'
```

An earlier run of this check caught a defect the unit suite had missed: `POST /api/mjengo/branding`
answered **503 "Database unavailable"** to an anonymous caller, i.e. before authentication. Fixed
(identity resolved before environment) and covered by two tests.

---

## 5. Ledger posting and reversal path — **PASS (PostgreSQL), PASS (unit)**

`lib/erp/accounting.ts` creates the journal `DRAFT`, writes lines, then seals `POSTED` — order
asserted in `mjengo-ledger-lifecycle.test.ts` (`journal.create` → `journalLine.create` →
`journal.update{status:POSTED}`). Reversal posts the mirrored journal **before** marking the original.

`mjengo-ledger-lifecycle.test.ts` (now 10 tests) proves: a line write against a sealed journal is
refused; a too-short reason is refused; another tenant's journal cannot be reversed; the engine joins
a caller's transaction instead of nesting one; and — new this turn — a **layer-classification test**
that pins which invariants are database-enforced and which are application-only, including the
double-reversal guard. Direct SQL evidence is §2.2.

---

## 6. Branding / auth / CSRF / tenancy / inventory — **PASS at unit level**

```
$ npx vitest run tests/unit/mjengo-*.test.ts
✓ tests/unit/mjengo-ledger-sql-postgres.test.ts (11 tests | 1 skipped)
✓ tests/unit/mjengo-settlement.test.ts (19 tests)
✓ tests/unit/mjengo-branding-and-journal.test.ts (24 tests)
✓ tests/unit/mjengo-ledger-lifecycle.test.ts (10 tests)
✓ tests/unit/mjengo-accounting-lifecycle.test.ts (4 tests)
✓ tests/unit/mjengo-csrf.test.ts (12 tests)
✓ tests/unit/mjengo-inventory-dedup.test.ts (11 tests)
✓ tests/unit/mjengo-workspace-routes.test.ts (7 tests)
✓ tests/unit/mjengo-entitlement-separation.test.ts (4 tests)
✓ tests/unit/mjengo-safe-text.test.ts (3 tests)
Test Files  10 passed (10)      Tests  104 passed | 1 skipped (105)
```

| Ask | Where | Result |
|---|---|---|
| Branding validation | `mjengo-branding-and-journal.test.ts` — `<img onerror>`, `<script>`, `javascript:`, `onerror=`, 1 char, 500 chars (capped at 200), control chars stripped, plain names accepted | **PASS** (400, nothing written) |
| Authentication | every route 401s without a session, before revealing configuration | **PASS** |
| CSRF / origin | foreign origin, suffix/prefix hosts, `javascript:`/`data:`/`file:`/`null`, malformed `X-Forwarded-Proto`, malformed `Host`, `sec-fetch-site: cross-site`/`same-site`, spoofed `X-Forwarded-Host`/`X-Forwarded-For` | **PASS** (403) |
| Tenant isolation (unit, stubbed ownership) | cross-tenant read and write refused with a valid session | **PASS** |
| Rate-limit identity | `trustedClientIp` ignores `X-Forwarded-For` off-Vercel, accepts only a well-formed first hop on it | **PASS** |
| Inventory duplicate lines | 2×1 vs 1 on hand → shortage; duplicates summing inside stock → allowed; services never blocked; concurrent claims of the last unit: exactly one succeeds; 10 claims for 6 units: 6 succeed, never negative | **PASS** |
| Cookie + arbitrary bearer CSRF bypass in a browser | — | **NOT TESTED** |
| Cross-tenant access **through the running app with a database** | — | **NOT TESTED** — no database, so no two real tenants |

---

## 7. Full suite, lint, typecheck, production build — with baseline separation

Identical commands on this branch and on a worktree of `origin/main` (`19f11d9`), sharing the same
`node_modules`. Re-recorded this turn at `9f61005`.

| Command | Branch `9f61005` | Baseline `origin/main` | Introduced here |
|---|---|---|---|
| `npx vitest run` | `1 failed | 4085 passed | 304 skipped (4390)` | `1 failed | 3981 passed | 303 skipped (4285)` | **0** |
| `npx eslint app components lib` | 49 warnings, **0 errors**, exit 0 | 49 warnings, **0 errors**, exit 0 | **0** |
| `npx tsc --noEmit` | **3 errors**, all `tests/**` | **3 errors**, same three files | **0** |
| `npx next build --webpack` | **exit 1** at the type step, same 3 test errors | **exit 1** at the type step, same 3 test errors | **0** |
| `npx next build --webpack`, `tests/**` excluded from tsconfig | **`✓ Compiled successfully in 19.5s`, exit 0** | not needed | — |

The single failing test is identical on both trees:
`tests/unit/autopilot-phase1-hardening.test.ts > Priority 1 …` fails because `Prisma.dmmf` is
undefined — `prisma generate` cannot download its engine here:

```
$ npx prisma generate
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/
       debian-openssl-3.0.x/libquery_engine.so.node.sha256 failed,
       reason: Client network socket disconnected before secure TLS connection was established
```

**`next build` FAILS. I am not calling it a pass.** It fails on `main` in this environment for the same
three pre-existing test files (`Prisma.dmmf`, `PrismaClientKnownRequestError`,
`BusinessUncheckedCreateInput`) caused by the absent generated client. They are not "fixed" here:
editing another product's tests to green a gate would hide the environment defect. What the excluded-
tests run does establish is narrower and stated as such — **the application code compiles and the
production build completes** when the compiler is not handed `tests/**`.

---

## 8. Browser-level evidence — **NOT TESTED**

```
$ command -v chromium chromium-browser google-chrome   → none
$ ls ~/.cache/puppeteer                                → absent
$ npx puppeteer browsers install chrome                → download failed (storage.googleapis.com unreachable)
$ curl -sI https://storage.googleapis.com              → 000
```

| Browser check | Status |
|---|---|
| Stored branding XSS in a real DOM | **NOT TESTED** |
| Reflected AI-response XSS | **NOT TESTED** |
| Cookie + arbitrary bearer CSRF bypass | **NOT TESTED** |
| Spoofed `X-Forwarded-For` through the platform proxy | **NOT TESTED** |
| Cross-tenant navigation in a real session | **NOT TESTED** |
| Unauthenticated workspace access (server-side) | **PASS** — nine routes, 307 → `/login`, over HTTP |
| CSP / proxy compatibility **without deploying** | **PARTIAL** — headers verified on a local production build; actual Vercel/Neon proxy behaviour **NOT TESTED** |

The safe-rendering guarantee does not depend on the browser runs: branding is escaped at the API
boundary (`sanitizeBrandingText` / `isSafeBrandingName`), rendered as text, and no MJENGO file contains
`dangerouslySetInnerHTML` or `innerHTML` (asserted by `mjengo-workspace-routes.test.ts`).

---

## 9. Source audit — partially complete, and honest about it

`docs/MJENGO_TAWA_SOURCE_COVERAGE.md` (721 lines) records the TAWA reference-tree audit: **32 files
reviewed in depth, 74 reviewed by title only.** Route → service → database → authorization → test is
fully traced for the 32; for the remaining 74 the capability list is recorded and each unverified
capability is marked unverified. The full 106-file matrix is **BLOCKED by scope** — a multi-day read
that produces no code.

---

## 10. Non-regression — **PASS**

| Claim | Evidence | Status |
|---|---|---|
| BUSINESS_POS remains KES 499 / 30 days | `verify:mjengo:pg` reads the row after all 60 migrations: `{"key":"BUSINESS_POS","priceKES":499,"durationDays":30}` | **PASS** |
| MJENGO_OS is KES 2,000 / 30 days | migration + seed on PostgreSQL; `assertMjengoOsPricing` throws on any other figure | **PASS** |
| ERP_PRO untouched at KES 3,000 | same run: `{"key":"ERP_PRO","priceKES":3000,"durationDays":30}` | **PASS** |
| POS subscriber gains no MJENGO access | `deriveMjengoEntitlement` with ACTIVE `BUSINESS_POS` → `entitled:false`; `settleMjengoPayment` rejects `BUSINESS_POS`; a live POS subscription creates 0 MJENGO rows on a real database | **PASS** |
| MJENGO subscriber gains no POS access | `derivePosEntitlement` with `MJENGO_OS` → `entitled:false` | **PASS** |
| MJENGO OS absent from homepage and `/pricing` | `homepagePlanCards()` excludes private keys; earlier attempt to add a card broke 10 suites and was reverted | **PASS** |
| Shared payment path unchanged for other plans | full suite 4085 passed, one inherited failure; the only shared-path change is an additional `plan.key === "MJENGO_OS"` branch, unreachable for every other product | **PASS (unit) / NOT TESTED (live provider)** |

---

## 11. Evidence matrix

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | PR diff reconciles with the GitHub API at a fixed head (56 files, +6136/−26) | **PASS** | §1.1–§1.2 |
| 2 | The `+179,826/−7,267` figure is identified | **PASS** | §1.3 — fork-point-relative, 1,415 files, dominated by `main`'s own 1,372-file move |
| 3 | Every changed file is MJENGO scope or shared-path-with-review | **PASS** | §1.4; four shared files called out |
| 4 | PR is clean/mergeable | **FAIL** | `mergeable_state: blocked`; inherited red workflows |
| 5 | All 60 migrations apply in order on PostgreSQL 18.6 | **PASS** | 60/60 |
| 6 | Ledger triggers + integrity view + line FK exist after deploy | **PASS** | 20 triggers, 1 view, 1 FK |
| 7 | Posted lines immutable (insert / update / delete refused) | **PASS** | 3 refusals on real PostgreSQL |
| 8 | Posted header immutable except reversal markers | **PASS** | 3 refusals + allowed marker write |
| 9 | `POSTED → DRAFT` refused; posted journal delete refused | **PASS** | 2 refusals |
| 10 | Empty / unbalanced / orphaned detection | **PASS** | integrity view rows + FK refusal |
| 11 | Orphan FK is `NOT VALID`; `convalidated = false` reported | **PASS** | §2.3 |
| 12 | `VALIDATE CONSTRAINT` demonstrated on clean data | **PASS** | `convalidated` flips to `true` |
| 13 | **Existing-data integrity of the FK on a database with history** | **NOT TESTED / unknown** | `NOT VALID`; must be validated per-database before any integrity claim |
| 14 | Database-enforced vs application-enforced invariants separated | **PASS** | §2.3 table; misleading check replaced |
| 15 | Transaction rollback leaves nothing behind | **PASS** | 0 rows |
| 16 | Migration re-runs without duplicating or altering other plans | **PASS** | 499/3000 unchanged after two runs |
| 17 | MJENGO checkout refuses before charging | **PASS** | 7 refusal cases |
| 18 | Verified payment activates the **MJENGO** entitlement, not an ordinary subscription | **PASS** | §3.2, 2 writes, correct keys |
| 19 | …derived state is ACTIVE | **PASS** | §3.2 |
| 20 | Settlement idempotency (replay + lost CAS race) | **PASS** | §3.2 |
| 21 | Settlement failure handling (failed/cancelled/expired/no evidence) | **PASS** | §3.2, zero writes |
| 22 | Settlement tenant isolation | **PASS** | §3.2 |
| 23 | Confirmation returns a MJENGO buyer to their workspace | **PASS (fix)** | §3.1 — wrong-table read found and fixed |
| 24 | Real provider payment → entitlement | **NOT TESTED** | no credentials; no simulation |
| 25 | Refund of a MJENGO payment | **BLOCKED** | labelled in UI |
| 26 | Every nav link resolves to a real, gated page | **PASS** | 11/11 static + 9×307 over HTTP + 404 control |
| 27 | Workspace sections connected to real tenant-scoped data | **PASS** | §4.3 |
| 28 | Payroll | **BLOCKED** | no payroll ledger exists |
| 29 | Branding validation | **PASS** | 12 cases |
| 30 | Authentication on every MJENGO route | **PASS** | 401s, HTTP + unit |
| 31 | CSRF / origin predicate | **PASS** | 12 cases |
| 32 | Tenant isolation (unit) | **PASS** | branding + journal + settlement |
| 33 | Tenant isolation end-to-end with a database | **NOT TESTED** | no database deployment |
| 34 | Inventory duplicate-line + concurrency | **PASS** | engine-level |
| 35 | Full suite, no branch-introduced failure | **PASS** | 4085 passed; 1 failure identical on baseline |
| 36 | Lint | **PASS** | 0 errors, 49 warnings = baseline |
| 37 | Typecheck (`tsc --noEmit`) | **FAIL (baseline-identical)** | 3 errors, all `tests/**`, same on `main` |
| 38 | Production build (`next build`) | **FAIL (baseline-identical)** | same 3 test errors; exit 0 only with `tests/**` excluded |
| 39 | Browser security suite | **NOT TESTED** | no browser obtainable |
| 40 | Disposable Neon branch (`migrate deploy` + `migrate status`) | **BLOCKED** | no credentials/network; cost approval required |
| 41 | `npm run test:db:erp` through the Prisma client | **BLOCKED** | needs a generated engine |
| 42 | Remaining 74-file source audit | **BLOCKED (scope)** | 32/106 traced in depth |
| 43 | Non-regression 499 / 2,000 / 3,000 and POS↔MJENGO separation | **PASS** | §10 |
| 44 | Merge / deploy / production migration | **NOT PERFORMED** | out of scope by instruction |

**Tally (counted mechanically from the table):** 44 rows — **31 PASS** (incl. 1 fix recorded) ·
**3 FAIL** (2 baseline-identical build/typecheck + 1 `mergeable_state: blocked`, none introduced by
this change) · **5 BLOCKED** (4 + 1 scope) · **4 NOT TESTED** (3 + 1 unknown-by-design) ·
**1 NOT PERFORMED** (merge/deploy).

**Release readiness: NO.** Not because the change is unsound — the database evidence is strong and the
non-regression evidence is clean — but because (a) the hosted-database gate has never run, (b) the
repo's build/typecheck gate is red on `main` too and cannot be greened in this environment, and (c) the
money path has never been exercised against a provider. Release needs 13, 24, 33, 37–41 resolved and a
separate written owner approval. PR #80 must stay **draft**.

---

## 12. Remaining work — ranked

1. **Hosted database (needs cost approval).** Create a disposable Neon branch; record its identity;
   `prisma migrate deploy`; `prisma migrate status`; run the orphan count and `VALIDATE CONSTRAINT`;
   then `npm run test:db:erp` and a two-tenant end-to-end matrix.
2. **Build/typecheck gate.** Needs `prisma generate` to succeed (network allowlist or a checked-in
   engine). Until then `next build` is red on every branch, and no amount of test exclusion changes
   that.
3. **Provider payment.** A Paystack **test-mode** payment for `MJENGO_OS` KES 2,000, then the
   confirmation → workspace → entitlement check. Must not be simulated; needs credentials.
4. **Browser suite.** Chromium download blocked; run the XSS + CSRF + cross-tenant matrix where a
   browser exists.
5. **Product storage separation.** `ErpSubscription`/`ErpEntitlement` are single-row-per-business, so
   MJENGO OS refuses to coexist with ERP_PRO (`STORAGE_CONFLICT`). Dedicated tables are an owner
   schema decision.
6. **Payroll** — no ledger exists; build one or keep the explicit BLOCKED label.
7. **Source audit** — 74 files title-scanned only.
8. **PR title/body.** Still "Draft: MJENGO OS preliminary TAWA audit" while carrying settlement,
   workspace and migration work. I have not rewritten it: the description is the owner's summary to
   approve.

---

## 13. Exact commands used

```bash
# ── diff reconciliation
gh api repos/POWERBot-1/Jata-Aftercall/pulls/80 \
  --jq '"base=\(.base.sha) head=\(.head.sha) files=\(.changed_files) +\(.additions) -\(.deletions) commits=\(.commits) draft=\(.draft) state=\(.mergeable_state)"'
git diff origin/main...HEAD --shortstat ; git diff origin/main..HEAD --shortstat
git diff 77e35cec..HEAD --shortstat                      # the +179,8xx figure's origin
git diff 77e35cec..origin/main --shortstat               # main's own post-fork churn
git rev-list --count origin/main..HEAD ; git rev-list --count HEAD..origin/main
git -c diff.algorithm=patience  diff 77e35cec..HEAD --shortstat    # and histogram / minimal
git diff --ignore-space-at-eol 77e35cec..HEAD --shortstat
gh pr diff 80 | wc -lc

# ── database (PGlite = PostgreSQL 18.6 wasm; never production)
npm run verify:mjengo:pg                 # 60 migrations + 29 checks, exit 0
npx vitest run tests/unit/mjengo-ledger-sql-postgres.test.ts

# ── application verification
npm run verify:mjengo:nav                # 11/11 links resolve, exit 0
npx vitest run tests/unit/mjengo-*.test.ts
npx vitest run                                                            # branch
(cd /tmp/baseline-main && npx vitest run)                                 # origin/main worktree
npx eslint app components lib                                             # both trees
npx tsc --noEmit                                                          # both trees
npx next build --webpack                                                  # both trees → FAIL (baseline-identical)
#   then the same build with "tests" added to tsconfig.exclude → exit 0 (tsconfig restored afterwards)

# ── HTTP evidence from a real production build
npx next start -p 3102 -H 0.0.0.0
for p in "" /sales /inventory /procurement /customers /accounting /workforce /reports /settings; do
  curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3102/dashboard/mjengo/biz1$p"   # 307 ×9
done
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3102/dashboard/mjengo/biz1/nope"  # 404 control
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'origin: https://evil.example' \
  -H 'content-type: application/json' -d '{}' http://127.0.0.1:3102/api/mjengo/branding       # 403
pkill -9 -f next-server
```

Artifacts (transient sandbox paths, regenerated by the commands above): `/tmp/verify-final.log`,
`/tmp/nav-final.log`, `/tmp/vitest-final.log`, `/tmp/vitest-baseline2.log`, `/tmp/lint-final2.txt`,
`/tmp/build-branch3.log`, `/tmp/build-base2.log`, `/tmp/build-notest2.log`, `/tmp/pr80.diff`.
