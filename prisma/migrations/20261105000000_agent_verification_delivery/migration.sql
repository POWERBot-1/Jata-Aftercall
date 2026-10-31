-- Delivery acceptance is not phone verification; no OTP or provider response body is stored.
ALTER TABLE "AgentPhoneChallenge" ADD COLUMN "deliveryChannel" TEXT;
ALTER TABLE "AgentPhoneChallenge" ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "AgentPhoneChallenge" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "AgentPhoneChallenge" ADD CONSTRAINT "AgentPhoneChallenge_deliveryState_check" CHECK ("deliveryState" IN ('PENDING', 'ACCEPTED', 'SENT', 'FAILED', 'UNKNOWN'));
ALTER TABLE "AgentPhoneChallenge" ADD CONSTRAINT "AgentPhoneChallenge_deliveryChannel_check" CHECK ("deliveryChannel" IS NULL OR "deliveryChannel" IN ('SMS', 'WHATSAPP'));
