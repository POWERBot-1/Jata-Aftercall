-- Operator-authorized replay is limited to verified no-message rejections and the
-- existing lifetime cap of five attempts. This migration does not enable delivery.
CREATE TABLE "AgentAdminNotificationReplay" (
  "requestId" TEXT PRIMARY KEY,
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "previousAttempt" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationReplay_claim_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationClaimState"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReplay_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationReplay_bounds_check" CHECK ("previousAttempt" BETWEEN 1 AND 4)
);
CREATE UNIQUE INDEX "AgentAdminNotificationReplay_attempt_key" ON "AgentAdminNotificationReplay" ("applicationId", "recipientKey", "previousAttempt");
