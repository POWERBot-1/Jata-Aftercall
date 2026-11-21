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
    businessId: `synthetic-business-${index}`,
    subscriptionId: `synthetic-subscription-${index}`,
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
    for (const runId of runIds) {
      const tasks = await db.productLifecycleExecutionTask.findMany({ where: { runId }, select: { id: true } });
      const taskIds = tasks.map((task: { id: string }) => task.id);
      if (taskIds.length) await db.productLifecycleExecutionEvent.deleteMany({ where: { taskId: { in: taskIds } } });
      await db.productLifecycleExecutionTask.deleteMany({ where: { runId } });
      await db.productLifecycleExecutionRun.deleteMany({ where: { id: runId } });
    }
    if (db) await db.$disconnect();
  });

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
    expect(events.map((event: { eventType: string }) => event.eventType)).toEqual([
      "CLAIMED", "LEASE_RECLAIMED", "COMPLETED",
    ]);
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
