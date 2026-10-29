-- POS / ERP - PRO: the notification centre (additive, 2026-10-29)
--
-- `ErpNotification` already exists from 20261027000000_pos_erp_pro. This migration only ADDS
-- columns to it and creates one new tenant-scoped table, so no existing column, row or index is
-- rewritten. Every new column is nullable or defaulted, which is what makes it safe on a live table.
--
-- Why the extra columns: the first version could only broadcast to a role and carried a single
-- `readAt`, so one person opening a notice marked it read for the whole team and there was nowhere
-- to record what raised a notice or whether an external send happened. Read state moves to
-- `ErpNotificationRead`, one row per person.

ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "recipientId" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "sourceId" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'IN_APP';
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "deliveryChannel" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "deliveryError" TEXT;
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ErpNotification" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- One notice per (tenant, dedupe key). PostgreSQL treats NULLs as distinct, so the pre-existing
-- broadcast rows (dedupeKey IS NULL) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "ErpNotification_businessId_dedupeKey_key"
  ON "ErpNotification"("businessId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "ErpNotification_businessId_recipientId_readAt_idx"
  ON "ErpNotification"("businessId", "recipientId", "readAt");

CREATE TABLE IF NOT EXISTS "ErpNotificationRead" (
  "id"             TEXT NOT NULL,
  "businessId"     TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "readAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpNotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErpNotificationRead_notificationId_userId_key"
  ON "ErpNotificationRead"("notificationId", "userId");
CREATE INDEX IF NOT EXISTS "ErpNotificationRead_businessId_userId_readAt_idx"
  ON "ErpNotificationRead"("businessId", "userId", "readAt");

-- Foreign keys are added inside a guard so re-running this file over itself is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErpNotificationRead_businessId_fkey'
  ) THEN
    ALTER TABLE "ErpNotificationRead"
      ADD CONSTRAINT "ErpNotificationRead_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ErpNotificationRead_notificationId_fkey'
  ) THEN
    ALTER TABLE "ErpNotificationRead"
      ADD CONSTRAINT "ErpNotificationRead_notificationId_fkey"
      FOREIGN KEY ("notificationId") REFERENCES "ErpNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Rollback (documented here; this file never runs it): remove "ErpNotificationRead", then the two
-- new indexes and the ten new columns on "ErpNotification". Dropping the new table first is required
-- because it depends on "ErpNotification". Everything added here belongs to notifications only, so
-- removing it cannot lose POS, invoice, journal or messaging data. The exact reverse statements live
-- in docs/POS_ERP_PRO_MIGRATION_PLAN.md so this file contains no destructive SQL.
