# JATA AFTERCALL — Consolidated remediation report (2026-10-02)

Branch `arena/01a0fde9-jata-aftercall` · PR **#20** · head commit **5cccb5e** (on `main` @ `8c81bb9`)

One framework, one payment stack: this work reconciles the plan catalogue, closes a
publication-gate gap, repairs the test baseline and proves the canonical journey end-to-end.
No second payment or subscription system was created; no schema, migration, seed or Paystack
configuration was changed.

---

## 1. What was wrong

| # | Defect | Evidence |
|---|---|---|
| D1 | The UI carried a **hardcoded, incomplete plan catalogue**: `app/page.tsx` declared only Annual + Monthly, so two of the four commercial offerings were invisible on the landing page. | code inspection; `tests/unit/plan-catalogue.test.ts` now pins it |
| D2 | There was **no way to reconcile the database catalogue** with the canonical four offerings without running the general seed (which also writes users, businesses, subscriptions and payments). The previously authorized implementation is not in Git (see §3). | no script/route existed; `49e7410` absent locally and on the remote |
| D3 | **Publication-gate gap in the API**: `GET /api/services?businessId=…` documented "public reads are limited to a published business" but returned services for *any* business id — a draft/unpaid business's catalogue was publicly readable while `/b/[slug]` correctly 404s. | `tests/security/services-publication-access.test.ts` (7 tests) |
| D4 | **`main` was red**: `npm test` failed on `tests/unit/repair-guards.test.ts:89` (and `:91`) because commit `8c81bb9` had to add a nullable `Service.updatedAt` + NULL-only backfill + `SET NOT NULL` to make the commerce migration applicable to a non-empty table (production Vercel deploy `a8c7eff` failed at that migration; `8c81bb9` fixed it and deployed successfully). | local suite failure reproduced on `8c81bb9`; commit + deployment statuses |
| D5 | The **canonical AFTERCALL journey had no real-database gate**: only the Interactive (KES 999) journey ran in CI, so create → configure → edit → preview → choose plan → pay → verify → activate → publish → public page on the entry plan, the four-offering catalogue, and payment/subscription/publication ownership were unproven. | new `tests/e2e/canonical-journey.test.ts` |

Earlier production diagnostics remain as-is: **PR #16 is untouched and still open** (its
request-correlated, redacted diagnostics and history are intact).

## 2. What was remediated

* **Plan catalogue is database-driven and complete** — one declaration
  (`lib/canonicalPlans.ts`) now feeds the landing page, the pricing fallbacks and the
  reconciliation, so no page can carry a partial list again. The four canonical offerings:
  Monthly KES 149/30 · Annual KES 999/365 · AI Business Front Desk KES 499/30 (active) ·
  Interactive Business KES 999/30 (active).
* **Narrow reconciliation replaces the seed for this purpose** —
  `scripts/reconcile-plans.ts` (`npm run reconcile:plans`):
  * writes **only** to `PlanConfig`; never users, businesses, subscriptions, payments, referrals, entitlements or audit history;
  * upserts **by key** so existing rows keep their `id` and their subscriptions stay attached;
  * never deletes and never deactivates; non-canonical rows are reported and left alone;
  * dry run by default (`-- --apply` to write); refuses without `DATABASE_URL`; logs a **redacted** target fingerprint; verifies its own result and exits non-zero if the catalogue is still wrong.
* **Manual operator path** for the authorized production run:
  `.github/workflows/reconcile-plans.yml` (`workflow_dispatch` only, typed confirmation
  `RECONCILE-PLAN-CATALOGUE`, `DATABASE_URL` repository secret, dry run always reported, no
  seed/migration/deploy).
* **Publication gate closed** — `GET /api/services` now serves guests only published,
  non-suspended businesses and unlocks a draft solely for an owner/admin session (404
  otherwise, so a draft's existence is not confirmed).
* **Test baseline repaired** — the migration guard strips only the exact sanctioned
  nullable-`ADD COLUMN` + NULL-only-`UPDATE` + `SET NOT NULL` pair, keeps every
  destructive-operation assertion, and a new test pins that exception as narrow. No
  migration file was changed back.
* **Canonical journey gate added** — see §7.

## 3. Recovered / reconstructed work

* The missing plan-reconciliation implementation (`49e7410`) **does not exist anywhere in
  Git**: it is not an object locally, not on the remote, in any ref/branch, or retrievable
  through the GitHub API (verified with `git cat-file`, `git log --all`, `git ls-remote`,
  `gh api …/commits/49e7410`). Per the mandate, recovery was not chased further.
* It was therefore **reconstructed from the documented intended behaviour** in commit
  `89c4993`, whose message states plainly that it is a new reconstruction and **not** that
  commit. Everything else on `main` (including PR #16's diagnostics branch and PR #19's
  merged Interactive work) was left intact; nothing was deleted, reverted or overwritten.

## 4. Exact files changed

| File | Change |
|---|---|
| `lib/canonicalPlans.ts` | **new** — the four offerings + pure reconciliation decision |
| `scripts/reconcile-plans.ts` | **new** — PlanConfig-only reconciliation CLI |
| `lib/pricing.ts` | fallback now derives from the canonical catalogue |
| `app/page.tsx` | landing page renders the shared catalogue (was a hardcoded 2-plan list); grid fits four offerings |
| `app/api/services/route.ts` | publication/suspension gate on the public services read |
| `package.json` | `reconcile:plans` script; `test:e2e` runs the whole `tests/e2e/` directory |
| `tests/unit/plan-catalogue.test.ts` | **new** — 17 tests (offerings, id preservation, CLI scope, DB-driven UI) |
| `tests/unit/repair-guards.test.ts` | sanctioned-backfill guard repaired + narrowed-exception test |
| `tests/security/services-publication-access.test.ts` | **new** — 7 tests for the services gate |
| `tests/e2e/canonical-journey.test.ts` | **new** — 12 real-database journey steps |
| `.github/workflows/interactive-business-e2e.yml` | runs the plan reconciliation (dry run → apply → verify) before both journey suites |
| `.github/workflows/reconcile-plans.yml` | **new** — manual, confirmation-gated production reconciliation |

Commits: `89c4993` (reconstruction), `a6dc633`, `4f87984`, `a907d05`, `5cccb5e`.
No `.env` file, secret, destructive database operation or schema/migration change is included.

## 5. Tests and checks (local, on `5cccb5e`)

| Check | Result |
|---|---|
| `npm test` | **61 files, 547 passed, 29 skipped** (the E2E files skip without `DATABASE_URL`); on `main` the same command failed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | exit 0 — only the two pre-existing warnings (`MediaPicker.tsx:45`, `CartProvider.tsx:210`) |
| `npm run build` | `[build] Build completed successfully` (offline fallback path; shared JS 103 kB) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (all) | 1 high, **dev-only** transitive (`brace-expansion` via eslint tooling); not changed, as fixing it is unrelated lockfile churn with no production exposure |

Regression tests were added for every defect actually fixed: D1/D2 (plan catalogue + CLI scope),
D3 (services gate), D4 (migration-backfill guard). D5 is itself the new evidence.

## 6. PR and commits

* **PR #20** — https://github.com/POWERBot-1/Jata-Aftercall/pull/20 (against `main`, mergeable)
* Head commit **`5cccb5e`**; branch `arena/01a0fde9-jata-aftercall`; no force-push, no branch deletion, PR #16 untouched.

## 7. Preview / E2E evidence

* **GitHub Actions, real PostgreSQL 16** — run **37050537047** (job `110982541992`) on `5cccb5e`:
  * `prisma generate` ✅ · `prisma migrate deploy` ✅ · `npm run seed` ✅
  * **`Reconcile the plan catalogue (dry run, apply, verify)` ✅** — the production reconciliation command exercised against a real database
  * **`Run the journey suites (§66 + canonical)` ✅** — the Interactive Business journey (17 steps) and the new canonical journey (12 steps)
* **Canonical journey asserted on the real database** (`tests/e2e/canonical-journey.test.ts`):
  1. register → business row + OWNER membership
  2. configure profile + service
  3. edit persists
  4. preview: the owner renders the unpublished page (business name present), a guest is refused by the page module itself
  5. the catalogue holds all four canonical offerings, both new plans active, prices/durations exact
  6. plan selection: Monthly payment stored at **14900 kobo** while the request body claims `amount: 1` / `priceKES: 1`; every canonical offering checked out through the same route at its server-derived amount (99900 / 14900 / 49900 / 99900); cross-tenant checkout → **403**
  7. before payment: owner PATCH → **403** with the documented safe message, studio publish → **403 `requires: "PAYMENT"`** (with a real draft present), anonymous direct API → **401**, row still unpublished, public page still refused
  8. verify → `PAID` + subscription `ACTIVE` for the right tenant, ~30-day window, idempotent re-verify (one payment, one subscription)
  9. another tenant cannot read the payment (**403**) nor publish the business (**403**)
  10. publish → public `/b/[slug]` **renders for a guest** with the edited name and the service, and the services API is public (**200**)
  11. unpublish hides the page again; republish restores it (no owner lock-out)
  12. an unpaid second business can build but not publish (**403**), and its services API returns **404** to a guest
* **Vercel Preview** for `5cccb5e`: deployment succeeded (`2HBFyvAaHoweRU4eJ62KyZqogCCk`), preview URL
  `https://jata-aftercall-git-arena-01a0fde9-jata-aftercall-powerbot-1.vercel.app`. This is the
  normal Preview automation that follows the PR; **no production deployment was invoked**.
* **Paystack test mode**: the CI environment runs with `PAYSTACK_SECRET_KEY` unset and
  `NODE_ENV != production` (asserted in the journey's `beforeAll`), so payments settle through
  the application's own test-settlement branch — the same `activateSubscriptionForPayment`
  function the Paystack webhook calls. **No real money and no production database were used.**

## 8. Production PlanConfig evidence

**Not executed — blocked, not skipped silently.** This sandbox has no production
`DATABASE_URL` (no `.env`, no Vercel/Neon credentials, and repository secrets are not readable
with the session's permissions), so the authorized reconciliation could not be run against
production from here, and no production database was touched.

Exact operator steps (already implemented, dry run first):

```bash
DATABASE_URL=<production url> npm run reconcile:plans             # dry run: prints the plan
DATABASE_URL=<production url> npm run reconcile:plans -- --apply  # apply + self-verify
```

or, after this PR is merged, dispatch **Actions → “Reconcile plan catalogue”** with
`mode=apply` and confirmation `RECONCILE-PLAN-CATALOGUE` (requires the `DATABASE_URL`
repository secret). Both paths write only the four `PlanConfig` rows and print a redacted
target fingerprint plus per-key verification.

## 9. Remaining blockers

1. **Production PlanConfig reconciliation is an operator action** (§8): no production
   database credential is available in this environment. Everything needed to run it safely is
   in place and proven against the CI database.
2. **Deploy note (no action unless it appears):** the `20260930000000_commerce_baseline`
   migration file was amended by `8c81bb9` to make it applicable to a non-empty `Service`
   table. Production applied the current content successfully (`8c81bb9` deployment = success),
   so nothing needs to change there. If some *other* environment reports *“migration … was
   modified after it was applied”*, the schema is already present — use the repo's existing
   baseline procedure (`prisma migrate resolve --applied <migration>`, README/runbook §3)
   rather than editing the migration back; the DDL is `IF NOT EXISTS`-guarded.
3. **Dev-only advisory** (`brace-expansion`, high, eslint toolchain) — production dependencies
   audit clean; deliberately not fixed here to keep the lockfile out of this remediation.
4. **PR #16 remains open** with its diagnostics untouched, to be merged or closed on its own
   merits; nothing in this PR depends on it.
