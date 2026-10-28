/**
 * Notifications — the in-app inbox for POS / ERP - PRO.
 *
 * What this module is responsible for:
 *   • one tenant-scoped row per thing somebody should know about, with a destination and a source,
 *   • per-person read state (`ErpNotificationRead`), so a shared notice is not marked read for the
 *     whole team when one person opens it,
 *   • deduplication through a unique `(businessId, dedupeKey)` index, so a retried job or a swept
 *     page cannot notify the same person twice about the same event,
 *   • an honest delivery record. This release is **in-app only**: nothing is sent to SMS, WhatsApp or
 *     email, and a row says so (`deliveryStatus`). The external path exists as a decision function
 *     that refuses unless a provider is genuinely configured, and it records the refusal rather than
 *     pretending a message went out.
 *
 * What it is not: a marketing channel. Campaign delivery lives in `lib/messaging/*` and is a separate,
 * paid, consent-checked path.
 */

import { logErpAudit } from "./audit";

export const NOTIFICATION_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_PRIORITY_LABELS: Record<NotificationPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

/**
 * A closed set of kinds, so the UI can label a notice and the tests can assert on it. "SYSTEM" covers
 * anything that does not have a domain meaning yet; it is deliberately the last resort.
 */
export const NOTIFICATION_KINDS = [
  "TASK_ASSIGNED",
  "TASK_OVERDUE",
  "TASK_COMPLETED",
  "STORE_ORDER",
  "INVOICE_OVERDUE",
  "MESSAGING_CAMPAIGN_FINISHED",
  "AUTOMATION_NOTICE",
  "AUTOMATION_SUGGEST_PURCHASE",
  "APPROVAL_REQUESTED",
  "APPROVAL_DECIDED",
  "COMPLIANCE_EXPIRING",
  "SYSTEM",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  TASK_ASSIGNED: "Work assigned to you",
  TASK_OVERDUE: "Work is overdue",
  TASK_COMPLETED: "Work completed",
  STORE_ORDER: "Online order",
  INVOICE_OVERDUE: "Invoice overdue",
  MESSAGING_CAMPAIGN_FINISHED: "Campaign finished",
  AUTOMATION_NOTICE: "Automation notice",
  AUTOMATION_SUGGEST_PURCHASE: "Purchase suggestion",
  APPROVAL_REQUESTED: "Approval needed",
  APPROVAL_DECIDED: "Approval decided",
  COMPLIANCE_EXPIRING: "Compliance expiring",
  SYSTEM: "System notice",
};

export const DELIVERY_STATUSES = ["IN_APP", "SKIPPED", "QUEUED", "SENT", "FAILED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export function notificationKind(raw: unknown): NotificationKind {
  const value = String(raw ?? "").toUpperCase();
  return (NOTIFICATION_KINDS as readonly string[]).includes(value) ? (value as NotificationKind) : "SYSTEM";
}

export function normalizeNotificationPriority(raw: unknown): NotificationPriority {
  const value = String(raw ?? "").toUpperCase();
  return (NOTIFICATION_PRIORITIES as readonly string[]).includes(value) ? (value as NotificationPriority) : "NORMAL";
}

export function isActionablePriority(priority: unknown): boolean {
  const value = normalizeNotificationPriority(priority);
  return value === "HIGH" || value === "URGENT";
}

export type NotificationInput = {
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  priority?: string | null;
  audienceRole?: string | null;
  recipientId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  dedupeKey?: string | null;
};

export type NotificationValidation = { ok: boolean; errors: string[]; value: Required<Omit<NotificationInput, "href" | "recipientId" | "sourceType" | "sourceId" | "dedupeKey">> & NotificationInput };

const AUDIENCE_ROLES = ["OWNER", "ADMIN", "MANAGER", "FINANCE", "STAFF", "VIEWER", "ALL"];

/**
 * Validation for everything that can be written from user input. Titles are short because they are
 * read in a bell menu; bodies carry the detail. A link must be a path inside this application — an
 * absolute URL in a notification is an open redirect waiting for a careless click.
 */
export function validateNotificationInput(input: Partial<NotificationInput>): NotificationValidation {
  const errors: string[] = [];
  const title = String(input.title ?? "").trim();
  const body = String(input.body ?? "").trim();
  const kind = notificationKind(input.kind);
  if (title.length < 3 || title.length > 160) errors.push("Give the notification a title of 3 to 160 characters.");
  if (body.length < 3 || body.length > 4000) errors.push("Give the notification a body of 3 to 4,000 characters.");

  const href = input.href === null || input.href === undefined || String(input.href).trim() === "" ? null : String(input.href).trim();
  if (href && (!href.startsWith("/") || href.startsWith("//"))) errors.push("A notification link must point inside this workspace.");

  const audienceRole = String(input.audienceRole ?? "OWNER").toUpperCase();
  if (!AUDIENCE_ROLES.includes(audienceRole)) errors.push("Choose who should see this notification.");

  const priority = normalizeNotificationPriority(input.priority);
  const recipientId = input.recipientId ? String(input.recipientId) : null;
  const dedupeKey = input.dedupeKey ? String(input.dedupeKey).slice(0, 200) : null;

  return {
    ok: errors.length === 0,
    errors,
    value: {
      kind,
      title,
      body,
      href,
      priority,
      audienceRole,
      recipientId,
      sourceType: input.sourceType ? String(input.sourceType).slice(0, 40) : null,
      sourceId: input.sourceId ? String(input.sourceId).slice(0, 60) : null,
      dedupeKey,
    },
  };
}

/**
 * Who may see a notification. Pure, so the rule that the database query and the page both depend on
 * is testable without a database:
 *   • a row addressed to a person is theirs alone;
 *   • a broadcast row is visible to its audience role, or to everybody when the role is ALL;
 *   • owners and admins see broadcast rows addressed to any role, because they run the workspace.
 */
export function notificationVisibleTo(
  notification: { recipientId?: string | null; audienceRole?: string | null },
  viewer: { userId: string; role: string },
): boolean {
  const recipient = notification.recipientId ? String(notification.recipientId) : null;
  if (recipient) return recipient === viewer.userId;
  const audience = String(notification.audienceRole ?? "OWNER").toUpperCase();
  if (audience === "ALL") return true;
  const role = String(viewer.role ?? "VIEWER").toUpperCase();
  if (role === "OWNER" || role === "ADMIN") return true;
  return audience === role;
}

/** True when this person has already read it, by per-person row or by the legacy broadcast flag. */
export function notificationIsRead(
  notification: { readAt?: Date | string | null; reads?: Array<{ userId: string }> | null; recipientId?: string | null },
  viewer: { userId: string; role: string },
): boolean {
  if (Array.isArray(notification.reads) && notification.reads.some((read) => read.userId === viewer.userId)) return true;
  // A legacy broadcast row that was marked read before per-person state existed: treat it as read
  // for everybody, which is what it meant at the time.
  if (!notification.recipientId && notification.readAt) return true;
  return false;
}

/**
 * Delivery decision. This release sends nothing outside the product. The function returns the status
 * to store and a reason a person can read, so a queued/sent claim can never be written by accident.
 */
export function deliveryDecision(input: {
  /** A configured, active provider connection for this tenant, if one exists. */
  channel?: { channel: string; status: string } | null;
  /** Explicit opt-in for out-of-product delivery. Off unless an operator turns it on. */
  dispatchEnabled?: boolean;
  recipientPhone?: string | null;
}): { status: DeliveryStatus; channel: string | null; reason: string } {
  const channel = input.channel ?? null;
  if (!channel || String(channel.status).toUpperCase() !== "ACTIVE") {
    return { status: "IN_APP", channel: null, reason: "In-app only; no delivery provider is connected for this workspace." };
  }
  if (!input.dispatchEnabled) {
    return {
      status: "SKIPPED",
      channel: channel.channel,
      reason: "In-app only in this release. A provider is connected but out-of-product delivery is switched off.",
    };
  }
  if (!input.recipientPhone) {
    return { status: "FAILED", channel: channel.channel, reason: "No phone number on this account, so nothing could be sent." };
  }
  // Even with a provider and an opt-in, this build does not send: the send path belongs to the paid
  // messaging pipeline, which checks consent and charges the wallet. Saying so is the honest answer.
  return { status: "SKIPPED", channel: channel.channel, reason: "Out-of-product delivery for notifications is not implemented; use a campaign instead." };
}

export type CreateNotificationInput = NotificationInput & {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  /** Optional provider facts, used only to record an honest delivery status. */
  channel?: { channel: string; status: string } | null;
  dispatchEnabled?: boolean;
  recipientPhone?: string | null;
};

/**
 * Create a notification. Idempotent when `dedupeKey` is supplied: the unique index is the
 * concurrency-safe arbiter, and the loser of a race returns the winner's row instead of erroring.
 * Never throws on a duplicate; throws on invalid input, because that is a programming error.
 */
export async function createNotification(client: any, input: CreateNotificationInput) {
  const validation = validateNotificationInput(input);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  }
  const value = validation.value;

  if (value.dedupeKey) {
    const existing = await client.erpNotification
      .findUnique({ where: { businessId_dedupeKey: { businessId: input.businessId, dedupeKey: value.dedupeKey } } })
      .catch(() => null);
    if (existing) return { notification: existing, created: false, deduplicated: true };
  }

  const decision = deliveryDecision({
    channel: input.channel ?? null,
    dispatchEnabled: input.dispatchEnabled ?? false,
    recipientPhone: input.recipientPhone ?? null,
  });

  let notification;
  try {
    notification = await client.erpNotification.create({
      data: {
        businessId: input.businessId,
        kind: value.kind,
        title: value.title,
        body: value.body,
        href: value.href ?? null,
        priority: value.priority,
        audienceRole: value.audienceRole,
        recipientId: value.recipientId ?? null,
        sourceType: value.sourceType ?? null,
        sourceId: value.sourceId ?? null,
        dedupeKey: value.dedupeKey ?? null,
        deliveryStatus: decision.status,
        deliveryChannel: decision.channel,
        deliveryError: decision.status === "FAILED" ? decision.reason : null,
        deliveredAt: null,
      },
    });
  } catch (error: any) {
    if (value.dedupeKey && String(error?.code ?? "") === "P2002") {
      const existing = await client.erpNotification.findUnique({
        where: { businessId_dedupeKey: { businessId: input.businessId, dedupeKey: value.dedupeKey } },
      });
      if (existing) return { notification: existing, created: false, deduplicated: true };
    }
    throw error;
  }

  // Delivery that did not happen is recorded and audited; a successful in-app write is not audited,
  // because the row itself is the record and an audit row per notice would drown the trail.
  if (decision.status === "FAILED") {
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      action: "NOTIFICATION_DELIVERY_FAILED",
      targetType: "NOTIFICATION",
      targetId: notification.id,
      outcome: "FAILED",
      reason: decision.reason,
      client,
    });
  }

  return { notification, created: true, deduplicated: false, delivery: decision };
}

/** Notify the person a task was given to. Deduplicated per task, so a retry cannot repeat it. */
export async function notifyTaskAssigned(
  client: any,
  input: { businessId: string; task: { id: string; title: string; priority?: string | null; dueAt?: Date | string | null; href?: string | null; assignedTo?: string | null }; actorId?: string | null; actorName?: string | null },
) {
  if (!input.task.assignedTo) return null;
  return createNotification(client, {
    businessId: input.businessId,
    kind: "TASK_ASSIGNED",
    title: `Assigned to you: ${input.task.title}`.slice(0, 160),
    body: input.task.dueAt
      ? `Due ${new Date(input.task.dueAt).toISOString().slice(0, 10)}. Open the board to start or finish it.`
      : "No due date. Open the board to start or finish it.",
    href: input.task.href ?? `/dashboard/erp/${encodeURIComponent(input.businessId)}/tasks`,
    priority: input.task.priority ?? "NORMAL",
    recipientId: input.task.assignedTo,
    audienceRole: "ALL",
    sourceType: "TASK",
    sourceId: input.task.id,
    // The assignee is part of the key: work reassigned to a second person notifies them too, while a
    // retry of the same assignment to the same person never repeats.
    dedupeKey: `task-assigned:${input.task.id}:${input.task.assignedTo}`,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
  }).catch(() => null); // a notification must never break the task write
}

/**
 * Raise one overdue notice per task per day, for the person who owns it (or the owner role when the
 * task has no named assignee). Called from the dashboard sweep; dedupe keys make repeated page loads
 * free.
 */
export async function notifyTaskOverdue(
  client: any,
  input: { businessId: string; task: any; now?: Date },
) {
  const now = input.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  return createNotification(client, {
    businessId: input.businessId,
    kind: "TASK_OVERDUE",
    title: `Overdue: ${input.task.title}`.slice(0, 160),
    body: `This was due ${new Date(input.task.dueAt).toISOString().slice(0, 10)} and is still ${String(input.task.status).toLowerCase().replace(/_/g, " ")}.`,
    href: input.task.href ?? `/dashboard/erp/${encodeURIComponent(input.businessId)}/tasks`,
    priority: "HIGH",
    recipientId: input.task.assignedTo ?? null,
    audienceRole: input.task.assignedTo ? "ALL" : (input.task.assignedRole ?? "OWNER"),
    sourceType: "TASK",
    sourceId: input.task.id,
    dedupeKey: `task-overdue:${input.task.id}:${day}`,
  }).catch(() => null);
}

/**
 * Sweep open, overdue tasks for a tenant and notify once per task per day. Bounded, tenant-scoped and
 * idempotent; safe to call on every dashboard load.
 */
export async function sweepOverdueTasks(client: any, input: { businessId: string; now?: Date; limit?: number }) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
  const tasks = await client.erpTask
    .findMany({
      where: { businessId: input.businessId, status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } },
      orderBy: { dueAt: "asc" },
      take: limit,
    })
    .catch(() => []);
  let raised = 0;
  for (const task of tasks as any[]) {
    const result = await notifyTaskOverdue(client, { businessId: input.businessId, task, now });
    if (result?.created) raised += 1;
  }
  return { swept: (tasks as any[]).length, raised };
}

export type NotificationViewer = { userId: string; role: string };

/** What this person may see, unread first, newest first. Tenant-scoped at the query level. */
export async function listNotifications(
  client: any,
  input: { businessId: string; viewer: NotificationViewer; unreadOnly?: boolean; limit?: number },
) {
  const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
  const rows = await client.erpNotification.findMany({
    where: {
      businessId: input.businessId,
      OR: [{ recipientId: input.viewer.userId }, { recipientId: null }],
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    include: { reads: { where: { userId: input.viewer.userId }, select: { userId: true } } },
  });
  const visible = (rows as any[]).filter((row) => notificationVisibleTo(row, input.viewer));
  const withRead = visible.map((row) => ({ ...row, read: notificationIsRead(row, input.viewer) }));
  const filtered = input.unreadOnly ? withRead.filter((row) => !row.read) : withRead;
  return {
    notifications: filtered,
    unread: withRead.filter((row) => !row.read).length,
    scanned: (rows as any[]).length,
  };
}

/** Unread count for the bell. Same visibility rule as the list, so the number matches the screen. */
export async function unreadNotificationCount(client: any, input: { businessId: string; viewer: NotificationViewer }) {
  const rows = await client.erpNotification
    .findMany({
      where: { businessId: input.businessId, OR: [{ recipientId: input.viewer.userId }, { recipientId: null }] },
      select: { id: true, recipientId: true, audienceRole: true, readAt: true, reads: { where: { userId: input.viewer.userId }, select: { userId: true } } },
      take: 500,
    })
    .catch(() => []);
  return (rows as any[]).filter((row) => notificationVisibleTo(row, input.viewer) && !notificationIsRead(row, input.viewer)).length;
}

/**
 * Mark one notification read for this person. Refuses another tenant's row and a row this person
 * cannot see, and is idempotent: marking read twice inserts one row.
 */
export async function markNotificationRead(
  client: any,
  input: { businessId: string; notificationId: string; viewer: NotificationViewer },
) {
  const notification = await client.erpNotification
    .findUnique({ where: { id: input.notificationId } })
    .catch(() => null);
  if (!notification || notification.businessId !== input.businessId) {
    throw Object.assign(new Error("That notification is not in this workspace."), { status: 404 });
  }
  if (!notificationVisibleTo(notification, input.viewer)) {
    throw Object.assign(new Error("That notification is not yours."), { status: 403 });
  }
  const existing = await client.erpNotificationRead
    .findUnique({ where: { notificationId_userId: { notificationId: notification.id, userId: input.viewer.userId } } })
    .catch(() => null);
  if (existing) return { notification, marked: false };
  const read = await client.erpNotificationRead
    .create({
      data: {
        businessId: input.businessId,
        notificationId: notification.id,
        userId: input.viewer.userId,
      },
    })
    .catch(async (error: any) => {
      if (String(error?.code ?? "") === "P2002") return null; // concurrent double click: already read
      throw error;
    });
  return { notification, marked: Boolean(read) };
}

/** Mark everything this person can see as read. Returns how many rows were newly marked. */
export async function markAllNotificationsRead(client: any, input: { businessId: string; viewer: NotificationViewer }) {
  const { notifications } = await listNotifications(client, { businessId: input.businessId, viewer: input.viewer, unreadOnly: true, limit: 200 });
  let marked = 0;
  for (const row of notifications as any[]) {
    const result = await markNotificationRead(client, { businessId: input.businessId, notificationId: row.id, viewer: input.viewer });
    if (result.marked) marked += 1;
  }
  return { marked, considered: (notifications as any[]).length };
}
