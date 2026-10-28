-- POS / ERP - PRO — operational tasks
--
-- Additive and reversible: one new table, one index on it, one foreign key to Business. No existing
-- table, column, index or row is touched, so this migration is safe on a live database and can be
-- rolled back by dropping the table (see the rollback block at the bottom).
--
-- Why it exists: compliance renewals, automation actions, approval follow-ups and the dashboard
-- inbox all need "a person owns this piece of work, by a date". `ErpTask` is that one record, so the
-- product does not grow four incompatible to-do lists.
--
-- Column types follow the datamodel in prisma/schema.prisma exactly (TEXT / TIMESTAMP(3) / defaults),
-- which is what keeps `prisma migrate diff` clean.

CREATE TABLE IF NOT EXISTS "ErpTask" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignedTo" TEXT,
    "assignedRole" TEXT,
    "createdBy" TEXT,
    "completedBy" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "href" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpTask_pkey" PRIMARY KEY ("id")
);

-- An automation event that is delivered twice must not raise two tasks.
CREATE UNIQUE INDEX IF NOT EXISTS "ErpTask_businessId_idempotencyKey_key" ON "ErpTask"("businessId", "idempotencyKey");
-- The dashboard inbox: open work for a tenant, soonest due first.
CREATE INDEX IF NOT EXISTS "ErpTask_businessId_status_dueAt_idx" ON "ErpTask"("businessId", "status", "dueAt");
-- "My tasks": one person's work inside one tenant.
CREATE INDEX IF NOT EXISTS "ErpTask_businessId_assignedTo_status_idx" ON "ErpTask"("businessId", "assignedTo", "status");
CREATE INDEX IF NOT EXISTS "ErpTask_businessId_createdAt_idx" ON "ErpTask"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "ErpTask" ADD CONSTRAINT "ErpTask_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Rollback (documented here; this file never runs it): remove the "ErpTask" table. Everything it
-- holds belongs to this feature only, so removing it cannot lose POS, invoice, journal or messaging
-- data. Export the table with pg_dump first if the tasks themselves must survive. The exact
-- statement lives in docs/POS_ERP_PRO_MIGRATION_PLAN.md so this file contains no destructive SQL.
