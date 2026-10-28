-- POS / ERP - PRO: approvals (additive, 2026-10-30)
--
-- Two new tenant-scoped tables and nothing else: no existing table, column, index or row is touched.
-- `ErpApprovalEvent` is append-only by convention (the domain module never updates or deletes one),
-- and both tables cascade from `Business`, so a tenant's deletion takes its approvals with it.

CREATE TABLE IF NOT EXISTS "ErpApprovalRequest" (
  "id"             TEXT NOT NULL,
  "businessId"     TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "detail"         TEXT,
  "amountCents"    INTEGER NOT NULL DEFAULT 0,
  "currencyCode"   TEXT NOT NULL DEFAULT 'KES',
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "requestedBy"    TEXT NOT NULL,
  "requestedName"  TEXT,
  "requestedRole"  TEXT,
  "approverRole"   TEXT NOT NULL DEFAULT 'OWNER',
  "approverId"     TEXT,
  "decidedBy"      TEXT,
  "decidedName"    TEXT,
  "decidedRole"    TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decisionNote"   TEXT,
  "sourceType"     TEXT,
  "sourceId"       TEXT,
  "href"           TEXT,
  "idempotencyKey" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErpApprovalRequest_businessId_idempotencyKey_key"
  ON "ErpApprovalRequest"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpApprovalRequest_businessId_status_createdAt_idx"
  ON "ErpApprovalRequest"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpApprovalRequest_businessId_approverId_status_idx"
  ON "ErpApprovalRequest"("businessId", "approverId", "status");
CREATE INDEX IF NOT EXISTS "ErpApprovalRequest_businessId_requestedBy_status_idx"
  ON "ErpApprovalRequest"("businessId", "requestedBy", "status");

CREATE TABLE IF NOT EXISTS "ErpApprovalEvent" (
  "id"         TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requestId"  TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "actorId"    TEXT,
  "actorName"  TEXT,
  "note"       TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpApprovalEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ErpApprovalEvent_businessId_requestId_createdAt_idx"
  ON "ErpApprovalEvent"("businessId", "requestId", "createdAt");

-- Foreign keys in a guard so re-running this file over itself is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpApprovalRequest_businessId_fkey') THEN
    ALTER TABLE "ErpApprovalRequest"
      ADD CONSTRAINT "ErpApprovalRequest_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpApprovalEvent_businessId_fkey') THEN
    ALTER TABLE "ErpApprovalEvent"
      ADD CONSTRAINT "ErpApprovalEvent_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpApprovalEvent_requestId_fkey') THEN
    ALTER TABLE "ErpApprovalEvent"
      ADD CONSTRAINT "ErpApprovalEvent_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "ErpApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Rollback (documented here; this file never runs it): remove "ErpApprovalEvent" first, then
-- "ErpApprovalRequest". Both tables hold approval history only, so removing them cannot lose POS,
-- invoice, journal, task or messaging data. The exact reverse statements live in
-- docs/POS_ERP_PRO_MIGRATION_PLAN.md so this file contains no destructive SQL.
