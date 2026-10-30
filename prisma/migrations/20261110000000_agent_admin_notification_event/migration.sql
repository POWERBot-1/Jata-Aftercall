-- Durable event only. No recipients, content, provider credentials or delivery state.
CREATE TABLE "AgentAdminNotificationEvent" (
  "applicationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationEvent_pkey" PRIMARY KEY ("applicationId"),
  CONSTRAINT "AgentAdminNotificationEvent_eventType_check" CHECK ("eventType" = 'APPLICATION_SUBMITTED'),
  CONSTRAINT "AgentAdminNotificationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "AgentApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
