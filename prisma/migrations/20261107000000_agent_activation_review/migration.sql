-- Agent access is distinct from the existing application review state and financial entitlement.
ALTER TABLE "AgentApplication" ADD COLUMN "agentStatus" TEXT NOT NULL DEFAULT 'INACTIVE';
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_agentStatus_check"
  CHECK ("agentStatus" IN ('INACTIVE', 'ACTIVE', 'SUSPENDED'));
