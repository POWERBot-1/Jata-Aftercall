import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));

import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import {
  claimLifecycleTasks,
  completePersistedLifecycleTask,
  createLifecycleExecutionRun,
  enqueueLifecycleTasks,
} from "@/lib/admin/product-lifecycle-execution-store";

const stamp = `lifecycle-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any;
const runIds: string[] = [];

async function makeRun(taskCount: number) {
  const run = await createLifecycleExecutionRun({ runKey: `${stamp}-${runIds.length}` });
  runIds.push(run.id);
  const inputs = Array.from({ length: taskCount }, (_, index) => ({
    product: "AI_FRONT_DESK" as const,
    businessId: `${run.id}-synthetic-business-${index}`,
    subscriptionId: `${run.id}-synthetic-subscription-${index}`,
    transitionKey: "EXPIRED",
    payload: { fixture: true, index },
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
    const replay = await enqueueLifecycleTasks(run.id, [{
      product: "AI_FRONT_DESK",
      businessId: original.businessId,
      subscriptionId: original.subscriptionId,
      transitionKey: original.transitionKey,
      payload: original.payload,
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
    await expect(db.$executeRaw`
      UPDATE "ProductLifecycleExecutionEvent" SET "reasonCode" = 'TAMPERED' WHERE "id" = ${event.id}
    `).rejects.toThrow();
    await expect(db.$executeRaw`
      DELETE FROM "ProductLifecycleExecutionEvent" WHERE "id" = ${event.id}
    `).rejects.toThrow();
  }, 30_000);
});
