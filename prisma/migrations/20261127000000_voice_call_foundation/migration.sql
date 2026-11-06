-- AI Front Desk Voice — durable call-event foundation (additive only).
-- Creates six new tables: inbound DID routing, provider event log (idempotent), per-call
-- state, command idempotency, usage metering and per-business safety policy.
-- No existing table is altered; no customer row is written or rewritten by this migration.

-- CreateTable
CREATE TABLE "VoiceInboundNumber" (
    "id" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "label" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceInboundNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCallEvent" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "callControlId" TEXT,
    "callSessionId" TEXT,
    "calledNumber" TEXT,
    "callingNumber" TEXT,
    "businessId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "rejectReason" TEXT,
    "sequence" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "VoiceCallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" TEXT NOT NULL,
    "callControlId" TEXT NOT NULL,
    "callSessionId" TEXT,
    "businessId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "callerNumber" TEXT NOT NULL,
    "calledNumber" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "state" TEXT NOT NULL DEFAULT 'INITIATED',
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "hangupCause" TEXT,
    "failoverReason" TEXT,
    "handoffTarget" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCallCommand" (
    "id" TEXT NOT NULL,
    "callControlId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestPayload" TEXT,
    "responsePayload" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceCallCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceUsageRecord" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "providerCostMinor" INTEGER,
    "providerCostCurrency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reconcileBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceBusinessPolicy" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dailySpendLimitMinor" INTEGER,
    "concurrencyLimit" INTEGER,
    "maxCallSeconds" INTEGER,
    "hardDisabled" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceBusinessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceInboundNumber_e164_key" ON "VoiceInboundNumber"("e164");

-- CreateIndex
CREATE INDEX "VoiceInboundNumber_businessId_idx" ON "VoiceInboundNumber"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCallEvent_providerEventId_key" ON "VoiceCallEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "VoiceCallEvent_callControlId_receivedAt_idx" ON "VoiceCallEvent"("callControlId", "receivedAt");

-- CreateIndex
CREATE INDEX "VoiceCallEvent_status_receivedAt_idx" ON "VoiceCallEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "VoiceCallEvent_businessId_idx" ON "VoiceCallEvent"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCall_callControlId_key" ON "VoiceCall"("callControlId");

-- CreateIndex
CREATE INDEX "VoiceCall_businessId_createdAt_idx" ON "VoiceCall"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCall_state_idx" ON "VoiceCall"("state");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCallCommand_dedupeKey_key" ON "VoiceCallCommand"("dedupeKey");

-- CreateIndex
CREATE INDEX "VoiceCallCommand_callControlId_createdAt_idx" ON "VoiceCallCommand"("callControlId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCallCommand_status_idx" ON "VoiceCallCommand"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceUsageRecord_callId_key" ON "VoiceUsageRecord"("callId");

-- CreateIndex
CREATE INDEX "VoiceUsageRecord_businessId_startedAt_idx" ON "VoiceUsageRecord"("businessId", "startedAt");

-- CreateIndex
CREATE INDEX "VoiceUsageRecord_status_idx" ON "VoiceUsageRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceBusinessPolicy_businessId_key" ON "VoiceBusinessPolicy"("businessId");
