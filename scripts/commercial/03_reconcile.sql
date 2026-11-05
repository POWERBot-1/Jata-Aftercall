-- =============================================================================
-- 03 — RECONCILIATION REPORT (run BEFORE and AFTER the approved execution; diff outputs)
-- Status: PREPARED — NOT EXECUTED. Every statement is a SELECT.
-- Expected under Option A: R1 baseline = 8 rows (Oct-29 verified); R1 post = 11 rows;
-- R2/R3/R4 must be BYTE-IDENTICAL before vs after (the migration mutates no customer rows).
-- =============================================================================

-- R1. Catalogue
SELECT key, "priceKES", "durationDays", "isActive" FROM "PlanConfig" ORDER BY key;

-- R2. Subscriptions by plan × status (customer population fingerprint)
SELECT COALESCE(pc.key,'<MISSING_PLAN>') AS plan_key, s.status, count(*) AS n
FROM "Subscription" s LEFT JOIN "PlanConfig" pc ON pc.id = s."planId"
GROUP BY 1, 2 ORDER BY 1, 2;

-- R3. AI entitlements by packageKey × status
SELECT "packageKey", status, count(*) AS n
FROM "AIPackageEntitlement" GROUP BY 1, 2 ORDER BY 1, 2;

-- R4. Payments by status (must show ZERO new rows from migration)
SELECT status, count(*) AS n, max("createdAt") AS last_payment
FROM "Payment" GROUP BY status ORDER BY status;

-- R5. Exceptions (must be empty or individually listed)
SELECT s."businessId", s."planId", s.status
FROM "Subscription" s LEFT JOIN "PlanConfig" pc ON pc.id = s."planId"
WHERE pc.id IS NULL;

-- R6. Spot-check: five most recent active Front Desk subscribers — start/expiry must be unchanged
SELECT s."businessId", pc.key, s.status, s."startAt", s."expiresAt"
FROM "Subscription" s JOIN "PlanConfig" pc ON pc.id = s."planId"
WHERE pc.key IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
  AND s.status IN ('ACTIVE','EXPIRING')
ORDER BY s."expiresAt" DESC
LIMIT 5;
