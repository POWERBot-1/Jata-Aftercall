-- =============================================================================
-- 02 — ROLLBACK: deactivate the three new Front Desk tiers
-- Status: PREPARED — NOT EXECUTED. Requires explicit owner approval (§41.11).
-- Effect: sets isActive=false for exactly AI_FRONT_DESK_STANDARD / _PRO / _VOICE.
--         Never touches AI_BUSINESS_FRONT_DESK, any other plan, or any customer row.
--         Customers who already purchased a new tier before rollback KEEP their access;
--         their cases go to the exception register for manual handling (never silent revert).
-- Order of operations: run THIS first, then roll back the application deployment.
-- =============================================================================

UPDATE "PlanConfig"
SET "isActive" = false, "updatedAt" = now()
WHERE key IN ('AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
  AND "isActive" = true;

-- Verify: three deactivated; Starter still active at 499/30
SELECT key, "priceKES", "durationDays", "isActive"
FROM "PlanConfig"
WHERE key IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
ORDER BY "priceKES";
