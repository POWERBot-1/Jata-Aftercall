/**
 * POS / ERP - PRO — operational tasks
 *
 * One record for "a person owns this piece of work by this date", used by the dashboard inbox, the
 * automation engine's CREATE_TASK action, compliance renewals and approval follow-ups.
 *
 * Every function takes an explicit `client` and an explicit `businessId`, and every query filters on
 * that tenant. There is no code path here that reads a task by id without also constraining the
 * business, so a task id from another tenant resolves to "not found" rather than to a leak.
 *
 * The state machine is small and enforced on the server: OPEN → IN_PROGRESS → DONE, and OPEN or
 * IN_PROGRESS → CANCELLED. DONE and CANCELLED are terminal — reopening is a new task, because a
 * completed task that silently becomes open again breaks the completion evidence the reports use.
 */

import { logErpAudit } from "./audit";
import { notifyTaskAssigned, notifyTaskCompleted } from "./notifications";

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCE_TYPES = ["MANUAL", "AUTOMATION", "ORDER", "INVOICE", "COMPLIANCE"] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const TERMINAL: TaskStatus[] = ["DONE", "CANCELLED"];

export function isTerminalTaskStatus(status: unknown): boolean {
  return TERMINAL.includes(normalizeTaskStatus(status));
}

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  const value = String(raw ?? "").toUpperCase().replace(/[\s-]+/g, "_");
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : "OPEN";
}

export function normalizeTaskPriority(raw: unknown): TaskPriority {
  const value = String(raw ?? "").toUpperCase();
  return (TASK_PRIORITIES as readonly string[]).includes(value) ? (value as TaskPriority) : "NORMAL";
}

/**
 * Which transitions are allowed. `DONE` records who finished it and when; `CANCELLED` requires a
 * reason so the audit trail explains why work was dropped rather than done.
 */
export function taskTransitionAllowed(from: TaskStatus, to: TaskStatus): { ok: boolean; reason?: string } {
  if (from === to) return { ok: true };
  if (TERMINAL.includes(from)) {
    return { ok: false, reason: `This task is already ${TASK_STATUS_LABELS[from].toLowerCase()}. Open a new task instead of reopening a closed one.` };
  }
  if (to === "IN_PROGRESS" && from !== "OPEN") {
    return { ok: false, reason: "Only an open task can be started." };
  }
  if (to === "OPEN") {
    return { ok: false, reason: "A task cannot go back to open. Move it to in progress, done or cancelled." };
  }
  return { ok: true };
}

export type TaskInput = {
  title: string;
  detail?: string | null;
  priority?: string | null;
  assignedTo?: string | null;
  assignedRole?: string | null;
  dueAt?: Date | string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  href?: string | null;
  idempotencyKey?: string | null;
};

export type TaskValidation = { ok: boolean; errors: string[]; value: TaskInput };

/**
 * Validation lives here, not in the form. The database constraint is only "not null"; the rules a
 * user can see are these, and the server applies them on every write path (page action, automation).
 */
export function validateTaskInput(input: Partial<TaskInput>, now: Date = new Date()): TaskValidation {
  const errors: string[] = [];
  const title = String(input.title ?? "").trim();
  if (title.length < 3) errors.push("Give the task a title of at least 3 characters.");
  if (title.length > 140) errors.push("Keep the title under 140 characters.");

  const detail = input.detail === null || input.detail === undefined ? null : String(input.detail).trim();
  if (detail && detail.length > 4000) errors.push("Keep the detail under 4,000 characters.");

  const dueAt = input.dueAt === null || input.dueAt === undefined || input.dueAt === "" ? null : new Date(input.dueAt);
  if (dueAt && Number.isNaN(dueAt.getTime())) errors.push("That due date is not a real date.");
  // A due date in the past is allowed on purpose: capturing overdue work (an expired permit, a late
  // delivery) is exactly what the compliance and fulfilment flows need. It is flagged, not refused.
  const overdue = Boolean(dueAt && dueAt.getTime() < now.getTime());

  const assignedTo = input.assignedTo ? String(input.assignedTo).trim() : null;
  const assignedRole = input.assignedRole ? String(input.assignedRole).toUpperCase() : null;

  return {
    ok: errors.length === 0,
    errors,
    value: {
      title,
      detail,
      priority: normalizeTaskPriority(input.priority),
      assignedTo,
      assignedRole,
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      sourceType: input.sourceType ? String(input.sourceType).toUpperCase() : "MANUAL",
      sourceId: input.sourceId ? String(input.sourceId) : null,
      href: input.href ? String(input.href) : null,
      idempotencyKey: input.idempotencyKey ? String(input.idempotencyKey) : null,
      ...(overdue ? { overdue: true } : {}),
    } as TaskInput,
  };
}

/** Group tasks into the buckets the inbox shows. Order is deliberate: overdue first. */
export function bucketTasks(tasks: any[], now: Date = new Date()) {
  const open = tasks.filter((task) => !TERMINAL.includes(normalizeTaskStatus(task.status)));
  const isOverdue = (task: any) => Boolean(task.dueAt) && new Date(task.dueAt).getTime() < now.getTime();
  return {
    overdue: open.filter(isOverdue),
    dueToday: open.filter((task) => {
      if (!task.dueAt || isOverdue(task)) return false;
      const due = new Date(task.dueAt);
      return due.toDateString() === now.toDateString();
    }),
    upcoming: open.filter((task) => task.dueAt && new Date(task.dueAt).getTime() > now.getTime() && new Date(task.dueAt).toDateString() !== now.toDateString()),
    undated: open.filter((task) => !task.dueAt),
    done: tasks.filter((task) => normalizeTaskStatus(task.status) === "DONE"),
    cancelled: tasks.filter((task) => normalizeTaskStatus(task.status) === "CANCELLED"),
  };
}

export type CreateTaskInput = TaskInput & { businessId: string; actorId?: string | null; actorName?: string | null };

/**
 * Create a task. When an `idempotencyKey` is supplied, a second call with the same key returns the
 * existing row instead of creating a duplicate — that is what makes the automation action safe to
 * replay after a retry or a webhook redelivery.
 */
export async function createTask(client: any, input: CreateTaskInput) {
  const validation = validateTaskInput(input);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors[0]), { status: 400, errors: validation.errors });
  }
  const data = validation.value;

  if (data.idempotencyKey) {
    const existing = await client.erpTask
      .findUnique({ where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: data.idempotencyKey } } })
      .catch(() => null);
    if (existing) return { task: existing, created: false, deduplicated: true };
  }

  // A task may only be assigned to somebody who is actually in this tenant. Assigning to a role is
  // the fallback, and any member of that role can then claim it.
  if (data.assignedTo) {
    const member = await resolveAssignee(client, input.businessId, data.assignedTo);
    if (!member) {
      throw Object.assign(new Error("That person is not a member of this business."), { status: 400 });
    }
  }

  let task;
  try {
    task = await client.erpTask.create({
      data: {
        businessId: input.businessId,
        title: data.title,
        detail: data.detail ?? null,
        status: "OPEN",
        priority: data.priority ?? "NORMAL",
        assignedTo: data.assignedTo ?? null,
        assignedRole: data.assignedRole ?? null,
        createdBy: input.actorId ?? null,
        dueAt: data.dueAt ?? null,
        sourceType: data.sourceType ?? "MANUAL",
        sourceId: data.sourceId ?? null,
        href: data.href ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
      },
    });
  } catch (error: any) {
    // Two concurrent replays of the same automation event: the unique index wins, and the loser
    // returns the winner's row rather than an error.
    if (data.idempotencyKey && String(error?.code ?? "") === "P2002") {
      const existing = await client.erpTask.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: data.idempotencyKey } },
      });
      if (existing) return { task: existing, created: false, deduplicated: true };
    }
    throw error;
  }

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: "TASK_CREATED",
    targetType: "TASK",
    targetId: task.id,
    after: { title: task.title, priority: task.priority, assignedTo: task.assignedTo, assignedRole: task.assignedRole, dueAt: task.dueAt, sourceType: task.sourceType },
    client,
  });

  // The person who was given the work is told about it. Best-effort: a notification must never
  // fail the task write, and the dedupe key stops a retry from notifying twice.
  await notifyTaskAssigned(client, { businessId: input.businessId, task, actorId: input.actorId ?? null, actorName: input.actorName ?? null });

  return { task, created: true, deduplicated: false };
}

async function resolveAssignee(client: any, businessId: string, userId: string) {
  const business = await client.business.findUnique({ where: { id: businessId }, select: { ownerId: true } }).catch(() => null);
  if (!business) return null;
  if (business.ownerId === userId) return { id: userId };
  const membership = await client.businessMember
    ?.findUnique?.({ where: { userId_businessId: { userId, businessId } }, select: { id: true } })
    .catch(() => null);
  return membership ?? null;
}

export type UpdateTaskInput = {
  businessId: string;
  taskId: string;
  status?: string;
  priority?: string;
  assignedTo?: string | null;
  dueAt?: Date | string | null;
  reason?: string | null;
  actorId?: string | null;
  actorName?: string | null;
};

/** Move a task through the state machine, or change its owner/priority/due date. */
export async function updateTask(client: any, input: UpdateTaskInput) {
  // The tenant is part of the lookup, never a post-hoc comparison.
  const task = await client.erpTask.findFirst({ where: { id: input.taskId, businessId: input.businessId } });
  if (!task) throw Object.assign(new Error("That task was not found."), { status: 404 });

  const from = normalizeTaskStatus(task.status);
  const data: Record<string, unknown> = {};
  const before: Record<string, unknown> = { status: task.status, priority: task.priority, assignedTo: task.assignedTo, dueAt: task.dueAt };

  if (input.status !== undefined) {
    const to = normalizeTaskStatus(input.status);
    const allowed = taskTransitionAllowed(from, to);
    if (!allowed.ok) throw Object.assign(new Error(allowed.reason ?? "That status change is not allowed."), { status: 400 });
    data.status = to;
    if (to === "DONE") {
      data.completedAt = new Date();
      data.completedBy = input.actorId ?? null;
    }
    if (to === "CANCELLED" && !String(input.reason ?? "").trim()) {
      throw Object.assign(new Error("Say why the task is being cancelled."), { status: 400 });
    }
  }

  if (input.priority !== undefined) data.priority = normalizeTaskPriority(input.priority);

  if (input.assignedTo !== undefined) {
    const next = input.assignedTo ? String(input.assignedTo).trim() : null;
    if (next) {
      const member = await resolveAssignee(client, input.businessId, next);
      if (!member) throw Object.assign(new Error("That person is not a member of this business."), { status: 400 });
    }
    data.assignedTo = next;
  }

  if (input.dueAt !== undefined) {
    if (input.dueAt === null || input.dueAt === "") {
      data.dueAt = null;
    } else {
      const due = new Date(input.dueAt);
      if (Number.isNaN(due.getTime())) throw Object.assign(new Error("That due date is not a real date."), { status: 400 });
      data.dueAt = due;
    }
  }

  if (Object.keys(data).length === 0) return { task, changed: false };

  const updated = await client.erpTask.update({ where: { id: task.id }, data });

  if (data.assignedTo !== undefined && data.assignedTo && data.assignedTo !== task.assignedTo) {
    // A reassignment is a new owner, so the same notice a new task raises applies. The dedupe key
    // carries the new owner, so moving work back and forth notifies each person once.
    await notifyTaskAssigned(client, {
      businessId: input.businessId,
      task: updated as any,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
    }).catch(() => null);
  }

  if (data.status === "DONE") {
    // The person who asked for the work is told it is finished; completing your own task says
    // nothing. Best-effort, like every notification: the state change must not depend on it.
    await notifyTaskCompleted(client, {
      businessId: input.businessId,
      task: updated as any,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
    });
  }

  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    action: data.status ? "TASK_STATUS_CHANGED" : "TASK_UPDATED",
    targetType: "TASK",
    targetId: task.id,
    before,
    after: { ...data, reason: input.reason ?? null },
    client,
  });

  return { task: updated, changed: true };
}

/** The inbox: open work for a tenant, soonest due first, bounded so a large tenant cannot page in everything. */
export async function listTasks(
  client: any,
  input: { businessId: string; assignee?: string | null; status?: string | null; limit?: number },
) {
  const limit = Math.min(Math.max(Number(input.limit ?? 100), 1), 200);
  const where: Record<string, unknown> = { businessId: input.businessId };
  if (input.assignee) where.assignedTo = input.assignee;
  if (input.status) {
    const status = String(input.status).toUpperCase();
    where.status = (TASK_STATUSES as readonly string[]).includes(status) ? status : "OPEN";
  }
  return client.erpTask.findMany({
    where,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: limit,
  });
}

/** Count of open tasks per assignee, for the dashboard widget. Tenant-scoped. */
export async function taskSummary(client: any, businessId: string, now: Date = new Date()) {
  const tasks = await client.erpTask.findMany({
    where: { businessId, status: { in: ["OPEN", "IN_PROGRESS"] } },
    select: { status: true, dueAt: true, assignedTo: true },
    take: 1000,
  });
  const overdue = tasks.filter((task: any) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime());
  return { open: tasks.length, overdue: overdue.length, unassigned: tasks.filter((task: any) => !task.assignedTo).length };
}
