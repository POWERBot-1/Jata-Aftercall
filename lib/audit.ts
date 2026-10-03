import prisma from "./db";

/**
 * Security-sensitive audit events (§47, §48, §50).
 * Never logs passwords, secrets, tokens, card data, or private credentials.
 */
export const AUDIT_ACTIONS = {
  BUSINESS_CREATED: "BUSINESS_CREATED",
  KNOWLEDGE_UPDATED: "KNOWLEDGE_UPDATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRICE_CHANGED: "PRICE_CHANGED",
  INVENTORY_CHANGED: "INVENTORY_CHANGED",
  PAYMENT_CONFIGURED: "PAYMENT_CONFIGURED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  HUMAN_HANDOFF: "HUMAN_HANDOFF",
  AI_CONFIGURATION_CHANGED: "AI_CONFIGURATION_CHANGED",
  ADMIN_ACCESS: "ADMIN_ACCESS",
} as const;

const FORBIDDEN_AUDIT_KEY_PATTERN =
  /password|secret|apikey|api_key|token|credential|privatekey|private_key|cardnumber|cvv|database_url|jwt/i;

export function redactAuditMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_AUDIT_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      output[key] = redactAuditMetadata(value as Record<string, unknown>);
    } else if (typeof value === "string" && /(?:sk_live_|sk_test_|postgres:\/\/|postgresql:\/\/)/i.test(value)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function logAudit(params: {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  previousValue?: unknown;
  newValue?: unknown;
}) {
  try {
    let finalMeta = params.metadata ? { ...params.metadata } : undefined;
    if (params.previousValue !== undefined || params.newValue !== undefined) {
      finalMeta = {
        ...(finalMeta || {}),
        ...(params.previousValue !== undefined ? { previousValue: params.previousValue } : {}),
        ...(params.newValue !== undefined ? { newValue: params.newValue } : {}),
        timestamp: new Date().toISOString(),
      };
    }
    const safeMeta = finalMeta ? redactAuditMetadata(finalMeta) : null;
    await prisma.auditEvent.create({
      data: {
        actorId: params.actorId || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        metadata: safeMeta ? JSON.stringify(safeMeta) : null,
      },
    });
  } catch {
    // Audit must not fail an otherwise successful registration or other write.
    console.error("audit write failed");
  }
}
