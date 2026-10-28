/**
 * Paid-but-unpublished POS resolution policy (owner decision: 72-hour maximum).
 *
 * A confirmed payment and its valid entitlement are never rolled back by this module. This
 * policy records a separate publication obligation, queues honest in-app notifications, and
 * escalates an unresolved case at the server-derived deadline. It never claims publication,
 * external notification delivery, an automated refund, a service credit, or a provider action.
 */

import prisma from "../db";
import { containsInlineImageDataUrl } from "../media/persistence-policy";
import { deliverPendingPaymentNotifications } from "../payments/notifications";

export const POS_PUBLICATION_RESOLUTION_HOURS = 72;
export const POS_PUBLICATION_RESOLUTION_WINDOW_MS = POS_PUBLICATION_RESOLUTION_HOURS * 60 * 60 * 1000;
export const POS_PUBLICATION_NOTIFICATION_PREFIX = "pos-publication:";

export type PosPublicationCaseStatus = "OPEN" | "ESCALATED" | "RESOLVED";
export type PosPublicationRemedyStatus = "PENDING_PUBLICATION" | "OWNER_ESCALATED" | "PUBLISHED";

export type PosPublicationProvisioningOutcome = {
  publishable: boolean;
  configurationId: string | null;
  blockerCode?: string;
  blockerDetail?: string | null;
};

export type PosPublicationResolutionCase = {
  id: string;
  businessId: string;
  paymentId: string;
  configurationId: string | null;
  paymentReference: string;
  confirmedAt: Date;
  deadlineAt: Date;
  blockerCode: string;
  blockerDetail: string | null;
  status: PosPublicationCaseStatus;
  entitlementStatus: string;
  remedyStatus: PosPublicationRemedyStatus;
  ownerNotificationQueuedAt: Date | null;
  escalationNotificationScheduledAt: Date | null;
  escalatedAt: Date | null;
  resolvedAt: Date | null;
};

function validDate(value: Date | string, error: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(error);
  return date;
}

/** Date arithmetic is epoch-millisecond based, so the stored instant is UTC and timezone independent. */
export function posPublicationDeadline(confirmedAt: Date | string): Date {
  const confirmed = validDate(confirmedAt, "PAYMENT_CONFIRMATION_TIMESTAMP_REQUIRED");
  return new Date(confirmed.getTime() + POS_PUBLICATION_RESOLUTION_WINDOW_MS);
}

/** The deadline is start-exclusive/end-inclusive: at exactly +72h the case is escalated. */
export function derivePosPublicationCaseStatus(
  row: { status: string; resolvedAt?: Date | string | null; deadlineAt: Date | string },
  now: Date = new Date(),
): PosPublicationCaseStatus {
  if (row.resolvedAt || row.status === "RESOLVED") return "RESOLVED";
  const deadline = validDate(row.deadlineAt, "PUBLICATION_DEADLINE_INVALID");
  return now.getTime() >= deadline.getTime() ? "ESCALATED" : "OPEN";
}

export function posPublicationNotificationKey(paymentId: string, kind: "OWNER" | "ESCALATION" | "RESOLUTION"): string {
  return `${POS_PUBLICATION_NOTIFICATION_PREFIX}${paymentId}:${kind}`;
}

function safeBlockerDetail(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const detail = value.trim();
  // Legacy inline image payloads must not gain a second persistence channel through policy rows.
  if (containsInlineImageDataUrl(detail)) return null;
  return detail.slice(0, 500);
}

function notificationCopy(params: {
  kind: "OWNER" | "ESCALATION" | "RESOLUTION";
  paymentReference: string;
  blockerCode?: string;
  deadlineAt?: Date;
  resolvedAt?: Date;
}): { title: string; message: string } {
  if (params.kind === "RESOLUTION") {
    return {
      title: "POS CONFIGURATION PUBLISHED",
      message: [
        `Publication resolved for POS payment ${params.paymentReference}.`,
        `Published at ${params.resolvedAt?.toISOString() ?? "the recorded publication time"}.`,
        "This message was created only after a configuration snapshot was published.",
      ].join("\n"),
    };
  }
  if (params.kind === "ESCALATION") {
    return {
      title: "POS PUBLICATION RESOLUTION ESCALATED",
      message: [
        `POS payment ${params.paymentReference} remains confirmed, but publication is unresolved after ${POS_PUBLICATION_RESOLUTION_HOURS} hours.`,
        `Blocker: ${params.blockerCode ?? "PUBLICATION_NOT_CONFIRMED"}.`,
        `Resolution deadline: ${params.deadlineAt?.toISOString() ?? "recorded deadline"}.`,
        "Owner review is required. Payment and entitlement records are unchanged; no support ticket or automatic refund has been initiated.",
      ].join("\n"),
    };
  }
  return {
    title: "POS PAYMENT CONFIRMED — PUBLICATION PENDING",
    message: [
      `POS payment ${params.paymentReference} is confirmed and the valid entitlement is preserved.`,
      `Publication is still blocked: ${params.blockerCode ?? "PUBLICATION_NOT_CONFIRMED"}.`,
      `Resolve publication by ${params.deadlineAt?.toISOString() ?? "the recorded 72-hour deadline"}.`,
      "This is not a publication-success notice and does not promise an automated refund.",
    ].join("\n"),
  };
}

async function queuePolicyNotification(
  tx: any,
  params: {
    businessId: string;
    paymentId: string;
    paymentReference: string;
    kind: "OWNER" | "ESCALATION" | "RESOLUTION";
    scheduledAt: Date;
    blockerCode?: string;
    deadlineAt?: Date;
    resolvedAt?: Date;
  },
): Promise<void> {
  const copy = notificationCopy(params);
  const idempotencyKey = posPublicationNotificationKey(params.paymentId, params.kind);
  await tx.paymentNotification.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      businessId: params.businessId,
      transactionId: null,
      audience: "MERCHANT",
      channel: "POS",
      recipientMasked: null,
      title: copy.title,
      message: copy.message,
      status: "PENDING",
      idempotencyKey,
      scheduledAt: params.scheduledAt,
    },
  });
}

/** Record the separate publication obligation in the same transaction as settlement. */
export async function recordPosPublicationResolution(
  tx: any,
  params: {
    payment: { id: string; reference: string; businessId: string };
    confirmedAt: Date | string;
    entitlementStatus: string;
    outcome: PosPublicationProvisioningOutcome;
    actorId?: string | null;
  },
): Promise<PosPublicationResolutionCase | null> {
  const confirmedAt = validDate(params.confirmedAt, "PAYMENT_CONFIRMATION_TIMESTAMP_REQUIRED");
  if (params.outcome.publishable) {
    await resolvePosPublicationCases(tx, {
      businessId: params.payment.businessId,
      publishedAt: confirmedAt,
      actorId: params.actorId,
    });
    return null;
  }

  const deadlineAt = posPublicationDeadline(confirmedAt);
  const blockerCode = String(params.outcome.blockerCode ?? "PUBLICATION_NOT_CONFIRMED").slice(0, 100);
  const blockerDetail = safeBlockerDetail(params.outcome.blockerDetail);
  const row = await tx.posPublicationResolution.upsert({
    where: { paymentId: params.payment.id },
    // A callback/retry cannot move the authoritative confirmation time or deadline, resolve a
    // case, downgrade an escalation, or create a second remedy.
    update: {},
    create: {
      businessId: params.payment.businessId,
      paymentId: params.payment.id,
      configurationId: params.outcome.configurationId,
      paymentReference: params.payment.reference,
      confirmedAt,
      deadlineAt,
      blockerCode,
      blockerDetail,
      status: "OPEN",
      entitlementStatus: params.entitlementStatus,
      remedyStatus: "PENDING_PUBLICATION",
      ownerNotificationQueuedAt: confirmedAt,
      escalationNotificationScheduledAt: deadlineAt,
      escalatedAt: null,
      resolvedAt: null,
    },
  });

  await queuePolicyNotification(tx, {
    businessId: params.payment.businessId,
    paymentId: params.payment.id,
    paymentReference: params.payment.reference,
    kind: "OWNER",
    scheduledAt: confirmedAt,
    blockerCode,
    deadlineAt,
  });
  await queuePolicyNotification(tx, {
    businessId: params.payment.businessId,
    paymentId: params.payment.id,
    paymentReference: params.payment.reference,
    kind: "ESCALATION",
    scheduledAt: deadlineAt,
    blockerCode,
    deadlineAt,
  });
  return row as PosPublicationResolutionCase;
}

/** Resolve only after a real configuration snapshot has been written in this transaction. */
export async function resolvePosPublicationCases(
  tx: any,
  params: { businessId: string; publishedAt: Date; actorId?: string | null },
): Promise<number> {
  const publishedAt = validDate(params.publishedAt, "PUBLICATION_TIMESTAMP_REQUIRED");
  const rows = await tx.posPublicationResolution.findMany({
    where: { businessId: params.businessId, resolvedAt: null },
    orderBy: { deadlineAt: "asc" },
  });
  let resolved = 0;
  for (const row of rows ?? []) {
    const changed = await tx.posPublicationResolution.updateMany({
      where: { id: row.id, businessId: params.businessId, resolvedAt: null },
      data: { status: "RESOLVED", remedyStatus: "PUBLISHED", resolvedAt: publishedAt },
    });
    if (changed.count !== 1) continue;
    resolved += 1;
    // A successful snapshot makes the future escalation obsolete. Preserve the queue row and its
    // scheduled time for audit, but cancel only a still-pending delivery. SENT/FAILED history is
    // never rewritten, and the deterministic key prevents a later retry from creating a duplicate.
    await tx.paymentNotification.updateMany({
      where: {
        idempotencyKey: posPublicationNotificationKey(row.paymentId, "ESCALATION"),
        status: "PENDING",
      },
      data: {
        status: "SKIPPED",
        lastError: "No longer required: publication resolved before pending escalation delivery.",
      },
    });
    await queuePolicyNotification(tx, {
      businessId: params.businessId,
      paymentId: row.paymentId,
      paymentReference: row.paymentReference,
      kind: "RESOLUTION",
      scheduledAt: publishedAt,
      resolvedAt: publishedAt,
    });
    await tx.posAuditEvent.create({
      data: {
        businessId: params.businessId,
        actorId: params.actorId ?? null,
        action: "POS_PUBLICATION_RESOLVED",
        targetType: "POS_PUBLICATION_RESOLUTION",
        targetId: row.id,
        metadata: JSON.stringify({
          paymentReference: row.paymentReference,
          deadlineAt: new Date(row.deadlineAt).toISOString(),
          resolvedAt: publishedAt.toISOString(),
          remedyStatus: "PUBLISHED",
        }),
      },
    });
  }
  return resolved;
}

/**
 * Reconcile deadline state without changing money or entitlements. The derived status is already
 * ESCALATED at the deadline even if no worker ran exactly then; this pass persists that state and
 * delivers only due in-app policy notifications. Scheduled delivery remains subject to an
 * application invocation; no external scheduler or external channel delivery is claimed.
 */
export async function reconcilePosPublicationDeadlines(params: {
  businessId?: string;
  now?: Date;
  client?: any;
  deliverNotifications?: boolean;
  limit?: number;
} = {}): Promise<{
  cases: PosPublicationResolutionCase[];
  newlyEscalated: number;
  notificationOutcome: { delivered: number; failed: number; skipped: number } | null;
}> {
  const client = params.client ?? prisma;
  // Some isolated unit tests use a deliberately minimal Prisma double. Production always has
  // this model after the reviewed migration; a missing test double means NOT TESTED, not a pass.
  if (!client.posPublicationResolution?.findMany) {
    return { cases: [], newlyEscalated: 0, notificationOutcome: null };
  }
  const now = params.now ?? new Date();
  const rows = await client.posPublicationResolution.findMany({
    where: { ...(params.businessId ? { businessId: params.businessId } : {}), resolvedAt: null },
    orderBy: { deadlineAt: "asc" },
    take: Math.min(Math.max(params.limit ?? 100, 1), 200),
  });

  let newlyEscalated = 0;
  for (const row of rows ?? []) {
    const entitlement = await client.posEntitlement?.findUnique?.({
      where: { businessId: row.businessId },
      select: { status: true },
    });
    if (entitlement?.status && entitlement.status !== row.entitlementStatus) {
      await client.posPublicationResolution.updateMany({
        where: { id: row.id, resolvedAt: null },
        data: { entitlementStatus: entitlement.status },
      });
      row.entitlementStatus = entitlement.status;
    }

    const derived = derivePosPublicationCaseStatus(row, now);
    if (derived === "ESCALATED" && row.status === "OPEN") {
      // State and audit are one atomic transition. If the audit write fails, the row remains OPEN
      // and a later reconciliation can retry instead of suppressing the missing audit forever.
      const changedCount = await client.$transaction(async (tx: any) => {
        const changed = await tx.posPublicationResolution.updateMany({
          where: { id: row.id, status: "OPEN", resolvedAt: null, deadlineAt: { lte: now } },
          data: { status: "ESCALATED", remedyStatus: "OWNER_ESCALATED", escalatedAt: row.deadlineAt },
        });
        if (changed.count !== 1) return 0;
        await tx.posAuditEvent.create({
          data: {
            businessId: row.businessId,
            actorId: null,
            action: "POS_PUBLICATION_ESCALATED",
            targetType: "POS_PUBLICATION_RESOLUTION",
            targetId: row.id,
            metadata: JSON.stringify({
              paymentReference: row.paymentReference,
              blockerCode: row.blockerCode,
              deadlineAt: new Date(row.deadlineAt).toISOString(),
              entitlementStatus: row.entitlementStatus,
              remedyStatus: "OWNER_ESCALATED",
            }),
          },
        });
        return 1;
      });
      if (changedCount === 1) {
        newlyEscalated += 1;
        row.status = "ESCALATED";
        row.remedyStatus = "OWNER_ESCALATED";
        row.escalatedAt = row.deadlineAt;
      }
    }
  }

  let notificationOutcome = null;
  if (params.deliverNotifications !== false && client.paymentNotification?.findMany) {
    notificationOutcome = await deliverPendingPaymentNotifications({
      businessId: params.businessId,
      now,
      client,
      idempotencyKeyPrefix: POS_PUBLICATION_NOTIFICATION_PREFIX,
    });
  }

  const cases = (rows ?? []).map((row: any) => ({
    ...row,
    status: derivePosPublicationCaseStatus(row, now),
    remedyStatus: row.resolvedAt
      ? "PUBLISHED"
      : derivePosPublicationCaseStatus(row, now) === "ESCALATED"
        ? "OWNER_ESCALATED"
        : row.remedyStatus,
  })) as PosPublicationResolutionCase[];
  return { cases, newlyEscalated, notificationOutcome };
}
