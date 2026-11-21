import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));

import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import {
  claimLifecycleTasks,
  completePersistedLifecycleTask,
  createLifecycleExecutionRun,
  enqueueLifecycleTasks,
  failPersistedLifecycleTask,
  finishLifecycleExecutionRun,
  movePersistedLifecycleTaskToReview,
} from "@/lib/admin/product-lifecycle-execution-store";

const stamp = `lifecycle-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any;
const runIds: string[] = [];

async function makeRun(taskCount: number, maxAttempts = 5) {
  const run = await createLifecycleExecutionRun({ runKey: `${stamp}-${runIds.length}` });
  runIds.push(run.id);
  const inputs = Array.from({ length: taskCount }, (_, index) => ({
    product: "AI_FRONT_DESK" as const,
    businessId: `${run.id}-synthetic-business-${index}`,
    subscriptionId: `${run.id}-synthetic-subscription-${index}`,
    transitionKey: "EXPIRED",
    payload: { fixture: true, index },
    maxAttempts,
  }));
  await enqueueLifecycleTasks(run.id, inputs);
  return run;
}

describe.skipIf(!realPrismaConfigured)("product lifecycle ledger PostgreSQL concurrency", () => {
  beforeAll(async () => {
    db = makeRealPrisma();
    holder.client = db;
  });

  afterAll(async () => {
    // Event history is intentionally append-only; use only a disposable PostgreSQL test database.
    // Synthetic run/task/event fixtures are retained for the lifetime of that disposable database.
    if (db) await db.$disconnect();
  });

  it("deduplicates enqueue retries without returning a task owned by another run", async () => {
    const run = await makeRun(1);
    const original = await db.productLifecycleExecutionTask.findFirst({ where: { runId: run.id } });
    if (!original) throw new Error("Expected lifecycle task fixture");
    const replay = await enqueueLifecycleTasks(run.id, [{
      product: "AI_FRONT_DESK",
      businessId: original.businessId,
      subscriptionId: original.subscriptionId,
      transitionKey: original.transitionKey,
      payload: original.payload as Record<string, unknown>,
    }]);
    expect(replay.inserted).toBe(0);
    expect(replay.tasks).toHaveLength(1);
    expect(replay.tasks[0].id).toBe(original.id);
    expect(replay.tasks[0].runId).toBe(run.id);
  }, 30_000);

  it("skips rows locked by another transaction and claims the remaining tasks", async () => {
    const run = await makeRun(4);
    let lockedIds: string[] = [];
    let claimResult: Awaited<ReturnType<typeof claimLifecycleTasks>> | null = null;

    await db.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw`
        SELECT "id" FROM "ProductLifecycleExecutionTask"
        WHERE "runId" = ${run.id}
        ORDER BY "createdAt" ASC, "id" ASC
        LIMIT 2
        FOR UPDATE
      `;
      lockedIds = locked.map((row: { id: string }) => row.id);

      // This executes on a second pool connection while the first transaction holds row locks.
      claimResult = await claimLifecycleTasks({ runId: run.id, limit: 4 });
      expect(claimResult.claimed).toHaveLength(2);
      expect(claimResult.claimed.every((task) => !lockedIds.includes(task.id))).toBe(true);
    }, { timeout: 20_000 });

    expect(lockedIds).toHaveLength(2);
    expect(claimResult?.claimed).toHaveLength(2);
    const claimedIds = claimResult!.claimed.map((task) => task.id);
    expect(new Set(claimedIds).size).toBe(2);
  }, 30_000);

  it("fences a stale lease after reclamation and records the winning transitions", async () => {
    const run = await makeRun(1);
    const firstNow = new Date(Date.now() + 5_000);
    const first = await claimLifecycleTasks({ runId: run.id, limit: 1, now: firstNow, leaseMs: 1_000 });
    expect(first.claimed).toHaveLength(1);

    const secondNow = new Date(firstNow.getTime() + 2_000);
    const second = await claimLifecycleTasks({ runId: run.id, limit: 1, now: secondNow, leaseMs: 10_000 });
    expect(second.claimed).toHaveLength(1);
    expect(second.claimed[0].id).toBe(first.claimed[0].id);
    expect(second.claimed[0].leaseToken).not.toBe(first.claimed[0].leaseToken);

    const stale = await completePersistedLifecycleTask(first.claimed[0].id, first.claimed[0].leaseToken, secondNow);
    const current = await completePersistedLifecycleTask(second.claimed[0].id, second.claimed[0].leaseToken, secondNow);
    expect(stale).toMatchObject({ updated: false });
    expect(current).toMatchObject({ updated: true, state: "COMPLETED" });

    const events = await db.productLifecycleExecutionEvent.findMany({
      where: { taskId: first.claimed[0].id }, orderBy: { createdAt: "asc" },
    });
    const eventTypes = events.map((event: { eventType: string }) => event.eventType);
    expect(events).toHaveLength(3);
    expect(eventTypes).toContain("CLAIMED");
    expect(eventTypes).toContain("LEASE_RECLAIMED");
    expect(eventTypes).toContain("COMPLETED");
  }, 30_000);

  it("rejects UPDATE and DELETE against append-only lifecycle event history", async () => {
    const run = await makeRun(1);
    const claimed = await claimLifecycleTasks({ runId: run.id, limit: 1 });
    const event = await db.productLifecycleExecutionEvent.findFirst({ where: { taskId: claimed.claimed[0].id } });
    if (!event) throw new Error("Expected lifecycle event fixture");
    await expect(db.$executeRaw`
      UPDATE "ProductLifecycleExecutionEvent" SET "reasonCode" = 'TAMPERED' WHERE "id" = ${event.id}
    `).rejects.toThrow();
    await expect(db.$executeRaw`
      DELETE FROM "ProductLifecycleExecutionEvent" WHERE "id" = ${event.id}
    `).rejects.toThrow();
  }, 30_000);

  it("claims each task at most once across simultaneous workers", async () => {
    const run = await makeRun(10);
    const [left, right] = await Promise.all([
      claimLifecycleTasks({ runId: run.id, limit: 10 }),
      claimLifecycleTasks({ runId: run.id, limit: 10 }),
    ]);
    const ids = [...left.claimed, ...right.claimed].map((task) => task.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(left.claimed.length + right.claimed.length).toBe(10);
  }, 30_000);

  it("records retry scheduling and makes the task claimable after its backoff", async () => {
    const run = await makeRun(1, 3);
    const firstNow = new Date(Date.now() + 5_000);
    const first = await claimLifecycleTasks({ runId: run.id, limit: 1, now: firstNow });
    expect(first.claimed).toHaveLength(1);
    const failed = await failPersistedLifecycleTask({
      taskId: first.claimed[0].id,
      token: first.claimed[0].leaseToken,
      errorCode: "TRANSIENT_TEST_FAILURE",
      retryable: true,
      now: firstNow,
    });
    expect(failed).toMatchObject({ updated: true, state: "RETRY" });

    const retryAt = new Date(firstNow.getTime() + 31_000);
    const retried = await claimLifecycleTasks({ runId: run.id, limit: 1, now: retryAt });
    expect(retried.claimed).toHaveLength(1);
    expect(retried.claimed[0].id).toBe(first.claimed[0].id);
    expect(retried.claimed[0].attempts).toBe(2);
  }, 30_000);

  it("dead-letters a non-retryable failure at the configured attempt limit", async () => {
    const run = await makeRun(1, 1);
    const claimed = await claimLifecycleTasks({ runId: run.id, limit: 1 });
    expect(claimed.claimed).toHaveLength(1);
    const failed = await failPersistedLifecycleTask({
      taskId: claimed.claimed[0].id,
      token: claimed.claimed[0].leaseToken,
      errorCode: "PERMANENT_TEST_FAILURE",
      retryable: false,
    });
    expect(failed).toMatchObject({ updated: true, state: "DEAD_LETTER" });
    const task = await db.productLifecycleExecutionTask.findUnique({ where: { id: claimed.claimed[0].id } });
    expect(task).toMatchObject({ state: "DEAD_LETTER", leaseToken: null, leaseUntil: null });
    const events = await db.productLifecycleExecutionEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event: { eventType: string }) => event.eventType)).toContain("DEAD_LETTERED");
  }, 30_000);

  it("rejects completion at the exact lease-expiry boundary", async () => {
    const run = await makeRun(1);
    const claimed = await claimLifecycleTasks({ runId: run.id, limit: 1, leaseMs: 1_000 });
    expect(claimed.claimed).toHaveLength(1);
    const expired = await completePersistedLifecycleTask(
      claimed.claimed[0].id,
      claimed.claimed[0].leaseToken,
      claimed.claimed[0].leaseUntil,
    );
    expect(expired).toMatchObject({ updated: false });
  }, 30_000);

  it("moves a currently leased task to manual review with an immutable event", async () => {
    const run = await makeRun(1);
    const claimed = await claimLifecycleTasks({ runId: run.id, limit: 1 });
    expect(claimed.claimed).toHaveLength(1);
    const review = await movePersistedLifecycleTaskToReview({
      taskId: claimed.claimed[0].id,
      token: claimed.claimed[0].leaseToken,
      reasonCode: "OWNER_REVIEW_REQUIRED",
    });
    expect(review).toMatchObject({ updated: true, state: "MANUAL_REVIEW" });
    const events = await db.productLifecycleExecutionEvent.findMany({ where: { taskId: claimed.claimed[0].id } });
    expect(events.map((event: { eventType: string }) => event.eventType)).toContain("MANUAL_REVIEW_REQUIRED");
  }, 30_000);

  it("prevents run completion while work is pending and rejects enqueue after completion", async () => {
    const run = await makeRun(1);
    const premature = await finishLifecycleExecutionRun({
      runId: run.id, status: "COMPLETED", summary: { fixture: true },
    });
    expect(premature).toMatchObject({ updated: false, pending: 1 });

    const claimed = await claimLifecycleTasks({ runId: run.id, limit: 1 });
    expect(claimed.claimed).toHaveLength(1);
    const completed = await completePersistedLifecycleTask(
      claimed.claimed[0].id, claimed.claimed[0].leaseToken,
    );
    expect(completed).toMatchObject({ updated: true, state: "COMPLETED" });

    const finalized = await finishLifecycleExecutionRun({
      runId: run.id, status: "COMPLETED", summary: { fixture: true },
    });
    expect(finalized).toMatchObject({ updated: true });
    await expect(enqueueLifecycleTasks(run.id, [{
      product: "AI_FRONT_DESK",
      businessId: "late-business",
      subscriptionId: "late-subscription",
      transitionKey: "EXPIRED",
      payload: { fixture: true },
    }])).rejects.toThrow("LIFECYCLE_RUN_NOT_ACTIVE");
  }, 30_000);

});
