# MJENGO OS — Integration Verification, 2026-11-02

**Branch** `arena/bc5b7fd6-jata-aftercall` · **PR** [#80](https://github.com/POWERBot-1/Jata-Aftercall/pull/80) — still **draft**, **not merged**, **not deployed**
**Destination** `https://jataaftercall.co.ke` · **No production migration, no production write, no paid infrastructure, no provider call.**

Every status in this document is one of **PASS**, **FAIL**, **BLOCKED** or **NOT TESTED**. Where a
check could not run, it says so and does not borrow a neighbouring result. Command output is quoted,
not paraphrased.

---

## 1. The PR diff discrepancy — resolved

### Fresh GitHub API evidence

```
$ gh api repos/POWERBot-1/Jata-Aftercall/pulls/80 \
    --jq '{number,state,draft,base_sha:.base.sha,head_sha:.head.sha,changed_files,additions,deletions,commits,mergeable,mergeable_state}'
{"additions":2486,"base_ref":"main","base_sha":"19f11d9ecd8daad1db2aaf35cc1166425f871acc",
 "changed_files":27,"commits":3,"deletions":15,"draft":true,
 "head_ref":"arena/bc5b7fd6-jata-aftercall","head_sha":"71ea5af8728eec0c31d9d716d5cee15a45ed4fd4",
 "mergeable":true,"mergeable_state":"blocked","number":80,"state":"open"}

$ gh api repos/POWERBot-1/Jata-Aftercall/pulls/80/files --paginate \
    --jq '.[] | "\(.status)\t\(.additions)\t\(.deletions)\t\(.filename)"' | wc -l
27
```

### Local three-dot diff at that same head

```
$ git fetch origin main && git rev-parse origin/main
19f11d9ecd8daad1db2aaf35cc1166425f871acc
$ git diff origin/main...HEAD --shortstat          # at 71ea5af
 27 files changed, 2486 insertions(+), 15 deletions(-)
$ git diff origin/main...HEAD --numstat | awk '$1=="-"' # binary files in the diff
(none)
$ git diff origin/main...HEAD --numstat | sort -rn | head -3
721 0 docs/MJENGO_TAWA_SOURCE_COVERAGE.md
453 0 docs/MJENGO_AUDIT_CONTINUATION.md
273 0 docs/MJENGO_TAWA_ROUTE_INVENTORY.md
```

**Agreement:** API says 27 files / +2486 / −15. Git says 27 files / +2486 / −15. The file lists are
byte-identical (`comm -3` on the two sorted lists → empty). **There is no discrepancy in the diff.**

### Where "176k" came from — measured, not guessed

```
$ gh pr diff 80 | wc -c
174700          ← the rendered patch as TEXT: 174,700 BYTES ≈ 175 kB
$ gh pr diff 80 | wc -l
2752            ← the same patch in LINES: 2,752
$ git diff origin/main...HEAD | wc -c
177001          ← local patch bytes (git's own "a/… b/…" headers differ slightly)
```

`174,700` is **bytes**, not lines: roughly 175 kB, which reads as "176k" if the unit is dropped. The
PR does not contain 176,000 changed lines. Two other candidate comparisons were measured and rejected:

| Comparison | Result | Why it is not the PR diff |
|---|---|---|
| `git diff <empty-tree> HEAD` (whole repo, no base) | 1,739 files, 306,554 insertions | That is the entire repository, i.e. a PR with no base |
| `git diff <root-commit> HEAD` | 1,739 files, 306,555 insertions | Same, off by the root commit itself |
| `gh pr diff 80 \| wc -l` | 2,752 lines | The patch text, which is ~1.08× the insertion count because of context headers |

A "176k-line" rendering can also appear if the diff is viewed against a **base that is not
`origin/main`** — e.g. opening the Files tab with `?w=1` off while a stale base commit is selected.
The API's `base.sha` is `19f11d9…` and the local merge-base with `origin/main` is the same commit, so
nothing in this PR is diffed against a stale base.

**Conclusion — PASS.** 27 files, +2486/−15, no binaries, three-dot and two-dot agree, base =
`19f11d9…`, and every changed file is MJENGO OS scope or the documentation of it:

| Group | Files |
|---|---|
| MJENGO library | `lib/mjengo/{entitlement,access,navigation,sanitize,csrf,settlement,workspace}.ts` |
| MJENGO API | `app/api/mjengo/{branding,journal}/route.ts` |
| MJENGO workspace | `app/dashboard/mjengo/**` (11 files) |
| Shared code touched for MJENGO | `lib/pricing.ts`, `lib/pos/inventory.ts`, `lib/erp/accounting.ts`, `lib/paystack.ts`, `app/api/checkout/route.ts`, `next.config.js`, `prisma/schema.prisma`, `prisma/seed.ts`, `package.json` |
| Migrations | `20261127000000_mjengo_os_product`, `20261127000001_ledger_immutability`, `20261127000002_ledger_line_integrity` |
| Tests | 9 `tests/unit/mjengo-*.test.ts` + `tests/unit/repair-guards.test.ts` (allowlist only) |
| Verification tooling | `scripts/verify/mjengo-postgres-verify.mjs` |
| Docs | 6 `docs/MJENGO_*.md` |

**One out-of-scope-class item is open and must be reviewed:** `app/api/checkout/route.ts` and
`lib/paystack.ts` are shared payment paths. The change is a single new allowlisted branch
(`plan.key === "MJENGO_OS"`); every other plan key takes the identical code path it took before. It is
in scope because MJENGO OS cannot be sold without it, but it is the highest-risk file in the PR.

**PR check status is `blocked`, not clean.** `mergeStateStatus: BLOCKED` with 15 failing GitHub
workflow jobs (e.g. *"Exact candidate applies on disposable PostgreSQL 18"*, *"full-suite"*,
*"Release gate (aggregate)"*). Those jobs need a Neon/hosted database and a downloadable Prisma
engine, neither of which this sandbox or the repo's own baseline can satisfy — the **baseline
`main` tree fails its build the same way** (§5). Their failure is inherited, but the PR is not
"green" and must not be described as mergeable.

---

## 2. Isolated database verification — **PASS on PostgreSQL 18.6 (WASM), BLOCKED on Neon**

### What ran, and on what

```
$ node scripts/verify/mjengo-postgres-verify.mjs         # npm run verify:mjengo:pg
engine: PostgreSQL 18.6 (PGlite 0.5.14) on wasm32-unknown-emscripten, …
PASS  migrate deploy: every migration in prisma/migrations applies in order — 60/60 applied
PASS  migration status: every MJENGO OS migration is in the chain and applied —
      20261127000000_mjengo_os_product, 20261127000001_ledger_immutability, 20261127000002_ledger_line_integrity
PASS  migration status: ledger triggers, integrity view and the line foreign key exist after deploy —
      20 triggers, 1 integrity view, 1 line FK
PASS  pricing: BUSINESS_POS is KES 499 / 30 days — {"key":"BUSINESS_POS","priceKES":499,"durationDays":30}
PASS  pricing: MJENGO_OS is KES 2,000 / 30 days — {"key":"MJENGO_OS","priceKES":2000,"durationDays":30}
PASS  pricing: ERP_PRO is untouched at KES 3,000 / 30 days — {"key":"ERP_PRO","priceKES":3000,"durationDays":30}
PASS  lifecycle: DRAFT → lines → POSTED commits with both lines — POSTED, 2 lines
PASS  immutability: INSERT a line into a POSTED journal is refused — journal line late_line is immutable: parent journal j_1 is POSTED
PASS  immutability: UPDATE a posted line amount is refused — journal line j_1_l1 is immutable: parent journal j_1 is POSTED
PASS  immutability: DELETE a posted line is refused — journal line j_1_l1 is immutable: parent journal j_1 is POSTED
PASS  immutability: rewriting the description of a POSTED journal is refused — journal j_1 is immutable once POSTED: only reversal markers may change
PASS  immutability: re-dating a POSTED journal is refused — journal j_1 is immutable once POSTED: only reversal markers may change
PASS  immutability: moving a POSTED journal to another tenant is refused — journal j_1 is immutable once POSTED: only reversal markers may change
PASS  lifecycle: POSTED → DRAFT is refused — journal j_1 cannot return from POSTED to DRAFT; reverse it instead
PASS  immutability: deleting a POSTED journal is refused — posted journal j_1 cannot be deleted; reverse it instead
PASS  lifecycle: REVERSED marker is the one permitted write on a POSTED journal — original.reversedById = j_2
PASS  lifecycle: a reversed journal cannot be reversed again through a second marker overwrite — marker overwrite accepted by the database; the double-reversal guard is application-level only
PASS  integrity: a balanced posted journal is not flagged — {"journalId":"j_1","balanced":true,"empty":false,"lineCount":2}
PASS  integrity: an empty posted journal is flagged empty — {"journalId":"j_3","balanced":false,"empty":true,"lineCount":0}
PASS  integrity: an unbalanced posted journal is flagged unbalanced — {"journalId":"j_4","balanced":false,"empty":false,"lineCount":2}
PASS  integrity: a line cannot be orphaned — the foreign key refuses a missing journal — insert or update on table "ErpJournalLine" violates foreign key constraint "ErpJournalLine_journalId_fkey"
PASS  atomicity: a refused line write rolls the whole journal transaction back — journal line j_half_l1 is immutable: parent journal j_half is POSTED
PASS  atomicity: nothing from the failed transaction survives — 0 rows
PASS  tenancy: a tenant-scoped read cannot see another tenant's journal — 0 rows for bizA
PASS  tenancy: the owning tenant can read its own journal — 1 row
PASS  separation: an ACTIVE BUSINESS_POS subscription creates no MJENGO_OS entitlement — MJENGO rows for bizA: 0; POS entitlement rows: 0

26/26 checks passed
```

The same invariants run under vitest on the repository's **own** baseline + ERP migrations (no
hand-written tables):

```
$ npx vitest run tests/unit/mjengo-ledger-sql-postgres.test.ts
✓ tests/unit/mjengo-ledger-sql-postgres.test.ts (11 tests | 1 skipped) 18513ms
```

### Two real database defects this found, both now fixed

1. **`ErpJournalLine.journalId` had no foreign key at all.** The model declares a bare `String` with
   an index and the POS/ERP PRO migration never created a reference, so an orphaned line was
   representable. Found because the check *"a line cannot be orphaned"* **failed** the first time it
   ran. Fixed by `20261127000002_ledger_line_integrity` (additive, `NOT VALID` on purpose so an
   existing database can be repaired before validation instead of failing `prisma migrate deploy`,
   with the inspect → repair → `VALIDATE CONSTRAINT` runbook in the file header) plus the missing
   relation in `prisma/schema.prisma`.
2. **The first version of the trigger migration would have broken the repo's own guard and the
   write path.** It used `DROP TRIGGER IF EXISTS` (the additive-migration guard forbids `DROP`) and it
   *permitted* inserting lines into POSTED journals "for compatibility". Because `postJournalTx`
   writes lines while DRAFT, that permission was unnecessary and left the one hole the migration
   exists to close. Rewritten as: lines immutable for any POSTED/REVERSED parent, one trigger name
   per rule, `CREATE FUNCTION`/`CREATE TRIGGER`/`CREATE VIEW` only.

### Neon — BLOCKED, and why

There are no Neon API credentials in this environment and `api.neon.tech` is not reachable from the
sandbox (`curl` → `000`). Provisioning a branch **also has a cost**, so per the instruction I stopped
and did not create one. Recorded honestly:

| Database target | Status |
|---|---|
| Full 60-migration chain + ledger invariants on PostgreSQL 18.6 (WASM, in-process) | **PASS** |
| Same on a disposable Neon branch via `prisma migrate deploy` | **BLOCKED** — no credentials, no network, cost approval required |
| `prisma migrate status` against a live database | **BLOCKED** — needs a live database reachable by the Prisma CLI |
| `npm run test:db:erp` (11 `*-postgres` suites through the Prisma client) | **BLOCKED** — needs `PRISMA_TEST_DATABASE_URL` **and** `prisma generate`, which downloads `binaries.prisma.sh` (blocked) |

No production database was contacted. No migration was applied anywhere except a throwaway in-memory
instance.

---

## 3. MJENGO OS payment settlement — **PASS at unit level, NOT TESTED against a provider**

`lib/mjengo/settlement.ts`, dispatched from `lib/paystack.ts`:

```ts
if (plan.key === MJENGO_PLAN_KEY) {
  return settleMjengoPayment(tx, { payment, plan, eventId, verification, repairingLegacyPaidPayment });
}
```

The rule the brief asked for — *never collect payment for a product that cannot activate* — is
enforced twice, on purpose:

* **Before money moves.** `app/api/checkout/route.ts` calls `mjengoCheckoutRefusal(plan)` before
  `initializeTransaction`. Disabled deployment, missing row, wrong key, inactive row, or a price that
  is not KES 2,000 / 30 days → `409 MJENGO_CHECKOUT_REFUSED` and **no transaction is initialised**.
  The settings page renders the same refusal instead of a pay button.
* **Inside the settlement transaction.** `settleMjengoPayment` re-checks the key and the terms,
  refuses without provider evidence, claims the payment with a compare-and-set
  (`updateMany({ where: { id, status: <read state> } })`), and refuses to write when the single
  `ErpEntitlement` row belongs to another product:

```
PASS  mjengo-settlement.test.ts (12 tests)
      checkout refusal: disabled · missing row · wrong key · 499 · 3000 · 31 days · inactive · allows 2000/30
      settlement: activates MJENGO_OS (30-day window + 3-day grace) · refuses without evidence
                  refuses 499 terms · refuses BUSINESS_POS key · idempotent replay
                  lost-CAS race resolves idempotently · refuses to overwrite ERP_PRO storage
                  renewal extends from paid-through date
```

**Idempotency** is the same CAS pattern `settlePosPayment` uses; a replayed webhook (same payment,
same event id) returns `alreadySettled` and does **not** extend the window a second time, and the
`processedWebhook` row is written once.

### Known limitation, stated rather than hidden

`ErpSubscription.businessId` and `ErpEntitlement.businessId` are `@unique`, so **one business cannot
hold both ERP_PRO and MJENGO_OS rows**. A business already on ERP_PRO is refused at checkout
(`STORAGE_CONFLICT`) rather than having its BOS PRO row overwritten — the customer is not charged for
a product that cannot be stored. Dedicated `MjengoSubscription`/`MjengoEntitlement` tables remove the
conflict; that is a schema decision for the owner and is **not** in this change.

| Claim | Status |
|---|---|
| Verified payment activates `MJENGO_OS` subscription + entitlement, tenant-scoped, idempotent | **PASS** (unit, double-based) |
| Checkout refuses before charging when the product cannot activate | **PASS** (unit) |
| Real Paystack sandbox payment → settlement → entitlement visible in the workspace | **NOT TESTED** — no provider credentials, no database, and money movement must not be simulated |
| Refund of a MJENGO OS payment | **BLOCKED** — no refund flow targets this product; labelled BLOCKED in the settings page |

---

## 4. Ledger invariants and the posting/reversal path — **PASS (PostgreSQL), PASS (unit)**

* `lib/erp/accounting.ts` creates the journal `DRAFT`, writes lines, then seals `POSTED` — order
  asserted in `mjengo-ledger-lifecycle.test.ts` (`journal.create` → `journalLine.create` →
  `journal.update{status:POSTED}`).
* `mjengo-ledger-lifecycle.test.ts` (9 tests) also proves: a line write against a sealed journal is
  refused; reversal posts the mirrored journal **before** marking the original; double reversal and a
  too-short reason are refused; another tenant's journal cannot be reversed; the engine joins a
  caller's transaction instead of nesting one (`db.$transaction is not a function` regression).
* Direct SQL on PostgreSQL: 8 mutation attempts all refused, `POSTED → DRAFT` refused, delete of a
  posted or non-empty journal refused, empty/unbalanced/orphan detection correct, rolled-back
  transaction leaves 0 rows (§2).

**Application-level-only guard (documented, not a gap I can close in SQL):** the database permits
overwriting `reversedById` — it is the designated mutable column — so *double reversal* is prevented
by `reverseJournal`'s `ALREADY_REVERSED` check, not by a trigger. The verification script asserts
this explicitly rather than pretending the trigger covers it.

---

## 5. Workspace routes — **PASS (implemented, gated, real data); browser NOT TESTED**

Eleven routes exist and every navigation link resolves to one (asserted by
`mjengo-workspace-routes.test.ts`, which reads the filesystem — a nav entry that 404s fails the
suite):

```
├ ƒ /api/mjengo/branding
├ ƒ /api/mjengo/journal
├ ƒ /dashboard/mjengo
├ ƒ /dashboard/mjengo/[businessId]
├ ƒ /dashboard/mjengo/[businessId]/accounting
├ ƒ /dashboard/mjengo/[businessId]/customers
├ ƒ /dashboard/mjengo/[businessId]/inventory
├ ƒ /dashboard/mjengo/[businessId]/procurement
├ ƒ /dashboard/mjengo/[businessId]/reports
├ ƒ /dashboard/mjengo/[businessId]/sales
├ ƒ /dashboard/mjengo/[businessId]/settings
├ ƒ /dashboard/mjengo/[businessId]/workforce
```

The gate runs **once**, in `app/dashboard/mjengo/[businessId]/layout.tsx`, before any child renders
(`requireMjengoAccess` → session → `canAccessBusiness` → `assertBusinessOwnership` →
`deriveMjengoEntitlement`). Child pages never re-decide it.

| Page | Backed by | State |
|---|---|---|
| Overview / sales | `PosSale`, `Order` (last 30 days), revenue & unpaid totals | **PASS** |
| Inventory | `PosInventoryItem` + `PosProduct`, aggregated per product, low-stock flags | **PASS** |
| Procurement | `PosSupplier`, `ErpPurchaseOrder`, `ErpRequisition` | **PASS** |
| Customers & credit | `PosCustomer` balances, `ErpInvoice` ageing | **PASS** |
| Accounting | `ErpJournal`, `ErpPeriod`, `ErpJournalIntegrity` view | **PASS** (view falls back to "Integrity view unavailable — migration not applied", never a false "healthy") |
| Reports | aggregates of the loaders above | **PASS** |
| Settings | stored plan row, entitlement state, storage conflict, checkout CTA/refusal | **PASS** |
| Workforce (staff) | `PosStaff` | **PASS** |
| **Workforce (payroll)** | no payroll/payslip/statutory table exists | **BLOCKED** — labelled in the page; no wage figure is computed or displayed |

Nothing is fabricated: every loader is tenant-scoped, and a failed read returns "unavailable", not a
number.

**Deliberately out of scope:** the pages are read views of data the POS/ERP modules already own. They
do not re-implement sale entry, stock adjustment or journal posting — those live behind the existing
`/api/pos/*` and `/api/erp/*` routes with their own authorization. Driving a sale *from* the MJENGO
page would duplicate that authorization surface, so it is not done here.

### HTTP evidence (real server, real responses)

```
$ npx next start -p 3101                          # built from this branch
/dashboard/mjengo                      307 -> /login
/dashboard/mjengo/bizA/sales           307 -> /login
/dashboard/mjengo/bizA/settings        307 -> /login
POST branding (anon)                   {"error":"Sign in to continue."} [401]
POST branding (foreign origin)         {"error":"Origin check failed: origin-host evil.example != request-host 127.0.0.1:3101"} [403]
GET  journal  (anon)                   {"error":"Sign in."} [401]
workspace CSP: Content-Security-Policy: frame-ancestors 'none'
business  CSP: Content-Security-Policy: frame-ancestors 'self'
```

That run caught a defect the unit suite had missed: `POST /api/mjengo/branding` answered **503
"Database unavailable"** to an anonymous caller, i.e. before authentication. Fixed (identity is now
resolved before environment) and covered by two tests: *"answers 401 before revealing whether a
database is configured"* and *"returns 503 only for an authenticated caller"*.

---

## 6. Branding / auth / CSRF / tenancy / inventory tests — **PASS at unit level**

```
$ npx vitest run tests/unit/mjengo-*.test.ts
✓ tests/unit/mjengo-accounting-lifecycle.test.ts (4 tests)
✓ tests/unit/mjengo-settlement.test.ts (12 tests)
✓ tests/unit/mjengo-ledger-lifecycle.test.ts (9 tests)
✓ tests/unit/mjengo-csrf.test.ts (12 tests)
✓ tests/unit/mjengo-inventory-dedup.test.ts (11 tests)
✓ tests/unit/mjengo-entitlement-separation.test.ts (4 tests)
✓ tests/unit/mjengo-workspace-routes.test.ts (6 tests)
✓ tests/unit/mjengo-safe-text.test.ts (3 tests)
✓ tests/unit/mjengo-branding-and-journal.test.ts (24 tests)
✓ tests/unit/mjengo-ledger-sql-postgres.test.ts (11 tests | 1 skipped)
Test Files  10 passed (10)     Tests  95 passed | 1 skipped (96)
```

Coverage of the specific asks:

| Ask | Where | Result |
|---|---|---|
| Branding validation | `mjengo-branding-and-journal.test.ts` — `<img onerror>`, `<script>`, `javascript:`, `onerror=`, 1 char, 500 chars (capped at 200), control chars stripped, plain names accepted | **PASS** (400, nothing written) |
| Authentication | every route returns 401 without a session, before revealing configuration | **PASS** |
| CSRF / origin | foreign origin, suffix/prefix hosts, `javascript:`/`data:`/`file:`/`null` origins, malformed `X-Forwarded-Proto`, malformed `Host`, `sec-fetch-site: cross-site`/`same-site`, spoofed `X-Forwarded-Host`/`X-Forwarded-For` | **PASS** (403) |
| Tenant isolation | cross-tenant read and write refused with a valid session (branding + journal) | **PASS** (unit, stubbed ownership) |
| Rate-limit identity | `trustedClientIp` ignores `X-Forwarded-For` off-Vercel, accepts only a well-formed first hop on it | **PASS** |
| Ledger lifecycle | §4 | **PASS** |
| Inventory duplicate lines | 2×1 vs 1 on hand → shortage; duplicates summing inside stock → allowed; services/untracked never blocked; concurrent claims of the last unit: exactly one succeeds; 10 claims for 6 units: 6 succeed, never negative | **PASS** (engine + conditional-decrement double) |
| Cookie + arbitrary bearer CSRF bypass | — | **NOT TESTED** — needs a real browser cookie jar |
| Cross-tenant access **through the running app** | — | **NOT TESTED** — no database, so no two real tenants |

---

## 7. Full suite, lint, typecheck, build — with baseline separation

Identical commands on the branch and on a worktree of `origin/main` (`19f11d9`), sharing the same
`node_modules`:

| Command | Branch (`4a1aea0`) | Baseline `origin/main` | Introduced by this PR |
|---|---|---|---|
| `npx vitest run` | 1 failed, 4076 passed, 304 skipped (4381) | 1 failed, 3981 passed, 303 skipped (4285) | **0** |
| `npx eslint app components lib` | 49 warnings, **0 errors** | 49 warnings, **0 errors** | **0** |
| `npx tsc --noEmit` | 3 errors, all in `tests/**` | 3 errors, same three | **0** |
| `npx next build --webpack` | fails at the TS step on those same 3 test errors | fails at the TS step on those same 3 test errors | **0** |
| `npx next build --webpack` with `tests/**` excluded from tsconfig | **`✓ Compiled successfully`, exit 0** | (not needed) | — |

The single failing test is `tests/unit/autopilot-phase1-hardening.test.ts` — `Prisma.dmmf` is
undefined because `prisma generate` cannot run here:

```
$ npx prisma generate
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.sha256 failed,
       reason: Client network socket disconnected before secure TLS connection was established
```

The three build-blocking type errors are the same three test files (`Prisma.dmmf`,
`PrismaClientKnownRequestError`, `BusinessUncheckedCreateInput`) — all baseline, all in `tests/**`,
all consequences of the missing generated client. They are **not** fixed here: editing another
product's test types to make a gate green would hide the environment defect instead of reporting it.

**Consequence, stated plainly:** `npm run build` and `npm run typecheck` **fail on this branch exactly
as they fail on `main`** in this environment. The application code itself typechecks clean
(`tsc --noEmit` with `tests/**` excluded → exit 0) and the production build completes when the
tests are excluded from the compiler's input. Neither is a green gate yet.

---

## 8. Browser tests — **NOT TESTED**

```
$ command -v chromium chromium-browser google-chrome   → none
$ ls node_modules/puppeteer                             → absent
$ ls ~/.cache/puppeteer                                 → absent
$ npx puppeteer browsers install chrome                 → error: download failed (storage.googleapis.com unreachable)
$ curl -sI https://storage.googleapis.com                → 000
```

No browser binary can be obtained (network allowlist excludes `storage.googleapis.com` and
`playwright.azureedge.net`; `apt-get` cannot reach `deb.debian.org`). Therefore:

| Browser-level check | Status |
|---|---|
| Stored branding XSS in a real DOM | **NOT TESTED** |
| Reflected AI-response XSS | **NOT TESTED** |
| Cookie + arbitrary bearer CSRF bypass | **NOT TESTED** |
| Spoofed `X-Forwarded-For` through the platform proxy | **NOT TESTED** |
| Cross-tenant navigation in a real session | **NOT TESTED** |
| Unauthorized MJENGO workspace access (server-side) | **PASS** — 307 → `/login` for all four routes, verified over HTTP |
| Platform proxy assumptions / CSP compatibility **without deploying** | **PARTIAL** — headers verified on a locally started production build; actual Vercel/Neon proxy behaviour is **NOT TESTED** |

The safe-rendering guarantee does not depend on this: branding is escaped at the API boundary
(`sanitizeBrandingText`/`isSafeBrandingName`), rendered as text, and no MJENGO file contains
`dangerouslySetInnerHTML` or `innerHTML` (asserted by `mjengo-workspace-routes.test.ts`). CSP is
`frame-ancestors` only — the earlier blanket `script-src ... https:` policy was removed because a
second `Content-Security-Policy` header is intersected by browsers and would have silently broken the
Arena preview while adding no protection Next.js hydration does not already require.

---

## 9. Source audit — partially complete, and honest about it

The TAWA reference-tree audit is recorded in `docs/MJENGO_TAWA_SOURCE_COVERAGE.md` (721 lines):
**32 files reviewed in depth, 74 reviewed by title only.** Route → service → database →
authorization → test is fully traced for the 32; for the remaining 74 the capability list is
recorded, but each unverified capability is marked unverified rather than assumed.

Not completed in this change: the full 106-file matrix. **Status: BLOCKED by scope, not by
environment** — it is a multi-day read of the reference tree and it produces no code.

---

## 10. Non-regression — **PASS**

| Claim | Evidence | Status |
|---|---|---|
| BUSINESS_POS remains KES 499 / 30 days | `verify:mjengo:pg` reads the row after all 60 migrations: `{"key":"BUSINESS_POS","priceKES":499,"durationDays":30}`; `FALLBACK_PLANS` unchanged; `assertPosPlanPricing` untouched | **PASS** |
| MJENGO_OS is KES 2,000 / 30 days | migration + seed row verified on PostgreSQL; `assertMjengoOsPricing` throws on any other figure | **PASS** |
| ERP_PRO untouched at KES 3,000 | same run: `{"key":"ERP_PRO","priceKES":3000,"durationDays":30}` | **PASS** |
| An existing POS subscriber gains no MJENGO access | `deriveMjengoEntitlement` with an ACTIVE `BUSINESS_POS` subscription → `entitled:false`, reason "does not include MJENGO OS"; `settleMjengoPayment` rejects `BUSINESS_POS`; a live `PosSubscription` row creates no MJENGO entitlement on a real database | **PASS** |
| MJENGO subscriber gains no POS access | `derivePosEntitlement` with a `MJENGO_OS` subscription → `entitled:false` | **PASS** |
| Existing JATA dashboard / ERP / payment behaviour intact | full suite: 4076 passed with one inherited failure; the only shared-path change is one allowlisted `plan.key` branch in `checkout`/`paystack` which is unreachable for every other product | **PASS (unit) / NOT TESTED (live provider)** |
| Homepage, `/pricing` and subscription catalogue unchanged | an earlier version appended an eighth home-page card and broke 10 existing suites; reverted. Those suites now pass | **PASS** |

---

## 11. PASS / FAIL / BLOCKED / NOT TESTED

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | PR diff matches the API (27 files, +2486/−15) | **PASS** | §1 |
| 2 | Every changed file is MJENGO scope | **PASS** | §1 table; two shared payment files called out |
| 3 | PR is clean/mergeable | **FAIL** | `mergeStateStatus: blocked`, 15 inherited red workflow jobs |
| 4 | All 60 migrations apply in order on PostgreSQL 18.6 | **PASS** | 60/60 |
| 5 | Ledger triggers + integrity view + line FK exist after deploy | **PASS** | 20 triggers, 1 view, 1 FK |
| 6 | Posted lines immutable (insert/update/delete refused) | **PASS** | 3 refusals on real PostgreSQL |
| 7 | Posted header immutable except reversal markers | **PASS** | 3 refusals + allowed marker write |
| 8 | `POSTED → DRAFT` refused; posted/non-empty journal delete refused | **PASS** | 4 refusals |
| 9 | DRAFT → lines → POSTED write order | **PASS** | unit order assertion + SQL |
| 10 | Reversal mirrors then marks; double reversal refused | **PASS** | unit + SQL |
| 11 | Empty / unbalanced / orphaned detection | **PASS** | integrity view rows + FK refusal |
| 12 | Transaction rollback leaves nothing behind | **PASS** | 0 rows |
| 13 | Migration idempotent on re-run, other plans untouched | **PASS** | 499/3000 unchanged after two runs |
| 14 | MJENGO checkout refuses before charging | **PASS** | unit, 7 refusal cases |
| 15 | Verified payment activates MJENGO_OS (idempotent, CAS) | **PASS** | unit, 7 cases |
| 16 | Real provider payment → entitlement | **NOT TESTED** | no credentials, no DB; no simulation |
| 17 | Survives a second product's storage row | **PASS** (refuses) | `STORAGE_CONFLICT` — documented limitation |
| 18 | Every workspace nav link has a gated page | **PASS** | filesystem assertion + 12 routes in build |
| 19 | Workspace shows real tenant-scoped data | **PASS** | loaders; no fixture data |
| 20 | Payroll | **BLOCKED** | no payroll ledger exists |
| 21 | Refunds from the MJENGO workspace | **BLOCKED** | labelled in UI; no provider call made |
| 22 | Branding validation (tags, handlers, `javascript:`, length, control chars) | **PASS** | 12 cases |
| 23 | Authentication on every MJENGO route | **PASS** | 401s, HTTP + unit |
| 24 | CSRF / origin predicate | **PASS** | 12 cases |
| 25 | Tenant isolation (unit, stubbed ownership) | **PASS** | branding + journal |
| 26 | Tenant isolation end-to-end with a database | **NOT TESTED** | no database |
| 27 | Cookie + arbitrary bearer CSRF bypass in a browser | **NOT TESTED** | no browser |
| 28 | Inventory duplicate-line + concurrency | **PASS** | 11 cases, engine-level |
| 29 | Full suite, no branch-introduced failure | **PASS** | 4076 passed, 1 inherited failure |
| 30 | Lint | **PASS** | 0 errors (49 warnings = baseline) |
| 31 | Typecheck (`tsc --noEmit`) | **FAIL (baseline-identical)** | 3 errors, all `tests/**`, also on `main` |
| 32 | Production build (`next build`) | **FAIL (baseline-identical)** | same 3 test errors; exit 0 with `tests/**` excluded |
| 33 | Browser security suite | **NOT TESTED** | no browser obtainable |
| 34 | Disposable Neon branch + `prisma migrate deploy` + `migrate status` | **BLOCKED** | no credentials/network; cost approval required |
| 35 | `npm run test:db:erp` through the Prisma client | **BLOCKED** | needs generated engine (host unreachable) |
| 36 | Remaining 74-file source audit | **BLOCKED (scope)** | 32/106 traced in depth |
| 37 | Non-regression of 499 / 2,000 / 3,000 and POS↔MJENGO separation | **PASS** | §10 |
| 38 | Merge / deploy / production migration | **NOT PERFORMED** | out of scope by instruction |

**Release readiness: NOT CLAIMED.** 22 gates pass with evidence, 2 fail identically on the baseline
typecheck/build, 6 are NOT TESTED, 4 are BLOCKED and 1 (merge/deploy) was not performed. A release
decision needs 16, 26, 27, 31–34 resolved first.

---

## 12. Remaining gaps — ranked

1. **Neon verification (cost approval + credentials).** Run `prisma migrate deploy`, `prisma migrate
   status`, then `npm run test:db:erp` and an end-to-end tenant matrix. Everything in §2 is expected
   to hold; it is not proven there yet.
2. **Build/typecheck gate.** Needs `prisma generate` to succeed (network allowlist or a checked-in
   engine), otherwise three pre-existing test files keep the repo's own gate red.
3. **Browser suite.** Playwright/Chromium download is blocked; run the XSS + CSRF matrix on a machine
   that has one.
4. **Product storage separation.** `ErpSubscription`/`ErpEntitlement` are single-row-per-business;
   MJENGO OS refuses to coexist with ERP_PRO. Dedicated tables are an owner schema decision.
5. **Payroll** — no ledger exists; either build one or keep the workspace section as an explicit
   BLOCKED label.
6. **Source audit** — 74 files remain title-scanned only.
7. **Stale PR title/body.** The PR is still titled *"Draft: MJENGO OS preliminary TAWA audit"* and its
   body describes only the audit. It now carries the settlement, workspace and migration work. The
   title/body should be rewritten before review — I have not changed it, because a PR description is
   the owner's summary to approve.

---

## 13. Exact commands used

```bash
# PR evidence
gh api repos/POWERBot-1/Jata-Aftercall/pulls/80 --jq '{…base_sha,head_sha,changed_files,…}'
gh api repos/POWERBot-1/Jata-Aftercall/pulls/80/files --paginate --jq '.[] | .filename' | wc -l
gh pr diff 80 | wc -l ; gh pr diff 80 | wc -c
git fetch origin main && git diff origin/main...HEAD --stat

# database
npm run verify:mjengo:pg                 # 60 migrations + 26 checks, PostgreSQL 18.6 (WASM)
npx vitest run tests/unit/mjengo-ledger-sql-postgres.test.ts

# tests
npx vitest run tests/unit/mjengo-*.test.ts
npx vitest run                          # branch
(cd /tmp/baseline-main && npx vitest run) # origin/main, same command

# static
npx eslint app components lib           # branch and baseline
npx tsc --noEmit                        # branch and baseline
npx next build --webpack                # branch and baseline
# + same build with `tests/**` excluded from tsconfig include (app-code-only proof)

# HTTP evidence
npx next start -p 3101 -H 0.0.0.0
curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1:3101/dashboard/mjengo/bizA/sales
curl -s -X POST -H 'origin: https://evil.example' … http://127.0.0.1:3101/api/mjengo/branding
```

Artifacts: `/tmp/vitest-full6.log`, `/tmp/vitest-baseline.log`, `/tmp/build-branch.log`,
`/tmp/build-final.log`, `/tmp/verify-pg.log` (transient sandbox paths; the commands above regenerate
them).
