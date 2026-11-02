-- MJENGO OS product — independent plan and entitlements.
-- Additive only: exactly one new PlanConfig row. No POS, ERP_PRO or customer row is touched and
-- existing BUSINESS_POS customers keep their KES 499 / 30 day access untouched.
--
-- Idempotent: a repeated deploy re-asserts the same commercial terms on the MJENGO_OS row only.
-- The `WHERE "PlanConfig"."key" = 'MJENGO_OS'` clause on the conflict path is what keeps this file
-- inside the repository's additive-migration guard (no bare `UPDATE "Table"` reaching other rows):
-- a conflicting row can only be the MJENGO_OS row itself, because `key` is the conflict target.
--
-- Rollback: remove the PlanConfig row for key='MJENGO_OS' after confirming no Subscription or
-- Payment references it. Destroying a referenced plan row is refused by the foreign keys.
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
  "isActive" = EXCLUDED."isActive",
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "PlanConfig"."key" = 'MJENGO_OS';
