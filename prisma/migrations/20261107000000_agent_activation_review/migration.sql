-- Review decisions grant no administrator role or financial entitlement.
BEGIN;
ALTER TABLE "AgentApplication" DROP CONSTRAINT "AgentApplication_status_check";
ALTER TABLE "AgentApplication" ADD CONSTRAINT "AgentApplication_status_check"
  CHECK ("status" IN ('PENDING', 'REJECTED', 'ACTIVE', 'SUSPENDED'));
COMMIT;
