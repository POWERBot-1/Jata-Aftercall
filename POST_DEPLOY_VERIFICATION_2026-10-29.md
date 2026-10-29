# JATA AFTERCALL — Authorized merge, deployment and ERP activation attempt

**Date:** 2026-10-29
**Scope:** JATA AFTERCALL only (no JATA Qi or TANYA-AI access)
**PR:** [#73](https://github.com/POWERBot-1/Jata-Aftercall/pull/73) — `fix(plans): make catalogue repair safe — no key truncation, no production seed advice`
**Reviewed head:** `685c8495e5ee94d8e3dbd5a7b91201bc7fc4fba3`
**Merge commit / current `main`:** `fac14d0dd13b4f874b14cbe5ada4bbd26a774716`
**Production deployment:** `dpl_D4mZi88g5vkz25kpkUyRMs5qyTGd` (Vercel), GitHub deployment `7413123583`
**Production writes:** **0** — the database step is BLOCKED (see Phase 3)

## Verdict by phase

| Phase | Status | One-line evidence |
| --- | --- | --- |
| 1 — pre-merge review and merge | **PASS** | Head `685c849`; 15/15 checks pass; 9 related files (+779/−5); no migrations; merged at `2026-10-29T13:09:27Z` as `fac14d0` |
| 2 — deploy and verify application code | **PASS** | Deployment `dpl_D4mZi…` `READY` / `PROMOTED`, built from `fac14d0`; `/health` `db: up`; `/`, `/pricing`, `/products`, `/products/business-pos` render correctly |
| 3 — provision `ERP_PRO` in Neon Production | **BLOCKED** | No production database connection is available in this environment; 0 rows written |
| 4 — set `ERP_PRO_ENABLED=true` | **BLOCKED (by Phase 3)** | Variable is absent from Production; not created, because enabling a product whose plan row does not exist would expose a checkout that fails with `PLAN_NOT_CONFIGURED` |
| 5 — authenticated customer-flow verification | **NOT TESTED** | No authenticated production session exists; anonymous routes redirect to `/login` |
| 6 — final evidence report | **PASS** | This document |

**Overall: not complete.** Merge and deployment succeeded; ERP provisioning and therefore the
authenticated ERP/customer verification did not.

---

## Phase 1 — Pre-merge checks and merge

| Check | Result |
| --- | --- |
| PR state | OPEN → **MERGED** at `2026-10-29T13:09:27Z` |
| Head SHA | `685c8495e5ee94d8e3dbd5a7b91201bc7fc4fba3` (unchanged from the reported head) |
| Mergeability / state | `MERGEABLE`, `mergeStateStatus: CLEAN` |
| Required checks | **15/15 pass** on that head, including Static/typecheck with a generated Prisma client, unit suite, migrations on PostgreSQL 18, the Journey against a real database, Real-Chrome six-viewport capture and the Release gate |
| Review decision | No review was required by protection; the diff was reviewed file by file |
| Diff | 9 files, +779/−5: 3 code files, 4 test files, 1 seed file, 1 report; **no migration files**, no credentials, no unrelated product changes |
| Merge method | `gh pr merge 73 --merge` (no force, no admin override, no protection bypass) |
| Merge commit | `fac14d0dd13b4f874b14cbe5ada4bbd26a774716`; `main` points at it |

No required check failed, so no blocker was bypassed.

## Phase 2 — Deployment and public verification

Vercel project `jata-aftercall` (`prj_mXn1031amrZQo4gyaVumKS4FltjW`), team `powerbot-1`
(`team_azd5tt6fZ2mt1v6Op6s5iJHv`), target **production**.

| Item | Evidence |
| --- | --- |
| Deployment ID | `dpl_D4mZi88g5vkz25kpkUyRMs5qyTGd` |
| Built commit | `fac14d0dd13b4f874b14cbe5ada4bbd26a774716` (`gitSource.sha`) |
| State | `READY`, `readySubstate: PROMOTED`, build not skipped |
| Aliases | `jataaftercall.co.ke`, `www.jataaftercall.co.ke`, `jata-aftercall.vercel.app` |
| GitHub deployment | `7413123583`, environment `Production`, status **success** (`Deployment has completed`) |
| `/health` | `{"status":"ok","db":"up","version":"1.0.0","timestamp":"2026-10-29T13:13:16.232Z"}` — **PASS** |

Live page reads (unauthenticated GETs through an external fetcher):

| URL | Result | Status |
| --- | --- | --- |
| `/` | Six pricing cards: 149 / 999 / 499 / 2,499 / 999 / 499, correct periods, POS and Autopilot CTAs | **PASS** |
| `/pricing` | Six-row comparison with the same prices and periods; no ERP, Pro or Enterprise | **PASS** |
| `/products` | Six product cards; Autopilot 2,499 and POS 499 presented as dashboard-priced | **PASS** |
| `/products/business-pos` | KES 499 / 30 days, owner-only, activated from `/dashboard/pos` | **PASS** |
| `/health` | `status: ok`, `db: up` | **PASS** |

The deployed commit matches the intended merge commit, and the deployment is promoted to Production.

## Phase 3 — ERP PRO provisioning: BLOCKED

**Intended target:** Neon project `damp-forest-92941163`, production branch `br-cold-snow-ax606swa`,
database `neondb`. The existing `PlanConfig` schema and its unique index `PlanConfig_key_key` were
verified statically from `prisma/migrations/20250915000000_init`.

**What prevents the write:**

| Probe | Result |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL`, `POSTGRES_URL`, `PGURL` in the workspace | **absent** (presence checked; no value read) |
| `.env*` files | only `.env.example` |
| `psql` client | not installed |
| Neon API / DNS from this sandbox | `api.neon.tech` does not resolve (`000`); egress is limited to GitHub, npm and PyPI |
| Vercel Production `DATABASE_URL` / `DIRECT_URL` | present as `sensitive` env vars; values were **not** decrypted or copied, and reading them is out of policy |
| Neon API key / project credential | not available |

There is no authorised channel from this environment to the production database. Per the
instruction, no preview, development or unrelated database was substituted, and **no SQL was run**.
The eight previously verified rows are untouched.

**Prepared statement (still unexecuted):**

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

Expected post-condition: one `ERP_PRO` row at 3,000 / 30 / active; existing ids and the other eight
rows unchanged.

## Phase 4 — `ERP_PRO_ENABLED` in Vercel Production: BLOCKED

`ERP_PRO_ENABLED` is **absent** from the project's environment variables (names and targets checked;
no values read). No variable was created and no redeployment was triggered.

**Why it was not set:** the ERP product would become reachable while its `PlanConfig` row is still
missing. `startErpPlanAction` resolves `planConfig.findUnique({ where: { key: "ERP_PRO" } })` and
refuses when the row is absent, so the visible result would be an enabled workspace whose purchase
path fails with `PLAN_NOT_CONFIGURED`. That is a worse customer state than the current clean
`503 PRODUCT_DISABLED`, and it cannot satisfy the requested “ERP PRO appears with KES 3,000 / 30
days and the expected purchase path”. The correct order remains row first, flag second.

**Ready to apply once the row exists:** create `ERP_PRO_ENABLED` = `true`, target **Production**
only, then redeploy and confirm the new deployment is `READY` / `PROMOTED`.

No other environment variable was created, changed or deleted. `DATABASE_URL`, `DIRECT_URL`,
Paystack and M-Pesa settings are untouched.

## Phase 5 — Authenticated customer flows: NOT TESTED

No production session or test account is available in this environment; the fetcher performs
anonymous GETs only. `/register` exists, but no account was created and no credentials were used.
The prohibited seeded admin account was not used.

| # | Flow | Status | Evidence / reason |
| --- | --- | --- | --- |
| 1 | Public onboarding shows Monthly 149, Annual 999, AI 499, Website Studio 999 | **NOT TESTED** | `/onboarding` requires sign-in; the four plans are present in the verified catalogue and in the public pages |
| 2 | Subscription page lists the four public plans | **NOT TESTED** | `/dashboard/subscription` redirects to `/login` |
| 3 | POS workspace shows Business POS 499 with correct access control | **NOT TESTED** | `/dashboard/pos` requires sign-in; row verified present at 499 / 30 / active |
| 4 | Autopilot Command Center shows three tiers and safe missing-config handling | **NOT TESTED** | `/dashboard/autopilot` redirects to `/login`; all three rows verified present and correct |
| 5 | ERP workspace accessible and ERP PRO at 3,000 / 30 | **FAIL (by configuration)** | Flag off and row absent; `/dashboard/erp` redirects to `/login` before any ERP gate |
| 6 | Private plans/workspaces remain protected when signed out | **PASS (perimeter only)** | `/dashboard/subscription`, `/dashboard/autopilot`, `/dashboard/erp` all serve `/login` |
| 7 | Responsive mobile/desktop verification | **NOT TESTED (production)** | No browser driver; the pre-merge Real-Chrome six-viewport capture passed on this exact code |
| 8 | Payment verification, gating and existing flows | **NOT TESTED (live)** | No payment initiated and no subscription changed; CI Journey and payment suites pass on the merged code |

No payment was initiated, no customer charged, no subscription or account changed, and no
authentication or entitlement check was bypassed.

## Phase 6 — Remaining actions

1. **Provision `ERP_PRO`** using the SQL above, or provide an authorised execution channel
   (for example a reviewed operator run against the `production` branch). Verify the post-write
   query before proceeding.
2. **Set `ERP_PRO_ENABLED=true`** for Production only, then redeploy.
3. **Run the authenticated checks** in Phase 5 with an owner/test account: onboarding, subscription,
   POS, Autopilot, ERP, plus the mobile/desktop capture.
4. No further code change is required for ERP visibility: `ERP_PRO` is already private in
   `PRIVATE_PLAN_KEYS`, so creating the row will not leak it into the public plan picker.

## What was not done

No production `PlanConfig` write, no `ERP_PRO_ENABLED` variable, no `npm run seed`, no payment, no
subscription/account change, no credential read or copy, no DNS, domain or email change, no JATA Qi
or TANYA-AI access. One merge and one production deployment were performed, as authorised.
