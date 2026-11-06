-- =============================================================================
-- 01 — EXTEND FRONT DESK CATALOGUE TO FOUR TIERS (Option A: key reuse)
-- Status: PREPARED — NOT EXECUTED. Requires explicit owner approval (§41.11).
-- Effect: adds exactly three rows (Standard 999, Pro 1999, Voice 3999; all 30 days).
--         The guard below REFUSES to run if the Starter row is missing or mispriced.
--         Touches no Subscription, Payment, AIPackageEntitlement or any other table.
--         The only write against the existing Starter row is its display name (Option A as
--         documented in runbook 07 §7.2 item 5); id, key, price, duration and active flag
--         are never modified — strike that trailing UPDATE if the owner wants zero touch.
--         Existing tier keys are never overwritten; conflicts must match exact expected rows.
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
  IF starter."priceKES" <> 499 OR starter."durationDays" <> 30 OR starter."isActive" IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'GUARD FAILED: Starter must be active at 499/30 (got %/% active=%) — aborting (nothing written).',
      starter."priceKES", starter."durationDays", starter."isActive";
  END IF;

  -- Existing keys are acceptable only when they already match the intended immutable catalogue.
  IF EXISTS (
    SELECT 1 FROM "PlanConfig"
    WHERE key = 'AI_FRONT_DESK_STANDARD'
      AND ("priceKES" <> 999 OR "durationDays" <> 30 OR "isActive" IS DISTINCT FROM true)
  ) OR EXISTS (
    SELECT 1 FROM "PlanConfig"
    WHERE key = 'AI_FRONT_DESK_PRO'
      AND ("priceKES" <> 1999 OR "durationDays" <> 30 OR "isActive" IS DISTINCT FROM true)
  ) OR EXISTS (
    SELECT 1 FROM "PlanConfig"
    WHERE key = 'AI_FRONT_DESK_VOICE'
      AND ("priceKES" <> 3999 OR "durationDays" <> 30 OR "isActive" IS DISTINCT FROM true)
  ) THEN
    RAISE EXCEPTION 'GUARD FAILED: an existing Front Desk tier conflicts with the approved catalogue; nothing written.';
  END IF;
END $$;

INSERT INTO "PlanConfig" (id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt") VALUES
  ('plan_ai_front_desk_standard', 'AI_FRONT_DESK_STANDARD',
   'Front Desk Standard — KES 999/month', 999, 30, true, now(), now()),
  ('plan_ai_front_desk_pro', 'AI_FRONT_DESK_PRO',
   'Front Desk Pro — KES 1,999/month', 1999, 30, true, now(), now()),
  ('plan_ai_front_desk_voice', 'AI_FRONT_DESK_VOICE',
   'Front Desk Voice — KES 3,999/month', 3999, 30, true, now(), now())
ON CONFLICT (key) DO NOTHING;

-- Display-name alignment (Option A): the Starter row keeps its id, key, price, duration and
-- active flag; only the customer-facing label moves to the approved Front Desk Starter name.
UPDATE "PlanConfig"
SET name = 'Front Desk Starter — KES 499/month', "updatedAt" = now()
WHERE key = 'AI_BUSINESS_FRONT_DESK'
  AND name <> 'Front Desk Starter — KES 499/month';

-- Post-condition verification (expect exactly these four rows; Starter id unchanged)
SELECT id, key, name, "priceKES", "durationDays", "isActive"
FROM "PlanConfig"
WHERE key IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
ORDER BY "priceKES";
