-- JATA AFTERCALL — Configurable Business POS (spec §1–§81)
--
-- Purely additive: this migration creates new tenant-scoped tables and touches no existing
-- table, column, index or row. No existing data is removed, emptied, rewritten or backfilled,
-- so the AFTERCALL journey, the commerce baseline and the Interactive Business package are
-- unaffected (POS spec §80).
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object) so the migration is safe on a
-- database provisioned outside the migration history. Money columns are whole Kenyan
-- shillings (§31) and every table carries "businessId" plus an index on it (§5).

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "configurationStatus" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "businessTypeKey" TEXT NOT NULL DEFAULT 'other',
    "answersJson" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "publishedJson" TEXT,
    "draftVersion" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "fingerprint" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosConfigurationVersion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "answersJson" TEXT NOT NULL,
    "fingerprint" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosConfigurationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'BUSINESS_POS',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "paymentId" TEXT,
    "paymentReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL DEFAULT 'BUSINESS_POS',
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "businessId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessTypeKey" TEXT NOT NULL DEFAULT 'other',
    "configurationJson" TEXT NOT NULL,
    "answersJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosBranch" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosStaff" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "roleKey" TEXT NOT NULL DEFAULT 'CASHIER',
    "branchId" TEXT,
    "commissionPercent" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosProduct" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "category" TEXT,
    "description" TEXT,
    "unitKey" TEXT NOT NULL DEFAULT 'piece',
    "priceKES" INTEGER NOT NULL DEFAULT 0,
    "wholesalePriceKES" INTEGER,
    "costKES" INTEGER,
    "sku" TEXT,
    "barcode" TEXT,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "durationMinutes" INTEGER,
    "variantOptions" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosInventoryItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosInventoryMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "branchId" TEXT,
    "reason" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitKey" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosInventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosCustomer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "location" TEXT,
    "customerNumber" TEXT,
    "segment" TEXT,
    "notes" TEXT,
    "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
    "creditLimitKES" INTEGER NOT NULL DEFAULT 0,
    "balanceKES" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosCustomerAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT,
    "detailsJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosCustomerAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosSupplier" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "location" TEXT,
    "termsDays" INTEGER NOT NULL DEFAULT 0,
    "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
    "balanceKES" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosSale" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "customerId" TEXT,
    "customerName" TEXT,
    "staffId" TEXT,
    "staffName" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'walk_in',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "kind" TEXT NOT NULL DEFAULT 'SALE',
    "subtotalKES" INTEGER NOT NULL DEFAULT 0,
    "discountKES" INTEGER NOT NULL DEFAULT 0,
    "taxKES" INTEGER NOT NULL DEFAULT 0,
    "feeKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "paidKES" INTEGER NOT NULL DEFAULT 0,
    "balanceKES" INTEGER NOT NULL DEFAULT 0,
    "refundedKES" INTEGER NOT NULL DEFAULT 0,
    "costKES" INTEGER,
    "notes" TEXT,
    "configurationVersion" INTEGER NOT NULL DEFAULT 1,
    "configurationFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosSaleItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "unitKey" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceKES" INTEGER NOT NULL DEFAULT 0,
    "discountKES" INTEGER NOT NULL DEFAULT 0,
    "taxKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "costKES" INTEGER,
    "variantDesc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "saleId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "branchId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'IN',
    "purpose" TEXT NOT NULL DEFAULT 'SALE',
    "method" TEXT NOT NULL DEFAULT 'cash',
    "amountKES" INTEGER NOT NULL DEFAULT 0,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SETTLED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosCreditEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyType" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "partyId" TEXT NOT NULL,
    "partyName" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'DEBIT',
    "amountKES" INTEGER NOT NULL DEFAULT 0,
    "balanceAfterKES" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "saleId" TEXT,
    "paymentId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosCreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosExpense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "categoryKey" TEXT NOT NULL,
    "label" TEXT,
    "amountKES" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosPurchase" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT,
    "branchId" TEXT,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "subtotalKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "paidKES" INTEGER NOT NULL DEFAULT 0,
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosPurchaseItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "unitKey" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCostKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosPurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "reference" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "staffId" TEXT,
    "assignedToId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'walk_in',
    "workflowKey" TEXT NOT NULL DEFAULT 'generic',
    "stateKey" TEXT NOT NULL DEFAULT 'NEW',
    "fulfilment" TEXT,
    "address" TEXT,
    "subtotalKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "depositKES" INTEGER NOT NULL DEFAULT 0,
    "expectedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosOrderItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitKey" TEXT,
    "unitPriceKES" INTEGER NOT NULL DEFAULT 0,
    "totalKES" INTEGER NOT NULL DEFAULT 0,
    "modifiers" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosOrderEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PosAuditEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "branchId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosAuditEvent_pkey" PRIMARY KEY ("id")
);

-- Foreign keys (guarded: re-running the migration is a no-op)

DO $$ BEGIN
    ALTER TABLE "PosConfiguration" ADD CONSTRAINT "PosConfiguration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosConfigurationVersion" ADD CONSTRAINT "PosConfigurationVersion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosConfigurationVersion" ADD CONSTRAINT "PosConfigurationVersion_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "PosConfiguration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSubscription" ADD CONSTRAINT "PosSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosEntitlement" ADD CONSTRAINT "PosEntitlement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosTemplate" ADD CONSTRAINT "PosTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosBranch" ADD CONSTRAINT "PosBranch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosStaff" ADD CONSTRAINT "PosStaff_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosProduct" ADD CONSTRAINT "PosProduct_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosInventoryItem" ADD CONSTRAINT "PosInventoryItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosInventoryItem" ADD CONSTRAINT "PosInventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PosProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosInventoryMovement" ADD CONSTRAINT "PosInventoryMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosInventoryMovement" ADD CONSTRAINT "PosInventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PosProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosCustomer" ADD CONSTRAINT "PosCustomer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosCustomerAsset" ADD CONSTRAINT "PosCustomerAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosCustomerAsset" ADD CONSTRAINT "PosCustomerAsset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "PosCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSupplier" ADD CONSTRAINT "PosSupplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSaleItem" ADD CONSTRAINT "PosSaleItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSaleItem" ADD CONSTRAINT "PosSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosCreditEntry" ADD CONSTRAINT "PosCreditEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosExpense" ADD CONSTRAINT "PosExpense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPurchase" ADD CONSTRAINT "PosPurchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPurchaseItem" ADD CONSTRAINT "PosPurchaseItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPurchaseItem" ADD CONSTRAINT "PosPurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PosPurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrderItem" ADD CONSTRAINT "PosOrderItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrderItem" ADD CONSTRAINT "PosOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrderEvent" ADD CONSTRAINT "PosOrderEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrderEvent" ADD CONSTRAINT "PosOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosAuditEvent" ADD CONSTRAINT "PosAuditEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Unique constraints (§5: tenant-scoped uniqueness, e.g. one receipt number per business)

DO $$ BEGIN
    ALTER TABLE "PosConfiguration" ADD CONSTRAINT "PosConfiguration_businessId_key" UNIQUE ("businessId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosConfigurationVersion" ADD CONSTRAINT "PosConfigurationVersion_businessId_version_key" UNIQUE ("businessId","version");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSubscription" ADD CONSTRAINT "PosSubscription_businessId_key" UNIQUE ("businessId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosEntitlement" ADD CONSTRAINT "PosEntitlement_businessId_key" UNIQUE ("businessId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosBranch" ADD CONSTRAINT "PosBranch_businessId_name_key" UNIQUE ("businessId","name");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosInventoryItem" ADD CONSTRAINT "PosInventoryItem_productId_branchId_key" UNIQUE ("productId","branchId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_businessId_receiptNumber_key" UNIQUE ("businessId","receiptNumber");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosPurchase" ADD CONSTRAINT "PosPurchase_businessId_reference_key" UNIQUE ("businessId","reference");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_businessId_reference_key" UNIQUE ("businessId","reference");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes

CREATE INDEX IF NOT EXISTS "PosConfiguration_businessId_status_idx" ON "PosConfiguration"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PosConfigurationVersion_businessId_publishedAt_idx" ON "PosConfigurationVersion"("businessId", "publishedAt");

CREATE INDEX IF NOT EXISTS "PosSubscription_businessId_status_idx" ON "PosSubscription"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PosSubscription_userId_idx" ON "PosSubscription"("userId");

CREATE INDEX IF NOT EXISTS "PosEntitlement_businessId_status_idx" ON "PosEntitlement"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PosTemplate_ownerId_idx" ON "PosTemplate"("ownerId");

CREATE INDEX IF NOT EXISTS "PosTemplate_businessId_idx" ON "PosTemplate"("businessId");

CREATE INDEX IF NOT EXISTS "PosBranch_businessId_idx" ON "PosBranch"("businessId");

CREATE INDEX IF NOT EXISTS "PosStaff_businessId_roleKey_idx" ON "PosStaff"("businessId", "roleKey");

CREATE INDEX IF NOT EXISTS "PosStaff_businessId_userId_idx" ON "PosStaff"("businessId", "userId");

CREATE INDEX IF NOT EXISTS "PosProduct_businessId_kind_idx" ON "PosProduct"("businessId", "kind");

CREATE INDEX IF NOT EXISTS "PosProduct_businessId_name_idx" ON "PosProduct"("businessId", "name");

CREATE INDEX IF NOT EXISTS "PosProduct_businessId_barcode_idx" ON "PosProduct"("businessId", "barcode");

CREATE INDEX IF NOT EXISTS "PosInventoryItem_businessId_idx" ON "PosInventoryItem"("businessId");

CREATE INDEX IF NOT EXISTS "PosInventoryItem_businessId_branchId_idx" ON "PosInventoryItem"("businessId", "branchId");

CREATE INDEX IF NOT EXISTS "PosInventoryMovement_businessId_productId_createdAt_idx" ON "PosInventoryMovement"("businessId", "productId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosInventoryMovement_businessId_reason_idx" ON "PosInventoryMovement"("businessId", "reason");

CREATE INDEX IF NOT EXISTS "PosInventoryMovement_businessId_branchId_idx" ON "PosInventoryMovement"("businessId", "branchId");

CREATE INDEX IF NOT EXISTS "PosCustomer_businessId_name_idx" ON "PosCustomer"("businessId", "name");

CREATE INDEX IF NOT EXISTS "PosCustomer_businessId_phone_idx" ON "PosCustomer"("businessId", "phone");

CREATE INDEX IF NOT EXISTS "PosCustomer_businessId_creditEnabled_idx" ON "PosCustomer"("businessId", "creditEnabled");

CREATE INDEX IF NOT EXISTS "PosCustomerAsset_businessId_customerId_idx" ON "PosCustomerAsset"("businessId", "customerId");

CREATE INDEX IF NOT EXISTS "PosCustomerAsset_businessId_identifier_idx" ON "PosCustomerAsset"("businessId", "identifier");

CREATE INDEX IF NOT EXISTS "PosSupplier_businessId_name_idx" ON "PosSupplier"("businessId", "name");

CREATE INDEX IF NOT EXISTS "PosSale_businessId_createdAt_idx" ON "PosSale"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosSale_businessId_status_idx" ON "PosSale"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PosSale_businessId_customerId_idx" ON "PosSale"("businessId", "customerId");

CREATE INDEX IF NOT EXISTS "PosSale_businessId_branchId_createdAt_idx" ON "PosSale"("businessId", "branchId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosSaleItem_saleId_idx" ON "PosSaleItem"("saleId");

CREATE INDEX IF NOT EXISTS "PosSaleItem_businessId_productId_idx" ON "PosSaleItem"("businessId", "productId");

CREATE INDEX IF NOT EXISTS "PosPayment_businessId_createdAt_idx" ON "PosPayment"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosPayment_businessId_purpose_idx" ON "PosPayment"("businessId", "purpose");

CREATE INDEX IF NOT EXISTS "PosPayment_saleId_idx" ON "PosPayment"("saleId");

CREATE INDEX IF NOT EXISTS "PosPayment_businessId_customerId_idx" ON "PosPayment"("businessId", "customerId");

CREATE INDEX IF NOT EXISTS "PosPayment_businessId_supplierId_idx" ON "PosPayment"("businessId", "supplierId");

CREATE INDEX IF NOT EXISTS "PosCreditEntry_businessId_partyType_partyId_idx" ON "PosCreditEntry"("businessId", "partyType", "partyId");

CREATE INDEX IF NOT EXISTS "PosCreditEntry_businessId_dueAt_idx" ON "PosCreditEntry"("businessId", "dueAt");

CREATE INDEX IF NOT EXISTS "PosCreditEntry_businessId_createdAt_idx" ON "PosCreditEntry"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosExpense_businessId_occurredAt_idx" ON "PosExpense"("businessId", "occurredAt");

CREATE INDEX IF NOT EXISTS "PosExpense_businessId_categoryKey_idx" ON "PosExpense"("businessId", "categoryKey");

CREATE INDEX IF NOT EXISTS "PosPurchase_businessId_status_idx" ON "PosPurchase"("businessId", "status");

CREATE INDEX IF NOT EXISTS "PosPurchase_businessId_supplierId_idx" ON "PosPurchase"("businessId", "supplierId");

CREATE INDEX IF NOT EXISTS "PosPurchaseItem_purchaseId_idx" ON "PosPurchaseItem"("purchaseId");

CREATE INDEX IF NOT EXISTS "PosPurchaseItem_businessId_productId_idx" ON "PosPurchaseItem"("businessId", "productId");

CREATE INDEX IF NOT EXISTS "PosOrder_businessId_stateKey_idx" ON "PosOrder"("businessId", "stateKey");

CREATE INDEX IF NOT EXISTS "PosOrder_businessId_createdAt_idx" ON "PosOrder"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosOrder_businessId_channel_idx" ON "PosOrder"("businessId", "channel");

CREATE INDEX IF NOT EXISTS "PosOrderItem_orderId_idx" ON "PosOrderItem"("orderId");

CREATE INDEX IF NOT EXISTS "PosOrderItem_businessId_idx" ON "PosOrderItem"("businessId");

CREATE INDEX IF NOT EXISTS "PosOrderEvent_orderId_idx" ON "PosOrderEvent"("orderId");

CREATE INDEX IF NOT EXISTS "PosOrderEvent_businessId_createdAt_idx" ON "PosOrderEvent"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosAuditEvent_businessId_createdAt_idx" ON "PosAuditEvent"("businessId", "createdAt");

CREATE INDEX IF NOT EXISTS "PosAuditEvent_businessId_action_idx" ON "PosAuditEvent"("businessId", "action");

