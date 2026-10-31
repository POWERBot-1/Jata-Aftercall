-- Durable provider evidence only; this migration does not enable delivery.
CREATE TABLE "AgentAdminNotificationAttempt" (
  "applicationId" TEXT NOT NULL,
  "recipientKey" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationAttempt_pkey" PRIMARY KEY ("applicationId", "recipientKey", "attempt"),
  CONSTRAINT "AgentAdminNotificationAttempt_delivery_fkey" FOREIGN KEY ("applicationId", "recipientKey") REFERENCES "AgentAdminNotificationDelivery"("applicationId", "recipientKey") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationAttempt_provider_check" CHECK ("providerKey" ~ '^[a-z0-9_-]{1,64}$'),
  CONSTRAINT "AgentAdminNotificationAttempt_attempt_check" CHECK ("attempt" BETWEEN 1 AND 5),
  CONSTRAINT "AgentAdminNotificationAttempt_outcome_check" CHECK (
    ("outcome" = 'ACCEPTED' AND "messageId" IS NOT NULL AND length("messageId") BETWEEN 1 AND 240) OR
    ("outcome" IN ('UNKNOWN', 'SAFE_TRANSIENT_REJECTION', 'SAFE_PERMANENT_REJECTION') AND "messageId" IS NULL)
  )
);
CREATE UNIQUE INDEX "AgentAdminNotificationAttempt_messageId_key" ON "AgentAdminNotificationAttempt"("messageId");
CREATE TABLE "AgentAdminNotificationCallback" (
  "eventId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentAdminNotificationCallback_pkey" PRIMARY KEY ("eventId"),
  CONSTRAINT "AgentAdminNotificationCallback_message_fkey" FOREIGN KEY ("messageId") REFERENCES "AgentAdminNotificationAttempt"("messageId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentAdminNotificationCallback_event_check" CHECK ("eventId" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AgentAdminNotificationCallback_status_check" CHECK ("status" IN ('DELIVERED', 'FAILED'))
);
