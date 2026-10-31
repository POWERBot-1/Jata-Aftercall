-- Separate operational state: does not modify queued recipient plans or enable delivery.
CREATE TABLE "AgentAdminNotificationClaimState" (
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "claimToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationClaimState_pkey" PRIMARY KEY ("applicationId", "recipientKey"),
  CONSTRAINT "AgentAdminNotificationClaimState_delivery_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationDelivery"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationClaimState_state_check" CHECK ("state" IN ('CLAIMED', 'RETRY', 'UNKNOWN', 'ACCEPTED', 'DEAD')),
  CONSTRAINT "AgentAdminNotificationClaimState_attempts_check" CHECK ("attempts" BETWEEN 1 AND 5),
  CONSTRAINT "AgentAdminNotificationClaimState_lease_check" CHECK (("state" = 'CLAIMED' AND "claimToken" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR ("state" <> 'CLAIMED' AND "claimToken" IS NULL AND "leaseUntil" IS NULL)),
  CONSTRAINT "AgentAdminNotificationClaimState_retry_check" CHECK (("state" = 'RETRY' AND "nextAttemptAt" IS NOT NULL AND "attempts" < 5) OR ("state" <> 'RETRY' AND "nextAttemptAt" IS NULL))
);
CREATE INDEX "AgentAdminNotificationClaimState_state_leaseUntil_idx" ON "AgentAdminNotificationClaimState"("state", "leaseUntil");
CREATE INDEX "AgentAdminNotificationClaimState_state_nextAttemptAt_idx" ON "AgentAdminNotificationClaimState"("state", "nextAttemptAt");
