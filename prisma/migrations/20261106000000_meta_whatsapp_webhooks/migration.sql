-- Meta's status is separate from OTP confirmation and from send acceptance.
ALTER TABLE "AgentPhoneChallenge" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "AgentPhoneChallenge" ADD COLUMN "providerStatusAt" TIMESTAMP(3);
ALTER TABLE "AgentPhoneChallenge" ADD CONSTRAINT "AgentPhoneChallenge_providerStatus_check" CHECK ("providerStatus" IS NULL OR "providerStatus" IN ('sent', 'delivered', 'read', 'failed'));
CREATE INDEX "AgentPhoneChallenge_providerMessageId_idx" ON "AgentPhoneChallenge"("providerMessageId");
CREATE TABLE "AgentWhatsAppWebhookEvent" (
  "id" TEXT NOT NULL,
  "challengeId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentWhatsAppWebhookEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentWhatsAppWebhookEvent_status_check" CHECK ("status" IN ('sent', 'delivered', 'read', 'failed')),
  CONSTRAINT "AgentWhatsAppWebhookEvent_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "AgentPhoneChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AgentWhatsAppWebhookEvent_challengeId_idx" ON "AgentWhatsAppWebhookEvent"("challengeId");
