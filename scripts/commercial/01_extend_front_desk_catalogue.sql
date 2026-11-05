-- =============================================================================
-- 01 — EXTEND FRONT DESK CATALOGUE TO FOUR TIERS (Option A: key reuse)
-- Status: PREPARED — NOT EXECUTED. Requires explicit owner approval (§41.11).
-- Effect: adds exactly three rows (Standard 999, Pro 1999, Voice 3999; all 30 days).
--         Never inserts, updates or deletes the existing AI_BUSINESS_FRONT_DESK row:
--         the guard below REFUSES to run if the Starter row is missing or mispriced.
--         Touches no Subscription, Payment, AIPackageEntitlement or any other table.
--         Idempotent: safe to re-run; ON CONFLICT never changes an existing id.
-- =============================================================================

DO $$
DECLARE
  starter RECORD;
BEGIN
  SELECT id, "priceKES", "durationDays", "isActive" INTO starter
  FROM "PlanConfig" WHERE key = 'AI_BUSINESS_FRONT_DESK';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARD FAILED: AI_BUSINESS_FRONT_DESK row missing — aborting (nothing written).';
  END IF;
  IF starter."priceKES" <> 499 OR starter."durationDays" <> 30 THEN
    RAISE EXCEPTION 'GUARD FAILED: Starter row is %/% (expected 499/30) — aborting (nothing written).',
      starter."priceKES", starter."durationDays";
  END IF;
END $$;

INSERT INTO "PlanConfig" (id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt") VALUES
  ('plan_ai_front_desk_standard', 'AI_FRONT_DESK_STANDARD',
   'Front Desk Standard — KES 999/month', 999, 30, true, now(), now()),
  ('plan_ai_front_desk_pro', 'AI_FRONT_DESK_PRO',
   'Front Desk Pro — KES 1,999/month', 1999, 30, true, now(), now()),
  ('plan_ai_front_desk_voice', 'AI_FRONT_DESK_VOICE',
   'Front Desk Voice — KES 3,999/month', 3999, 30, true, now(), now())
ON CONFLICT (key) DO UPDATE SET
  "priceKES" = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  name = EXCLUDED.name,
  "isActive" = true,
  "updatedAt" = now();

-- Rename only the display name of the reused Starter row (price/key/id untouched).
UPDATE "PlanConfig"
SET name = 'Front Desk Starter — KES 499/month', "updatedAt" = now()
WHERE key = 'AI_BUSINESS_FRONT_DESK' AND "priceKES" = 499 AND "durationDays" = 30
  AND name IS DISTINCT FROM 'Front Desk Starter — KES 499/month';

-- Post-condition verification (expect exactly these four rows; Starter id unchanged)
SELECT id, key, name, "priceKES", "durationDays", "isActive"
FROM "PlanConfig"
WHERE key IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
ORDER BY "priceKES";
