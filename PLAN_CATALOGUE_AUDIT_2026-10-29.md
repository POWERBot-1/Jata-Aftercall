# JATA AFTERCALL — Plan Catalogue Audit and Targeted Repair

**Date:** 2026-10-29
**Repository:** `POWERBot-1/Jata-Aftercall`
**Deployed commit audited:** `d49d6052fd0e3a487e88b7fa2b34d6a840d03a78` (Vercel Production deployment `7410857599`, state `success`)
**Work branch:** `arena/df1ff801-jata-aftercall`

## Status at a glance

| Phase | Status | Why |
| --- | --- | --- |
| 1 — authoritative catalogue from repository evidence | **PASS** | Every intended plan, key, price, duration and visibility rule is named in the code; see §2. |
| 2 — read-only production audit | **BLOCKED** | No production database credential exists in this environment, the live host is unreachable, and no Neon query tool is connected. No `SELECT` was executed. Row counts are **unknown**, not zero. |
| 3 — Autopilot repair | **BLOCKED** | Cannot reach the database; **0 rows written**. The authorised, idempotent SQL is ready in §5. |
| 3 — POS / ERP-Oro changes | **NOT AUTHORISED / NOT RUN** | Configuration established in §2; exact proposed statements in §6. |
| 4 — application verification | **PARTIAL PASS / BLOCKED** | Live `GET /` and `GET /health` passed in the post-deployment smoke run (§9). Plan-specific and authenticated checks are **NOT TESTED**: `https://jata-aftercall.vercel.app` returns `000` from this sandbox and no browser session exists. |
| Repair-path code fixes (this branch) | **PASS locally / NOT DEPLOYED** | Admin plan-key truncation and the production-seed instruction are fixed with tests; see §8. |

Nothing in this document is a claim that a production plan row exists, is missing, or was changed. The only facts about
production are the deployment records, environment-variable names (never values) and network results in §1.

---

## 1. Production target and what could be verified

| Item | Value | Evidence |
| --- | --- | --- |
| `main` / production SHA | `d49d6052fd0e3a487e88b7fa2b34d6a840d03a78` | GitHub API `commits/main` |
| Vercel Production deployment | `7410857599` (Vercel `dpl_CDQCAKEtMTctis97hJp5rxKHYDfA`), created `2026-10-29T11:22:55Z`, state `success` / `READY` (promoted) | GitHub Deployments API; Vercel connector |
| Live host | `https://jata-aftercall.vercel.app` (deployment alias `jata-aftercall-dtvm2hi0d-powerbot-1.vercel.app`) | deployment record |
| Documented database target | Neon project `damp-forest-92941163` (display name `jata-aftercall` in `docs/NEON-RECOVERY-READINESS.md`), branch `production` (`br-cold-snow-ax606swa`), database `neondb` | `docs/MIGRATION_TARGET_GUARD.md` §5, enrolment dated 2026-10-18 |
| Target verified today? | **NO** | no credential and no network path; the enrolment record is historical evidence, not a live check |

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

> **Status: BLOCKED.** Not one row was inserted or updated. This block is reproduced exactly as authorised. Run it only
> against the verified production branch, after §7. If all three rows already exist and are correct, run nothing.

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
and not deployed**; production remains `d49d605`. At the time of writing, 12 of 14 PR checks had passed — including
*Static (install, generate, lint, typecheck, audit)* with a real generated Prisma client, *Schema, types, unit suite,
build*, the migration gates and *Release gate (aggregate)* — with the two long-running browser/database journeys still in
progress.

Not run: `next build` locally (offline `prisma generate` fails, same limitation as the previous session).

---

## 9. Verification still required (Phase 4)

Two live transport checks passed through the repository's own read-only post-deployment smoke workflow. Every
plan-specific and authenticated check is **NOT TESTED**; none may be reported as PASS.

| Check | Status | How to close it |
| --- | --- | --- |
| Live `GET /` serves the application | **PASS** | Production smoke run `40864949988`, `2026-10-29T11:22:57Z`; the script exits 0 only when the homepage is `200` HTML |
| Live `GET /health` reports `status: ok` / `db: up` | **PASS** | same run; the script exits non-zero for `db: down` or `db: unconfigured`. This proves the runtime database connection — **not** that any plan row exists |
| Production rows exist with expected keys/prices/durations/active flags | **BLOCKED** | §7 query on the production branch; report count and rows |
| Autopilot page shows all three tiers at the verified prices | **NOT TESTED** | owner session → `/dashboard/autopilot/<businessId>` |
| Checkout resolves the correct plan server-side | **NOT TESTED** | activation must return 200 with the stored id/price; no payment needs to be completed |
| POS plan page shows KES 499 and can start checkout | **NOT TESTED** | `/dashboard/pos/<businessId>/plan`; button enabled only with an active row |
| ERP entry shows KES 3,000 and can start checkout | **NOT TESTED** | `/dashboard/erp/<businessId>/settings`; still gated by `ERP_PRO_ENABLED` |
| `/pricing` and `/products` show the full six-card catalogue | **NOT TESTED** | live read |
| `/onboarding` and `/dashboard/subscription` list the four public plans | **NOT TESTED** | signed-in read |
| Mobile and desktop visibility | **NOT TESTED** | 320×568, 360×800, 390×844, 430×932, 768×1024, 1366×768 |
| No payment initiated / no unrelated data changed | **PASS (by construction)** | no database connection existed; no payment route was called; no seed was run; no environment or DNS change was made. The only live requests were the workflow's read-only `GET /` and `GET /health` |

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
2. **`ERP_PRO` is missing from the seed.** Even an authorised seed run would not create the ERP plan. The proposed row and
   the `ERP_PRO_ENABLED` decision are in §6.
3. **The four public plans are not covered by the current authorisation.** Repairing only the three Autopilot rows will
   not fill an empty onboarding plan list. The audit in §7 must decide whether they too are missing.
4. **The production database identity is historical evidence only.** The enrolment record names
   `damp-forest-92941163` / `production` / `neondb`, but nothing in this environment could confirm it today.
5. **Admin-key truncation is fixed on this branch, not deployed.** Until it is, creating `ERP_PRO` or
   `JATA_AUTOPILOT_ENTERPRISE` through `/admin/plans` produces a truncated key; use SQL (§5/§6) instead.

## 11. What was not done

No production database read or write; no `npm run seed`; no payment or subscription change; no environment variable,
domain, DNS or Vercel setting change; no merge and no production deployment; no access to JATA Qi or TANYA-AI; no
credential value read, printed or transmitted. Pushing the review branch caused Vercel to create a preview deployment
record, but its build was skipped by the project's own Ignored Build Step (`buildSkipped: true`), so it ran no code and
touched no database.
