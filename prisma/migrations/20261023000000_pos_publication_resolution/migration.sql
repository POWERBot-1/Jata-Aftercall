-- Owner-selected paid-but-unpublished POS safeguard: one additive resolution table.
-- No payment, entitlement, configuration, or historical audit row is rewritten or backfilled.
CREATE TABLE IF NOT EXISTS "PosPublicationResolution" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "configurationId" TEXT,
  "paymentReference" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "blockerCode" TEXT NOT NULL,
  "blockerDetail" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "entitlementStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "remedyStatus" TEXT NOT NULL DEFAULT 'PENDING_PUBLICATION',
  "ownerNotificationQueuedAt" TIMESTAMP(3),
  "escalationNotificationScheduledAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PosPublicationResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PosPublicationResolution_paymentId_key"
  ON "PosPublicationResolution"("paymentId");
CREATE INDEX IF NOT EXISTS "PosPublicationResolution_businessId_status_idx"
  ON "PosPublicationResolution"("businessId", "status");
CREATE INDEX IF NOT EXISTS "PosPublicationResolution_status_deadlineAt_idx"
  ON "PosPublicationResolution"("status", "deadlineAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PosPublicationResolution_businessId_fkey'
      AND conrelid = '"PosPublicationResolution"'::regclass
  ) THEN
    ALTER TABLE "PosPublicationResolution"
      ADD CONSTRAINT "PosPublicationResolution_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PosPublicationResolution_paymentId_fkey'
      AND conrelid = '"PosPublicationResolution"'::regclass
  ) THEN
    ALTER TABLE "PosPublicationResolution"
      ADD CONSTRAINT "PosPublicationResolution_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
