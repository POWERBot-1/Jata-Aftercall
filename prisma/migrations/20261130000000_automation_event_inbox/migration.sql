-- Additive JATA automation inbox/outbox. No financial/business tables are touched.
CREATE TYPE "AutomationEventDirection" AS ENUM ('OUTBOUND', 'INBOUND');
CREATE TYPE "AutomationEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'RECEIVED', 'DELIVERED', 'FAILED');

CREATE TABLE "AutomationEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "direction" "AutomationEventDirection" NOT NULL,
  "status" "AutomationEventStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationEvent_eventId_key" ON "AutomationEvent"("eventId");
CREATE INDEX "AutomationEvent_direction_status_availableAt_idx" ON "AutomationEvent"("direction", "status", "availableAt");
CREATE INDEX "AutomationEvent_tenantId_createdAt_idx" ON "AutomationEvent"("tenantId", "createdAt");
