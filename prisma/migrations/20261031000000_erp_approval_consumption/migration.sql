-- An approval is a single-use permission slip.
--
-- Before this migration a granted request recorded "somebody may spend up to this amount" but
-- nothing tied a grant to the action it authorised, so the same grant could be replayed. These
-- three nullable columns are written once, inside the same transaction as the action, and a second
-- attempt is refused by the guarded update (consumedAt IS NULL) rather than by application memory.
-- Additive and reversible: dropping the columns loses only "which grant paid for which action".

ALTER TABLE "ErpApprovalRequest" ADD COLUMN IF NOT EXISTS "consumedAt" TIMESTAMP(3);
ALTER TABLE "ErpApprovalRequest" ADD COLUMN IF NOT EXISTS "consumedBy" TEXT;
ALTER TABLE "ErpApprovalRequest" ADD COLUMN IF NOT EXISTS "consumedRef" TEXT;

CREATE INDEX IF NOT EXISTS "ErpApprovalRequest_businessId_kind_status_consumedAt_idx"
  ON "ErpApprovalRequest" ("businessId", "kind", "status", "consumedAt");
