-- MJENGO OS product — independent plan and entitlements.
-- Additive only: one new PlanConfig row and one new MJENGO-specific view helper.
-- No POS, ERP_PRO, or customer data is altered. Existing BUSINESS_POS customers retain access.
-- Rollback: delete the PlanConfig row where key='MJENGO_OS' after confirming no subscriptions reference it.
-- Verify: `SELECT * FROM "PlanConfig" WHERE key='MJENGO_OS'` returns 2000/30 isActive.
-- Test on disposable local DB first; never run against production without owner approval.

INSERT INTO "PlanConfig" ("id", "key", "name", "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
VALUES (
  'cuid-mjengo-os-000000000001',
  'MJENGO_OS',
  'MJENGO OS — Business Management — KES 2,000/month',
  2000,
  30,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "priceKES" = EXCLUDED."priceKES",
  "durationDays" = EXCLUDED."durationDays",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
