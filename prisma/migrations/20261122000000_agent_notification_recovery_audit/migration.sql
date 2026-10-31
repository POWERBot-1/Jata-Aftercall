-- Audit automatic lease recovery without storing destinations, provider data or tokens.
-- This does not authorize a resend or enable the worker.
CREATE TABLE "AgentAdminNotificationRecovery" (
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationRecovery_pkey" PRIMARY KEY ("applicationId", "recipientKey", "attempt"),
  CONSTRAINT "AgentAdminNotificationRecovery_claim_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationClaimState"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationRecovery_attempt_check" CHECK ("attempt" BETWEEN 1 AND 5),
  CONSTRAINT "AgentAdminNotificationRecovery_reason_check" CHECK ("reason" = 'LEASE_EXPIRED_UNKNOWN')
);
