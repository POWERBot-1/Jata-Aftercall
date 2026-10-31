-- Existing rows were created by agent-only registration. This field is evidence, not entitlement.
ALTER TABLE "AgentReferralAttribution" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'REGISTRATION';
ALTER TABLE "AgentReferralAttribution" ADD CONSTRAINT "AgentReferralAttribution_source_check" CHECK ("source" IN ('REGISTRATION', 'EXISTING_ACCOUNT'));
