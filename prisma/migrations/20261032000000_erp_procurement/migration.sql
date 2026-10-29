-- Procurement: purchase orders, their lines, goods receipts and receipt lines.
--
-- Four new tables and one nullable column on ErpSupplierBill (which order a bill settles). Nothing
-- existing is rewritten: no POS table is touched, every table cascades from Business, and the
-- supplier is referenced by id with the name copied onto the order so history stays readable.
-- Reverse-dependency order for a rollback is at the bottom of docs/POS_ERP_PRO_MIGRATION_PLAN.md.

CREATE TABLE IF NOT EXISTS "ErpPurchaseOrder" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "currencyCode" TEXT NOT NULL DEFAULT 'KES',
  "subtotalCents" INTEGER NOT NULL DEFAULT 0,
  "taxCents" INTEGER NOT NULL DEFAULT 0,
  "totalCents" INTEGER NOT NULL DEFAULT 0,
  "expectedAt" TIMESTAMP(3),
  "notes" TEXT,
  "requestedBy" TEXT NOT NULL,
  "requestedName" TEXT,
  "approvalRequestId" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "orderedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ErpPurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ErpPurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unitCostCents" INTEGER NOT NULL DEFAULT 0,
  "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  "lineSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  "lineTaxCents" INTEGER NOT NULL DEFAULT 0,
  "receivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ErpGoodsReceipt" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedBy" TEXT,
  "receivedName" TEXT,
  "note" TEXT,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpGoodsReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ErpGoodsReceiptLine" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpGoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErpPurchaseOrder_businessId_orderNumber_key" ON "ErpPurchaseOrder" ("businessId", "orderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPurchaseOrder_businessId_idempotencyKey_key" ON "ErpPurchaseOrder" ("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpPurchaseOrder_businessId_status_createdAt_idx" ON "ErpPurchaseOrder" ("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpPurchaseOrder_businessId_supplierId_status_idx" ON "ErpPurchaseOrder" ("businessId", "supplierId", "status");
CREATE INDEX IF NOT EXISTS "ErpPurchaseOrderLine_businessId_purchaseOrderId_idx" ON "ErpPurchaseOrderLine" ("businessId", "purchaseOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpGoodsReceipt_businessId_idempotencyKey_key" ON "ErpGoodsReceipt" ("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpGoodsReceipt_businessId_purchaseOrderId_receivedAt_idx" ON "ErpGoodsReceipt" ("businessId", "purchaseOrderId", "receivedAt");
CREATE INDEX IF NOT EXISTS "ErpGoodsReceiptLine_businessId_receiptId_idx" ON "ErpGoodsReceiptLine" ("businessId", "receiptId");
CREATE INDEX IF NOT EXISTS "ErpGoodsReceiptLine_businessId_lineId_idx" ON "ErpGoodsReceiptLine" ("businessId", "lineId");


-- Which purchase order a supplier bill settles. Nullable: bills typed by hand have no order.
ALTER TABLE "ErpSupplierBill" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;
CREATE INDEX IF NOT EXISTS "ErpSupplierBill_businessId_purchaseOrderId_idx" ON "ErpSupplierBill" ("businessId", "purchaseOrderId");

-- Foreign keys in a guard so re-running this file over itself is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpPurchaseOrder_businessId_fkey') THEN
    ALTER TABLE "ErpPurchaseOrder"
      ADD CONSTRAINT "ErpPurchaseOrder_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpPurchaseOrderLine_businessId_fkey') THEN
    ALTER TABLE "ErpPurchaseOrderLine"
      ADD CONSTRAINT "ErpPurchaseOrderLine_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpPurchaseOrderLine_purchaseOrderId_fkey') THEN
    ALTER TABLE "ErpPurchaseOrderLine"
      ADD CONSTRAINT "ErpPurchaseOrderLine_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpGoodsReceipt_businessId_fkey') THEN
    ALTER TABLE "ErpGoodsReceipt"
      ADD CONSTRAINT "ErpGoodsReceipt_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpGoodsReceipt_purchaseOrderId_fkey') THEN
    ALTER TABLE "ErpGoodsReceipt"
      ADD CONSTRAINT "ErpGoodsReceipt_purchaseOrderId_fkey"
      FOREIGN KEY ("purchaseOrderId") REFERENCES "ErpPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpGoodsReceiptLine_businessId_fkey') THEN
    ALTER TABLE "ErpGoodsReceiptLine"
      ADD CONSTRAINT "ErpGoodsReceiptLine_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpGoodsReceiptLine_receiptId_fkey') THEN
    ALTER TABLE "ErpGoodsReceiptLine"
      ADD CONSTRAINT "ErpGoodsReceiptLine_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "ErpGoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ErpGoodsReceiptLine_lineId_fkey') THEN
    ALTER TABLE "ErpGoodsReceiptLine"
      ADD CONSTRAINT "ErpGoodsReceiptLine_lineId_fkey"
      FOREIGN KEY ("lineId") REFERENCES "ErpPurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
