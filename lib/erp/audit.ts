/**
 * POS / ERP - PRO audit trail (§3.5)
 *
 * Financial changes, approvals, consent, KYC access and privileged operations are recorded with
 * actor, tenant, action, outcome and reason. Secret-looking values are redacted before they reach
 * the table: an audit log that leaks a token is worse than no log.
 */

import prisma from "../db";

const SECRET_KEY = /(secret|password|token|api[_-]?key|authorization|private[_-]?key|otp)/i;

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => redactAuditValue(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? "[redacted]" : redactAuditValue(entry, depth + 1);
    }
    return output;
  }
  return value;
}

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(redactAuditValue(value));
  } catch {
    return null;
  }
}

export type ErpAuditInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome?: "SUCCESS" | "DENIED" | "FAILED";
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  client?: any;
};

/** Never throws: losing an audit write must not break the business operation it describes. */
export async function logErpAudit(input: ErpAuditInput): Promise<void> {
  const client = input.client ?? prisma;
  try {
    await client.erpAuditEvent.create({
      data: {
        businessId: input.businessId,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        outcome: input.outcome ?? "SUCCESS",
        reason: input.reason ?? null,
        beforeJson: json(input.before),
        afterJson: json(input.after),
      },
    });
  } catch {
    /* audit is best-effort at the storage layer; the operation's own transaction is the source of truth */
  }
}
