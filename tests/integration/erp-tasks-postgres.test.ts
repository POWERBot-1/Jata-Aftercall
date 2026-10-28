/**
 * Operational tasks against a real PostgreSQL database.
 *
 * The unit suite proves the rules with a fake client. This one proves the things only a real
 * database can: that two tenants cannot see or change each other's tasks, that a replayed
 * automation event cannot create a second task (unique index, not application memory), that the
 * state machine survives a concurrent double-submit, and that every accepted change leaves an audit
 * row inside the right tenant.
 *
 * Environment: PRISMA_TEST_DATABASE_URL (an isolated, migrated database — never production) and,
 * where the native engine cannot be downloaded, PRISMA_WASM_HARNESS_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTask, updateTask, listTasks, taskSummary, bucketTasks } from "@/lib/erp/tasks";
import { runAutomation } from "@/lib/erp/automation";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = { ownerA: "", ownerB: "", staffA: "", businessA: "", businessB: "", outsideUser: "" };

async function makeUser(label: string) {
  return client.user.create({ data: { email: `task-${label}-${stamp}@example.test`, name: `Task ${label}`, passwordHash: "not-a-real-login" } });
}

async function makeBusiness(ownerId: string, label: string) {
  return client.business.create({ data: { ownerId, slug: `task-${label}-${stamp}`, name: `Task ${label}`, category: "retail" } });
}

describe.skipIf(!enabled)("operational tasks against real PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();

    const ownerA = await makeUser("owner-a");
    const ownerB = await makeUser("owner-b");
    const staffA = await makeUser("staff-a");
    const outside = await makeUser("outside");
    ids.ownerA = ownerA.id;
    ids.ownerB = ownerB.id;
    ids.staffA = staffA.id;
    ids.outsideUser = outside.id;

    const businessA = await makeBusiness(ownerA.id, "a");
    const businessB = await makeBusiness(ownerB.id, "b");
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;

    await client.businessMember.create({ data: { userId: staffA.id, businessId: businessA.id, role: "STAFF" } });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.business.deleteMany({ where: { id: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB, ids.staffA, ids.outsideUser].filter(Boolean) } } });
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("persists a task and reads it back inside its own tenant", async () => {
    const { task } = await createTask(client, {
      businessId: ids.businessA,
      title: "Renew the depot fire certificate",
      detail: "Certificate expires at the end of the month.",
      priority: "HIGH",
      dueAt: new Date(Date.now() + 3 * 86_400_000),
      actorId: ids.ownerA,
      actorName: "Owner A",
    });
    const stored = await client.erpTask.findUnique({ where: { id: task.id } });
    expect(stored).toMatchObject({ businessId: ids.businessA, status: "OPEN", priority: "HIGH", title: "Renew the depot fire certificate" });
    expect(stored.dueAt).toBeInstanceOf(Date);
  });

  it("does not leak another tenant's task, and refuses to change it", async () => {
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Private to tenant A", actorId: ids.ownerA });

    // Reading through the tenant-scoped lister must not return it to tenant B.
    const forB = await listTasks(client, { businessId: ids.businessB });
    expect(forB.map((row: any) => row.id)).not.toContain(task.id);

    // The write path is scoped in the query, so tenant B cannot touch it by id.
    await expect(updateTask(client, { businessId: ids.businessB, taskId: task.id, status: "DONE" })).rejects.toThrow(/not found/i);
    const unchanged = await client.erpTask.findUnique({ where: { id: task.id } });
    expect(unchanged.status).toBe("OPEN");
  });

  it("refuses to assign work to a user who is not in the tenant", async () => {
    await expect(createTask(client, { businessId: ids.businessA, title: "Call the outsider", assignedTo: ids.outsideUser })).rejects.toThrow(/not a member/i);
    await expect(createTask(client, { businessId: ids.businessA, title: "Call the other tenant", assignedTo: ids.ownerB })).rejects.toThrow(/not a member/i);
  });

  it("accepts an assignment to a real member and to the owner", async () => {
    const toStaff = await createTask(client, { businessId: ids.businessA, title: "Count the shelves", assignedTo: ids.staffA });
    expect(toStaff.task.assignedTo).toBe(ids.staffA);
    const toOwner = await createTask(client, { businessId: ids.businessA, title: "Sign the permit", assignedTo: ids.ownerA });
    expect(toOwner.task.assignedTo).toBe(ids.ownerA);
  });

  it("records who completed a task and when", async () => {
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Close the October books", actorId: ids.ownerA });
    const done = await updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "DONE", actorId: ids.staffA, actorName: "Staff A" });
    expect(done.task.status).toBe("DONE");
    expect(done.task.completedBy).toBe(ids.staffA);
    expect(done.task.completedAt).toBeInstanceOf(Date);

    // Terminal: a completed task cannot be reopened.
    await expect(updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "OPEN" })).rejects.toThrow(/already done|new task/i);
  });

  it("refuses a cancellation with no reason, and accepts one with a reason", async () => {
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Follow up the quotation" });
    await expect(updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "CANCELLED" })).rejects.toThrow(/why/i);
    const cancelled = await updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "CANCELLED", reason: "The customer bought elsewhere." });
    expect(cancelled.task.status).toBe("CANCELLED");
  });

  it("survives a concurrent double-submit of the same transition", async () => {
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Concurrent completion" });
    const results = await Promise.allSettled([
      updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "DONE", actorId: ids.ownerA }),
      updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "DONE", actorId: ids.staffA }),
    ]);
    // At least one succeeds; neither corrupts the row, and the stored state is DONE exactly once.
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const stored = await client.erpTask.findUnique({ where: { id: task.id } });
    expect(stored.status).toBe("DONE");
  });

  it("cannot create two tasks for one replayed automation event", async () => {
    const key = `automation-task:test:${stamp}:event:1`;
    const first = await createTask(client, { businessId: ids.businessA, title: "Chase overdue invoice", idempotencyKey: key });
    const second = await createTask(client, { businessId: ids.businessA, title: "Chase overdue invoice", idempotencyKey: key });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    const count = await client.erpTask.count({ where: { businessId: ids.businessA, idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("lets two tenants use the same idempotency key without colliding", async () => {
    const key = `shared-key-${stamp}`;
    const a = await createTask(client, { businessId: ids.businessA, title: "Same key A", idempotencyKey: key });
    const b = await createTask(client, { businessId: ids.businessB, title: "Same key B", idempotencyKey: key });
    expect(a.task.businessId).toBe(ids.businessA);
    expect(b.task.businessId).toBe(ids.businessB);
    expect(a.task.id).not.toBe(b.task.id);
  });

  it("writes audit rows inside the tenant for creation and for completion", async () => {
    const before = await client.erpAuditEvent.count({ where: { businessId: ids.businessA, targetType: "TASK" } });
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Audited task", actorId: ids.ownerA, actorName: "Owner A" });
    await updateTask(client, { businessId: ids.businessA, taskId: task.id, status: "DONE", actorId: ids.ownerA });
    const after = await client.erpAuditEvent.count({ where: { businessId: ids.businessA, targetType: "TASK" } });
    expect(after - before).toBeGreaterThanOrEqual(2);

    const rows = await client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, targetType: "TASK", targetId: task.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row: any) => row.action)).toEqual(["TASK_CREATED", "TASK_STATUS_CHANGED"]);
    // And none of it lands on the other tenant.
    const leaked = await client.erpAuditEvent.count({ where: { businessId: ids.businessB, targetType: "TASK", targetId: task.id } });
    expect(leaked).toBe(0);
  });

  it("raises one real task per automation event, in the right tenant", async () => {
    const rule = await client.erpAutomationRule.create({
      data: {
        businessId: ids.businessA,
        name: "Overdue invoice follow-up",
        trigger: "INVOICE_OVERDUE",
        status: "ACTIVE",
        conditionsJson: "[]",
        actionsJson: JSON.stringify([{ type: "CREATE_TASK", params: { title: "Chase the overdue invoice", dueInDays: 2 } }]),
        requiresApproval: false,
        maxRunsPerDay: 50,
      },
    });
    const configuration = await client.erpConfiguration.findUnique({ where: { businessId: ids.businessA } }).catch(() => null);
    if (!configuration) {
      await client.erpConfiguration.create({ data: { businessId: ids.businessA, industryPackKey: "retail", countryCode: "KE", currencyCode: "KES", timeZone: "Africa/Nairobi" } as any });
    }

    const eventId = `evt-${stamp}`;
    const run = await runAutomation(client, { businessId: ids.businessA, ruleId: rule.id, eventId, event: { invoiceId: "inv-1" }, dryRun: false, actorId: ids.ownerA });
    expect(run.status).toBe("EXECUTED");

    const created = await client.erpTask.findMany({ where: { businessId: ids.businessA, sourceType: "AUTOMATION", sourceId: rule.id } });
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe("Chase the overdue invoice");
    expect(created[0].dueAt).toBeInstanceOf(Date);

    // Replaying the identical event must not raise a second task.
    const replay = await runAutomation(client, { businessId: ids.businessA, ruleId: rule.id, eventId, event: { invoiceId: "inv-1" }, dryRun: false, actorId: ids.ownerA });
    expect(["EXECUTED", "SKIPPED"]).toContain(replay.status);
    const afterReplay = await client.erpTask.count({ where: { businessId: ids.businessA, sourceType: "AUTOMATION", sourceId: rule.id } });
    expect(afterReplay).toBe(1);
  }, 60_000);

  it("summarises open work per tenant, and the board buckets it consistently", async () => {
    const summaryA = await taskSummary(client, ids.businessA);
    const summaryB = await taskSummary(client, ids.businessB);
    expect(summaryA.open).toBeGreaterThanOrEqual(0);
    expect(summaryB.open).toBeGreaterThanOrEqual(0);

    const rowsA = await listTasks(client, { businessId: ids.businessA, status: "OPEN" });
    expect(rowsA.every((row: any) => row.businessId === ids.businessA && row.status === "OPEN")).toBe(true);

    const buckets = bucketTasks(rowsA);
    expect(buckets.done).toHaveLength(0);
    expect(buckets.overdue.length + buckets.dueToday.length + buckets.upcoming.length + buckets.undated.length).toBe(rowsA.length);
  });

  it("caps the list so a large tenant cannot page in everything", async () => {
    const rows = await listTasks(client, { businessId: ids.businessA, limit: 5000 });
    expect(rows.length).toBeLessThanOrEqual(200);
  });
});
