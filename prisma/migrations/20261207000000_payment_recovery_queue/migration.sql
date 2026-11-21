-- Durable, tenant-independent operator review queue.
-- This migration creates storage only; no existing payment or entitlement rows are modified.
CREATE TABLE "PaymentRecoveryTask" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "exception" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRecoveryTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentRecoveryTask_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "PaymentRecoveryTask_maxAttempts_positive" CHECK ("maxAttempts" > 0),
  CONSTRAINT "PaymentRecoveryTask_priority_valid" CHECK ("priority" IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  CONSTRAINT "PaymentRecoveryTask_status_valid" CHECK ("status" IN ('READY', 'LEASED', 'RETRY', 'COMPLETED', 'DEAD_LETTER'))
);

CREATE UNIQUE INDEX "PaymentRecoveryTask_idempotencyKey_key"
  ON "PaymentRecoveryTask"("idempotencyKey");
CREATE INDEX "PaymentRecoveryTask_status_availableAt_priority_idx"
  ON "PaymentRecoveryTask"("status", "availableAt", "priority");
CREATE INDEX "PaymentRecoveryTask_status_leaseUntil_idx"
  ON "PaymentRecoveryTask"("status", "leaseUntil");
