/**
 * POS audit log (§37, §56)
 *
 * Every meaningful business action is recorded against the tenant: who did it, to what,
 * when, and the before/after where it matters. Audit writes never fail the operation they
 * describe, and never carry secrets or another tenant's identifiers.
 */

import prisma from "../db";

export type PosAuditAction =
  | "POS_CONFIGURATION_SAVED"
  | "POS_CONFIGURATION_PUBLISHED"
  | "POS_CONFIGURATION_ROLLED_BACK"
  | "POS_CONFIGURATION_COPIED"
  | "POS_TEMPLATE_SAVED"
  | "POS_PREVIEW_OPENED"
  | "POS_PLAN_SELECTED"
  | "POS_PROVISIONED"
  | "POS_SUSPENDED"
  | "POS_CANCELLED"
  | "POS_SUBSCRIPTION_ACTIVATED"
  | "POS_SALE_CREATED"
  | "POS_SALE_REFUNDED"
  | "POS_SALE_VOIDED"
  | "POS_PAYMENT_RECORDED"
  | "POS_PRICE_CHANGED"
  | "POS_DISCOUNT_APPLIED"
  | "POS_STOCK_ADJUSTED"
  | "POS_STOCK_TRANSFERRED"
  | "POS_CREDIT_APPROVED"
  | "POS_CREDIT_DECLINED"
  | "POS_REPAYMENT_RECORDED"
  | "POS_SUPPLIER_PAYMENT_RECORDED"
  | "POS_PURCHASE_RECORDED"
  | "POS_PURCHASE_RECEIVED"
  | "POS_ORDER_CREATED"
  | "POS_ORDER_STATE_CHANGED"
  | "POS_EXPENSE_RECORDED"
  | "POS_PRODUCT_CREATED"
  | "POS_PRODUCT_UPDATED"
  | "POS_CUSTOMER_CREATED"
  | "POS_CUSTOMER_UPDATED"
  | "POS_SUPPLIER_CREATED"
  | "POS_STAFF_ADDED"
  | "POS_PERMISSION_CHANGED"
  | "POS_ACCESS_DENIED";

export type PosAuditEntry = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  action: PosAuditAction | string;
  targetType?: string | null;
  targetId?: string | null;
  branchId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

const MAX_METADATA_BYTES = 8_000;

/** Keys that must never be written to an audit log (§56). */
const FORBIDDEN_METADATA_KEYS = ["password", "passwordhash", "pin", "secret", "token", "apikey", "credential", "signature", "session"];

function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_METADATA_KEYS.some((forbidden) => normalized.includes(forbidden))) continue;
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null) {
      clean[key] = Array.isArray(value) ? value.slice(0, 20) : Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20));
      continue;
    }
    clean[key] = typeof value === "string" ? value.slice(0, 240) : value;
  }
  let json = JSON.stringify(clean);
  if (json.length > MAX_METADATA_BYTES) json = JSON.stringify({ truncated: true });
  return json;
}

export async function logPosAudit(entry: PosAuditEntry): Promise<void> {
  if (!entry.businessId) return;
  try {
    await prisma.posAuditEvent.create({
      data: {
        businessId: entry.businessId,
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: String(entry.action).slice(0, 60),
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        branchId: entry.branchId ?? null,
        metadata: sanitizeMetadata({
          ...(entry.metadata ?? {}),
          ...(entry.before ? { before: entry.before } : {}),
          ...(entry.after ? { after: entry.after } : {}),
        }),
      },
    });
  } catch {
    // An audit failure must not roll back a completed sale (§37) but it must be visible.
    console.error("pos audit write failed");
  }
}

/** Audit inside an existing transaction — used where the write and the audit are one unit. */
export async function logPosAuditInTransaction(tx: any, entry: PosAuditEntry): Promise<void> {
  if (!entry.businessId) return;
  await tx.posAuditEvent.create({
    data: {
      businessId: entry.businessId,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action: String(entry.action).slice(0, 60),
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      branchId: entry.branchId ?? null,
      metadata: sanitizeMetadata({
        ...(entry.metadata ?? {}),
        ...(entry.before ? { before: entry.before } : {}),
        ...(entry.after ? { after: entry.after } : {}),
      }),
    },
  });
}

export type PosAuditRow = {
  id: string;
  action: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: Date;
  metadata: Record<string, unknown> | null;
};

/** Tenant-scoped audit read. The business id always comes from the server (§5). */
export async function listPosAudit(businessId: string, options: { take?: number; action?: string } = {}): Promise<PosAuditRow[]> {
  const rows = await prisma.posAuditEvent.findMany({
    where: { businessId, ...(options.action ? { action: options.action } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.take ?? 50, 1), 200),
    select: { id: true, action: true, actorName: true, targetType: true, targetId: true, createdAt: true, metadata: true },
  });
  return rows.map((row: any) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorName ?? null,
    targetType: row.targetType ?? null,
    targetId: row.targetId ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    metadata: parseMetadata(row.metadata),
  }));
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  POS_SALE_CREATED: "Sale recorded",
  POS_SALE_REFUNDED: "Sale refunded",
  POS_SALE_VOIDED: "Sale voided",
  POS_PAYMENT_RECORDED: "Payment recorded",
  POS_PRICE_CHANGED: "Price changed",
  POS_DISCOUNT_APPLIED: "Discount applied",
  POS_STOCK_ADJUSTED: "Stock adjusted",
  POS_STOCK_TRANSFERRED: "Stock transferred",
  POS_CREDIT_APPROVED: "Credit approved",
  POS_CREDIT_DECLINED: "Credit declined",
  POS_REPAYMENT_RECORDED: "Repayment recorded",
  POS_SUPPLIER_PAYMENT_RECORDED: "Supplier paid",
  POS_PURCHASE_RECEIVED: "Stock received",
  POS_ORDER_CREATED: "Order created",
  POS_ORDER_STATE_CHANGED: "Order moved",
  POS_PURCHASE_RECORDED: "Purchase recorded",
  POS_EXPENSE_RECORDED: "Expense recorded",
  POS_PRODUCT_CREATED: "Product added",
  POS_PRODUCT_UPDATED: "Product updated",
  POS_CUSTOMER_CREATED: "Customer added",
  POS_CUSTOMER_UPDATED: "Customer updated",
  POS_SUPPLIER_CREATED: "Supplier added",
  POS_STAFF_ADDED: "Staff added",
  POS_PERMISSION_CHANGED: "Permissions changed",
  POS_CONFIGURATION_SAVED: "Configuration saved",
  POS_CONFIGURATION_PUBLISHED: "Configuration published",
  POS_CONFIGURATION_ROLLED_BACK: "Configuration rolled back",
  POS_CONFIGURATION_COPIED: "Configuration copied",
  POS_TEMPLATE_SAVED: "Template saved",
  POS_PREVIEW_OPENED: "Preview opened",
  POS_PLAN_SELECTED: "Plan selected",
  POS_PROVISIONED: "POS went live",
  POS_SUBSCRIPTION_ACTIVATED: "Subscription activated",
  POS_SUSPENDED: "POS suspended",
  POS_CANCELLED: "POS cancelled",
  POS_ACCESS_DENIED: "Access denied",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
