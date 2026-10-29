# JATA AFTERCALL — Plan Catalogue Audit and Targeted Repair

**Date:** 2026-10-29
**Repository:** `POWERBot-1/Jata-Aftercall`
**Deployed commit audited:** `d49d6052fd0e3a487e88b7fa2b34d6a840d03a78` (Vercel Production deployment `7410857599`, state `success`)
**Work branch:** `arena/df1ff801-jata-aftercall`

## Status at a glance

| Phase | Status | Why |
| --- | --- | --- |
| 1 — authoritative catalogue from repository evidence | **PASS** | Every intended plan, key, price, duration and visibility rule is named in the code; see §2. |
| 2 — read-only production audit | **PASS** | Completed with owner-supplied Neon query output on 2026-10-29: **8 rows, all active, all prices and durations correct**. No credential entered this environment; the query text is quoted in Part II §12. |
| 3 — Autopilot repair | **PASS — NO WRITE NEEDED** | All three Autopilot rows already exist at 2,499 / 6,999 / 19,999 with 30-day periods and `isActive = true`. **0 rows written**, and none should be. The prepared SQL in §5 is retained but must not run. |
| 3 — POS / ERP-Oro changes | **ERP NOT AUTHORISED / NOT RUN** | `BUSINESS_POS` is present and correct. `ERP_PRO` is absent and `ERP_PRO_ENABLED` is unset; the prepared insert and flag change are in Part II §14 and were **not** executed. |
| 4 — application verification | **PASS (public) / NOT TESTED (authenticated)** | Live `/`, `/pricing`, `/products`, `/products/business-pos` and `/health` verified through an external fetcher (Part II §15). `/onboarding` and every `/dashboard/*` route redirect to `/login`, so authenticated screens and checkout remain **NOT TESTED**. |
| Repair-path code fixes (this branch) | **PASS locally / NOT DEPLOYED** | Admin plan-key truncation and the production-seed instruction are fixed with tests; see §8. |

**Superseded note (2026-10-29, later):** The paragraphs above preserve the state of the investigation *before* the owner
supplied the production query result. Part II records the verified 8-row inventory, the live surface matrix and the ERP
proposal. Where §1–§11 say a row state is unknown or blocked, Part II is authoritative. No production row was written at
any point.

---

## 1. Production target and what could be verified

| Item | Value | Evidence |
| --- | --- | --- |
| `main` / production SHA | `d49d6052fd0e3a487e88b7fa2b34d6a840d03a78` | GitHub API `commits/main` |
| Vercel Production deployment | `7410857599` (Vercel `dpl_CDQCAKEtMTctis97hJp5rxKHYDfA`), created `2026-10-29T11:22:55Z`, state `success` / `READY` (promoted) | GitHub Deployments API; Vercel connector |
| Live host | `https://jata-aftercall.vercel.app` (deployment alias `jata-aftercall-dtvm2hi0d-powerbot-1.vercel.app`) | deployment record |
| Documented database target | Neon project `damp-forest-92941163` (display name `jata-aftercall` in `docs/NEON-RECOVERY-READINESS.md`), branch `production` (`br-cold-snow-ax606swa`), database `neondb` | `docs/MIGRATION_TARGET_GUARD.md` §5, enrolment dated 2026-10-18 |
| Target verified today? | **YES (indirect)** | The Production build log for `dpl_CDQCAKEtMTctis97hJp5rxKHYDfA` records `[migration-guard] OK_ENROLLED_PRODUCTION … target=3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5`, exactly the enrolled Production fingerprint, against database `neondb`; the owner's query addressed the same branch. No credential was read. See Part II §12. |

### Access probe (2026-10-29)

| Probe | Result |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL` in the environment | **unset** (names checked; values never read or printed) |
| `.env*` files in the workspace | only `.env.example` |
| Vercel control plane | **available** through the Vercel connector (project, deployment, env-var names and build status); no database query tool |
| Neon connector / database credential | none configured |
| `https://jata-aftercall.vercel.app/health` | `000` (connection refused by sandbox egress) |
| `https://jata-aftercall.vercel.app/pricing` | `000` |
| `https://api.vercel.com/v2/user` | `000` |
| `https://api.github.com/rate_limit` | `200` |
| Secrets referenced by the workflow definitions | `GITHUB_TOKEN` only — CI uses a disposable local PostgreSQL, not the production database |

The `000` results are this sandbox's egress policy, not the site's state: a GitHub-hosted read-only smoke run reached the
same origin successfully seconds after the production deployment (§9). No request from this sandbox ever reached the
application or the database.

**Consequence:** the read-only inventory query could not be run. No connection string was requested, read, printed or
transmitted. No development, preview, test or unrelated Lovable database was used.

### What the Vercel control plane confirmed (names and states only; no values read)

| Item | Result |
| --- | --- |
| Project | `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`, team `powerbot-1`) |
| Production deployment | `dpl_CDQCAKEtMTctis97hJp5rxKHYDfA`, state **READY**, substate `PROMOTED`, commit `d49d605`, target `production` |
| Production aliases | `jataaftercall.co.ke`, `www.jataaftercall.co.ke`, `jata-aftercall.vercel.app` |
| Production environment variable **names** | `DATABASE_URL` **present**, `DIRECT_URL` **present**, `AUTH_SECRET`, `NEXTAUTH_*`, `PAYSTACK_*`, `ADMIN_EMAILS`, `CLIENT_KEY`, `MPESA_*`, `NODE_ENV` also present |
| `ERP_PRO_ENABLED` / `ERP_PRO_DISABLED` | **absent** from the production deployment environment → `erpFeatureEnabled()` evaluates **false** in production; ERP/Oro is switched off by design |
| Preview deployment for this branch's commit `c129e3b` | `dpl_GkgBtgCz31WrQkXFGC5QTCmcmqJs`, state `CANCELED`, `buildSkipped: true` — the project's Ignored Build Step skips non-production builds, so **no preview build ran and no preview database was migrated** |
| Post-deployment smoke, run `40864949988` | `deployment_status`, started `2026-10-29T11:22:57Z` (seconds after the production deployment), conclusion **success**, every step green |

The production build is **READY**, and `scripts/build.sh` runs `prisma migrate deploy` with `set -e` whenever
`DATABASE_URL` is configured. A successful production build therefore proves the production database was reachable and
the migration gate passed at build time. It proves **nothing** about `PlanConfig` contents.

This also closes the previous session's open item: **`DIRECT_URL` is present in Vercel Production** (presence confirmed
from the variable name; value never retrieved). It remains unverified whether it points at the direct endpoint of the
same production branch — that requires the value or the Neon console.

---

## 2. Authoritative catalogue (Phase 1)

The catalogue is `PlanConfig`, keyed by `key` (unique). It is written by **`prisma/seed.ts` only** (plus the authenticated
admin plans API); **no migration inserts plan rows**, and `scripts/build.sh` never seeds. See §3.

| # | Key | Customer-facing name | KES | Days | Visibility rule | Authoritative source |
| --- | --- | --- | ---: | ---: | --- | --- |
| 1 | `MONTHLY` | Monthly — KES 149/month | 149 | 30 | Public — homepage, `/pricing`, `/products`, onboarding, `/dashboard/subscription`, checkout | `prisma/seed.ts:15`; `lib/pricing.ts:230` |
| 2 | `ANNUAL` | Annual — KES 999/year | 999 | 365 | Public — same surfaces | `prisma/seed.ts:14`; `lib/pricing.ts:229` |
| 3 | `AI_BUSINESS_FRONT_DESK` | AI Business Front Desk — KES 499/month | 499 | 30 | Public add-on — same surfaces; price asserted server-side (`499 / 30`) | `prisma/seed.ts:17`; `lib/pricing.ts:186, 231` |
| 4 | `INTERACTIVE_BUSINESS` | **Website Studio** — KES 999/month | 999 | 30 | Public add-on — same surfaces; always displayed as “Website Studio” | `prisma/seed.ts:19`; `lib/productNames.ts`; `lib/pricing.ts:199, 232` |
| 5 | `BUSINESS_POS` | JATA AFTERCALL — Business POS — KES 499/month | 499 | 30 | **Private / owner-only.** Never on a payable list; homepage card is marketing only and links into `/dashboard/pos`. Sold from `/dashboard/pos/[businessId]/plan` only. | `prisma/seed.ts:23`; `lib/pricing.ts:39, 234` (`PRIVATE_PLAN_KEYS`); `lib/pos/entitlement.ts:18-21` |
| 6 | `JATA_AUTOPILOT` | JATA Autopilot — KES 2,499/month | 2,499 | 30 | **Private / owner-only.** Homepage card marketing only; sold inside `/dashboard/autopilot/[businessId]`. | `prisma/seed.ts:25`; `lib/autopilot/entitlement.ts:31-42`; `lib/pricing.ts:39, 235` |
| 7 | `JATA_AUTOPILOT_PRO` | JATA Autopilot Pro — KES 6,999/month | 6,999 | 30 | **Private / owner-only**, inside the Command Center only | `prisma/seed.ts:26`; `lib/autopilot/entitlement.ts:43-53` |
| 8 | `JATA_AUTOPILOT_ENTERPRISE` | JATA Autopilot Enterprise — KES 19,999/month | 19,999 | 30 | **Private / owner-only**, inside the Command Center only | `prisma/seed.ts:27`; `lib/autopilot/entitlement.ts:54-64` |
| 9 | `ERP_PRO` | **POS / ERP - PRO** | 3,000 | 30 | **Feature-flagged product.** Authenticated entry `/dashboard/erp`; no marketing card; disabled in production unless `ERP_PRO_ENABLED=true`. | `lib/erp/entitlement.ts:16-20, 84-88`; `app/dashboard/erp/page.tsx` |

**ERP/Oro note.** The repository contains no product named “Oro”; the only ERP product is `ERP_PRO` (“POS / ERP - PRO”) at
**KES 3,000 / 30 days** with a 3-day grace period. That price is a constant (`ERP_PLAN_PRICE_KES`), not a `PlanConfig` row.
**`ERP_PRO` is absent from `prisma/seed.ts`.** No migration, seed or test helper creates its `PlanConfig` row, so the
sanctioned bootstrap cannot produce it; only a manual insert or the admin plans API can. This is reported, not changed.

**No other `PlanConfig` key is referenced by the product code.** Team Free Access is a separate entitlement
(`lib/team-access.ts`), not a stored plan. Marketing-only cards, badges and includes in `lib/landing.ts` do not create
additional plans.

---

## 3. Why a plan can be missing from the application

1. **The table is populated only by a manual seed.** `prisma/seed.ts:13-31` upserts the eight non-ERP plans.
   `scripts/build.sh` runs `migrate deploy` and `prisma generate`, never the seed
   (`DEPLOYMENT.md` §64–§66). The only other writer is the authenticated admin API. A production database created by
   migrations alone therefore has **zero** plan rows; a database seeded before a product existed has a **partial**
   catalogue.
2. **Onboarding reads the table directly, with no fallback.**
   `app/onboarding/page.tsx:17` returns `publiclyListedPlans(await prisma.planConfig.findMany({ where: { isActive: true } }))`.
   Zero rows → an empty plan picker. No error, no canonical list.
3. **`/dashboard/subscription` distinguishes “unavailable” from “empty”, but not from “not seeded”.**
   `app/dashboard/subscription/page.tsx:42-44` shows “No active plans are available right now.” for zero rows.
4. **`/pricing` and `/products` fall back to the six canonical cards only when the table returns _zero_ rows.**
   With any row present, a missing public plan is **not** filled: `homepagePlanCards()` only fills the two owner-only
   slots (`POS`, `JATA_AUTOPILOT`), behaviour pinned by `tests/unit/homepage-plan-cards.test.ts`. A partial catalogue
   therefore silently hides the missing public plans on those marketing pages.
5. **POS and Autopilot are private by design.** They are excluded from onboarding and `/dashboard/subscription`
   (`PRIVATE_PLAN_KEYS`), so their absence from those lists is **not** evidence that a row is missing. Their own pages
   still render:
   * Autopilot Command Center always renders all three tiers from `AUTOPILOT_PLAN_CATALOG`; a missing row yields
     `id: null` and activation returns `503 PLAN_NOT_CONFIGURED` inline.
   * The POS plan page always renders KES 499; a missing row yields `checkoutUrl: null`, so the pay button is
     **disabled** and the page states the plan is unavailable.
   * ERP settings renders the KES 3,000 commercial terms from constants; a missing row fails “Continue to payment” with
     “The POS / ERP - PRO plan has not been configured on this deployment yet. Nothing was charged.”
6. **ERP has an additional independent gate.** `erpFeatureEnabled()` returns `false` in production unless
   `ERP_PRO_ENABLED=true` (`lib/erp/entitlement.ts:84-88`). Even with a correct `ERP_PRO` row, production returns
   `503 PRODUCT_DISABLED` while the flag is unset. Changing that flag is a Vercel environment change and is **not**
   authorised here.

**Finding:** no API or UI filtering bug was found that could hide a plan whose row exists and is active. The observed
symptom is consistent with missing or inactive `PlanConfig` rows — but that has **not** been verified, because the
database could not be read.

---

## 4. Schema and constraint check (static)

`prisma/schema.prisma`:

```prisma
model PlanConfig {
  id           String   @id @default(cuid())
  key          String   @unique
  name         String
  priceKES     Int
  durationDays Int
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  subscriptions Subscription[]
}
```

`prisma/migrations/20250915000000_init/migration.sql:118-129` creates the table, and line 223 creates
`CREATE UNIQUE INDEX "PlanConfig_key_key" ON "PlanConfig"("key")`.

Therefore the supplied `ON CONFLICT ("key") DO UPDATE …` matches the real unique constraint. `id` is a `TEXT` primary
key; `ON CONFLICT DO UPDATE` **does not change any existing `id`**, so historical `Payment.planId` references remain
valid. No schema mismatch blocks the statement.

---

## 5. Authorised Autopilot repair — ready, NOT EXECUTED

> **Status: NOT NEEDED — DO NOT RUN.** The owner-supplied production query on 2026-10-29 shows all three rows already
> present, active and correctly priced (2,499 / 6,999 / 19,999, 30 days). Not one row was inserted or updated. The block
> is retained only as the historical authorised repair and as a template; running it now would touch rows that are
> already correct and is outside the current instruction.

```sql
INSERT INTO "PlanConfig"
  ("id", "key", "name", "priceKES", "durationDays",
   "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_jata_autopilot', 'JATA_AUTOPILOT',
   'JATA Autopilot — KES 2,499/month', 2499, 30, true, now(), now()),
  ('plan_jata_autopilot_pro', 'JATA_AUTOPILOT_PRO',
   'JATA Autopilot Pro — KES 6,999/month', 6999, 30, true, now(), now()),
  ('plan_jata_autopilot_enterprise', 'JATA_AUTOPILOT_ENTERPRISE',
   'JATA Autopilot Enterprise — KES 19,999/month', 19999, 30, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET
  "priceKES" = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  "isActive" = true,
  "updatedAt" = now();
```

Scope notes:

* Touches only these three keys; preserves existing IDs; does not touch subscriptions, payments or any other table.
* Does not update `name` on an existing row. If an existing name is wrong or corrupt, that needs separate authorisation.
* Expected post-condition: exactly three rows, `2499 / 6999 / 19999`, `durationDays = 30`, `isActive = true`.

---

## 6. POS / ERP-Oro and the rest of the catalogue — proposed, NOT AUTHORISED

The owner authorised **only** the three Autopilot rows. The statements below are proposals; none was run.

| Key | Proposed row | Why it may also need repair | Authorisation |
| --- | --- | --- | --- |
| `BUSINESS_POS` | KES 499 / 30 days / active, id `plan_business_pos` | Missing row → POS pay button disabled, no POS checkout | **Not authorised** |
| `ERP_PRO` | KES 3,000 / 30 days / active, id `plan_erp_pro`, name “POS / ERP - PRO” | Missing row → ERP “Continue to payment” refuses; row is never created by seed | **Not authorised** — and the `ERP_PRO_ENABLED` flag is a separate decision |
| `MONTHLY` | KES 149 / 30 days, id `plan_monthly` | If the table is empty, onboarding and `/dashboard/subscription` show no plan at all | **Not authorised** |
| `ANNUAL` | KES 999 / 365 days, id `plan_annual` | Same | **Not authorised** |
| `AI_BUSINESS_FRONT_DESK` | KES 499 / 30 days, id `plan_ai_front_desk` | Same | **Not authorised** |
| `INTERACTIVE_BUSINESS` | KES 999 / 30 days, id `plan_interactive_business`, name “Website Studio — KES 999/month” | Same | **Not authorised** |

A single idempotent block covering these six, if the owner authorises it and the audit shows them missing:

```sql
INSERT INTO "PlanConfig"
  ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_monthly', 'MONTHLY', 'Monthly — KES 149/month', 149, 30, true, now(), now()),
  ('plan_annual', 'ANNUAL', 'Annual — KES 999/year', 999, 365, true, now(), now()),
  ('plan_ai_front_desk', 'AI_BUSINESS_FRONT_DESK', 'AI Business Front Desk — KES 499/month', 499, 30, true, now(), now()),
  ('plan_interactive_business', 'INTERACTIVE_BUSINESS', 'Website Studio — KES 999/month', 999, 30, true, now(), now()),
  ('plan_business_pos', 'BUSINESS_POS', 'JATA AFTERCALL — Business POS — KES 499/month', 499, 30, true, now(), now()),
  ('plan_erp_pro', 'ERP_PRO', 'POS / ERP - PRO', 3000, 30, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET
  "priceKES" = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  "isActive" = true,
  "updatedAt" = now();
```

**Do not run this block under the current authorisation.** It would change production records outside the three
Autopilot rows. For ERP it would create a plan the product still hides behind `ERP_PRO_ENABLED` until that flag is
separately approved.

---

## 7. Read-only audit to run first (owner or authorised operator)

Connect only to the production Neon branch named above, then run:

```sql
-- A. Whole catalogue, including IDs and timestamps.
SELECT id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM "PlanConfig"
ORDER BY key;

-- B. Count and the subset named in the task.
SELECT count(*) AS total FROM "PlanConfig";

SELECT key, "priceKES", "durationDays", "isActive"
FROM "PlanConfig"
WHERE key IN (
  'JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE',
  'BUSINESS_POS', 'ERP_PRO'
)
ORDER BY key;
```

Report the **before** count and rows before any write. If A shows all nine keys correct and active, do not write; the
remaining issue is then a code/visibility investigation, not a data repair.

---

## 8. Code changes on this branch (not production data, not deployed)

Two repair-path defects were found and fixed, with tests. They do **not** create or repair a plan row.

| File | Change |
| --- | --- |
| `lib/planKey.ts` (new) | `normalizePlanKey()` — validates and returns a plan key exactly, or `null`. Never truncates. |
| `app/api/admin/plans/route.ts` | Create/update now use `normalizePlanKey`. Previously `sanitizeText(key, 20)` silently truncated `AI_BUSINESS_FRONT_DESK` (22) to `AI_BUSINESS_FRONT_DE` and `JATA_AUTOPILOT_ENTERPRISE` (25) to `JATA_AUTOPILOT_ENTER`, creating rows no product can resolve. |
| `app/api/checkout/route.ts` | A missing Autopilot row no longer tells the operator to run `npm run seed` in production. That seed also writes demo businesses, themes and an admin account; the message now names the targeted `PlanConfig` repair. |
| `tests/unit/plan-key-normalization.test.ts` (new) | 7 tests: all canonical keys round-trip, the 20-character regression is gone, invalid keys are rejected, the route uses the validator. |
| `tests/integration/autopilot-activation.test.ts` | The `503 PLAN_NOT_CONFIGURED` assertion now requires `PlanConfig` and forbids `npm run seed` guidance. |

Verification actually run in this environment:

| Command | Result |
| --- | --- |
| `npx vitest run tests/unit/plan-key-normalization.test.ts` | **7 PASS** |
| `npx vitest run tests/unit/plan-key-normalization.test.ts tests/unit/plan-availability.test.ts tests/unit/homepage-plan-cards.test.ts tests/security/admin-page-authorization.test.ts` | **50 PASS** |
| `npx vitest run tests/integration/autopilot-activation.test.ts tests/unit/plan-key-normalization.test.ts` | **34 PASS** |
| `npx vitest run tests/integration/checkout-route.test.ts tests/integration/payment-settlement.test.ts tests/security/admin-page-authorization.test.ts` | **50 PASS** |
| `npx vitest run tests/unit` | **2,472 PASS / 1 FAIL** — the pre-existing `Prisma.dmmf` failure in `autopilot-phase1-hardening.test.ts` that occurs because `prisma generate` is offline-blocked; identical on unmodified `main` |
| `npx eslint app/api/admin/plans/route.ts lib/planKey.ts tests/unit/plan-key-normalization.test.ts` | **0 errors** |
| `npx tsc --noEmit` | **4 errors, all pre-existing offline-Prisma test-file gaps**; no new error |

These changes are on `arena/df1ff801-jata-aftercall` and open as **PR #73** (`OPEN`, `MERGEABLE`). They are **not merged
and not deployed**; production remains `d49d605`. On the first code commit `c129e3b`, 12 of 14 PR checks passed —
including *Static (install, generate, lint, typecheck, audit)* with a real generated Prisma client, *Schema, types, unit
suite, build*, the migration gates and *Release gate (aggregate)* — with the two long-running browser/database journeys
still in progress. The later commits are documentation only; they restart CI without changing code.

Not run: `next build` locally (offline `prisma generate` fails, same limitation as the previous session).

---

## 9. Verification still required (Phase 4)

Two live transport checks passed through the repository's own read-only post-deployment smoke workflow. Every
plan-specific and authenticated check is **NOT TESTED**; none may be reported as PASS.

| Check | Status | How to close it |
| --- | --- | --- |
| Live `GET /` serves the application | **PASS** | Production smoke run `40864949988`, `2026-10-29T11:22:57Z`; the script exits 0 only when the homepage is `200` HTML |
| Live `GET /health` reports `status: ok` / `db: up` | **PASS** | same run; the script exits non-zero for `db: down` or `db: unconfigured`. This proves the runtime database connection — **not** that any plan row exists |
| Production rows exist with expected keys/prices/durations/active flags | **PASS** | Owner-supplied Neon query, 8 rows, all active; Part II §12 |
| Autopilot page shows all three tiers at the verified prices | **NOT TESTED** | owner session → `/dashboard/autopilot/<businessId>` |
| Checkout resolves the correct plan server-side | **NOT TESTED** | activation must return 200 with the stored id/price; no payment needs to be completed |
| POS plan page shows KES 499 and can start checkout | **NOT TESTED** | `/dashboard/pos/<businessId>/plan`; button enabled only with an active row |
| ERP entry shows KES 3,000 and can start checkout | **FAIL / BLOCKED** | row absent **and** `ERP_PRO_ENABLED` unset; `access()` returns `503 PRODUCT_DISABLED` before any row read |
| `/pricing` and `/products` show the full six-card catalogue | **PASS** | live read on 2026-10-29; Part II §15 |
| `/onboarding` and `/dashboard/subscription` list the four public plans | **NOT TESTED** | signed-in read |
| Mobile and desktop visibility | **NOT TESTED** | 320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768 |
| No payment initiated / no unrelated data changed | **PASS (by construction)** | this work had no database connection and wrote nothing; no payment route was called, no seed was run, and no environment or DNS change was made. The only live requests were the workflow's read-only `GET /` and `GET /health`; the latter ran `SELECT 1`, not a `PlanConfig` read |

Why the smoke PASS does not weaken the blocking finding: `/` renders the marketing grid through `homepagePlanCards()`, which
substitutes canonical cards when rows are unavailable, and `/health` runs `SELECT 1` only. Neither reads `PlanConfig`, so
neither can show whether the plans exist. This is exactly the distinction the repair must not blur.

### Post-repair read-only verification

```sql
SELECT key, "priceKES", "durationDays", "isActive", id
FROM "PlanConfig"
WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')
ORDER BY "priceKES";
```

Expected exactly:

| key | priceKES | durationDays | isActive |
| --- | ---: | ---: | --- |
| `JATA_AUTOPILOT` | 2499 | 30 | true |
| `JATA_AUTOPILOT_PRO` | 6999 | 30 | true |
| `JATA_AUTOPILOT_ENTERPRISE` | 19999 | 30 | true |

The `id` values must be reported but not changed. A database `up` from `/health` proves none of this; it only proves the
connection works.

---

## 10. Findings requiring an owner decision

1. **The catalogue has no automatic bootstrap.** A migration-created database is empty and the app never falls back on
   onboarding/subscription. A one-off idempotent data migration (or a deploy-time, opt-in catalogue check) would prevent
   recurrence, but it writes production data on deploy and is outside this authorisation.
2. **`ERP_PRO` was missing from the seed.** Even an authorised seed run would not have created the ERP plan. A seed row
   is now on this branch (3,000 / 30), and the two production changes remain proposals in Part II §14.
3. **The four public plans are present.** The production query proved this; the earlier concern that they might be
   missing is closed. No write was needed.
4. **The production database identity is confirmed indirectly.** The deployment's own migration guard accepted the
   enrolled Production fingerprint `3439ca4e…f3e8d5` for database `neondb`, and the owner's query addressed the same
   Neon production branch.
5. **Admin-key truncation is fixed on this branch, not deployed.** Until it is, creating `ERP_PRO` or
   `JATA_AUTOPILOT_ENTERPRISE` through `/admin/plans` produces a truncated key; use SQL (§5/§6) instead.

## 11. What was not done

No production `PlanConfig` row was read or written **by this agent**; the row inventory in Part II comes from owner-supplied
query output, and zero writes were executed. No `npm run seed`; no payment or subscription change; no environment variable,
domain, DNS or Vercel setting change; no merge and no production deployment; no access to JATA Qi or TANYA-AI; no
credential value read, printed or transmitted. Pushing the review branch caused Vercel to create a preview deployment
record, but its build was skipped by the project's own Ignored Build Step (`buildSkipped: true`), so it ran no code and
touched no database.

---

# Part II — Verified production evidence (2026-10-29, later update)

Part I was written before the owner supplied the production query result and before the live pages could be fetched.
This part records what is now verified, what each reported "missing plan" actually is, and the exact ERP changes that
are prepared but **not** applied.

## 12. Verified production `PlanConfig` inventory

Source: owner-supplied Neon SQL output for the production branch (database `neondb`), run 2026-10-29. The agent did
not connect to the database; the values below are transcribed from that result.

| # | Key | KES | Days | `isActive` | Visibility class |
| ---: | --- | ---: | ---: | --- | --- |
| 1 | `MONTHLY` | 149 | 30 | true | Public |
| 2 | `ANNUAL` | 999 | 365 | true | Public |
| 3 | `AI_BUSINESS_FRONT_DESK` | 499 | 30 | true | Public add-on |
| 4 | `INTERACTIVE_BUSINESS` | 999 | 30 | true | Public add-on (branded “Website Studio”) |
| 5 | `BUSINESS_POS` | 499 | 30 | true | Private workspace |
| 6 | `JATA_AUTOPILOT` | 2,499 | 30 | true | Private workspace; advertised as one card |
| 7 | `JATA_AUTOPILOT_PRO` | 6,999 | 30 | true | Private workspace; never advertised |
| 8 | `JATA_AUTOPILOT_ENTERPRISE` | 19,999 | 30 | true | Private workspace; never advertised |
| — | `ERP_PRO` | **absent** | **absent** | — | Feature-flagged authenticated product |

**Before:** 8 rows. **After this investigation:** 8 rows. **Writes: 0.**

* Every existing row matches the authoritative catalogue in §2 exactly.
* All three Autopilot rows are correct, so the §5 repair is **unnecessary and must not be run**.
* `ERP_PRO` is the only absent key.

### Production-target identity

The Production build log for `dpl_CDQCAKEtMTctis97hJp5rxKHYDfA` records:

```
[direct-url] OK (OK_DIRECT_URL_READY) — runtime uses the pooled URL; migrations use the direct URL
[migration-guard] OK_ENROLLED_PRODUCTION env=production mode=enforce target=3439ca4ed940f77fde4d30f94a8873dc02ccf3daa1baec900804857450f3e8d5
Datasource "db": PostgreSQL database "neondb", schema "public" at "<host redacted>"
```

`3439ca4e…f3e8d5` is exactly the single enrolled Production fingerprint in
`scripts/lib/migration-target-allowlist.json` (Neon project `damp-forest-92941163`, branch `production`, database
`neondb`). The Vercel Production runtime and the owner's query therefore address the same database. No credential
value was read, printed or copied; the host is redacted here.

## 13. Why each reported plan is or is not visible

| Plan | `/` | `/pricing` | `/products` | Onboarding & subscription | Workspace entry | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `MONTHLY` | card, 149 | row, 149 | product | **Yes** | checkout | Visible |
| `ANNUAL` | card, 999 | row, 999 | product | **Yes** | checkout | Visible |
| `AI_BUSINESS_FRONT_DESK` | card, 499 | row, 499 | product | **Yes** | checkout | Visible |
| `INTERACTIVE_BUSINESS` | card, 999 “Website Studio” | row, 999 | product | **Yes** | checkout | Visible |
| `BUSINESS_POS` | card, 499, “Open Business POS” | row, 499 | product | **No — by design** | `/dashboard/pos` | Publicly advertised; private to the picker |
| `JATA_AUTOPILOT` | card, 2,499, “Open JATA Autopilot” | row, 2,499 | product | **No — by design** | `/dashboard/autopilot` | Publicly advertised; private to the picker |
| `JATA_AUTOPILOT_PRO` | **No** | **No** | **No** | **No** | Command Center tier 2 | Private by design; row exists |
| `JATA_AUTOPILOT_ENTERPRISE` | **No** | **No** | **No** | **No** | Command Center tier 3 | Private by design; row exists |
| `ERP_PRO` | **No** | **No** | **No** | **No** | `/dashboard/erp` | **Unprovisioned and switched off** |

### The four distinct reasons a plan can look “missing”

1. **Private by design, but advertised** — POS and the standard Autopilot. They are excluded from the
   onboarding/subscription pickers by `PRIVATE_PLAN_KEYS` but deliberately appear as owner-only cards on the marketing
   pages. Nothing is broken.
2. **Private by design, not advertised** — Autopilot Pro and Enterprise. They are sold only inside the Command Center and
   never appear publicly. Nothing is broken.
3. **Genuinely unprovisioned** — `ERP_PRO`. No plan row exists, no marketing card exists, and `ERP_PRO_ENABLED` is unset.
   The product fails closed with `503 PRODUCT_DISABLED`.
4. **Latent code defect (fixed on this branch)** — `ERP_PRO` was absent from `PRIVATE_PLAN_KEYS`. Creating its row would
   have inserted “POS / ERP - PRO” into the **public** onboarding/subscription list the moment the row appeared. That is
   the one real visibility bug found, and it was latent precisely because the row did not exist.

## 14. ERP / Oro — canonical configuration and proposed changes (NOT APPLIED)

### Canonical values, verified in code and tests

| Field | Value | Source |
| --- | --- | --- |
| Plan key | `ERP_PRO` | `lib/erp/entitlement.ts:16` |
| Plan name | `POS / ERP - PRO` | `lib/erp/entitlement.ts:17` |
| Price | KES **3,000** | `ERP_PLAN_PRICE_KES`, `lib/erp/entitlement.ts:18` |
| Duration | **30 days** | `ERP_PLAN_DURATION_DAYS`, line 19 |
| Grace | 3 days | `ERP_GRACE_DAYS`, line 20 |
| Production flag | `ERP_PRO_ENABLED=true` required | `erpFeatureEnabled()`, lines 84-88 |
| Dev-side override | `ERP_PRO_DISABLED` | same function |
| Table | `"PlanConfig"`: `id TEXT PK`, `key TEXT UNIQUE`, `name TEXT`, `priceKES INT`, `durationDays INT`, `isActive BOOLEAN`, timestamps | init migration `20250915000000_init:118-129, 223` |
| ERP tables | `ErpSubscription.planKey` and `ErpEntitlement.packageKey` both default to `ERP_PRO`; **no migration inserts a `PlanConfig` row** | `20261027000000_pos_erp_pro/migration.sql:44, 67` |
| Tests pinning all of the above | `tests/unit/erp-entitlement.test.ts`, `tests/unit/erp-entitlement-access.test.ts` | both assert key, 3,000, 30, and the flag names |

No “Oro” product exists in the codebase. The ERP product is `POS / ERP - PRO`.

### Proposed production insert — **NOT EXECUTED**

```sql
INSERT INTO "PlanConfig"
  ("id", "key", "name", "priceKES", "durationDays",
   "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_erp_pro', 'ERP_PRO', 'POS / ERP - PRO', 3000, 30, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET
  "priceKES" = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  "isActive" = true,
  "updatedAt" = now();
```

Scope notes: touches exactly one key; inserts `plan_erp_pro` only if absent; `DO UPDATE` never changes an existing `id`,
so historical `Payment.planId` / `ErpSubscription` references stay valid; the name is written only on insert. The unique
index `PlanConfig_key_key` exists, so `ON CONFLICT ("key")` is valid. **Not run. Awaiting separate explicit
authorisation.**

### Proposed feature-flag change — **NOT APPLIED**

Set `ERP_PRO_ENABLED=true` for the Vercel **Production** environment and redeploy, because a running deployment keeps the
environment it was built with. `ERP_PRO_DISABLED` must remain unset. **Awaiting separate explicit authorisation.**

### Order of operations after authorisation

1. Re-run the §7 count: expect 8 rows and no `ERP_PRO`.
2. Run the insert; confirm exactly one `ERP_PRO` row at 3,000 / 30 / active and that the other eight ids are unchanged.
3. If separately approved, set `ERP_PRO_ENABLED=true` and redeploy.
4. Signed in as an owner/admin, open `/dashboard/erp/<businessId>`: the settings page must show KES 3,000 and offer
   “Continue to payment” without completing a payment.
5. Do not set the flag without the row; the code fails closed, but the product would remain unusable and confusing.

## 15. Live verification performed

All reads below were unauthenticated GETs through an external page fetcher on 2026-10-29.

| URL | Result | Status |
| --- | --- | --- |
| `/health` | `{"status":"ok","db":"up","version":"1.0.0","timestamp":"2026-10-29T12:28:08.628Z"}` | **PASS** |
| `/pricing` | Six-row comparison: Monthly 149/30, Annual 999/year, AI Front Desk 499/30, Autopilot 2,499/30, Website Studio 999/30, Business POS 499/30. No ERP, Pro or Enterprise | **PASS** |
| `/` | Six pricing cards in owner order (149, 999, 499, 2,499, 999, 499); POS → `/dashboard/pos`, Autopilot → `/dashboard/autopilot`; FAQ refers to “the four page plans” | **PASS** |
| `/products` | “One account. Four customer products.” Six product cards, Autopilot 2,499 and POS 499 presented as dashboard-priced | **PASS** |
| `/products/business-pos` | KES 499 / 30 days; states it is sold from inside the dashboard, “never from the public pricing list” | **PASS** (minor wording inconsistency: `/pricing` does show the POS row) |
| `/dashboard/subscription` | Redirects to `/login` | **NOT TESTED** (auth) |
| `/dashboard/erp` | Redirects to `/login` | **NOT TESTED** (auth) |
| `/dashboard/autopilot` | Redirects to `/login` | **NOT TESTED** (auth) |
| `/onboarding`, `/dashboard/pos`, checkout | Require a session | **NOT TESTED** |

The GitHub production smoke run `40864949988` independently confirms `/` and `/health`; its script exits 0 only for
`status: ok, db: up`. That proves connectivity, not row contents — the row contents are proven by §12.

**Conclusion on the reported symptom:** every plan is either correctly visible, intentionally private, or (ERP) not
provisioned. No existing plan row is missing or mispriced. The only code defect affecting visibility was the latent ERP
public-list leak, now fixed and covered by tests.

## 16. Regression tests added on this branch

`tests/unit/plan-catalogue-visibility.test.ts` (9 tests) pins the verified production matrix:

* the public/payable list is exactly the four page keys;
* the homepage card order is `MONTHLY, ANNUAL, AI_BUSINESS_FRONT_DESK, JATA_AUTOPILOT, INTERACTIVE_BUSINESS,
  BUSINESS_POS` with prices `149, 999, 499, 2499, 999, 499` and durations `30, 365, 30, 30, 30, 30`;
* Pro and Enterprise never appear as cards but remain in `PRIVATE_PLAN_KEYS`;
* `INTERACTIVE_BUSINESS` is branded “Website Studio” with its stored description preserved;
* `ERP_PRO` is private, absent from the public list and absent from the homepage fallback set — so creating its row cannot
  leak it onto `/onboarding` or `/dashboard/subscription`;
* `prisma/seed.ts` provisions all nine keys, including `ERP_PRO` at 3,000 / 30.

Evidence: targeted six suites **76/76 PASS**; full `tests/unit` **2,481 / 2,482** with the single pre-existing offline
Prisma-DMMF failure; ESLint on changed files **0 errors**; `tsc --noEmit` shows the same four pre-existing offline errors.

## 17. Remaining approvals

1. **Merge/deploy PR #73** — head `df8371d` passed **15/15 checks**, including Static/typecheck with a generated Prisma
   client, the unit suite, migrations against PostgreSQL 18, the Journey against a real database, and the Real-Chrome
   six-viewport capture. The diff contains nine related files (+777/−5) and no unrelated changes, but no merge or
   deployment is performed without an explicit instruction.
2. **`ERP_PRO` row insert** — SQL in §14; requires separate explicit production-write authorisation.
3. **`ERP_PRO_ENABLED=true` + redeploy** — requires separate explicit production-configuration authorisation.
4. **Authenticated verification** — owner to confirm that `/onboarding` and `/dashboard/subscription` show the four public
   plans, that the POS and Autopilot workspaces show their plans, and that ERP shows the disabled notice today.

No production row, flag, seed, payment, subscription, account, secret, DNS record or deployment was changed in producing
this part. The only production facts are the owner's query output and read-only HTTP GETs.
