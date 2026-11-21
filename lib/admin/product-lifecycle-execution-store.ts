/**
 * Transaction-backed persistence for the product lifecycle execution ledger.
 *
 * This module only records work and execution evidence. It never changes subscriptions,
 * entitlements, payments, customer access, or calls external providers.
 */
import { randomUUID } from "node:crypto";
import prisma from "@/lib/db";
import {
  completeLifecycleTask,
  failLifecycleTask,
  lifecycleIdempotencyKey,
  moveLifecycleTaskToReview,
  type LifecycleTask,
} from "@/lib/admin/product-lifecycle-execution-ledger";
import type { LifecycleProduct } from "@/lib/admin/product-expiry-grace-observation";

type Tx = any;
type TaskInput = {
  product: LifecycleProduct;
  businessId: string;
  subscriptionId: string;
  transitionKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  availableAt?: Date;
};
type ClaimedTask = {
  id: string;
  runId: string;
  product: string;
  businessId: string;
  subscriptionId: string;
  transitionKey: string;
  state: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseToken: string;
  leaseUntil: Date;
};

const MAX_BATCH = 100;
const MAX_LEASE_MS = 15 * 60_000;

function boundedText(value: string, name: string, max = 256): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error("LIFECYCLE_INVALID_" + name);
  return value.trim();
}

function safeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > 16_384) throw new Error("LIFECYCLE_INVALID_PAYLOAD");
  return serialized;
}

function eventData(input: {
  taskId: string; eventType: string; fromState: string | null; toState: string;
  reasonCode: string; actorId?: string; metadata?: unknown;
}) {
  return {
    taskId: input.taskId,
    eventType: input.eventType,
    fromState: input.fromState,
    toState: input.toState,
    reasonCode: input.reasonCode,
    actorType: "SYSTEM",
    actorId: input.actorId ?? null,
    metadata: input.metadata === undefined ? undefined : JSON.parse(safeJson(input.metadata)),
  };
}

/** Create a durable run once per caller-supplied idempotency key. */
export async function createLifecycleExecutionRun(input: {
  runKey: string; mode?: "OBSERVE" | "PLAN"; cursor?: Record<string, unknown>;
}) {
  const runKey = boundedText(input.runKey, "RUN_KEY", 200);
  const mode = input.mode ?? "OBSERVE";
  if (mode !== "OBSERVE" && mode !== "PLAN") throw new Error("LIFECYCLE_INVALID_MODE");
  if (input.cursor !== undefined) safeJson(input.cursor);
  try {
    return await prisma.productLifecycleExecutionRun.create({
      data: { runKey, mode, status: "RUNNING", cursor: input.cursor as any },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: unknown }).code === "P2002") {
      const existing = await prisma.productLifecycleExecutionRun.findUnique({ where: { runKey } });
      if (existing) return existing;
    }
    throw error;
  }
}

/** Enqueue tasks atomically; the unique idempotency key makes retries and races safe. */
export async function enqueueLifecycleTasks(runId: string, inputs: TaskInput[]) {
  boundedText(runId, "RUN_ID", 128);
  if (!Array.isArray(inputs) || inputs.length > MAX_BATCH) throw new Error("LIFECYCLE_INVALID_BATCH");
  if (inputs.length === 0) return { received: 0, inserted: 0, tasks: [] };

  const rows = inputs.map((input) => {
    const businessId = boundedText(input.businessId, "BUSINESS_ID");
    const subscriptionId = boundedText(input.subscriptionId, "SUBSCRIPTION_ID");
    const transitionKey = boundedText(input.transitionKey, "TRANSITION_KEY");
    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
      throw new Error("LIFECYCLE_INVALID_MAX_ATTEMPTS");
    }
    if (!input.product || typeof input.product !== "string") throw new Error("LIFECYCLE_INVALID_PRODUCT");
    const payload = JSON.parse(safeJson(input.payload));
    const idempotencyKey = lifecycleIdempotencyKey({
      product: input.product, businessId, subscriptionId, transitionKey,
    });
    return {
      runId, idempotencyKey, product: input.product, businessId, subscriptionId, transitionKey,
      state: "READY", payload, maxAttempts, availableAt: input.availableAt ?? new Date(),
    };
  });

  return prisma.$transaction(async (tx: Tx) => {
    const run = await tx.productLifecycleExecutionRun.findUnique({
      where: { id: runId }, select: { id: true, status: true },
    });
    if (!run || run.status !== "RUNNING") throw new Error("LIFECYCLE_RUN_NOT_ACTIVE");
    const inserted = await tx.productLifecycleExecutionTask.createMany({ data: rows, skipDuplicates: true });
    const tasks = await tx.productLifecycleExecutionTask.findMany({
      where: { idempotencyKey: { in: rows.map((row) => row.idempotencyKey) } },
      orderBy: { createdAt: "asc" },
    });
    return { received: rows.length, inserted: inserted.count, tasks };
  });
}

/**
 * Claim a bounded batch with PostgreSQL row locks. SKIP LOCKED prevents competing workers
 * from claiming the same row. A unique random lease token is generated for every task.
 */
export async function claimLifecycleTasks(input: {
  runId: string; limit?: number; now?: Date; leaseMs?: number;
}) {
  const runId = boundedText(input.runId, "RUN_ID", 128);
  const limit = input.limit ?? 25;
  const now = input.now ?? new Date();
  const leaseMs = input.leaseMs ?? 60_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH ||
      !Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_LEASE_MS ||
      !Number.isFinite(now.getTime())) throw new Error("LIFECYCLE_INVALID_CLAIM_OPTIONS");
  const leaseUntil = new Date(now.getTime() + leaseMs);

  return prisma.$transaction(async (tx: Tx) => {
    const run = await tx.productLifecycleExecutionRun.findUnique({
      where: { id: runId }, select: { id: true, status: true },
    });
    if (!run || run.status !== "RUNNING") throw new Error("LIFECYCLE_RUN_NOT_ACTIVE");

    // Exhausted work is moved to a terminal review queue with evidence, never silently discarded.
    const exhausted = await tx.$queryRaw`
      WITH candidates AS (
        SELECT "id", "state" FROM "ProductLifecycleExecutionTask"
        WHERE "runId" = ${runId}
          AND "attempts" >= "maxAttempts"
          AND ("state" IN ('READY', 'RETRY') OR ("state" = 'CLAIMED' AND "leaseUntil" <= ${now}))
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "ProductLifecycleExecutionTask" AS task
      SET "state" = 'DEAD_LETTER', "leaseToken" = NULL, "leaseUntil" = NULL,
          "lastErrorCode" = 'ATTEMPT_LIMIT_REACHED', "updatedAt" = ${now}
      FROM candidates
      WHERE task."id" = candidates."id"
      RETURNING task."id", candidates."state" AS "fromState"
    `;
    if (exhausted.length) {
      await tx.productLifecycleExecutionEvent.createMany({
        data: exhausted.map((row: any) => eventData({
          taskId: row.id, eventType: "DEAD_LETTERED", fromState: row.fromState,
          toState: "DEAD_LETTER", reasonCode: "ATTEMPT_LIMIT_REACHED",
        })),
      });
    }

    const claimed: ClaimedTask[] = await tx.$queryRaw`
      WITH candidates AS (
        SELECT "id", "state" FROM "ProductLifecycleExecutionTask"
        WHERE "runId" = ${runId}
          AND "attempts" < "maxAttempts"
          AND (("state" IN ('READY', 'RETRY') AND "availableAt" <= ${now})
            OR ("state" = 'CLAIMED' AND "leaseUntil" <= ${now}))
        ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "ProductLifecycleExecutionTask" AS task
      SET "state" = 'CLAIMED',
          "attempts" = task."attempts" + 1,
          "leaseToken" = gen_random_uuid()::text,
          "leaseUntil" = ${leaseUntil},
          "updatedAt" = ${now}
      FROM candidates
      WHERE task."id" = candidates."id"
      RETURNING task."id", task."runId", task."product", task."businessId",
        task."subscriptionId", task."transitionKey", task."state", task."attempts",
        task."maxAttempts", task."availableAt", task."leaseToken", task."leaseUntil",
        candidates."state" AS "fromState"
    `;
    if (claimed.length) {
      await tx.productLifecycleExecutionEvent.createMany({
        data: claimed.map((task: any) => eventData({
          taskId: task.id,
          eventType: task.fromState === "CLAIMED" ? "LEASE_RECLAIMED" : "CLAIMED",
          fromState: task.fromState, toState: "CLAIMED",
          reasonCode: task.fromState === "CLAIMED" ? "EXPIRED_LEASE" : "READY_WORK",
          metadata: { attempt: task.attempts },
        })),
      });
    }
    return { claimed, exhausted: exhausted.length };
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}

async function loadTaskForTransition(tx: Tx, taskId: string): Promise<{
  row: any; task: LifecycleTask;
}> {
  const row = await tx.productLifecycleExecutionTask.findUnique({ where: { id: taskId } });
  if (!row) throw new Error("LIFECYCLE_TASK_NOT_FOUND");
  return {
    row,
    task: {
      state: row.state, attempts: row.attempts, maxAttempts: row.maxAttempts,
      availableAt: row.availableAt, leaseToken: row.leaseToken,
      leaseUntil: row.leaseUntil, completedAt: row.completedAt,
    },
  };
}

async function persistTransition(input: {
  taskId: string; token: string; now: Date;
  kind: "complete" | "fail" | "review"; errorCode?: string; retryable?: boolean;
}) {
  boundedText(input.taskId, "TASK_ID", 128);
  boundedText(input.token, "LEASE_TOKEN", 256);
  return prisma.$transaction(async (tx: Tx) => {
    const { row, task } = await loadTaskForTransition(tx, input.taskId);
    const transition = input.kind === "complete"
      ? completeLifecycleTask(task, input.token, input.now)
      : input.kind === "review"
        ? moveLifecycleTaskToReview(task, input.token, input.errorCode ?? "MANUAL_REVIEW")
        : failLifecycleTask(task, input.token, {
            now: input.now, errorCode: input.errorCode ?? "WORK_FAILED",
            retryable: input.retryable ?? true,
          });
    if (!transition.ok || !transition.event) return { updated: false };
    const next = transition.task;
    const changed = await tx.productLifecycleExecutionTask.updateMany({
      where: {
        id: input.taskId, state: "CLAIMED", leaseToken: input.token,
        leaseUntil: { gt: input.now },
      },
      data: {
        state: next.state, attempts: next.attempts, availableAt: next.availableAt,
        leaseToken: next.leaseToken, leaseUntil: next.leaseUntil,
        completedAt: next.completedAt,
        lastErrorCode: input.kind === "fail" ? input.errorCode ?? "WORK_FAILED" : null,
      },
    });
    if (changed.count !== 1) return { updated: false };
    await tx.productLifecycleExecutionEvent.create({
      data: eventData({
        taskId: input.taskId, eventType: transition.event.eventType,
        fromState: transition.event.fromState, toState: transition.event.toState,
        reasonCode: transition.event.reasonCode,
      }),
    });
    return { updated: true, state: next.state };
  }, { isolationLevel: "ReadCommitted", timeout: 10_000 });
}

export function completePersistedLifecycleTask(taskId: string, token: string, now = new Date()) {
  return persistTransition({ taskId, token, now, kind: "complete" });
}
export function failPersistedLifecycleTask(input: {
  taskId: string; token: string; errorCode: string; retryable: boolean; now?: Date;
}) {
  return persistTransition({
    taskId: input.taskId, token: input.token, now: input.now ?? new Date(),
    kind: "fail", errorCode: input.errorCode, retryable: input.retryable,
  });
}
export function movePersistedLifecycleTaskToReview(input: {
  taskId: string; token: string; reasonCode: string; now?: Date;
}) {
  return persistTransition({
    taskId: input.taskId, token: input.token, now: input.now ?? new Date(),
    kind: "review", errorCode: input.reasonCode,
  });
}

/** Finalize only an active run; summary/cursor are bounded JSON evidence. */
export async function finishLifecycleExecutionRun(input: {
  runId: string; status: "COMPLETED" | "FAILED" | "ABANDONED";
  summary: Record<string, unknown>; cursor?: Record<string, unknown>;
}) {
  boundedText(input.runId, "RUN_ID", 128);
  const summary = JSON.parse(safeJson(input.summary));
  const cursor = input.cursor === undefined ? undefined : JSON.parse(safeJson(input.cursor));
  const now = new Date();
  return prisma.$transaction(async (tx: Tx) => {
    const run = await tx.productLifecycleExecutionRun.findUnique({
      where: { id: input.runId }, select: { id: true, status: true },
    });
    if (!run || run.status !== "RUNNING") return { updated: false };
    if (input.status === "COMPLETED") {
      const pending = await tx.productLifecycleExecutionTask.count({
        where: { runId: input.runId, state: { in: ["READY", "CLAIMED", "RETRY"] } },
      });
      if (pending > 0) return { updated: false, pending };
    }
    const changed = await tx.productLifecycleExecutionRun.updateMany({
      where: { id: input.runId, status: "RUNNING" },
      data: { status: input.status, summary, cursor, finishedAt: now, leaseToken: null, leaseUntil: null },
    });
    return { updated: changed.count === 1 };
  }, { isolationLevel: "ReadCommitted", timeout: 10_000 });
}

/** UUID helper is exported for callers that need an opaque run key. */
export function newLifecycleRunKey(): string {
  return randomUUID();
}
