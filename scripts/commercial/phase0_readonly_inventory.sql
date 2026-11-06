-- =============================================================================
-- PHASE 0 READ-ONLY PRODUCTION INVENTORY — AI Front Desk 2.0 commercial migration
-- Classification: §41.2 audit. EVERY STATEMENT IS A SELECT. Nothing is written.
-- Target: enrolled production Neon branch (database `neondb`) — same target verified by the
-- 2026-10-29 owner query (see PLAN_CATALOGUE_AUDIT_2026-10-29.md Part II §12).
-- Run by the owner/operator; transcribe the full output back as evidence.
-- VALIDATED 2026-11-05 (see scripts/commercial/README.md): 16/16 statements are SELECT;
-- zero write/transaction keywords; every table and column cross-checked against
-- prisma/schema.prisma. Read-only confirmed. Execution instructions: same README.
-- =============================================================================

-- A. Complete catalogue (authoritative)
SELECT id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt"
FROM "PlanConfig"
ORDER BY key;

-- A2. Front Desk family specifically (expect exactly one row today: AI_BUSINESS_FRONT_DESK 499/30)
SELECT id, key, name, "priceKES", "durationDays", "isActive"
FROM "PlanConfig"
WHERE key IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE')
ORDER BY "priceKES";

-- B. Catalogue count (baseline for reconciliation B-1)
SELECT count(*) AS plan_rows FROM "PlanConfig";

-- C. Paystack/payment reference shape (no secrets): recent subscription payments
SELECT p.status, pc.key AS plan_key, count(*) AS n,
       min(p."createdAt") AS first_seen, max(p."createdAt") AS last_seen
FROM "Payment" p
LEFT JOIN "PlanConfig" pc ON pc.id = p."planId"
WHERE p.purpose = 'SUBSCRIPTION'
GROUP BY p.status, pc.key
ORDER BY pc.key, p.status;

-- D. Payment verification integrity: PAID rows without provider id, and amount sanity
SELECT p.id, p.reference, p.amount, p.currency, p."paystackId", pc.key AS plan_key, p."createdAt"
FROM "Payment" p
LEFT JOIN "PlanConfig" pc ON pc.id = p."planId"
WHERE p.status = 'PAID'
  AND (p."paystackId" IS NULL OR p."paystackId" = ''
       OR p.amount <> COALESCE(pc."priceKES", p.amount) * 100)
ORDER BY p."createdAt" DESC;

-- E. EXISTING CUSTOMER ENTITLEMENT INVENTORY (deliverable #3) — subscriptions by plan/status
SELECT pc.key AS plan_key, s.status, count(*) AS businesses,
       min(s."startAt") AS earliest_start, max(s."expiresAt") AS latest_expiry
FROM "Subscription" s
LEFT JOIN "PlanConfig" pc ON pc.id = s."planId"
GROUP BY pc.key, s.status
ORDER BY pc.key, s.status;

-- E2. Row-level detail for EVERY subscription (customer-by-customer plan input)
SELECT s."businessId", s."userId", u.email, pc.key AS plan_key, s.status,
       s."startAt", s."expiresAt", s."graceUntil", s."updatedAt"
FROM "Subscription" s
LEFT JOIN "PlanConfig" pc ON pc.id = s."planId"
LEFT JOIN "User" u ON u.id = s."userId"
ORDER BY pc.key, s.status, s."expiresAt";

-- F. AI Front Desk entitlement rows (packageKey × status × expiry)
SELECT "packageKey", status, count(*) AS businesses,
       min("expiresAt") AS earliest_expiry, max("expiresAt") AS latest_expiry
FROM "AIPackageEntitlement"
GROUP BY "packageKey", status
ORDER BY "packageKey", status;

-- F2. Row-level AI entitlements
SELECT e."businessId", e."packageKey", e.status, e."activatedAt", e."expiresAt", e."updatedAt"
FROM "AIPackageEntitlement" e
ORDER BY e."packageKey", e.status, e."expiresAt";

-- G. ANOMALIES → exception register (each row is individually reviewed, never auto-fixed)
-- G1. Subscriptions whose plan row is missing
SELECT s."businessId", s."planId", s.status, s."expiresAt"
FROM "Subscription" s
LEFT JOIN "PlanConfig" pc ON pc.id = s."planId"
WHERE pc.id IS NULL;

-- G2. AI entitlement packageKey that is not a known key
SELECT "businessId", "packageKey", status, "expiresAt"
FROM "AIPackageEntitlement"
WHERE "packageKey" NOT IN ('AI_BUSINESS_FRONT_DESK','AI_FRONT_DESK_STANDARD','AI_FRONT_DESK_PRO','AI_FRONT_DESK_VOICE');

-- G3. ACTIVE entitlement but no ACTIVE/EXPIRING subscription (contradictory state)
SELECT e."businessId", e.status AS ent_status, e."expiresAt" AS ent_expires,
       s.status AS sub_status, s."expiresAt" AS sub_expires
FROM "AIPackageEntitlement" e
LEFT JOIN "Subscription" s ON s."businessId" = e."businessId"
WHERE e.status = 'ACTIVE'
  AND (s.id IS NULL OR s.status NOT IN ('ACTIVE','EXPIRING'));

-- G4. PAID subscription payments with no subscription row for the business
SELECT DISTINCT p."businessId", p.reference, pc.key AS plan_key, p."createdAt"
FROM "Payment" p
JOIN "PlanConfig" pc ON pc.id = p."planId"
LEFT JOIN "Subscription" s ON s."businessId" = p."businessId"
WHERE p.status = 'PAID' AND p.purpose = 'SUBSCRIPTION'
  AND p."businessId" IS NOT NULL AND s.id IS NULL;

-- H. PROTECTED / OUT-OF-SCOPE populations (must be byte-identical after migration)
-- Note: Subscription.status is an enum while POS/Autopilot statuses are text; PostgreSQL
-- cannot resolve a UNION across type categories, so every status expression is cast to text
-- explicitly (output shape is unchanged).
SELECT 'page_plans' AS family, pc.key, s.status::text, count(*)
FROM "Subscription" s JOIN "PlanConfig" pc ON pc.id = s."planId"
WHERE pc.key IN ('MONTHLY','ANNUAL','INTERACTIVE_BUSINESS')
GROUP BY pc.key, s.status::text
UNION ALL
SELECT 'other_products', 'POS', "status"::text, count(*) FROM "PosSubscription" GROUP BY "status"::text
UNION ALL
SELECT 'other_products', 'AUTOPILOT', "status"::text, count(*) FROM "AutopilotSubscription" GROUP BY "status"::text
ORDER BY family, key, status;

-- I. Duplicate-charge canary: same business with >1 PAID payment in 24h for the same plan
SELECT "businessId", planId, count(*) AS paid_n
FROM "Payment"
WHERE status = 'PAID' AND purpose = 'SUBSCRIPTION'
  AND "createdAt" > now() - interval '24 hours'
GROUP BY "businessId", planId
HAVING count(*) > 1;

-- J. Processed-webhook volume (idempotency health)
SELECT count(*) AS processed_events FROM "ProcessedWebhook";
