-- =============================================================================
-- 02 — ROLLBACK: deactivate the three new Front Desk tiers
-- Status: PREPARED — NOT EXECUTED. Requires explicit owner approval (§41.11).
-- Effect: sets isActive=false for exactly AI_FRONT_DESK_STANDARD / _PRO / _VOICE.
--         Never touches AI_BUSINESS_FRONT_DESK, any other plan, or any customer row.
--         Tier-aware application code MUST remain deployed while any customer has an active
--         Standard/Pro entitlement. Do not roll back to pre-tier code until every such paid term
--         and grace period has expired, or a separately verified compatible build is ready.
--         This script only closes new sales; it never revokes existing customer access.
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
