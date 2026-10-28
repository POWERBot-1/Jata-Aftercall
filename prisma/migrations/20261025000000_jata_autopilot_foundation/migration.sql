-- JATA Autopilot — additive tenant-scoped foundation tables.
-- Purely additive: creates new Autopilot* tables, indexes, and foreign keys only.
-- Existing tables, columns, constraints, and rows remain untouched.

CREATE TABLE IF NOT EXISTS "AutopilotSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'JATA_AUTOPILOT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "paymentId" TEXT,
    "paymentReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotEntitlement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "packageKey" TEXT NOT NULL DEFAULT 'JATA_AUTOPILOT',
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "status" TEXT NOT NULL DEFAULT 'NONE',
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "autonomyMode" TEXT NOT NULL DEFAULT 'ASSISTED',
    "operationalStatus" TEXT NOT NULL DEFAULT 'LIVE',
    "industryPackKey" TEXT NOT NULL DEFAULT 'generic_custom',
    "quietHoursStart" TEXT NOT NULL DEFAULT '20:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '07:00',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "dailySpendCapMinorKES" INTEGER NOT NULL DEFAULT 25000,
    "maxBatchRecipients" INTEGER NOT NULL DEFAULT 50,
    "maxAutoDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotUsageLedger" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "unitsIn" INTEGER NOT NULL DEFAULT 0,
    "unitsOut" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMinorKES" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotUsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotCustomerProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "displayName" TEXT,
    "phoneNormalized" TEXT,
    "emailNormalized" TEXT,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'NEW_LEAD',
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "notesSummary" TEXT,
    "lastInteractionAt" TIMESTAMP(3),
    "totalOrdersSnapshot" INTEGER NOT NULL DEFAULT 0,
    "totalSpentSnapshotKES" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotCustomerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotConsentRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerProfileId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
    "status" TEXT NOT NULL DEFAULT 'OPTED_IN',
    "source" TEXT NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'COMMAND_CENTER',
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "modality" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "diagnosticsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotIngestionRecord" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "documentKind" TEXT NOT NULL,
    "extractedJson" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "paymentClaimSafeFlag" TEXT NOT NULL DEFAULT 'NONE',
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotIngestionRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotActionProposal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT,
    "actionType" TEXT NOT NULL,
    "riskCategory" TEXT NOT NULL DEFAULT 'LOW_RISK_DRAFT',
    "autonomyModeAtCreation" TEXT NOT NULL DEFAULT 'ASSISTED',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "expectedImpact" TEXT,
    "payloadJson" TEXT NOT NULL,
    "beforeSnapshotJson" TEXT,
    "afterSnapshotJson" TEXT,
    "rollbackSupported" BOOLEAN NOT NULL DEFAULT true,
    "voiceTranscriptConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotActionProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AutopilotAuditEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "proposalId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotAuditEvent_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotSubscription_businessId_key" ON "AutopilotSubscription"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotEntitlement_businessId_key" ON "AutopilotEntitlement"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotConfiguration_businessId_key" ON "AutopilotConfiguration"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotUsageLedger_idempotencyKey_key" ON "AutopilotUsageLedger"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotCustomerProfile_businessId_phoneNormalized_key" ON "AutopilotCustomerProfile"("businessId", "phoneNormalized");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotCustomerProfile_businessId_emailNormalized_key" ON "AutopilotCustomerProfile"("businessId", "emailNormalized");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotConsentRecord_biz_profile_channel_scope_key" ON "AutopilotConsentRecord"("businessId", "customerProfileId", "channel", "scope");
CREATE UNIQUE INDEX IF NOT EXISTS "AutopilotActionProposal_businessId_idempotencyKey_key" ON "AutopilotActionProposal"("businessId", "idempotencyKey");

-- Secondary lookup indexes
CREATE INDEX IF NOT EXISTS "AutopilotSubscription_businessId_status_idx" ON "AutopilotSubscription"("businessId", "status");
CREATE INDEX IF NOT EXISTS "AutopilotSubscription_userId_idx" ON "AutopilotSubscription"("userId");
CREATE INDEX IF NOT EXISTS "AutopilotEntitlement_businessId_status_idx" ON "AutopilotEntitlement"("businessId", "status");
CREATE INDEX IF NOT EXISTS "AutopilotConfiguration_businessId_operationalStatus_idx" ON "AutopilotConfiguration"("businessId", "operationalStatus");
CREATE INDEX IF NOT EXISTS "AutopilotUsageLedger_businessId_periodKey_idx" ON "AutopilotUsageLedger"("businessId", "periodKey");
CREATE INDEX IF NOT EXISTS "AutopilotUsageLedger_businessId_dayKey_idx" ON "AutopilotUsageLedger"("businessId", "dayKey");
CREATE INDEX IF NOT EXISTS "AutopilotCustomerProfile_businessId_lifecycleStage_idx" ON "AutopilotCustomerProfile"("businessId", "lifecycleStage");
CREATE INDEX IF NOT EXISTS "AutopilotConsentRecord_businessId_status_idx" ON "AutopilotConsentRecord"("businessId", "status");
CREATE INDEX IF NOT EXISTS "AutopilotSession_businessId_createdAt_idx" ON "AutopilotSession"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotMessage_businessId_sessionId_createdAt_idx" ON "AutopilotMessage"("businessId", "sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotIngestionRecord_businessId_createdAt_idx" ON "AutopilotIngestionRecord"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotIngestionRecord_businessId_sha256Hash_idx" ON "AutopilotIngestionRecord"("businessId", "sha256Hash");
CREATE INDEX IF NOT EXISTS "AutopilotActionProposal_businessId_status_createdAt_idx" ON "AutopilotActionProposal"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotAuditEvent_businessId_createdAt_idx" ON "AutopilotAuditEvent"("businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "AutopilotAuditEvent_action_idx" ON "AutopilotAuditEvent"("action");

-- Tenant & relational foreign keys (guarded for idempotent application)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotSubscription_businessId_fkey') THEN
        ALTER TABLE "AutopilotSubscription"
            ADD CONSTRAINT "AutopilotSubscription_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotEntitlement_businessId_fkey') THEN
        ALTER TABLE "AutopilotEntitlement"
            ADD CONSTRAINT "AutopilotEntitlement_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotConfiguration_businessId_fkey') THEN
        ALTER TABLE "AutopilotConfiguration"
            ADD CONSTRAINT "AutopilotConfiguration_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotUsageLedger_businessId_fkey') THEN
        ALTER TABLE "AutopilotUsageLedger"
            ADD CONSTRAINT "AutopilotUsageLedger_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotCustomerProfile_businessId_fkey') THEN
        ALTER TABLE "AutopilotCustomerProfile"
            ADD CONSTRAINT "AutopilotCustomerProfile_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotConsentRecord_businessId_fkey') THEN
        ALTER TABLE "AutopilotConsentRecord"
            ADD CONSTRAINT "AutopilotConsentRecord_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotConsentRecord_customerProfileId_fkey') THEN
        ALTER TABLE "AutopilotConsentRecord"
            ADD CONSTRAINT "AutopilotConsentRecord_customerProfileId_fkey"
            FOREIGN KEY ("customerProfileId") REFERENCES "AutopilotCustomerProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotSession_businessId_fkey') THEN
        ALTER TABLE "AutopilotSession"
            ADD CONSTRAINT "AutopilotSession_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotMessage_businessId_fkey') THEN
        ALTER TABLE "AutopilotMessage"
            ADD CONSTRAINT "AutopilotMessage_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotMessage_sessionId_fkey') THEN
        ALTER TABLE "AutopilotMessage"
            ADD CONSTRAINT "AutopilotMessage_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "AutopilotSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotIngestionRecord_businessId_fkey') THEN
        ALTER TABLE "AutopilotIngestionRecord"
            ADD CONSTRAINT "AutopilotIngestionRecord_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotActionProposal_businessId_fkey') THEN
        ALTER TABLE "AutopilotActionProposal"
            ADD CONSTRAINT "AutopilotActionProposal_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AutopilotAuditEvent_businessId_fkey') THEN
        ALTER TABLE "AutopilotAuditEvent"
            ADD CONSTRAINT "AutopilotAuditEvent_businessId_fkey"
            FOREIGN KEY ("businessId") REFERENCES "Business"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
