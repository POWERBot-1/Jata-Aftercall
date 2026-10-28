/**
 * Approvals — a request for permission, and the decision on it.
 *
 * Why this exists: the platform already had approval *limits* (`ERP_APPROVAL_LIMITS_CENTS`) applied
 * inline wherever money moves. That is a check, not a workflow: there was no record of somebody
 * asking, nobody could be asked, and "who approved this" could only be inferred from an audit row.
 * One object fixes that for expenses, purchases, journals, discounts and, later, procurement.
 *
 * Rules this module enforces on the server, never in the UI:
 *   • the requester and the decider must both be in the tenant the row belongs to;
 *   • nobody decides their own request, whatever their role;
 *   • the decider needs `APPROVE_SPEND` **and** the amount must be inside their limit, unless the
 *     request is addressed to them by name with a role that carries an unlimited limit;
 *   • a decided request is terminal — a mistake is corrected by a new request, not by editing history;
 *   • every transition appends an `ErpApprovalEvent`, so the history is a record and not a guess.
 */

import { logErpAudit } from "./audit";
import { approvalDecision, ERP_APPROVAL_LIMITS_CENTS, hasErpPermission, normalizeErpRole, type ErpRole } from "./access";
import { createNotification } from "./notifications";

export const APPROVAL_KINDS = ["SPEND", "PURCHASE", "JOURNAL", "DISCOUNT", "CAMPAIGN", "OTHER"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  SPEND: "Spending",
  PURCHASE: "Purchase order",
  JOURNAL: "Journal entry",
  DISCOUNT: "Discount",
  CAMPAIGN: "Campaign",
  OTHER: "Other",
};

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export function normalizeApprovalKind(raw: unknown): ApprovalKind {
  const value = String(raw ?? "").toUpperCase();
  return (APPROVAL_KINDS as readonly string[]).includes(value) ? (value as ApprovalKind) : "OTHER";
}

export function normalizeApprovalStatus(raw: unknown): ApprovalStatus {
  const value = String(raw ?? "").toUpperCase();
  return (APPROVAL_STATUSES as readonly string[]).includes(value) ? (value as ApprovalStatus) : "PENDING";
}

export function isTerminalApprovalStatus(status: unknown): boolean {
  const value = normalizeApprovalStatus(status);
  return value !== "PENDING";
}

export type ApprovalInput = {
  /** Optional: an unset or unknown kind is stored as OTHER rather than rejecting the request. */
  kind?: string;
  title: string;
  detail?: string | null;
  amountCents: number;
  approverRole?: string | null;
  approverId?: string | null;
  href?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  idempotencyKey?: string | null;
};

export type ApprovalValue = {
  kind: ApprovalKind;
  title: string;
  detail: string | null;
  amountCents: number;
  approverRole: string;
  approverId: string | null;
  href: string | null;
  sourceType: string | null;
  sourceId: string | null;
  idempotencyKey: string | null;
};

export type ApprovalValidation = { ok: boolean; errors: string[]; value: ApprovalValue };

/** Anything a person can type is validated here: title length, a whole-cents amount, an in-app link. */
export function validateApprovalInput(input: Partial<ApprovalInput>): ApprovalValidation {
  const errors: string[] = [];
  const title = String(input.title ?? "").trim();
  const detail = input.detail === null || input.detail === undefined ? null : String(input.detail).trim();
  if (title.length < 3 || title.length > 160) errors.push("Give the request a title of 3 to 160 characters.");
  if (detail && detail.length > 4000) errors.push("Keep the detail under 4,000 characters.");

  const rawAmount = Number(input.amountCents ?? 0);
  if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount < 0) {
    errors.push("Enter the amount in whole cents, or leave it at zero.");
  }

  const href = input.href === null || input.href === undefined || String(input.href).trim() === "" ? null : String(input.href).trim();
  if (href && (!href.startsWith("/") || href.startsWith("//"))) errors.push("A request link must point inside this workspace.");

  const approverRole = normalizeErpRole(input.approverRole ?? "OWNER");
  if (approverRole === "VIEWER") errors.push("A viewer cannot approve anything. Address the request to an owner, admin, manager or finance lead.");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      kind: normalizeApprovalKind(input.kind),
      title,
      detail,
      amountCents: Number.isFinite(rawAmount) && Number.isInteger(rawAmount) && rawAmount >= 0 ? rawAmount : 0,
      approverRole,
      approverId: input.approverId ? String(input.approverId) : null,
      href,
      sourceType: input.sourceType ? String(input.sourceType).slice(0, 40) : null,
      sourceId: input.sourceId ? String(input.sourceId).slice(0, 60) : null,
      idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey).slice(0, 200) : null,
    },
  };
}

/**
 * May this person decide this request? Pure, so the queue and the server action cannot disagree.
 * Returns a reason a person can read, never a bare boolean.
 */
export function approvalAuthority(params: {
  request: { requestedBy: string; approverRole?: string | null; approverId?: string | null; amountCents?: number | null; status?: string | null };
  decider: { userId: string; role: string };
  thresholdCents?: number;
}): { allowed: boolean; reason: string } {
  const status = normalizeApprovalStatus(params.request.status);
  if (status !== "PENDING") return { allowed: false, reason: "This request has already been decided." };
  if (params.request.requestedBy === params.decider.userId) {
    return { allowed: false, reason: "You cannot approve your own request. Ask somebody else." };
  }
  const role = normalizeErpRole(params.decider.role);
  if (!hasErpPermission(role, "APPROVE_SPEND")) {
    return { allowed: false, reason: "Your role cannot approve spending." };
  }
  if (params.request.approverId && params.request.approverId !== params.decider.userId) {
    return { allowed: false, reason: "This request was addressed to somebody else." };
  }
  const requestedRole = normalizeErpRole(params.request.approverRole ?? "OWNER");
  // A request addressed to a named person is still bound by that person's limit; a request addressed
  // to a role may be decided by anybody at or above it who has the permission.
  const decision = approvalDecision({
    role,
    amountCents: Number(params.request.amountCents ?? 0),
    thresholdCents: params.thresholdCents,
    separationOfDuties: false,
  });
  if (!decision.allowed) return decision;
  if (!params.request.approverId && roleRank(role) < roleRank(requestedRole)) {
    return { allowed: false, reason: `This request is for a ${requestedRole.toLowerCase()} decision.` };
  }
  return { allowed: true, reason: "You can decide this request." };
}

/** Higher rank decides a request addressed to a lower role. Owners sit at the top. */
function roleRank(role: ErpRole): number {
  const order: ErpRole[] = ["VIEWER", "STAFF", "FINANCE", "MANAGER", "ADMIN", "OWNER"];
  return order.indexOf(role);
}

export type CreateApprovalInput = ApprovalInput & {
  businessId: string;
  requestedBy: string;
  requestedName?: string | null;
  requestedRole?: string | null;
  actorName?: string | null;
};

/** Raise a request. Idempotent when a key is supplied; the unique index is the arbiter. */
export async function createApprovalRequest(client: any, input: CreateApprovalInput) {
  const validation = validateApprovalInput(input);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  }
  const value = validation.value;

  if (value.idempotencyKey) {
    const existing = await client.erpApprovalRequest
      .findUnique({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: value.idempotencyKey } } })
      .catch(() => null);
    if (existing) return { request: existing, created: false, deduplicated: true };
  }

  let request;
  try {
    request = await client.erpApprovalRequest.create({
      data: {
        businessId: input.businessId,
        kind: value.kind,
        title: value.title,
        detail: value.detail ?? null,
        amountCents: value.amountCents,
        status: "PENDING",
        requestedBy: input.requestedBy,
        requestedName: input.requestedName ?? null,
        requestedRole: input.requestedRole ? normalizeErpRole(input.requestedRole) : null,
        approverRole: value.approverRole,
        approverId: value.approverId ?? null,
        sourceType: value.sourceType ?? null,
        sourceId: value.sourceId ?? null,
        href: value.href ?? null,
        idempotencyKey: value.idempotencyKey ?? null,
      },
    });
  } catch (error: any) {
    if (value.idempotencyKey && String(error?.code ?? "") === "P2002") {
      const existing = await client.erpApprovalRequest.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: value.idempotencyKey } },
      });
      if (existing) return { request: existing, created: false, deduplicated: true };
    }
    throw error;
  }

  await recordEvent(client, {
    businessId: input.businessId,
    requestId: request.id,
    action: "REQUESTED",
    actorId: input.requestedBy,
    actorName: input.requestedName ?? input.actorName ?? null,
    note: value.detail ?? null,
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.requestedBy,
    actorName: input.requestedName ?? input.actorName ?? null,
    action: "APPROVAL_REQUESTED",
    targetType: "APPROVAL",
    targetId: request.id,
    after: { kind: request.kind, amountCents: request.amountCents, approverRole: request.approverRole, approverId: request.approverId },
    client,
  });

  // The decider is told. A named decider gets a personal notice; a role gets a broadcast one.
  await createNotification(client, {
    businessId: input.businessId,
    kind: "APPROVAL_REQUESTED",
    title: `Approval needed: ${request.title}`.slice(0, 160),
    body: request.amountCents > 0
      ? `KES ${(request.amountCents / 100).toLocaleString("en-KE")} — asked by ${input.requestedName ?? "a teammate"}.`
      : `Asked by ${input.requestedName ?? "a teammate"}.`,
    href: request.href ?? `/dashboard/erp/${encodeURIComponent(input.businessId)}/approvals`,
    priority: "HIGH",
    recipientId: request.approverId ?? null,
    audienceRole: request.approverId ? "ALL" : String(request.approverRole),
    sourceType: "APPROVAL",
    sourceId: request.id,
    dedupeKey: `approval-requested:${request.id}`,
    actorId: input.requestedBy,
    actorName: input.requestedName ?? null,
  }).catch(() => null);

  return { request, created: true, deduplicated: false };
}

/** Decide a pending request. Approve or reject; both need a note for reject. */
export async function decideApprovalRequest(
  client: any,
  input: {
    businessId: string;
    requestId: string;
    decision: "APPROVE" | "REJECT";
    note?: string | null;
    decider: { userId: string; role: string; name?: string | null };
    thresholdCents?: number;
  },
) {
  const request = await client.erpApprovalRequest
    .findFirst({ where: { id: input.requestId, businessId: input.businessId } })
    .catch(() => null);
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });

  const note = String(input.note ?? "").trim();
  if (input.decision === "REJECT" && note.length < 3) {
    throw Object.assign(new Error("Say why you are rejecting it."), { status: 400 });
  }
  const authority = approvalAuthority({
    request,
    decider: { userId: input.decider.userId, role: input.decider.role },
    thresholdCents: input.thresholdCents,
  });
  if (!authority.allowed) throw Object.assign(new Error(authority.reason), { status: 403 });

  const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const updated = await client.erpApprovalRequest.update({
    where: { id: request.id },
    data: {
      status,
      decidedBy: input.decider.userId,
      decidedName: input.decider.name ?? null,
      decidedRole: normalizeErpRole(input.decider.role),
      decidedAt: new Date(),
      decisionNote: note || null,
    },
  });

  await recordEvent(client, {
    businessId: input.businessId,
    requestId: request.id,
    action: status,
    actorId: input.decider.userId,
    actorName: input.decider.name ?? null,
    note: note || null,
  });

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.decider.userId,
    actorName: input.decider.name ?? null,
    action: status === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
    targetType: "APPROVAL",
    targetId: request.id,
    reason: note || null,
    before: { status: request.status },
    after: { status, amountCents: request.amountCents },
    client,
  });

  await createNotification(client, {
    businessId: input.businessId,
    kind: "APPROVAL_DECIDED",
    title: `${status === "APPROVED" ? "Approved" : "Rejected"}: ${request.title}`.slice(0, 160),
    body: note ? `${input.decider.name ?? "A teammate"}: ${note}` : `${input.decider.name ?? "A teammate"} decided this request.`,
    href: request.href ?? `/dashboard/erp/${encodeURIComponent(input.businessId)}/approvals`,
    priority: status === "REJECTED" ? "HIGH" : "NORMAL",
    recipientId: request.requestedBy,
    audienceRole: "ALL",
    sourceType: "APPROVAL",
    sourceId: request.id,
    dedupeKey: `approval-decided:${request.id}`,
    actorId: input.decider.userId,
    actorName: input.decider.name ?? null,
  }).catch(() => null);

  return { request: updated, status };
}

/** The requester may take a request back while it is still waiting. Nobody else may. */
export async function withdrawApprovalRequest(
  client: any,
  input: { businessId: string; requestId: string; requester: { userId: string; name?: string | null }; note?: string | null },
) {
  const request = await client.erpApprovalRequest
    .findFirst({ where: { id: input.requestId, businessId: input.businessId } })
    .catch(() => null);
  if (!request) throw Object.assign(new Error("That request was not found."), { status: 404 });
  if (request.requestedBy !== input.requester.userId) {
    throw Object.assign(new Error("Only the person who asked can withdraw a request."), { status: 403 });
  }
  if (isTerminalApprovalStatus(request.status)) {
    throw Object.assign(new Error("That request has already been decided."), { status: 400 });
  }

  const updated = await client.erpApprovalRequest.update({
    where: { id: request.id },
    data: { status: "WITHDRAWN", decidedBy: input.requester.userId, decidedAt: new Date(), decisionNote: String(input.note ?? "").trim() || null },
  });
  await recordEvent(client, {
    businessId: input.businessId,
    requestId: request.id,
    action: "WITHDRAWN",
    actorId: input.requester.userId,
    actorName: input.requester.name ?? null,
    note: input.note ?? null,
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.requester.userId,
    actorName: input.requester.name ?? null,
    action: "APPROVAL_WITHDRAWN",
    targetType: "APPROVAL",
    targetId: request.id,
    client,
  });
  return { request: updated };
}

async function recordEvent(client: any, input: { businessId: string; requestId: string; action: string; actorId?: string | null; actorName?: string | null; note?: string | null }) {
  await client.erpApprovalEvent
    .create({
      data: {
        businessId: input.businessId,
        requestId: input.requestId,
        action: input.action,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        note: input.note ?? null,
      },
    })
    .catch(() => null); // history must not block the decision, and the audit row covers the decision
}

/**
 * Does recording this amount need somebody to sign for it first?
 *
 * Pure and derived from the same limits the decision path uses, so the button a person sees and the
 * check the server runs cannot disagree. `restricted` means "raise a request"; it never means
 * "refused" — the person is still allowed to ask.
 */
export function spendGate(role: string, amountCents: number, thresholdCents?: number): { restricted: boolean; limitCents: number; reason: string | null } {
  const normalized = normalizeErpRole(role);
  const roleLimit = approvalLimitFor(normalized);
  const limitCents = Math.min(thresholdCents ?? Number.MAX_SAFE_INTEGER, roleLimit);
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (amount <= limitCents) return { restricted: false, limitCents, reason: null };
  const limit = (limitCents / 100).toLocaleString("en-KE");
  return {
    restricted: true,
    limitCents,
    reason: roleLimit === 0
      ? "Your role cannot record spending on its own. It has to be approved first."
      : `This is above the KES ${limit} your role may sign for. It has to be approved first.`,
  };
}

/** Which role a request from this person should go to. Never the requester's own role. */
export function escalationRoleFor(role: string): string {
  const normalized = normalizeErpRole(role);
  if (normalized === "MANAGER" || normalized === "FINANCE") return "ADMIN";
  return "OWNER";
}

export type ConsumeApprovalInput = {
  businessId: string;
  /** Only the person who asked may spend their own grant. */
  requesterId: string;
  kind: string;
  amountCents: number;
  actorId?: string | null;
  actorName?: string | null;
  /** What the grant is being spent on, stored on the row so the trail can be followed both ways. */
  ref: string;
  thresholdCents?: number;
};

/**
 * Spend a grant on the action it authorised.
 *
 * Two rules make this safe under a double submit: the candidate must still be unconsumed when it is
 * picked, and the write is conditional on `consumedAt IS NULL` (updateMany, so a lost race writes
 * nothing instead of overwriting). Returns the request when the grant was taken, or null when there
 * is nothing to spend — the caller then raises a new request rather than posting.
 */
export async function consumeApproval(client: any, input: ConsumeApprovalInput) {
  const amount = Math.max(0, Math.round(Number(input.amountCents) || 0));
  const candidates = await client.erpApprovalRequest
    .findMany({
      where: {
        businessId: input.businessId,
        requestedBy: input.requesterId,
        kind: normalizeApprovalKind(input.kind),
        status: "APPROVED",
        consumedAt: null,
        amountCents: { gte: amount },
      },
      orderBy: [{ decidedAt: "asc" }, { createdAt: "asc" }],
      take: 5,
    })
    .catch(() => []);

  for (const candidate of candidates as any[]) {
    // The decider's own limit was checked when they approved; a tenant threshold still applies to the
    // amount actually being spent.
    if (input.thresholdCents !== undefined && amount > input.thresholdCents) continue;
    const taken = await client.erpApprovalRequest
      .updateMany({
        where: { id: candidate.id, businessId: input.businessId, status: "APPROVED", consumedAt: null },
        data: { consumedAt: new Date(), consumedBy: input.actorId ?? input.requesterId, consumedRef: String(input.ref).slice(0, 200) },
      })
      .catch(() => ({ count: 0 }));
    if (Number(taken?.count ?? 0) !== 1) continue;

    await recordEvent(client, {
      businessId: input.businessId,
      requestId: candidate.id,
      action: "CONSUMED",
      actorId: input.actorId ?? input.requesterId,
      actorName: input.actorName ?? null,
      note: String(input.ref).slice(0, 200),
    });
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? input.requesterId,
      actorName: input.actorName ?? null,
      action: "APPROVAL_CONSUMED",
      targetType: "APPROVAL",
      targetId: candidate.id,
      after: { amountCents: amount, ref: String(input.ref).slice(0, 200) },
      client,
    });
    const fresh = await client.erpApprovalRequest.findFirst({ where: { id: candidate.id, businessId: input.businessId } }).catch(() => null);
    return fresh ?? { ...candidate, consumedRef: String(input.ref).slice(0, 200) };
  }
  return null;
}

/**
 * The barrier a consequential action calls before it writes money.
 *
 * Either an existing grant covers the amount (and is spent by the caller) or a request is raised and
 * nothing is written. Returns the shape a server action can redirect on, with the reason a person
 * can read.
 */
export async function requireApprovalFor(input: {
  client: any;
  businessId: string;
  requester: { userId: string; name?: string | null; role: string };
  kind: string;
  amountCents: number;
  title: string;
  detail?: string | null;
  href?: string | null;
  ref: string;
  thresholdCents?: number;
  actorName?: string | null;
}) {
  const gate = spendGate(input.requester.role, input.amountCents, input.thresholdCents);
  if (!gate.restricted) return { blocked: false as const, gate };
  const consumed = await consumeApproval(input.client, {
    businessId: input.businessId,
    requesterId: input.requester.userId,
    kind: input.kind,
    amountCents: input.amountCents,
    actorId: input.requester.userId,
    actorName: input.actorName ?? input.requester.name ?? null,
    ref: input.ref,
    thresholdCents: input.thresholdCents,
  });
  if (consumed) return { blocked: false as const, gate, consumed };
  const raised = await createApprovalRequest(input.client, {
    businessId: input.businessId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    amountCents: input.amountCents,
    requestedBy: input.requester.userId,
    requestedName: input.requester.name ?? input.actorName ?? null,
    requestedRole: input.requester.role,
    approverRole: escalationRoleFor(input.requester.role),
    href: input.href ?? null,
    idempotencyKey: `gate:${input.ref}`,
  });
  return { blocked: true as const, gate, request: raised.request, deduplicated: raised.deduplicated };
}

/** The queue: what is waiting, newest first, plus what this person may decide. Tenant-scoped. */
export async function listApprovalRequests(
  client: any,
  input: {
    businessId: string;
    decider: { userId: string; role: string };
    status?: string | null;
    limit?: number;
    /** `mine` limits the read to what this person asked for or was addressed by name. */
    scope?: "all" | "mine";
  },
) {
  const limit = Math.min(Math.max(Number(input.limit ?? 100), 1), 200);
  const where: Record<string, unknown> = { businessId: input.businessId };
  if (input.status) where.status = normalizeApprovalStatus(input.status);
  if (input.scope === "mine") {
    where.OR = [{ requestedBy: input.decider.userId }, { approverId: input.decider.userId }];
  }
  const rows = await client.erpApprovalRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
  return (rows as any[]).map((row) => ({
    ...row,
    canDecide: approvalAuthority({ request: row, decider: input.decider }).allowed,
  }));
}

export async function approvalSummary(
  client: any,
  businessId: string,
  options: { viewer?: { userId: string; role: string }; scope?: "all" | "mine" } = {},
) {
  const scope = options.scope === "mine" && options.viewer
    ? { OR: [{ requestedBy: options.viewer.userId }, { approverId: options.viewer.userId }] }
    : {};
  const [pending, approved, rejected] = await Promise.all([
    client.erpApprovalRequest.count({ where: { businessId, status: "PENDING", ...scope } }).catch(() => 0),
    client.erpApprovalRequest.count({ where: { businessId, status: "APPROVED", ...scope } }).catch(() => 0),
    client.erpApprovalRequest.count({ where: { businessId, status: "REJECTED", ...scope } }).catch(() => 0),
  ]);
  return { pending, approved, rejected };
}

/** How much this role may approve without escalation. Shown in the UI and used by the domain. */
export function approvalLimitFor(role: string): number {
  return ERP_APPROVAL_LIMITS_CENTS[normalizeErpRole(role)] ?? 0;
}
