# JATA Autopilot — Minimal `PlanConfig` Insert Repair: Preparation & Independent Verification

**Date:** 2026-10-26
**Repository:** `POWERBot-1/Jata-Aftercall`, branch `arena/dc4b30cf-jata-aftercall`, based on merged
`main` @ `083dfdb47a5811b729d221bbf3da996b626f4488` (PR #65)
**Production:** `https://jata-aftercall.vercel.app`
**Companion file:** `AUTOPILOT_PLANS_INSERT_REPAIR_REVIEW.sql` — read-only by default; **the write inside it is commented out and unexecuted**

**Status: PREPARATION AND REVIEW ONLY. NOTHING WAS EXECUTED AGAINST PRODUCTION.**

---

## 0. Authorization boundary — what was and was not done

| Action | Done? |
| --- | --- |
| Read the repository (schema, migrations, seed, checkout route, pricing/entitlement, tests) | Yes |
| Execute the repair SQL, or any `INSERT` / `UPDATE` / `DELETE` / migration against any database | **No** |
| Run `npm run seed` (against production or anywhere else) | **No** |
| Change production environment variables or secrets | **No** |
| Initiate a payment or activate a subscription | **No** |
| Merge a PR, deploy code, or push to any branch other than the session branch | **No** |
| Read, print, or store a connection string, token or secret value | **No** — none was available, and none is reproduced here |
| Execute SQL against a **local, throwaway Postgres engine** rebuilt from this repo's own migration DDL (PGlite 0.5.11 / PostgreSQL 18.6, in `/tmp`, discarded) | Yes — this is the basis for the "verified" rows below |
| Run repository tests (`vitest`) | Yes — existing suites plus a temporary harness that was deleted afterwards |

Production data was **not** re-read by me: the five-row result in the owner's evidence is taken as
given. Everything else below is repository evidence or a local reproduction.

---

## 1. Schema evidence and source file locations

### 1.1 The Prisma model — `prisma/schema.prisma:291-301`

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

### 1.2 The actual PostgreSQL DDL that production runs — `prisma/migrations/20250915000000_init/migration.sql:118-129, 223`

```sql
CREATE TABLE "PlanConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceKES" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanConfig_key_key" ON "PlanConfig"("key");
```

Facts that matter for the repair (each one is load-bearing):

| Fact | Consequence |
| --- | --- |
| `id` is `TEXT` **NOT NULL with no database default** (the `cuid()` default exists only in the Prisma client) | Raw SQL **must** supply `id` explicitly |
| `updatedAt` is `TIMESTAMP(3)` **NOT NULL with no default** | Raw SQL **must** supply it — reproduced: omitting it fails with `null value in column "updatedAt" … violates not-null constraint` |
| `isActive` defaults to `true`; `createdAt` defaults to `CURRENT_TIMESTAMP` | Optional in the statement, but supplied explicitly for a fully deterministic row |
| `key` is unique via a **unique index** named `PlanConfig_key_key` (Prisma `@unique` emits an index, **not** a named constraint) | `ON CONFLICT ("key")` is valid; `ON CONFLICT ON CONSTRAINT "PlanConfig_key_key"` **is not** — reproduced: `constraint "PlanConfig_key_key" for table "PlanConfig" does not exist` |
| `priceKES` / `durationDays` are `INTEGER` (whole KES, not minor units) | `2499`, `6999`, `19999` are correct as-is; the ×100 conversion happens later in `toKobo()` |
| No `currency` column | `assertAutopilotPlanPricing` reads `plan.currency === undefined` and treats that as KES (see 1.4) |
| `TIMESTAMP(3)` is **without time zone** | A bare `now()` is cast through the *session* `TimeZone`; see finding **D1** |

### 1.3 No migration provisions plan rows — the catalogue is seed-only

`grep -rn "PlanConfig" prisma/migrations/*/migration.sql` outside the init migration matches exactly
one line, and it is not an insert: `20261025000000_jata_autopilot_foundation/migration.sql:10`
(`AutopilotSubscription."planKey" TEXT NOT NULL DEFAULT 'JATA_AUTOPILOT'`). **No migration in this
repository inserts or updates a `PlanConfig` row.**

The only writer is `prisma/seed.ts:15-31`:

```ts
{ key: "JATA_AUTOPILOT",            name: "JATA Autopilot — KES 2,499/month",            priceKES: 2499,  durationDays: 30 },
{ key: "JATA_AUTOPILOT_PRO",        name: "JATA Autopilot Pro — KES 6,999/month",        priceKES: 6999,  durationDays: 30 },
{ key: "JATA_AUTOPILOT_ENTERPRISE", name: "JATA Autopilot Enterprise — KES 19,999/month", priceKES: 19999, durationDays: 30 },
// upsert(where: {key}, update: {name, priceKES, durationDays, isActive: true}, create: {...p, isActive: true})
```

The seed has no scope flag and also upserts page themes, four demo businesses, a demo customer and an
`ADMIN` user derived from `ADMIN_EMAILS` whose **created** password is the well-known `Admin123!`
(`prisma/seed.ts:34-61`). Builds and the migration gate never call it: `scripts/build.sh` runs
`scripts/migrate.sh` (`prisma migrate deploy`, "no seed") and then `next build`; `DEPLOYMENT.md:64-66`
states the same. This matches the confirmed production state: five rows exist, the three Autopilot
rows do not. Consequence in §6 (finding **D5**).

### 1.4 The validation the repaired rows must satisfy

`lib/autopilot/entitlement.ts:19` and `:23-61` (catalogue) and `:107-137`:

```ts
export const AUTOPILOT_BILLING_DAYS = 30;
// JATA_AUTOPILOT 2499 · JATA_AUTOPILOT_PRO 6999 · JATA_AUTOPILOT_ENTERPRISE 19999, all 30 days

export function assertAutopilotPlanPricing(plan): { ok: true } | { ok: false; reason: string } {
  if (!plan || !isAutopilotPlanKey(plan.key)) return { ok: false, ... };
  if (plan.isActive === false) return { ok: false, reason: "… plan is inactive." };
  if (plan.currency !== undefined && plan.currency !== null && plan.currency !== "KES") return { ok: false, ... };
  if (!Number.isInteger(plan.priceKES) || plan.priceKES !== spec.priceKES) return { ok: false, ... };
  if (plan.durationDays !== AUTOPILOT_BILLING_DAYS) return { ok: false, ... };
  return { ok: true };
}
```

It is enforced twice: at checkout (`app/api/checkout/route.ts:104-107`, failing closed with
`500 PLAN_PRICING_INVALID`) and again at settlement (`lib/autopilot/settlement.ts:74-88`, throwing
`AUTOPILOT_PLAN_CONTRACT_VIOLATION`, and separately requiring `payment.currency === "KES"` and
`payment.amount === plan.priceKES * 100`).

Two other gates in the same route that the rows must pass (`app/api/checkout/route.ts:67-84`):

* key resolution — a missing row for an allowlisted key returns `503 PLAN_NOT_CONFIGURED`
  ("JATA Autopilot plans are not configured in this deployment yet…") — the exact production symptom;
* `!plan.isActive || !Number.isSafeInteger(plan.priceKES) || plan.priceKES <= 0 || plan.durationDays <= 0`
  returns `400 PLAN_UNAVAILABLE`.

Amount arithmetic: `lib/paymentCurrency.ts` fixes `PAYMENT_CURRENCY = "KES"` and `lib/paystack.ts:255`
is `toKobo(kes) = Math.round(kes * 100)` → **249900 / 699900 / 1999900** minor units.

### 1.5 Surfaces that read `PlanConfig` (blast-radius review)

| Surface | Effect of adding exactly three rows |
| --- | --- |
| `app/dashboard/autopilot/[businessId]/page.tsx:79-81`, `app/api/autopilot/overview/route.ts:67-69` | `getPlanByKey(...)` starts returning rows, so `plans[].id` stops being `null`. This is the fix. |
| `app/api/checkout/route.ts:72` | Key resolution succeeds → `200` instead of `503 PLAN_NOT_CONFIGURED`. |
| `app/page.tsx:42` + `lib/pricing.ts:105-115` (`homepagePlanCards`) | No visible change: the standard Autopilot card already renders from `FALLBACK_PLANS` with identical values, and `JATA_AUTOPILOT` is in `PRIVATE_PLAN_KEYS` (`lib/pricing.ts:38-43`) so it is never a payable card. |
| `app/dashboard/subscription/page.tsx:42`, `app/onboarding/page.tsx:17` | Filtered by `publiclyListedPlans()` → the three private keys stay invisible. **No new rows appear on any customer-facing plan list.** |
| `app/admin/plans/page.tsx:15` | Unfiltered admin list → the three rows will appear there (intended, admin-only). |
| `lib/pricing.ts getPlanByKey` / `FALLBACK_PLANS` | Values are identical to the fallback, so nothing shifts. |

---

## 2. Exact proposed SQL — **NOT EXECUTED**

> **NOT EXECUTED.** No database was touched. This is the statement proposed for the owner to run,
> and it is the same text (commented out) in `AUTOPILOT_PLANS_INSERT_REPAIR_REVIEW.sql` Part B1.

**Recommended variant — insert-only, conflict-safe, cannot modify any existing row:**

```sql
BEGIN;
SET LOCAL statement_timeout = '30s';

INSERT INTO public."PlanConfig"
  ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_jata_autopilot',            'JATA_AUTOPILOT',            'JATA Autopilot — KES 2,499/month',            2499,  30, true, timezone('UTC', now()), timezone('UTC', now())),
  ('plan_jata_autopilot_pro',        'JATA_AUTOPILOT_PRO',        'JATA Autopilot Pro — KES 6,999/month',        6999,  30, true, timezone('UTC', now()), timezone('UTC', now())),
  ('plan_jata_autopilot_enterprise', 'JATA_AUTOPILOT_ENTERPRISE', 'JATA Autopilot Enterprise — KES 19,999/month', 19999, 30, true, timezone('UTC', now()), timezone('UTC', now()))
ON CONFLICT ("key") DO NOTHING;

COMMIT;
```

Why each choice:

| Choice | Reason (evidenced) |
| --- | --- |
| `public."PlanConfig"` | Explicit schema; the owner's own query used `public."PlanConfig"`. Quoted identifiers are mandatory (camelCase columns). |
| Explicit `id` | No database default (§1.2). Deterministic, readable ids make the rows identifiable later and make the statement idempotent by value. |
| `ON CONFLICT ("key")` | Infers the unique index `PlanConfig_key_key`. Verified to work on a rebuilt schema. |
| `DO NOTHING`, not `DO UPDATE` | The owner's evidence shows all three keys absent, so nothing needs updating; `DO NOTHING` gives an absolute guarantee that no existing row — of any plan — can change. See §4 for the precise difference. |
| `updatedAt` supplied | NOT NULL, no default. |
| `timezone('UTC', now())` | Matches Prisma's UTC convention for a `TIMESTAMP(3)` column regardless of the session's `TimeZone` (finding **D1**). |
| Names copied byte-for-byte from `prisma/seed.ts` / `lib/pricing.ts FALLBACK_PLANS` (em dash U+2014, confirmed with `cat -A`) | `name` is display-only, but a mismatched name would be visible in the UI (`planDisplayName` has no canonical override for the Autopilot keys). |
| Single multi-row `INSERT` in one transaction | Atomic: reproduced that a constraint violation in any row inserts **nothing** (the id-collision case, §4.3). |

**Alternative (only if the owner wants one-pass convergence) — this is `AUTOPILOT_ACTIVATION_REPAIR_2026-10-26.md` §7's form, with the same three values:**

```sql
INSERT INTO public."PlanConfig"
  ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
VALUES
  ('plan_jata_autopilot',            'JATA_AUTOPILOT',            'JATA Autopilot — KES 2,499/month',            2499,  30, true, now(), now()),
  ('plan_jata_autopilot_pro',        'JATA_AUTOPILOT_PRO',        'JATA Autopilot Pro — KES 6,999/month',        6999,  30, true, now(), now()),
  ('plan_jata_autopilot_enterprise', 'JATA_AUTOPILOT_ENTERPRISE', 'JATA Autopilot Enterprise — KES 19,999/month', 19999, 30, true, now(), now())
ON CONFLICT ("key") DO UPDATE SET
  "priceKES"     = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  "isActive"     = true,
  "updatedAt"    = now();
```

Its behaviour on an existing key is materially different (§4.2) and it writes `now()` in the session's
time zone (finding **D1**). Both differences were reproduced locally.

---

## 3. Read-only verification SQL — **safe to run, no writes**

Full set with expected outputs is in `AUTOPILOT_PLANS_INSERT_REPAIR_REVIEW.sql` Part A / A5.
All 17 statements in that file were executed against a schema rebuilt from the repository's own DDL,
and each returned the expected pre-repair result (0 rows / `false`), so the file has no syntax error
and no statement that writes.

**V1 — one row, pass/fail (every column must be `true`):**

```sql
SELECT
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')) = 3 AS all_three_present,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT'            AND "priceKES" = 2499  AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS standard_ok,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT_PRO'        AND "priceKES" = 6999  AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS pro_ok,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT_ENTERPRISE' AND "priceKES" = 19999 AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS enterprise_ok;
```

**V2 — detail rows (expected: exactly three):**

```sql
SELECT key, id, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')
ORDER BY "priceKES";
-- expected: JATA_AUTOPILOT 2499 / 30 / true
--           JATA_AUTOPILOT_PRO 6999 / 30 / true
--           JATA_AUTOPILOT_ENTERPRISE 19999 / 30 / true
```

**V3 — the five pre-existing rows are still there and unchanged** (compare against the A2 snapshot
taken before the write):

```sql
SELECT id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
WHERE key IN ('ANNUAL','MONTHLY','AI_BUSINESS_FRONT_DESK','INTERACTIVE_BUSINESS','BUSINESS_POS')
ORDER BY key;
```

**V4 — row count (expected 5 → 8):** `SELECT count(*) FROM public."PlanConfig";`

**V5 — display-name encoding (expected 0 rows):** `position(chr(65533) in name) > 0` for the three
keys, i.e. no U+FFFD replacement character from a bad paste.

**Pre-flight before any write (A0/A1/A2/A3/A4 in the SQL file):** confirm the live column types,
nullability, defaults and the `PlanConfig_key_key` index; snapshot the whole table as the rollback
record; confirm no key **and** no proposed id is already taken; and count
`Payment` / `Subscription` / `AutopilotSubscription` rows that reference the three ids (expected 0/0/0).
A3 is the guard against the id-collision case in §4.3.

---

## 4. Conflict handling and historical-ID preservation

Reproduced on a database rebuilt from this repository's own `PlanConfig` DDL, pre-loaded with the five
production keys, a historical `Payment` (`planId` → the ANNUAL row) and a historical `Subscription`.

### 4.1 All three keys absent (the confirmed production state)

| Check | Result |
| --- | --- |
| Rows before | 5 |
| `ON CONFLICT ("key") DO NOTHING` | 3 rows inserted; the five existing rows byte-identical (same `id`, `createdAt`, `updatedAt`); total 8 |
| Historical `Payment.planId` → `PlanConfig.id` join | still resolves to `ANNUAL` |
| Second run of the same statement | 0 rows inserted, no error → idempotent |
| Verification V1 | `all_three_present / standard_ok / pro_ok / enterprise_ok` all `true` |

Nothing references the new ids (A4 returns 0/0/0), so "preserving existing `Payment.planId`
references" is satisfied trivially: no id is replaced, and the previously broken link — the missing
row — is what gets created. No `Payment` or `Subscription` row is touched.

### 4.2 A target key already exists — exact behaviour of each variant

Test row: `JATA_AUTOPILOT`, `id = cmliveautopilot000000001`, `priceKES = 1999`, `isActive = false`,
a `name` edited by an operator, plus a historical `Payment` pointing at that id.

| | `ON CONFLICT … DO NOTHING` | `ON CONFLICT … DO UPDATE` |
| --- | --- | --- |
| Rows inserted for that key | 0 | 0 (updated in place) |
| `id` | **unchanged** (`cmliveautopilot000000001`) | **unchanged** (`cmliveautopilot000000001`) |
| `priceKES` | **unchanged (1999)** — stays wrong | rewritten to **2499** |
| `durationDays` | unchanged (30) | rewritten to **30** |
| `isActive` | **unchanged (`false`)** — tier stays unsellable | rewritten to **`true`** (re-activates a deliberately deactivated tier) |
| `name` | unchanged | **unchanged** — the `SET` list does not include `name`, so an operator-edited or corrupted name survives (the seed *would* overwrite it) |
| `createdAt` | unchanged | unchanged |
| `updatedAt` | unchanged | `now()` |
| Historical `Payment.planId` join | still resolves to the same row | still resolves to the same row |
| Verification V1 | `standard_ok = false` (correctly reports the drift) | `standard_ok = true` |
| Affected rows reported | 2 (the other two tiers) | 3 |

So on an existing key: **`DO NOTHING` never alters the row** (it can leave a drifted row broken), and
**`DO UPDATE` silently rewrites price, duration and active flag** while preserving `id`, `createdAt`
and `name`. Neither variant touches any row whose key is not one of the three.

Because the evidence says all three keys are absent, `DO NOTHING` is sufficient and strictly safer.
If A3 ever shows a pre-existing key, the correct next step is a **separate, explicitly scoped
decision**: either B2's `UPDATE … WHERE key = … AND id = …` for that one row, or acceptance of the
`DO UPDATE` semantics above.

### 4.3 Edge case: the proposed `id` already exists under a different key

The ids are readable strings, so a collision is conceivable. Reproduced: with
`id = 'plan_jata_autopilot'` already held by another key, the statement fails with

```
duplicate key value violates unique constraint "PlanConfig_pkey"
```

The whole multi-row `INSERT` is rolled back — **nothing** is inserted (row count unchanged), so the
failure is safe and visible rather than partial. Pre-flight A3 detects this before the write.

### 4.4 What is deliberately *not* changed

`ANNUAL`, `MONTHLY`, `AI_BUSINESS_FRONT_DESK`, `INTERACTIVE_BUSINESS`, `BUSINESS_POS` — no column of
any of them is referenced by the statement; `id` and `key` of every existing row are untouched; no
`Subscription`, `Payment`, `AutopilotSubscription` or `AutopilotEntitlement` row is written; no
`name` rewrite of any kind; nothing deleted.

---

## 5. Expected results and rollback

### 5.1 Expected after the authorised write

| Observation | Expected |
| --- | --- |
| `PlanConfig` row count | 5 → **8** |
| V1 | `true, true, true, true` |
| V2 | three rows: 2499 / 6999 / 19999, `durationDays = 30`, `isActive = true` |
| V3 | the five original rows, unchanged (including their `id`, `createdAt`, `updatedAt`) |
| `/dashboard/autopilot/<businessId>` | `plans[].id` non-null for all three tiers; the "not configured" path is no longer reachable for these keys |
| `POST /api/checkout {businessId, planKey}` | `200` with Paystack `authorization_url`; amounts 249900 / 699900 / 1999900 minor units |
| Homepage `/` | unchanged (the standard card already rendered from `FALLBACK_PLANS` with the same values) |
| `/admin/plans` | 8 rows (admin-only surface) |
| Code deploy | **Not required** — the repair is data-only; `083dfdb` is already the Production deployment (see §6, deployment row) |

Local evidence for the route-level expectation: a temporary vitest harness (created, run, then
deleted) mocked only the database, session, Paystack initialiser and base URL, and drove the **real**
`app/api/checkout/route.ts` with rows shaped exactly like the ones the statement inserts:

```
✓ JATA_AUTOPILOT            → 200, initializeTransaction called with { amount: 249900,  currency: "KES" }
✓ JATA_AUTOPILOT_PRO        → 200, { amount: 699900,  currency: "KES" }
✓ JATA_AUTOPILOT_ENTERPRISE → 200, { amount: 1999900, currency: "KES" }
✓ assertAutopilotPlanPricing → { ok: true } for all three exact rows
✓ the same rows with priceKES − 1, durationDays 31, or isActive false → ok: false (guard is live)
6/6 passed
```

`tests/unit/autopilot-entitlement-and-packs.test.ts` (7 tests, the repository's own pricing-contract
suite) also passes unchanged.

### 5.2 Rollback

* **Capture first.** A2's full-table snapshot (all eight columns, with `id`, `createdAt`,
  `updatedAt`) is the rollback record. Keep it before the write.
* **Undo an insert** (only while nothing has purchased): delete the three rows by **both** key and id
  — see Part C1 of the SQL file. Foreign-key consequences differ per table and must be respected:
  `Subscription.planId` is `ON DELETE RESTRICT` (a delete fails safely once a subscription exists);
  `Payment.planId` is `ON DELETE SET NULL` (a delete would **silently sever** an existing payment's
  link to its plan); `AutopilotSubscription.planId` has **no foreign key at all**
  (`prisma/migrations/20261025000000_jata_autopilot_foundation/migration.sql:5-22`) — a delete would
  leave a dangling id there.
* **Undo a value change** (`DO UPDATE` / B2): write back the captured `priceKES`, `durationDays`,
  `isActive` for that `id` (Part C2). This is preferable to deleting once a real payment exists.
* **Last resort:** Neon branch restore / point-in-time recovery on the production branch, per
  `docs/NEON-RECOVERY-READINESS.md` — that document records that recovery is **unverified** in this
  repository's review environment; treat it as unproven.
* Deactivating a tier instead of deleting it (`isActive = false`) is the least destructive way to pull
  a plan from sale; it needs no FK reasoning at all.

### 5.3 Paystack and post-repair requirements

1. **`PAYSTACK_SECRET_KEY` must be set in Vercel Production.** Without it the route fails closed with
   `503 PAYMENTS_UNAVAILABLE` and marks the payment `FAILED` (`app/api/checkout/route.ts:178-194`).
   Presence is reported in `PRODUCTION_DEPLOYMENT_AUDIT_2026-10-25.md`; **it was not read here**
   (capability boundary). Which key is deployed — live or test — is **NOT TESTED**.
2. **Currency/amount are fixed in code, not configuration:** `PAYMENT_CURRENCY = "KES"`,
   `amount = priceKES × 100`. A plan row whose price does not match the catalogue is refused *before*
   Paystack is called, so a mispriced insert cannot undercharge.
3. **Do not change these prices while a checkout is in flight.** Settlement re-validates the plan row
   (`lib/autopilot/settlement.ts:74-88`); a price edit between payment creation and webhook would make
   settlement fail closed with `AUTOPILOT_PLAN_CONTRACT_VIOLATION` and the paid customer would not be
   activated automatically.
4. **Safe post-repair verification order:** V1/V2/V3/V4 (read-only) → `/admin/plans` listed as an
   ADMIN (read-only) → only then, **with separate authorisation**, one end-to-end click. The click is
   *not* read-only: it creates a `Payment` row and a Paystack session. Use Paystack test mode; abandon
   the session (the 15-minute pending window retires it to `EXPIRED`, and a later provider-verified
   success can still settle it) or complete it with a test card to prove settlement end-to-end.
5. **No redeploy** is needed for the repair itself.

---

## 6. Status per check

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `AUTOPILOT_ACTIVATION_REPAIR_2026-10-26.md` located and §7 read | **PASS** | Repository root; §7 "Blockers / owner actions" |
| 2 | `PlanConfig` model fields established | **PASS** | `prisma/schema.prisma:291-301` |
| 3 | Actual column types, nullability, defaults, PK, unique index established | **PASS** | `prisma/migrations/20250915000000_init/migration.sql:118-129, 223` |
| 4 | No migration creates `PlanConfig` rows (catalogue is seed-only) | **PASS** | `grep` over all 20 migrations; single non-insert match |
| 5 | Pricing validation contract established | **PASS** | `lib/autopilot/entitlement.ts:107-137`; enforced at `app/api/checkout/route.ts:104-107` and `lib/autopilot/settlement.ts:74-88` |
| 6 | Doc §7 SQL uses only real columns with correct types | **PASS** | 8 columns, all exist, all correctly typed |
| 7 | Doc §7 SQL supplies every NOT NULL column without a default | **PASS** for `updatedAt`; reproduced failure when omitted | local run |
| 8 | `ON CONFLICT ("key")` is supported by the real schema | **PASS** — unique **index** exists; `ON CONFLICT ON CONSTRAINT` form correctly **fails** | local run on rebuilt DDL |
| 9 | Proposed SQL parses and executes on a real Postgres engine (PG 18.6, schema rebuilt from this repo's migrations) | **PASS** | insert, re-run, conflict cases, all Part A statements |
| 10 | Proposed SQL executes on **Neon production** | **BLOCKED** — no credential, no Neon connection from this environment; and a production write is outside this authorisation | — |
| 11 | Live production `PlanConfig` contents re-read independently | **BLOCKED** — I can only rely on the owner's read-only result | — |
| 12 | Confirmed production state (5 rows, 3 Autopilot keys absent) | **PASS** (owner-provided, taken as given) | owner's `SELECT key, "priceKES", "durationDays", "isActive" …` |
| 13 | Production schema drift (extra columns, missing index, changed defaults) | **BLOCKED** — cannot read the Neon catalogue; A0/A0b in the SQL file close this before any write | — |
| 14 | Behaviour when a target key already exists, both variants | **PASS** | §4.2, reproduced |
| 15 | Existing ids / historical `Payment.planId` preserved | **PASS** | §4.1, §4.2 — `id` never rewritten by either variant |
| 16 | Unrelated plans untouched | **PASS** for `DO NOTHING` (absolute); `DO UPDATE` touches only the three allowlisted keys | §4 |
| 17 | Idempotency of a re-run | **PASS** | second run: 0 rows affected, no error |
| 18 | Atomicity of the multi-row insert | **PASS** | id-collision case inserted nothing |
| 19 | Repaired rows pass `assertAutopilotPlanPricing` | **PASS** | temporary harness + `tests/unit/autopilot-entitlement-and-packs.test.ts` (7 passed) |
| 20 | Real `POST /api/checkout` accepts the repaired rows and charges the catalogue price | **PASS** (local, mocked provider; 249900 / 699900 / 1999900) | 6/6 temporary tests |
| 21 | No customer-facing plan list gains rows | **PASS** | `PRIVATE_PLAN_KEYS` (`lib/pricing.ts:38-43`) + `publiclyListedPlans` call sites |
| 22 | Read-only verification SQL is valid and returns the expected pre-repair state | **PASS** | 17/17 statements executed |
| 23 | Fix already deployed to production (no code deploy needed) | **PASS** (GitHub deployment record: commit `083dfdb`, environment `Production`, status `success`, created `2026-10-26T08:08:08Z`) | `gh api repos/…/deployments` + statuses |
| 24 | Live site reachable / behaves as expected from here | **NOT TESTED** — sandbox egress to `jata-aftercall.vercel.app` is blocked (DNS resolves, HTTPS `000`) | — |
| 25 | `PAYSTACK_SECRET_KEY` present in Vercel Production | **NOT TESTED** — no access; documented as present in the 2026-10-25 audit | — |
| 26 | End-to-end payment in Paystack test mode | **NOT TESTED** — a payment is outside this authorisation | — |
| 27 | Repair executed | **NOT EXECUTED — by design** | — |

### Findings on the existing documentation

The §7 SQL in `AUTOPILOT_ACTIVATION_REPAIR_2026-10-26.md` is **schema-correct**: right table, right
eight columns, correct types, `updatedAt` supplied, and `ON CONFLICT ("key")` valid against the real
unique index. Its claim that it "keeps any existing `id`, so historical `Payment.planId` references
stay valid" is accurate for both variants (reproduced). Nothing in it would fail on this schema. Five
things it does not say, all of which change the review:

* **D1 — `now()` vs `timezone('UTC', now())`.** `createdAt`/`updatedAt` are `TIMESTAMP(3)` *without*
  time zone, so a bare `now()` is cast through the session `TimeZone`. Reproduced: with
  `SET TimeZone = 'Africa/Nairobi'`, `now()` stored `12:01` where Prisma stores `09:01` — a 3-hour
  skew. Harmless in effect (no application logic reads `PlanConfig.createdAt/updatedAt`) but
  inconsistent, and avoidable.
* **D2 — `DO UPDATE` is not "insert only what is missing".** On a key that already exists it rewrites
  `priceKES`, `durationDays` and `isActive` and re-activates a deliberately deactivated tier, while
  leaving `name` stale. §4.2 tabulates this. Given the evidence that all three keys are absent,
  `DO NOTHING` is the lower-risk form.
* **D3 — deterministic ids can collide.** If any proposed `id` is already held by another key, the
  whole statement fails on `PlanConfig_pkey` (safe, but a surprise). A3 checks this first.
* **D4 — the `ON CONSTRAINT` trap.** The unique key is an *index*, so
  `ON CONFLICT ON CONSTRAINT "PlanConfig_key_key"` fails; only the column-inference form works.
* **D5 — the repair is not reproducible from the repository.** Because no migration provisions
  `PlanConfig`, a fresh database or a new Neon branch loses all eight plans, including these three.
  The one-off SQL fixes production today and leaves that structural gap in place. Worth a separate,
  reviewed follow-up — a **scoped, idempotent plan-provisioning script** (e.g. `scripts/seed-plans.ts`
  writing only the eight plan rows, or a data migration) — rather than widening `npm run seed`, which
  would also create demo businesses and an `ADMIN` account with a known default password.

---

## 7. Recommendation before any owner write

1. **Run Part A only** (read-only) and keep the output: A0/A0b confirm the live schema still matches
   the migrations and that `PlanConfig_key_key` exists; A1/A3 should return **no rows**; A2 is the
   rollback snapshot; A4 should return 0 / 0 / 0.
2. **If A1/A3 are empty** — the expected case — authorise **B1 (`ON CONFLICT ("key") DO NOTHING`)**
   exactly as written. It is the minimal, atomic, idempotent repair; it cannot alter any existing row
   or any unrelated plan; it preserves every id; and it needs no code deploy.
3. **If A3 returns a row**, stop and review it: a pre-existing key needs a deliberate decision (§4.2),
   and a taken `id` needs the id changed.
4. **If A0/A0b differ from the migrations**, stop: the schema has drifted and the SQL file must be
   re-reviewed against what is actually there.
5. After the write: **V1–V5 read-only**. Then optionally verify `/admin/plans` shows 8 rows. Then, as a
   **separate authorisation**, one Paystack **test-mode** end-to-end activation to prove 2499 →
   249900 minor units reaches activation; abandon it or pay with a test card.
6. Keep the A2 snapshot until at least one successful end-to-end activation has been observed.

**Nothing above has been executed. The repair is prepared, reviewed against the real schema, and
reproduced locally; it awaits explicit owner authorisation.**
