import { randomUUID } from "node:crypto";
import type { ControlGrant } from "./access";
import { sanitizeAuditState } from "./security";

export async function createControlAuditEvent(
  tx: any,
  input: {
    actorId: string;
    grant: ControlGrant;
    action: string;
    targetType: string;
    targetId?: string | null;
    scopeBusinessId?: string | null;
    outcome: "SUCCESS" | "DENIED" | "FAILED";
    reason?: string | null;
    beforeState?: unknown;
    afterState?: unknown;
    metadata?: Record<string, unknown>;
    correlationId?: string;
  },
) {
  return tx.controlAuditEvent.create({
    data: {
      id: randomUUID(),
      actorId: input.actorId,
      actorRole: input.grant.role,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      scopeBusinessId: input.scopeBusinessId ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      beforeState: sanitizeAuditState(input.beforeState) as any,
      afterState: sanitizeAuditState(input.afterState) as any,
      metadata: sanitizeAuditState(input.metadata) as any,
      correlationId: input.correlationId ?? null,
    },
  });
}
