-- Rejection is an application decision, not an agent activation or financial action.
ALTER TABLE "AgentApplication" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_status_check" CHECK ("status" IN ('PENDING', 'REJECTED'));
CREATE INDEX "AgentApplication_status_createdAt_idx" ON "AgentApplication"("status", "createdAt");
