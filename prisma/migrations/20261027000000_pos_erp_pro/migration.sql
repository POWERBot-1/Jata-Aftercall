-- POS / ERP - PRO — additive schema (Phase 1).
--
-- New product beside JATA AFTERCALL Business POS. This migration only creates new tenant-scoped
-- tables, their indexes and their guarded foreign keys; no existing table or column is altered and
-- no historical migration is edited. Every table carries businessId and cascades from Business so a
-- removed tenant cannot leave orphaned ERP records.
--
-- Rollback guidance: docs/POS_ERP_PRO_MIGRATION_PLAN.md (reverse order table removal, only after an
-- export has been verified and restored into a scratch database).

CREATE TABLE IF NOT EXISTS "ErpConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "industryPackKey" TEXT NOT NULL DEFAULT 'retail',
    "countryCode" TEXT NOT NULL DEFAULT 'KE',
    "currencyCode" TEXT NOT NULL DEFAULT 'KES',
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "legalName" TEXT,
    "kraPin" TEXT,
    "county" TEXT,
    "featureFlagsJson" TEXT NOT NULL DEFAULT '{}',
    "storefrontSlug" TEXT,
    "storefrontJson" TEXT NOT NULL DEFAULT '{}',
    "onboardingJson" TEXT NOT NULL DEFAULT '{}',
    "teamRolesJson" TEXT NOT NULL DEFAULT '{}',
    "messagingAllowanceSegments" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpConfiguration_id_key" ON "ErpConfiguration"("id");
CREATE INDEX IF NOT EXISTS "ErpConfiguration_businessId_idx" ON "ErpConfiguration"("businessId");

DO $$ BEGIN
    ALTER TABLE "ErpConfiguration" ADD CONSTRAINT "ErpConfiguration_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'ERP_PRO',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "paymentId" TEXT,
    "paymentReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSubscription_id_key" ON "ErpSubscription"("id");
CREATE INDEX IF NOT EXISTS "ErpSubscription_businessId_status_idx" ON "ErpSubscription"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "ErpSubscription" ADD CONSTRAINT "ErpSubscription_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL DEFAULT 'ERP_PRO',
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpEntitlement_id_key" ON "ErpEntitlement"("id");
CREATE INDEX IF NOT EXISTS "ErpEntitlement_businessId_status_idx" ON "ErpEntitlement"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "ErpEntitlement" ADD CONSTRAINT "ErpEntitlement_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSequence_id_key" ON "ErpSequence"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSequence_businessId_key_key" ON "ErpSequence"("businessId", "key");
CREATE INDEX IF NOT EXISTS "ErpSequence_businessId_idx" ON "ErpSequence"("businessId");

DO $$ BEGIN
    ALTER TABLE "ErpSequence" ADD CONSTRAINT "ErpSequence_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpAuditEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAuditEvent_id_key" ON "ErpAuditEvent"("id");
CREATE INDEX IF NOT EXISTS "ErpAuditEvent_businessId_createdAt_idx" ON "ErpAuditEvent"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpAuditEvent_businessId_action_idx" ON "ErpAuditEvent"("businessId", "action");

DO $$ BEGIN
    ALTER TABLE "ErpAuditEvent" ADD CONSTRAINT "ErpAuditEvent_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT,
    "responseJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpIdempotencyRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpIdempotencyRecord_id_key" ON "ErpIdempotencyRecord"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpIdempotencyRecord_businessId_scope_key_key" ON "ErpIdempotencyRecord"("businessId", "scope", "key");
CREATE INDEX IF NOT EXISTS "ErpIdempotencyRecord_businessId_scope_idx" ON "ErpIdempotencyRecord"("businessId", "scope");

DO $$ BEGIN
    ALTER TABLE "ErpIdempotencyRecord" ADD CONSTRAINT "ErpIdempotencyRecord_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentCode" TEXT,
    "systemKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAccount_id_key" ON "ErpAccount"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAccount_businessId_code_key" ON "ErpAccount"("businessId", "code");
CREATE INDEX IF NOT EXISTS "ErpAccount_businessId_type_idx" ON "ErpAccount"("businessId", "type");

DO $$ BEGIN
    ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpPeriod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpPeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPeriod_id_key" ON "ErpPeriod"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPeriod_businessId_fiscalYear_month_key" ON "ErpPeriod"("businessId", "fiscalYear", "month");
CREATE INDEX IF NOT EXISTS "ErpPeriod_businessId_status_idx" ON "ErpPeriod"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "ErpPeriod" ADD CONSTRAINT "ErpPeriod_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpJournal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "journalNumber" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL DEFAULT 'KES',
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "reversedById" TEXT,
    "reversalOfId" TEXT,
    "reversalReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpJournal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpJournal_id_key" ON "ErpJournal"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpJournal_businessId_journalNumber_key" ON "ErpJournal"("businessId", "journalNumber");
CREATE INDEX IF NOT EXISTS "ErpJournal_businessId_entryDate_idx" ON "ErpJournal"("businessId", "entryDate");
CREATE INDEX IF NOT EXISTS "ErpJournal_businessId_status_idx" ON "ErpJournal"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpJournal_businessId_sourceType_sourceId_idx" ON "ErpJournal"("businessId", "sourceType", "sourceId");

DO $$ BEGIN
    ALTER TABLE "ErpJournal" ADD CONSTRAINT "ErpJournal_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpJournalLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "branchId" TEXT,
    "description" TEXT,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpJournalLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpJournalLine_id_key" ON "ErpJournalLine"("id");
CREATE INDEX IF NOT EXISTS "ErpJournalLine_journalId_idx" ON "ErpJournalLine"("journalId");
CREATE INDEX IF NOT EXISTS "ErpJournalLine_businessId_accountCode_idx" ON "ErpJournalLine"("businessId", "accountCode");
CREATE INDEX IF NOT EXISTS "ErpJournalLine_businessId_branchId_idx" ON "ErpJournalLine"("businessId", "branchId");

DO $$ BEGIN
    ALTER TABLE "ErpJournalLine" ADD CONSTRAINT "ErpJournalLine_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpInvoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerPin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL DEFAULT 'KES',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "journalId" TEXT,
    "etimsStatus" TEXT NOT NULL DEFAULT 'NONE',
    "etimsControlNumber" TEXT,
    "etimsResponseJson" TEXT,
    "etimsSubmittedAt" TIMESTAMP(3),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpInvoice_id_key" ON "ErpInvoice"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpInvoice_businessId_invoiceNumber_key" ON "ErpInvoice"("businessId", "invoiceNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpInvoice_businessId_idempotencyKey_key" ON "ErpInvoice"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpInvoice_businessId_status_idx" ON "ErpInvoice"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpInvoice_businessId_dueAt_idx" ON "ErpInvoice"("businessId", "dueAt");
CREATE INDEX IF NOT EXISTS "ErpInvoice_businessId_customerId_idx" ON "ErpInvoice"("businessId", "customerId");

DO $$ BEGIN
    ALTER TABLE "ErpInvoice" ADD CONSTRAINT "ErpInvoice_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpInvoiceLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxRuleKey" TEXT,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "taxTreatment" TEXT NOT NULL DEFAULT 'STANDARD',
    "lineNetCents" INTEGER NOT NULL DEFAULT 0,
    "lineTaxCents" INTEGER NOT NULL DEFAULT 0,
    "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpInvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpInvoiceLine_id_key" ON "ErpInvoiceLine"("id");
CREATE INDEX IF NOT EXISTS "ErpInvoiceLine_invoiceId_idx" ON "ErpInvoiceLine"("invoiceId");
CREATE INDEX IF NOT EXISTS "ErpInvoiceLine_businessId_idx" ON "ErpInvoiceLine"("businessId");

DO $$ BEGIN
    ALTER TABLE "ErpInvoiceLine" ADD CONSTRAINT "ErpInvoiceLine_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "journalId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPayment_id_key" ON "ErpPayment"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPayment_businessId_receiptNumber_key" ON "ErpPayment"("businessId", "receiptNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPayment_businessId_idempotencyKey_key" ON "ErpPayment"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpPayment_businessId_receivedAt_idx" ON "ErpPayment"("businessId", "receivedAt");
CREATE INDEX IF NOT EXISTS "ErpPayment_businessId_customerId_idx" ON "ErpPayment"("businessId", "customerId");

DO $$ BEGIN
    ALTER TABLE "ErpPayment" ADD CONSTRAINT "ErpPayment_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpPaymentAllocation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpPaymentAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPaymentAllocation_id_key" ON "ErpPaymentAllocation"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpPaymentAllocation_paymentId_invoiceId_key" ON "ErpPaymentAllocation"("paymentId", "invoiceId");
CREATE INDEX IF NOT EXISTS "ErpPaymentAllocation_businessId_invoiceId_idx" ON "ErpPaymentAllocation"("businessId", "invoiceId");

DO $$ BEGIN
    ALTER TABLE "ErpPaymentAllocation" ADD CONSTRAINT "ErpPaymentAllocation_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpExpense" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "category" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL DEFAULT '5700',
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'cash',
    "paidFromCode" TEXT NOT NULL DEFAULT '1000',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "approvedById" TEXT,
    "journalId" TEXT,
    "receiptUrl" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpExpense_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpExpense_id_key" ON "ErpExpense"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpExpense_businessId_idempotencyKey_key" ON "ErpExpense"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpExpense_businessId_occurredAt_idx" ON "ErpExpense"("businessId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ErpExpense_businessId_status_idx" ON "ErpExpense"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "ErpExpense" ADD CONSTRAINT "ErpExpense_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpSupplierBill" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpSupplierBill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSupplierBill_id_key" ON "ErpSupplierBill"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSupplierBill_businessId_supplierId_billNumber_key" ON "ErpSupplierBill"("businessId", "supplierId", "billNumber");
CREATE INDEX IF NOT EXISTS "ErpSupplierBill_businessId_status_idx" ON "ErpSupplierBill"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpSupplierBill_businessId_dueAt_idx" ON "ErpSupplierBill"("businessId", "dueAt");

DO $$ BEGIN
    ALTER TABLE "ErpSupplierBill" ADD CONSTRAINT "ErpSupplierBill_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpTaxRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL DEFAULT 0,
    "treatment" TEXT NOT NULL DEFAULT 'STANDARD',
    "inclusive" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceRef" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpTaxRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpTaxRule_id_key" ON "ErpTaxRule"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpTaxRule_businessId_key_effectiveFrom_key" ON "ErpTaxRule"("businessId", "key", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "ErpTaxRule_businessId_key_idx" ON "ErpTaxRule"("businessId", "key");

DO $$ BEGIN
    ALTER TABLE "ErpTaxRule" ADD CONSTRAINT "ErpTaxRule_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpComplianceProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "taxpayerName" TEXT,
    "kraPin" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "turnoverBand" TEXT,
    "sector" TEXT,
    "county" TEXT,
    "etimsSolution" TEXT NOT NULL DEFAULT 'NONE',
    "etimsStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "etimsOnboardedAt" TIMESTAMP(3),
    "etimsLastCheckAt" TIMESTAMP(3),
    "etimsNotes" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpComplianceProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpComplianceProfile_id_key" ON "ErpComplianceProfile"("id");

DO $$ BEGIN
    ALTER TABLE "ErpComplianceProfile" ADD CONSTRAINT "ErpComplianceProfile_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpStoreOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "fulfilment" TEXT NOT NULL DEFAULT 'PICKUP',
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "deliveryCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stockPolicy" TEXT NOT NULL DEFAULT 'RESERVE_ON_CONFIRM',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpStoreOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrder_id_key" ON "ErpStoreOrder"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrder_businessId_orderNumber_key" ON "ErpStoreOrder"("businessId", "orderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrder_businessId_idempotencyKey_key" ON "ErpStoreOrder"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpStoreOrder_businessId_status_idx" ON "ErpStoreOrder"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpStoreOrder_businessId_createdAt_idx" ON "ErpStoreOrder"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "ErpStoreOrder" ADD CONSTRAINT "ErpStoreOrder_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpStoreOrderItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL DEFAULT 0,
    "lineTotalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpStoreOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrderItem_id_key" ON "ErpStoreOrderItem"("id");
CREATE INDEX IF NOT EXISTS "ErpStoreOrderItem_orderId_idx" ON "ErpStoreOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "ErpStoreOrderItem_businessId_idx" ON "ErpStoreOrderItem"("businessId");

DO $$ BEGIN
    ALTER TABLE "ErpStoreOrderItem" ADD CONSTRAINT "ErpStoreOrderItem_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpNotification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "audienceRole" TEXT NOT NULL DEFAULT 'OWNER',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpNotification_id_key" ON "ErpNotification"("id");
CREATE INDEX IF NOT EXISTS "ErpNotification_businessId_createdAt_idx" ON "ErpNotification"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "ErpNotification_businessId_readAt_idx" ON "ErpNotification"("businessId", "readAt");

DO $$ BEGIN
    ALTER TABLE "ErpNotification" ADD CONSTRAINT "ErpNotification_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpAutomationRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditionsJson" TEXT NOT NULL DEFAULT '[]',
    "actionsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "maxRunsPerDay" INTEGER NOT NULL DEFAULT 50,
    "lastRunAt" TIMESTAMP(3),
    "runCountToday" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ErpAutomationRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAutomationRule_id_key" ON "ErpAutomationRule"("id");
CREATE INDEX IF NOT EXISTS "ErpAutomationRule_businessId_status_idx" ON "ErpAutomationRule"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpAutomationRule_businessId_trigger_idx" ON "ErpAutomationRule"("businessId", "trigger");

DO $$ BEGIN
    ALTER TABLE "ErpAutomationRule" ADD CONSTRAINT "ErpAutomationRule_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpAutomationRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "eventJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "actionsJson" TEXT,
    "resultJson" TEXT,
    "error" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ErpAutomationRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAutomationRun_id_key" ON "ErpAutomationRun"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAutomationRun_businessId_ruleId_idempotencyKey_key" ON "ErpAutomationRun"("businessId", "ruleId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpAutomationRun_businessId_startedAt_idx" ON "ErpAutomationRun"("businessId", "startedAt");
CREATE INDEX IF NOT EXISTS "ErpAutomationRun_businessId_status_idx" ON "ErpAutomationRun"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "ErpAutomationRun" ADD CONSTRAINT "ErpAutomationRun_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ErpKycDocument" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "senderIdId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "uploadedById" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpKycDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpKycDocument_id_key" ON "ErpKycDocument"("id");
CREATE INDEX IF NOT EXISTS "ErpKycDocument_businessId_status_idx" ON "ErpKycDocument"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ErpKycDocument_senderIdId_idx" ON "ErpKycDocument"("senderIdId");

DO $$ BEGIN
    ALTER TABLE "ErpKycDocument" ADD CONSTRAINT "ErpKycDocument_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgChannelConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "healthJson" TEXT NOT NULL DEFAULT '{}',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgChannelConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgChannelConnection_id_key" ON "MsgChannelConnection"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgChannelConnection_businessId_channel_key" ON "MsgChannelConnection"("businessId", "channel");
CREATE INDEX IF NOT EXISTS "MsgChannelConnection_businessId_status_idx" ON "MsgChannelConnection"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "MsgChannelConnection" ADD CONSTRAINT "MsgChannelConnection_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgSenderId" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "requestedId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "applicationRef" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "submittedAt" TIMESTAMP(3),
    "underReviewAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "missingItemsJson" TEXT NOT NULL DEFAULT '[]',
    "feesJson" TEXT NOT NULL DEFAULT '[]',
    "feeAcknowledgedAt" TIMESTAMP(3),
    "resubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "replyCapable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgSenderId_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgSenderId_id_key" ON "MsgSenderId"("id");
CREATE INDEX IF NOT EXISTS "MsgSenderId_businessId_status_idx" ON "MsgSenderId"("businessId", "status");
CREATE INDEX IF NOT EXISTS "MsgSenderId_businessId_requestedId_idx" ON "MsgSenderId"("businessId", "requestedId");

DO $$ BEGIN
    ALTER TABLE "MsgSenderId" ADD CONSTRAINT "MsgSenderId_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgSenderIdEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "senderIdId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsgSenderIdEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgSenderIdEvent_id_key" ON "MsgSenderIdEvent"("id");
CREATE INDEX IF NOT EXISTS "MsgSenderIdEvent_senderIdId_createdAt_idx" ON "MsgSenderIdEvent"("senderIdId", "createdAt");
CREATE INDEX IF NOT EXISTS "MsgSenderIdEvent_businessId_createdAt_idx" ON "MsgSenderIdEvent"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "MsgSenderIdEvent" ADD CONSTRAINT "MsgSenderIdEvent_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgContact" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "phoneNormalized" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgContact_id_key" ON "MsgContact"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgContact_businessId_phoneNormalized_key" ON "MsgContact"("businessId", "phoneNormalized");
CREATE INDEX IF NOT EXISTS "MsgContact_businessId_status_idx" ON "MsgContact"("businessId", "status");
CREATE INDEX IF NOT EXISTS "MsgContact_businessId_customerId_idx" ON "MsgContact"("businessId", "customerId");

DO $$ BEGIN
    ALTER TABLE "MsgContact" ADD CONSTRAINT "MsgContact_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgConsentRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "wordingVersion" TEXT,
    "evidenceJson" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT,
    CONSTRAINT "MsgConsentRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgConsentRecord_id_key" ON "MsgConsentRecord"("id");
CREATE INDEX IF NOT EXISTS "MsgConsentRecord_businessId_contactId_channel_purpose_idx" ON "MsgConsentRecord"("businessId", "contactId", "channel", "purpose");
CREATE INDEX IF NOT EXISTS "MsgConsentRecord_businessId_capturedAt_idx" ON "MsgConsentRecord"("businessId", "capturedAt");

DO $$ BEGIN
    ALTER TABLE "MsgConsentRecord" ADD CONSTRAINT "MsgConsentRecord_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgSuppression" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ALL',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsgSuppression_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgSuppression_id_key" ON "MsgSuppression"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgSuppression_businessId_phoneNormalized_channel_key" ON "MsgSuppression"("businessId", "phoneNormalized", "channel");
CREATE INDEX IF NOT EXISTS "MsgSuppression_businessId_phoneNormalized_idx" ON "MsgSuppression"("businessId", "phoneNormalized");

DO $$ BEGIN
    ALTER TABLE "MsgSuppression" ADD CONSTRAINT "MsgSuppression_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgAudience" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definitionJson" TEXT NOT NULL DEFAULT '{}',
    "isSaved" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgAudience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgAudience_id_key" ON "MsgAudience"("id");
CREATE INDEX IF NOT EXISTS "MsgAudience_businessId_createdAt_idx" ON "MsgAudience"("businessId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "MsgAudience" ADD CONSTRAINT "MsgAudience_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgTemplate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "category" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
    "body" TEXT NOT NULL,
    "variablesJson" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "whatsappTemplateName" TEXT,
    "whatsappTemplateStatus" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgTemplate_id_key" ON "MsgTemplate"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgTemplate_businessId_key_version_key" ON "MsgTemplate"("businessId", "key", "version");
CREATE INDEX IF NOT EXISTS "MsgTemplate_businessId_status_idx" ON "MsgTemplate"("businessId", "status");

DO $$ BEGIN
    ALTER TABLE "MsgTemplate" ADD CONSTRAINT "MsgTemplate_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgCampaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "purpose" TEXT NOT NULL DEFAULT 'MARKETING',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "audienceId" TEXT,
    "audienceJson" TEXT,
    "templateId" TEXT,
    "messageBody" TEXT NOT NULL,
    "senderIdId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "eligibleRecipients" INTEGER NOT NULL DEFAULT 0,
    "excludedRecipients" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'KES',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "notes" TEXT,
    "dedupeKey" TEXT,
    "testSentAt" TIMESTAMP(3),
    "testSentTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgCampaign_id_key" ON "MsgCampaign"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgCampaign_businessId_dedupeKey_key" ON "MsgCampaign"("businessId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "MsgCampaign_businessId_status_idx" ON "MsgCampaign"("businessId", "status");
CREATE INDEX IF NOT EXISTS "MsgCampaign_businessId_scheduledAt_idx" ON "MsgCampaign"("businessId", "scheduledAt");

DO $$ BEGIN
    ALTER TABLE "MsgCampaign" ADD CONSTRAINT "MsgCampaign_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgCampaignRecipient" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "phoneNormalized" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "exclusionReason" TEXT,
    "segments" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsgCampaignRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgCampaignRecipient_id_key" ON "MsgCampaignRecipient"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgCampaignRecipient_campaignId_phoneNormalized_key" ON "MsgCampaignRecipient"("campaignId", "phoneNormalized");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgCampaignRecipient_businessId_idempotencyKey_key" ON "MsgCampaignRecipient"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "MsgCampaignRecipient_campaignId_status_idx" ON "MsgCampaignRecipient"("campaignId", "status");
CREATE INDEX IF NOT EXISTS "MsgCampaignRecipient_businessId_status_idx" ON "MsgCampaignRecipient"("businessId", "status");
CREATE INDEX IF NOT EXISTS "MsgCampaignRecipient_providerMessageId_idx" ON "MsgCampaignRecipient"("providerMessageId");

DO $$ BEGIN
    ALTER TABLE "MsgCampaignRecipient" ADD CONSTRAINT "MsgCampaignRecipient_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgMessageEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsgMessageEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgMessageEvent_id_key" ON "MsgMessageEvent"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgMessageEvent_dedupeKey_key" ON "MsgMessageEvent"("dedupeKey");
CREATE INDEX IF NOT EXISTS "MsgMessageEvent_businessId_receivedAt_idx" ON "MsgMessageEvent"("businessId", "receivedAt");
CREATE INDEX IF NOT EXISTS "MsgMessageEvent_campaignId_eventType_idx" ON "MsgMessageEvent"("campaignId", "eventType");
CREATE INDEX IF NOT EXISTS "MsgMessageEvent_providerMessageId_idx" ON "MsgMessageEvent"("providerMessageId");

DO $$ BEGIN
    ALTER TABLE "MsgMessageEvent" ADD CONSTRAINT "MsgMessageEvent_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgWallet" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'KES',
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MsgWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgWallet_id_key" ON "MsgWallet"("id");
CREATE INDEX IF NOT EXISTS "MsgWallet_businessId_idx" ON "MsgWallet"("businessId");

DO $$ BEGIN
    ALTER TABLE "MsgWallet" ADD CONSTRAINT "MsgWallet_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MsgLedgerEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL DEFAULT 0,
    "reservedAfterCents" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "reference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsgLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MsgLedgerEntry_id_key" ON "MsgLedgerEntry"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgLedgerEntry_businessId_idempotencyKey_key" ON "MsgLedgerEntry"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "MsgLedgerEntry_businessId_createdAt_idx" ON "MsgLedgerEntry"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "MsgLedgerEntry_businessId_campaignId_idx" ON "MsgLedgerEntry"("businessId", "campaignId");

DO $$ BEGIN
    ALTER TABLE "MsgLedgerEntry" ADD CONSTRAINT "MsgLedgerEntry_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS "ErpCreditNote" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "netCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "journalId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErpCreditNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ErpCreditNote_id_key" ON "ErpCreditNote"("id");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpCreditNote_businessId_creditNoteNumber_key" ON "ErpCreditNote"("businessId", "creditNoteNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpCreditNote_businessId_idempotencyKey_key" ON "ErpCreditNote"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ErpCreditNote_businessId_invoiceId_idx" ON "ErpCreditNote"("businessId", "invoiceId");

DO $$ BEGIN
    ALTER TABLE "ErpCreditNote" ADD CONSTRAINT "ErpCreditNote_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Uniqueness the application relies on with `findUnique` (tenant to record, shop slug, public
-- order token, one wallet per business). These fields are `@unique` in the Prisma schema; a
-- missing index would let duplicates through and break `findUnique` lookups.
CREATE UNIQUE INDEX IF NOT EXISTS "ErpConfiguration_businessId_key" ON "ErpConfiguration"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpConfiguration_storefrontSlug_key" ON "ErpConfiguration"("storefrontSlug");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpSubscription_businessId_key" ON "ErpSubscription"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpEntitlement_businessId_key" ON "ErpEntitlement"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpComplianceProfile_businessId_key" ON "ErpComplianceProfile"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "ErpStoreOrder_publicToken_key" ON "ErpStoreOrder"("publicToken");
CREATE UNIQUE INDEX IF NOT EXISTS "MsgWallet_businessId_key" ON "MsgWallet"("businessId");
