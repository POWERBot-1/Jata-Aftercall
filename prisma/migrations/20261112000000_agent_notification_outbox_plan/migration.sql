-- Planning only: no sender, provider account, recipient numbers or message contents.
CREATE TABLE "AgentAdminNotificationPlan" (
  "applicationId" TEXT NOT NULL,
  "recipientKeyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationPlan_pkey" PRIMARY KEY ("applicationId"),
  CONSTRAINT "AgentAdminNotificationPlan_event_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentAdminNotificationEvent"("applicationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationPlan_version_check" CHECK ("recipientKeyVersion" ~ '^[A-Za-z0-9_-]{1,32}$')
);
CREATE TABLE "AgentAdminNotificationDelivery" (
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationDelivery_pkey" PRIMARY KEY ("applicationId", "recipientKey"),
  CONSTRAINT "AgentAdminNotificationDelivery_plan_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentAdminNotificationPlan"("applicationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationDelivery_recipient_check" CHECK ("recipientKey" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AgentAdminNotificationDelivery_state_check" CHECK ("state" = 'QUEUED')
);
CREATE INDEX "AgentAdminNotificationDelivery_state_createdAt_idx" ON "AgentAdminNotificationDelivery"("state", "createdAt");
