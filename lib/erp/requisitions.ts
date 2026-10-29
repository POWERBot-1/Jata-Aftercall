/**
 * Requisitions (directive module 5: the request to buy, before the order)
 *
 * A purchase order says what the business promised a supplier. A requisition says who asked for it,
 * why, and who allowed it — and it has to keep saying that after the order exists, because that is
 * the question an audit, a budget review and an angry owner all ask. So it is a first-class,
 * tenant-scoped object with its own number, its own state machine and its own audit trail, not a
 * half-filled purchase order.
 *
 * The controls this file enforces:
 *
 * 1. **Separation of duties.** Whoever raises a request cannot approve it. A one-person business
 *    still needs somebody else to decide, and the refusal says so instead of silently allowing it.
 * 2. **Approval needs authority.** Deciding a request needs `APPROVE_SPEND`; raising one only needs
 *    a role that is not read-only.
 * 3. **An approved request is what gets bought.** Conversion is the only path from a requisition to
 *    a purchase order, it only works from `APPROVED`, and it happens once (a second attempt returns
 *    the order that already exists).
 * 4. **Amending a submitted request sends it back.** An approver must never approve one thing and
 *    have another bought, so an amendment returns the request to `DRAFT` for resubmission and
 *    records the before-and-after.
 * 5. **Tenant-scoped at the query.** Every `where` carries `businessId`; nothing is filtered after
 *    the fact.
 *
 * Every state change is audited. Numbers come from `ErpSequence`, never from a row count.
 */

import { logErpAudit } from "./audit";
import { nextDocumentNumber } from "./sequences";
import { createNotification } from "./notifications";
import { hasErpPermission, normalizeErpRole } from "./access";
import { createPurchaseOrder } from "./procurement";

export const REQUISITION_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CONVERTED", "CANCELLED"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for a decision",
  APPROVED: "Approved, not yet ordered",
  REJECTED: "Rejected",
  CONVERTED: "Turned into a purchase order",
  CANCELLED: "Cancelled",
};

export const REQUISITION_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type RequisitionPriority = (typeof REQUISITION_PRIORITIES)[number];

export const REQUISITION_PRIORITY_LABELS: Record<RequisitionPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

/** 16% is the Kenyan standard rate; 8% covers the packs' reduced-rate supplies; 0 is zero-rated. */
export const REQUISITION_TAX_RATES_BPS = [0, 800, 1600] as const;

export function normalizeRequisitionStatus(raw: unknown): RequisitionStatus {
  const value = String(raw ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (REQUISITION_STATUSES as readonly string[]).includes(value) ? (value as RequisitionStatus) : "DRAFT";
}

export function normalizeRequisitionPriority(raw: unknown): RequisitionPriority {
  const value = String(raw ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (REQUISITION_PRIORITIES as readonly string[]).includes(value) ? (value as RequisitionPriority) : "NORMAL";
}

/** A request is only open while somebody can still act on it. */
export function isOpenRequisitionStatus(status: unknown): boolean {
  const value = normalizeRequisitionStatus(status);
  return value === "DRAFT" || value === "SUBMITTED" || value === "APPROVED";
}

/**
 * The state machine. Narrow on purpose: a rejected request cannot be silently approved later, a
 * converted one cannot be reconverted, and nothing returns from `CANCELLED`.
 */
export function requisitionTransitionAllowed(from: unknown, to: unknown): { ok: boolean; reason?: string } {
  const current = normalizeRequisitionStatus(from);
  const next = normalizeRequisitionStatus(to);
  if (current === next) return { ok: true };
  const allowed: Record<RequisitionStatus, RequisitionStatus[]> = {
    DRAFT: ["SUBMITTED", "CANCELLED"],
    SUBMITTED: ["APPROVED", "REJECTED", "DRAFT", "CANCELLED"],
    APPROVED: ["CONVERTED", "CANCELLED"],
    REJECTED: [],
    CONVERTED: [],
    CANCELLED: [],
  };
  if (allowed[current].includes(next)) return { ok: true };
  if (current === "REJECTED") return { ok: false, reason: "A rejected request stays rejected. Raise a new one if things have changed." };
  if (current === "CONVERTED") return { ok: false, reason: "This request already became a purchase order; change the order instead." };
  if (current === "CANCELLED") return { ok: false, reason: "A cancelled request cannot be reopened." };
  return {
    ok: false,
    reason: `A request cannot go from ${REQUISITION_STATUS_LABELS[current].toLowerCase()} to ${REQUISITION_STATUS_LABELS[next].toLowerCase()}.`,
  };
}

export type RequisitionLineInput = {
  productId?: string | null;
  description: string;
  quantity: number;
  estimatedUnitCostCents: number;
  taxRateBps?: number;
};

export type RequisitionValue = {
  title: string;
  justification: string | null;
  department: string | null;
  priority: RequisitionPriority;
  neededBy: Date | null;
  supplierId: string | null;
  supplierName: string | null;
  lines: Array<{
    productId: string | null;
    description: string;
    quantity: number;
    estimatedUnitCostCents: number;
    taxRateBps: number;
    lineSubtotalCents: number;
    lineTaxCents: number;
  }>;
  estimatedSubtotalCents: number;
  estimatedTaxCents: number;
  estimatedTotalCents: number;
};

export type RequisitionValidation = { ok: boolean; errors: string[]; value: RequisitionValue };

function money(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

/** Line and document totals are computed from the lines, never accepted from the client. */
export function requisitionLineTotals(line: { quantity: number; estimatedUnitCostCents: number; taxRateBps?: number }) {
  const quantity = Number(line.quantity) || 0;
  const subtotal = Math.round(quantity * money(line.estimatedUnitCostCents));
  const tax = Math.round((subtotal * Math.max(0, Number(line.taxRateBps) || 0)) / 10000);
  return { lineSubtotalCents: subtotal, lineTaxCents: tax };
}

export function requisitionTotals(lines: Array<{ quantity: number; estimatedUnitCostCents: number; taxRateBps?: number }>) {
  const totals = (lines ?? []).reduce(
    (sum, line) => {
      const lineTotals = requisitionLineTotals(line);
      return {
        estimatedSubtotalCents: sum.estimatedSubtotalCents + lineTotals.lineSubtotalCents,
        estimatedTaxCents: sum.estimatedTaxCents + lineTotals.lineTaxCents,
      };
    },
    { estimatedSubtotalCents: 0, estimatedTaxCents: 0 },
  );
  return { ...totals, estimatedTotalCents: totals.estimatedSubtotalCents + totals.estimatedTaxCents };
}

/** Pure validation so the form, the action and the tests all agree on what a request is. */
export type RequisitionInputShape = {
  title?: string | null;
  justification?: string | null;
  department?: string | null;
  priority?: string | null;
  neededBy?: Date | string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  lines?: RequisitionLineInput[] | null;
};

export function validateRequisitionInput(input: RequisitionInputShape): RequisitionValidation {
  const errors: string[] = [];
  const title = String(input.title ?? "").trim().slice(0, 160);
  if (title.length < 3) errors.push("Give the request a title of at least three characters.");

  const justification = input.justification ? String(input.justification).trim().slice(0, 2000) : null;
  const department = input.department ? String(input.department).trim().slice(0, 80) : null;

  let neededBy: Date | null = null;
  if (input.neededBy) {
    const parsed = input.neededBy instanceof Date ? input.neededBy : new Date(input.neededBy as unknown as string);
    if (Number.isNaN(parsed.getTime())) errors.push("That 'needed by' date is not valid.");
    else neededBy = parsed;
  }

  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) errors.push("Add at least one line to the request.");
  if (rawLines.length > 50) errors.push("A request holds at most fifty lines.");

  const lines = rawLines.map((line, index) => {
    const position = index + 1;
    const description = String(line.description ?? "").trim().slice(0, 240);
    if (description.length < 2) errors.push(`Line ${position} needs a description.`);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) errors.push(`Line ${position} needs a quantity greater than zero.`);
    const unitCost = Number(line.estimatedUnitCostCents);
    if (!Number.isInteger(unitCost) || unitCost < 0) errors.push(`Line ${position} needs an estimated cost in whole cents, zero or more.`);
    const taxRateBps = Number(line.taxRateBps ?? 0);
    if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 3000) errors.push(`Line ${position} has an unsupported tax rate.`);
    const totals = requisitionLineTotals({ quantity, estimatedUnitCostCents: unitCost, taxRateBps });
    return {
      productId: line.productId ? String(line.productId) : null,
      description,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      estimatedUnitCostCents: Number.isInteger(unitCost) ? unitCost : 0,
      taxRateBps: Number.isInteger(taxRateBps) ? taxRateBps : 0,
      ...totals,
    };
  });

  const totals = requisitionTotals(lines);
  return {
    ok: errors.length === 0,
    errors,
    value: {
      title,
      justification,
      department,
      priority: normalizeRequisitionPriority(input.priority),
      neededBy,
      supplierId: input.supplierId ? String(input.supplierId) : null,
      supplierName: input.supplierName ? String(input.supplierName).trim().slice(0, 160) : null,
      lines,
      ...totals,
    },
  };
}

export type CreateRequisitionInput = {
  businessId: string;
  title: string;
  justification?: string | null;
  department?: string | null;
  priority?: string | null;
  neededBy?: Date | string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  requestedBy: string;
  requestedName?: string | null;
  idempotencyKey?: string | null;
  lines: RequisitionLineInput[];
};

/**
 * Raise a request. Draft only: raising it does not ask anybody for permission, submitting does.
 * Idempotency is per tenant, so a double-submitted form returns the request it already created.
 */
export async function createRequisition(client: any, input: CreateRequisitionInput) {
  const validation = validateRequisitionInput(input);
  if (!validation.ok) throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  const value = validation.value;

  if (input.idempotencyKey) {
    const existing = await client.erpRequisition
      .findUnique({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: String(input.idempotencyKey) } } })
      .catch(() => null);
    if (existing) return { request: existing, created: false, deduplicated: true };
  }

  // A supplier named on the request must belong to this tenant; never trust an id from the form.
  if (value.supplierId) {
    const supplier = await client.posSupplier.findFirst({
      where: { id: value.supplierId, businessId: input.businessId },
      select: { id: true, name: true },
    });
    if (!supplier) throw Object.assign(new Error("That supplier is not on this business's list."), { status: 400 });
    value.supplierName = value.supplierName ?? supplier.name;
  }

  const requisitionNumber = await nextDocumentNumber(client, input.businessId, "requisition");

  const request = await client.erpRequisition.create({
    data: {
      businessId: input.businessId,
      requisitionNumber,
      status: "DRAFT",
      title: value.title,
      justification: value.justification,
      department: value.department,
      priority: value.priority,
      neededBy: value.neededBy,
      supplierId: value.supplierId,
      supplierName: value.supplierName,
      estimatedSubtotalCents: value.estimatedSubtotalCents,
      estimatedTaxCents: value.estimatedTaxCents,
      estimatedTotalCents: value.estimatedTotalCents,
      requestedBy: input.requestedBy,
      requestedName: input.requestedName ?? null,
      idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
      lines: {
        create: value.lines.map((line, index) => ({
          businessId: input.businessId,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          estimatedUnitCostCents: line.estimatedUnitCostCents,
          taxRateBps: line.taxRateBps,
          lineSubtotalCents: line.lineSubtotalCents,
          lineTaxCents: line.lineTaxCents,
          sortOrder: index,
        })),
      },
    },
    include: { lines: true },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.requestedBy,
    actorName: input.requestedName ?? null,
    action: "REQUISITION_CREATED",
    targetType: "REQUISITION",
    targetId: request.id,
    after: { requisitionNumber, estimatedTotalCents: value.estimatedTotalCents, lineCount: value.lines.length },
    client,
  });

  return { request, created: true, deduplicated: false };
}

/**
 * Change a draft or submitted request.
 *
 * A submitted request that is amended goes back to `DRAFT`: an approver must never approve one
 * thing and have another bought. The audit row carries both versions.
 */
export async function amendRequisition(
  client: any,
  input: {
    businessId: string;
    requisitionId: string;
    actorId?: string | null;
    actorName?: string | null;
    reason?: string | null;
    lines: RequisitionLineInput[];
    title?: string;
    justification?: string | null;
    department?: string | null;
    priority?: string | null;
    neededBy?: Date | string | null;
    supplierId?: string | null;
    supplierName?: string | null;
  },
) {
  const existing = await client.erpRequisition.findFirst({
    where: { id: input.requisitionId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!existing) throw Object.assign(new Error("That request was not found."), { status: 404 });
  const status = normalizeRequisitionStatus(existing.status);
  if (status !== "DRAFT" && status !== "SUBMITTED") {
    throw Object.assign(new Error("Only a draft or submitted request can be amended."), { status: 400 });
  }
  if (input.actorId && String(existing.requestedBy) !== String(input.actorId)) {
    throw Object.assign(new Error("Only the person who raised this request can amend it."), { status: 403 });
  }

  const validation = validateRequisitionInput({
    title: input.title ?? existing.title,
    justification: input.justification ?? existing.justification,
    department: input.department ?? existing.department,
    priority: input.priority ?? existing.priority,
    neededBy: input.neededBy ?? existing.neededBy,
    supplierId: input.supplierId === undefined ? existing.supplierId : input.supplierId,
    supplierName: input.supplierName ?? existing.supplierName,
    lines: input.lines,
  });
  if (!validation.ok) throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  const value = validation.value;

  return client.$transaction(async (tx: any) => {
    await tx.erpRequisitionLine.deleteMany({ where: { businessId: input.businessId, requisitionId: existing.id } });
    const updated = await tx.erpRequisition.update({
      where: { id: existing.id },
      data: {
        title: value.title,
        justification: value.justification,
        department: value.department,
        priority: value.priority,
        neededBy: value.neededBy,
        supplierId: value.supplierId,
        supplierName: value.supplierName,
        estimatedSubtotalCents: value.estimatedSubtotalCents,
        estimatedTaxCents: value.estimatedTaxCents,
        estimatedTotalCents: value.estimatedTotalCents,
        status: "DRAFT",
        submittedAt: null,
        lines: {
          create: value.lines.map((line, index) => ({
            businessId: input.businessId,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            estimatedUnitCostCents: line.estimatedUnitCostCents,
            taxRateBps: line.taxRateBps,
            lineSubtotalCents: line.lineSubtotalCents,
            lineTaxCents: line.lineTaxCents,
            sortOrder: index,
          })),
        },
      },
      include: { lines: true },
    });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      action: "REQUISITION_AMENDED",
      targetType: "REQUISITION",
      targetId: existing.id,
      before: {
        status,
        title: existing.title,
        estimatedTotalCents: Number(existing.estimatedTotalCents ?? 0),
        lines: (existing.lines as any[]).map((line) => ({ description: line.description, quantity: line.quantity, unitCost: line.estimatedUnitCostCents })),
      },
      after: {
        status: "DRAFT",
        title: value.title,
        estimatedTotalCents: value.estimatedTotalCents,
        lines: value.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitCost: line.estimatedUnitCostCents })),
      },
      reason: input.reason ? String(input.reason).slice(0, 500) : null,
      client: tx,
    });

    return updated;
  });
}

/** Put a draft in front of a decision-maker. */
export async function submitRequisition(
  client: any,
  input: { businessId: string; requisitionId: string; actorId?: string | null; actorName?: string | null },
) {
  const request = await client.erpRequisition.findFirst({
    where: { id: input.requisitionId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });
  const transition = requisitionTransitionAllowed(request.status, "SUBMITTED");
  if (!transition.ok) throw Object.assign(new Error(transition.reason ?? "That request cannot be submitted."), { status: 400 });
  if ((request.lines as any[]).length === 0) throw Object.assign(new Error("A request with no lines cannot be submitted."), { status: 400 });

  const updated = await client.erpRequisition.update({
    where: { id: request.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: "REQUISITION_SUBMITTED",
    targetType: "REQUISITION",
    targetId: request.id,
    before: { status: request.status },
    after: { status: "SUBMITTED", estimatedTotalCents: Number(request.estimatedTotalCents ?? 0) },
    client,
  });

  return updated;
}

/**
 * Approve or reject a submitted request.
 *
 * `approverRole` is passed in by the caller from the signed-in workspace role, and it is checked
 * here too: a UI that forgets to hide the button must not be the only thing standing between a
 * viewer and an approval. The requester can never decide their own request.
 */
export async function decideRequisition(
  client: any,
  input: {
    businessId: string;
    requisitionId: string;
    decision: "APPROVE" | "REJECT";
    approverRole: string;
    actorId: string;
    actorName?: string | null;
    note?: string | null;
  },
) {
  const role = normalizeErpRole(input.approverRole);
  if (!hasErpPermission(role, "APPROVE_SPEND")) {
    throw Object.assign(new Error("Your role cannot approve spending."), { status: 403 });
  }
  const request = await client.erpRequisition.findFirst({
    where: { id: input.requisitionId, businessId: input.businessId },
    include: { lines: true },
  });
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });
  if (String(request.requestedBy) === String(input.actorId)) {
    throw Object.assign(new Error("You cannot decide your own request. Somebody else has to approve it."), { status: 403 });
  }
  const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const transition = requisitionTransitionAllowed(request.status, nextStatus);
  if (!transition.ok) throw Object.assign(new Error(transition.reason ?? "That request cannot be decided."), { status: 400 });
  if (input.decision === "REJECT" && String(input.note ?? "").trim().length < 3) {
    throw Object.assign(new Error("Say why the request is being rejected."), { status: 400 });
  }

  const note = input.note ? String(input.note).trim().slice(0, 2000) : null;
  const updated = await client.erpRequisition.update({
    where: { id: request.id },
    data: {
      status: nextStatus,
      decidedBy: input.actorId,
      decidedName: input.actorName ?? null,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName ?? null,
    action: input.decision === "APPROVE" ? "REQUISITION_APPROVED" : "REQUISITION_REJECTED",
    targetType: "REQUISITION",
    targetId: request.id,
    before: { status: request.status },
    after: { status: nextStatus, estimatedTotalCents: Number(request.estimatedTotalCents ?? 0) },
    reason: note,
    client,
  });

  await createNotification(client, {
    businessId: input.businessId,
    kind: "APPROVAL",
    title: `${request.requisitionNumber} ${input.decision === "APPROVE" ? "approved" : "rejected"}`.slice(0, 160),
    body: `${input.actorName ?? "A teammate"} decided your request "${request.title}".${note ? ` Note: ${note.slice(0, 200)}` : ""}`,
    href: `/dashboard/erp/${encodeURIComponent(input.businessId)}/requisitions?request=${request.id}`,
    priority: input.decision === "REJECT" ? "HIGH" : "NORMAL",
    recipientId: String(request.requestedBy),
    sourceType: "REQUISITION",
    sourceId: request.id,
    dedupeKey: `requisition-decision:${request.id}:${nextStatus}`,
    actorId: input.actorId,
    actorName: input.actorName ?? null,
  }).catch(() => null);

  return updated;
}

/**
 * Turn an approved request into a purchase order — once.
 *
 * The order goes through `createPurchaseOrder`, the same path the procurement screen uses, so the
 * stock, tax and approval rules are not re-implemented here. A second attempt returns the order
 * that already exists rather than raising another one.
 */
export async function convertRequisition(
  client: any,
  input: { businessId: string; requisitionId: string; actorId?: string | null; actorName?: string | null; expectedAt?: Date | string | null },
) {
  const request = await client.erpRequisition.findFirst({
    where: { id: input.requisitionId, businessId: input.businessId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });

  if (normalizeRequisitionStatus(request.status) === "CONVERTED") {
    const existing = request.purchaseOrderId
      ? await client.erpPurchaseOrder.findFirst({ where: { id: String(request.purchaseOrderId), businessId: input.businessId } })
      : null;
    return { order: existing, created: false, alreadyConverted: true };
  }
  if (normalizeRequisitionStatus(request.status) !== "APPROVED") {
    throw Object.assign(new Error("Only an approved request can become a purchase order."), { status: 400 });
  }
  if (!request.supplierId) throw Object.assign(new Error("Name the supplier before turning this into an order."), { status: 400 });

  const lines = (request.lines as any[]).map((line) => ({
    productId: line.productId ?? null,
    description: line.description,
    quantity: Number(line.quantity),
    unitCostCents: Number(line.estimatedUnitCostCents),
    taxRateBps: Number(line.taxRateBps),
  }));

  return client.$transaction(async (tx: any) => {
    const created = await createPurchaseOrder(tx, {
      businessId: input.businessId,
      supplierId: String(request.supplierId),
      supplierName: String(request.supplierName ?? "Supplier"),
      expectedAt: input.expectedAt ?? request.neededBy ?? null,
      notes: `From requisition ${request.requisitionNumber}`,
      requestedBy: String(request.requestedBy),
      requestedName: request.requestedName ?? null,
      lines,
    });

    const order = (created as any)?.order ?? created;

    await tx.erpRequisition.update({
      where: { id: request.id },
      data: { status: "CONVERTED", purchaseOrderId: String(order.id) },
    });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      action: "REQUISITION_CONVERTED",
      targetType: "REQUISITION",
      targetId: request.id,
      before: { status: request.status },
      after: { status: "CONVERTED", purchaseOrderId: order.id, orderNumber: order.orderNumber },
      client: tx,
    });

    return { order, created: true, alreadyConverted: false };
  });
}

export async function cancelRequisition(
  client: any,
  input: { businessId: string; requisitionId: string; reason: string; actorId?: string | null; actorName?: string | null },
) {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw Object.assign(new Error("Say why the request is being cancelled."), { status: 400 });
  const request = await client.erpRequisition.findFirst({ where: { id: input.requisitionId, businessId: input.businessId } });
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });
  const transition = requisitionTransitionAllowed(request.status, "CANCELLED");
  if (!transition.ok) throw Object.assign(new Error(transition.reason ?? "That request cannot be cancelled."), { status: 400 });

  const updated = await client.erpRequisition.update({
    where: { id: request.id },
    data: { status: "CANCELLED", cancelledBy: input.actorId ?? null, cancelledAt: new Date(), cancelReason: reason.slice(0, 2000) },
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: "REQUISITION_CANCELLED",
    targetType: "REQUISITION",
    targetId: request.id,
    before: { status: request.status },
    reason,
    client,
  });

  return updated;
}

export async function listRequisitions(client: any, input: { businessId: string; status?: string | null; limit?: number }) {
  const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
  const where: Record<string, unknown> = { businessId: input.businessId };
  if (input.status) where.status = normalizeRequisitionStatus(input.status);
  const rows = await client.erpRequisition.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  return rows as any[];
}

export async function requisitionSummary(client: any, businessId: string) {
  const [draft, submitted, approved, converted, rejected] = await Promise.all([
    client.erpRequisition.count({ where: { businessId, status: "DRAFT" } }).catch(() => 0),
    client.erpRequisition.count({ where: { businessId, status: "SUBMITTED" } }).catch(() => 0),
    client.erpRequisition.count({ where: { businessId, status: "APPROVED" } }).catch(() => 0),
    client.erpRequisition.count({ where: { businessId, status: "CONVERTED" } }).catch(() => 0),
    client.erpRequisition.count({ where: { businessId, status: "REJECTED" } }).catch(() => 0),
  ]);
  return { draft, submitted, approved, converted, rejected };
}

/** Anybody who is not read-only can ask for something. Deciding needs `APPROVE_SPEND`. */
export function canRaiseRequisition(role: string): boolean {
  return normalizeErpRole(role) !== "VIEWER";
}

export function canDecideRequisition(role: string): boolean {
  return hasErpPermission(normalizeErpRole(role), "APPROVE_SPEND");
}
