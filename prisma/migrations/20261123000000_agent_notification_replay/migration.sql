-- Operator-authorized replay is limited to verified no-message rejections.
ALTER TABLE "AgentAdminNotificationClaimState" ADD COLUMN "retryCeiling" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "AgentAdminNotificationClaimState" DROP CONSTRAINT "AgentAdminNotificationClaimState_attempts_check";
ALTER TABLE "AgentAdminNotificationClaimState" DROP CONSTRAINT "AgentAdminNotificationClaimState_retry_check";
ALTER TABLE "AgentAdminNotificationClaimState" ADD CONSTRAINT "AgentAdminNotificationClaimState_attempts_check" CHECK ("attempts" BETWEEN 1 AND 15 AND "retryCeiling" BETWEEN 5 AND 15 AND "attempts" <= "retryCeiling");
ALTER TABLE "AgentAdminNotificationClaimState" ADD CONSTRAINT "AgentAdminNotificationClaimState_retry_check" CHECK (("state" = 'RETRY' AND "nextAttemptAt" IS NOT NULL AND "attempts" < "retryCeiling") OR ("state" <> 'RETRY' AND "nextAttemptAt" IS NULL));
ALTER TABLE "AgentAdminNotificationAttempt" DROP CONSTRAINT "AgentAdminNotificationAttempt_attempt_check";
ALTER TABLE "AgentAdminNotificationAttempt" ADD CONSTRAINT "AgentAdminNotificationAttempt_attempt_check" CHECK ("attempt" BETWEEN 1 AND 15);
ALTER TABLE "AgentAdminNotificationRecovery" DROP CONSTRAINT "AgentAdminNotificationRecovery_attempt_check";
ALTER TABLE "AgentAdminNotificationRecovery" ADD CONSTRAINT "AgentAdminNotificationRecovery_attempt_check" CHECK ("attempt" BETWEEN 1 AND 15);
CREATE TABLE "AgentAdminNotificationReplay" (
  "requestId" TEXT PRIMARY KEY,
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "previousAttempt" INTEGER NOT NULL,
  "retryCeiling" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationReplay_claim_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationClaimState"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReplay_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReplay_bounds_check" CHECK ("previousAttempt" BETWEEN 1 AND 14 AND "retryCeiling" BETWEEN 5 AND 15 AND "retryCeiling" > "previousAttempt")
);
CREATE UNIQUE INDEX "AgentAdminNotificationReplay_attempt_key" ON "AgentAdminNotificationReplay" ("applicationId", "recipientKey", "previousAttempt");
