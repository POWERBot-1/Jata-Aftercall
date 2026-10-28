-- Requisitions: the request to buy, before any money is promised to a supplier.
--
-- Two new tables. Nothing existing is rewritten, no POS table is touched, both tables cascade from
-- Business, and the optional `purchaseOrderId` is a plain column rather than a foreign key: a
-- requisition must survive the deletion of a draft order without losing its own audit story, and
-- the order number is re-readable from the order at any time.
-- Reverse-dependency order for a rollback is at the bottom of docs/POS_ERP_PRO_MIGRATION_PLAN.md.

CREATE TABLE IF NOT EXISTS "ErpRequisition" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requisitionNumber" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "justification" TEXT,
  "department" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "neededBy" TIMESTAMP(3),
  "supplierId" TEXT,
  "supplierName" TEXT,
  "currencyCode" TEXT NOT NULL DEFAULT 'KES',
  "estimatedSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  "estimatedTaxCents" INTEGER NOT NULL DEFAULT 0,
  "estimatedTotalCents" INTEGER NOT NULL DEFAULT 0,
  "requestedBy" TEXT NOT NULL,
  "requestedName" TEXT,
  "submittedAt" TIMESTAMP(3),
  "decidedBy" TEXT,
  "decidedName" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "purchaseOrderId" TEXT,
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpRequisition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ErpRequisitionLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "estimatedUnitCostCents" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  "lineSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  "lineTaxCents" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpRequisitionLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErpRequisition_businessId_requisitionNumber_key"
  ON "ErpRequisition"("businessId", "requisitionNumber");
-- A retried submit reuses the key and cannot raise a second request.
CREATE UNIQUE INDEX IF NOT EXISTS "ErpRequisition_businessId_idempotencyKey_key"
  ON "ErpRequisition"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpRequisition_businessId_status_createdAt_idx"
  ON "ErpRequisition"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpRequisition_businessId_requestedBy_createdAt_idx"
  ON "ErpRequisition"("businessId", "requestedBy", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpRequisitionLine_businessId_requisitionId_idx"
  ON "ErpRequisitionLine"("businessId", "requisitionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpRequisition_businessId_fkey') THEN
    ALTER TABLE "ErpRequisition"
      ADD CONSTRAINT "ErpRequisition_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpRequisitionLine_businessId_fkey') THEN
    ALTER TABLE "ErpRequisitionLine"
      ADD CONSTRAINT "ErpRequisitionLine_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpRequisitionLine_requisitionId_fkey') THEN
    ALTER TABLE "ErpRequisitionLine"
      ADD CONSTRAINT "ErpRequisitionLine_requisitionId_fkey"
      FOREIGN KEY ("requisitionId") REFERENCES "ErpRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
