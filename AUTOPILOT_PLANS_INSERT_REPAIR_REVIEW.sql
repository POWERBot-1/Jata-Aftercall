-- JATA Autopilot — minimal PlanConfig repair for the three missing Autopilot tiers.
--
-- STATUS: PREPARED FOR OWNER REVIEW. THE WRITE IN PART B HAS NOT BEEN EXECUTED ANYWHERE.
--         Nothing in this file has been run against Neon, production or any shared database.
--
-- Target:  Neon project production branch (br-cold-snow-ax606swa), database neondb, schema public.
-- Purpose: create exactly three PlanConfig rows — JATA_AUTOPILOT (2499), JATA_AUTOPILOT_PRO (6999),
--          JATA_AUTOPILOT_ENTERPRISE (19999) — all 30 days, all active. Nothing else.
--
-- Why only three rows: the owner's read-only query on 2026-10-26 returned five rows
-- (AI_BUSINESS_FRONT_DESK, ANNUAL, BUSINESS_POS, INTERACTIVE_BUSINESS, MONTHLY) and none of the
-- three Autopilot keys. No migration in prisma/migrations inserts PlanConfig rows, so the
-- catalogue is seed-only and the Autopilot tiers were never provisioned in production.
--
-- Schema facts this file depends on (prisma/schema.prisma:291-301 and
-- prisma/migrations/20250915000000_init/migration.sql:118-129, 223):
--   id TEXT NOT NULL PK | key TEXT NOT NULL UNIQUE | name TEXT NOT NULL
--   priceKES INTEGER NOT NULL | durationDays INTEGER NOT NULL
--   isActive BOOLEAN NOT NULL DEFAULT true
--   createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP | updatedAt TIMESTAMP(3) NOT NULL (no default)
--   UNIQUE INDEX "PlanConfig_key_key" ON "PlanConfig"("key")   <-- this is an INDEX, not a constraint
--
-- SAFETY DESIGN OF THIS FILE
--   Part A is read-only (repeatable-read, READ ONLY transaction) and can be run as-is.
--   Part B is the write and is COMMENTED OUT. Running this file with psql performs no write.
--   Part C is the rollback reference and is also commented out.
--
-- Usage (after explicit owner authorisation), read-only parts only:
--   psql -X -v ON_ERROR_STOP=1 --dbname "$DATABASE_URL" --file AUTOPILOT_PLANS_INSERT_REPAIR_REVIEW.sql
--   (Use a read-only role for Part A; never paste the connection string into a chat or ticket.)

\set ON_ERROR_STOP on

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY. Safe to run at any time. No writes, no locks beyond ACCESS SHARE.
-- ════════════════════════════════════════════════════════════════════════════════════════════

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

\echo '── A0. Confirm the live table shape matches the migrations (drift check) ──'
-- Expected: the eight columns below, is_nullable = NO for all of them, column_default 'true' for
-- isActive and 'CURRENT_TIMESTAMP' for createdAt, NULL default for updatedAt.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'PlanConfig'
ORDER BY ordinal_position;

\echo '── A0b. Confirm the unique index the repair statement relies on ──'
-- Expected: PlanConfig_pkey on (id) and PlanConfig_key_key on (key). If PlanConfig_key_key is
-- absent, Part B's ON CONFLICT ("key") clause has no arbiter: STOP and report back.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'PlanConfig'
ORDER BY indexname;

\echo '── A1. Current state of the three Autopilot keys (expected: 0 rows before repair) ──'
SELECT key, id, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
WHERE key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE')
ORDER BY "priceKES";

\echo '── A2. Full catalogue snapshot (expected: 5 rows) — SAVE THIS OUTPUT AS THE ROLLBACK RECORD ──'
SELECT id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
ORDER BY key;

\echo '── A3. Collision check: is any proposed id, or any target key, already taken? (expected: 0 rows) ──'
-- A non-empty result means either a key already exists (see the conflict analysis in the report)
-- or one of the deterministic ids is held by another key, which would make the INSERT fail on
-- PlanConfig_pkey. Do not run Part B until this returns no rows, or until the finding is reviewed.
SELECT id, key, "priceKES", "durationDays", "isActive"
FROM public."PlanConfig"
WHERE id IN ('plan_jata_autopilot', 'plan_jata_autopilot_pro', 'plan_jata_autopilot_enterprise')
   OR key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE')
ORDER BY key;

\echo '── A4. Existing references that a repair must not disturb (expected: 0 / 0 / 0) ──'
-- Payment.planId -> PlanConfig.id is ON DELETE SET NULL; Subscription.planId is ON DELETE RESTRICT;
-- AutopilotSubscription.planId has no foreign key at all.
SELECT 'Payment' AS referring_table, count(*)::int AS rows_referencing
FROM public."Payment"
WHERE "planId" IN (SELECT id FROM public."PlanConfig"
                   WHERE key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE'))
UNION ALL
SELECT 'Subscription', count(*)::int
FROM public."Subscription"
WHERE "planId" IN (SELECT id FROM public."PlanConfig"
                   WHERE key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE'))
UNION ALL
SELECT 'AutopilotSubscription', count(*)::int
FROM public."AutopilotSubscription"
WHERE "planId" IN (SELECT id FROM public."PlanConfig"
                   WHERE key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE'));

COMMIT;

-- ── A5 / V1. POST-REPAIR VERIFICATION — read-only, single-row pass/fail ──────────────────────
-- Run this after the authorised write. Every column must be true.
-- (Before the repair this returns false / false / false / false, which is the current production state.)
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

\echo '── V1. All three keys present, correct price, 30 days, active ──'
SELECT
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')) = 3 AS all_three_present,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT' AND "priceKES" = 2499 AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS standard_ok,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT_PRO' AND "priceKES" = 6999 AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS pro_ok,
  (SELECT count(*) FROM public."PlanConfig"
     WHERE key = 'JATA_AUTOPILOT_ENTERPRISE' AND "priceKES" = 19999 AND "durationDays" = 30 AND "isActive" IS TRUE) = 1 AS enterprise_ok;

\echo '── V2. Detail rows (expected: exactly three, copied into the verification record) ──'
SELECT key, id, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
WHERE key IN ('JATA_AUTOPILOT', 'JATA_AUTOPILOT_PRO', 'JATA_AUTOPILOT_ENTERPRISE')
ORDER BY "priceKES";

\echo '── V3. The original five rows must still be present and unchanged (expected: 5 rows) ──'
SELECT id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM public."PlanConfig"
WHERE key IN ('ANNUAL','MONTHLY','AI_BUSINESS_FRONT_DESK','INTERACTIVE_BUSINESS','BUSINESS_POS')
ORDER BY key;

\echo '── V4. Row count (expected: previous count + 3; 5 + 3 = 8) ──'
SELECT count(*)::int AS total_plan_rows FROM public."PlanConfig";

\echo '── V5. Optional: display-name encoding check (expected: 0 rows) ──'
-- planDisplayName() renders a stored name that contains U+FFFD verbatim for keys it has no
-- canonical override for, and the Autopilot keys are not overridden. A mangled em dash would be
-- visible in the UI, so check it. chr(65533) is U+FFFD.
SELECT key, name FROM public."PlanConfig"
WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')
  AND position(chr(65533) in name) > 0;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- PART B — THE WRITE. NOT EXECUTED. Requires explicit owner authorisation.
--          Every line below is commented out on purpose; uncommenting is the authorisation act.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- B1. RECOMMENDED — insert-only, conflict-safe, cannot modify any existing row.
--     Given A1/A3 return no rows (the confirmed production state), this inserts exactly 3 rows.
--     If a target key already exists, that key's row is left completely untouched (Postgres
--     reports it as "no row inserted" and reports no error). Re-running is a no-op.
--     A single multi-row INSERT is atomic: if any value violates a constraint, nothing is inserted.
--
-- BEGIN;
-- SET LOCAL statement_timeout = '30s';
-- INSERT INTO public."PlanConfig"
--   ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
-- VALUES
--   ('plan_jata_autopilot',            'JATA_AUTOPILOT',            'JATA Autopilot — KES 2,499/month',            2499, 30, true, timezone('UTC', now()), timezone('UTC', now())),
--   ('plan_jata_autopilot_pro',        'JATA_AUTOPILOT_PRO',        'JATA Autopilot Pro — KES 6,999/month',        6999, 30, true, timezone('UTC', now()), timezone('UTC', now())),
--   ('plan_jata_autopilot_enterprise', 'JATA_AUTOPILOT_ENTERPRISE', 'JATA Autopilot Enterprise — KES 19,999/month', 19999, 30, true, timezone('UTC', now()), timezone('UTC', now()))
-- ON CONFLICT ("key") DO NOTHING;
-- COMMIT;
--
--     Notes on the statement itself:
--       • ON CONFLICT ("key") infers the unique index "PlanConfig_key_key". Do NOT rewrite this as
--         ON CONFLICT ON CONSTRAINT "PlanConfig_key_key": Prisma created an index, not a named
--         constraint, so that form fails with 'constraint ... does not exist' (reproduced).
--       • updatedAt has no database default and is NOT NULL, so it must be supplied (reproduced:
--         omitting it fails with 'null value in column "updatedAt" ... violates not-null constraint').
--       • timezone('UTC', now()) rather than now(): the columns are TIMESTAMP(3) WITHOUT time zone,
--         so a bare now() is cast through the session TimeZone. With a non-UTC session (e.g.
--         Africa/Nairobi) the two columns would be stored three hours ahead of the UTC values
--         Prisma writes (reproduced). These two columns are display/metadata only — no application
--         logic reads PlanConfig.createdAt/updatedAt — but the values should still agree.
--       • Names are byte-identical to prisma/seed.ts lines 25-27 and to lib/pricing.ts FALLBACK_PLANS
--         (em dash U+2014). The name is display-only; price and duration come from priceKES/durationDays.
--       • The ids are readable, deterministic values. PlanConfig.id is TEXT with a cuid() default at
--         the Prisma layer only; there is no database default, so the id must be supplied by hand.
--
-- B2. ONLY IF A3 SHOWS A PRE-EXISTING TARGET KEY WITH DRIFT — targeted update for that one key.
--     Scoped by both key and id so it cannot touch another plan. This is a deliberate price /
--     availability change and should be a separate owner decision.
--
-- UPDATE public."PlanConfig"
--    SET "priceKES"     = 2499,          -- replace with the price for the tier being corrected
--        "durationDays" = 30,
--        "isActive"     = true,
--        "updatedAt"    = timezone('UTC', now())
--  WHERE key = 'JATA_AUTOPILOT'
--    AND id  = '<the id A1 returned for that key>';
--
-- B3. THE DOCUMENTED VARIANT — prisma/seed.ts parity via upsert. NOT RECOMMENDED here.
--     Equivalent to AUTOPILOT_ACTIVATION_REPAIR_2026-10-26.md §7. It keeps any existing id but, on
--     a key that already exists, it rewrites priceKES, durationDays and isActive (re-activating a
--     deliberately deactivated tier) and leaves the stored name untouched. Use only if the owner
--     explicitly wants one-pass convergence regardless of existing state.
--
-- INSERT INTO public."PlanConfig"
--   ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
-- VALUES
--   ('plan_jata_autopilot',            'JATA_AUTOPILOT',            'JATA Autopilot — KES 2,499/month',            2499, 30, true, timezone('UTC', now()), timezone('UTC', now())),
--   ('plan_jata_autopilot_pro',        'JATA_AUTOPILOT_PRO',        'JATA Autopilot Pro — KES 6,999/month',        6999, 30, true, timezone('UTC', now()), timezone('UTC', now())),
--   ('plan_jata_autopilot_enterprise', 'JATA_AUTOPILOT_ENTERPRISE', 'JATA Autopilot Enterprise — KES 19,999/month', 19999, 30, true, timezone('UTC', now()), timezone('UTC', now()))
-- ON CONFLICT ("key") DO UPDATE SET
--   "priceKES"     = EXCLUDED."priceKES",
--   "durationDays" = EXCLUDED."durationDays",
--   "isActive"     = true,
--   "updatedAt"    = EXCLUDED."updatedAt";

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- PART C — ROLLBACK REFERENCE. NOT EXECUTED. Decide with the A2 snapshot in hand.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- C1. If the repair only inserted (B1) and nothing was purchased since:
-- DELETE FROM public."PlanConfig"
--  WHERE key IN ('JATA_AUTOPILOT','JATA_AUTOPILOT_PRO','JATA_AUTOPILOT_ENTERPRISE')
--    AND id  IN ('plan_jata_autopilot','plan_jata_autopilot_pro','plan_jata_autopilot_enterprise');
--
--     Caveats: Subscription.planId is ON DELETE RESTRICT, so a delete fails (safely) once an
--     AFTERCALL subscription points at the row. Payment.planId is ON DELETE SET NULL, so a delete
--     after any Autopilot payment exists would silently sever that payment's link to its plan.
--     AutopilotSubscription.planId has no foreign key, so a delete would leave a dangling id there.
--     Once a real payment exists, prefer restoring values (C2) over deleting.
--
-- C2. If B2/B3 changed an existing row: restore the priceKES / durationDays / isActive values that
--     the A1 (or A2) output captured, scoped by that row's id.
--
-- C3. Last resort: Neon branch restore / point-in-time recovery on the production branch, per
--     docs/NEON-RECOVERY-READINESS.md. That document records that recovery has not been verified
--     in this repository's review environment; treat it as unproven until the owner has drilled it.
