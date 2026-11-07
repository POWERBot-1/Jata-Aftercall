-- Control grants are time-bounded. Legacy NULL expiry rows are intentionally inactive
-- until an owner-authorized provisioner replaces them with a new expiring grant.
ALTER TABLE "ControlRoleGrant" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "ControlRoleGrant_userId_revokedAt_expiresAt_idx"
  ON "ControlRoleGrant"("userId", "revokedAt", "expiresAt");

-- Extend the append-only guard: expiresAt cannot be edited during or after revocation.
CREATE OR REPLACE FUNCTION control_role_grant_immutable() RETURNS trigger AS $$
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
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'control role grants may only be revoked once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
