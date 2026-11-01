-- Dedicated control-plane identities, explicit per-grant capabilities, TOTP material and append-only audit.
-- No existing CUSTOMER/ADMIN roles are rewritten and no privileged grant is seeded.
CREATE TYPE "ControlRole" AS ENUM (
  'SUPER_ADMIN', 'PLATFORM_ADMIN', 'FINANCE_ADMIN',
  'SUPPORT_ADMIN', 'SECURITY_ADMIN', 'READ_ONLY_AUDITOR'
);

CREATE TABLE "ControlRoleGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "ControlRole" NOT NULL,
  "permissionKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "scopeBusinessId" TEXT,
  "createdById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ControlRoleGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ControlRoleGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ControlRoleGrant_scopeBusinessId_fkey" FOREIGN KEY ("scopeBusinessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ControlRoleGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ControlRoleGrant_userId_revokedAt_idx" ON "ControlRoleGrant"("userId", "revokedAt");
CREATE INDEX "ControlRoleGrant_role_revokedAt_idx" ON "ControlRoleGrant"("role", "revokedAt");
CREATE INDEX "ControlRoleGrant_scopeBusinessId_revokedAt_idx" ON "ControlRoleGrant"("scopeBusinessId", "revokedAt");

-- Grant rows are historical records. The only permitted update is one-time revocation; permission,
-- actor, role and scope changes require a new row so audits can reconstruct prior authorization.
CREATE FUNCTION control_role_grant_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'control role grants are append-only';
  END IF;
  IF OLD."revokedAt" IS NOT NULL
     OR NEW."revokedAt" IS NULL
     OR NEW."revocationReason" IS NULL
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."permissionKeys" IS DISTINCT FROM OLD."permissionKeys"
     OR NEW."scopeBusinessId" IS DISTINCT FROM OLD."scopeBusinessId"
     OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'control role grants may only be revoked once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ControlRoleGrant_immutable" BEFORE UPDATE OR DELETE ON "ControlRoleGrant"
  FOR EACH ROW EXECUTE FUNCTION control_role_grant_immutable();

CREATE TABLE "ControlMfaCredential" (
  "userId" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "secretIv" TEXT NOT NULL,
  "secretTag" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "lastAcceptedStep" BIGINT,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ControlMfaCredential_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "ControlMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ControlMfaCredential_failedAttempts_check" CHECK ("failedAttempts" >= 0)
);

CREATE TABLE "ControlAuditEvent" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" "ControlRole" NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "scopeBusinessId" TEXT,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "beforeState" JSONB,
  "afterState" JSONB,
  "metadata" JSONB,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ControlAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ControlAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ControlAuditEvent_scopeBusinessId_fkey" FOREIGN KEY ("scopeBusinessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ControlAuditEvent_actorId_createdAt_idx" ON "ControlAuditEvent"("actorId", "createdAt");
CREATE INDEX "ControlAuditEvent_action_createdAt_idx" ON "ControlAuditEvent"("action", "createdAt");
CREATE INDEX "ControlAuditEvent_scopeBusinessId_createdAt_idx" ON "ControlAuditEvent"("scopeBusinessId", "createdAt");
CREATE INDEX "ControlAuditEvent_targetType_targetId_createdAt_idx" ON "ControlAuditEvent"("targetType", "targetId", "createdAt");

CREATE FUNCTION control_audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'control audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ControlAuditEvent_immutable" BEFORE UPDATE OR DELETE ON "ControlAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION control_audit_event_immutable();
