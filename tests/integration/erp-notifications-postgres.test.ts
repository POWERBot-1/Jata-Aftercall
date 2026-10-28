/**
 * Notifications against a real PostgreSQL database.
 *
 * The unit suite models the constraints. This one proves them: the unique dedupe index really stops a
 * second notice, two people really keep separate read state, a cross-tenant read really is refused,
 * and the overdue sweep really is idempotent when it runs twice.
 *
 * Environment: PRISMA_TEST_DATABASE_URL (an isolated, migrated database — never production) and,
 * where the native engine cannot be downloaded, PRISMA_WASM_HARNESS_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sweepOverdueTasks,
  unreadNotificationCount,
} from "@/lib/erp/notifications";
import { createTask, updateTask } from "@/lib/erp/tasks";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = { ownerA: "", ownerB: "", staffA: "", staffA2: "", businessA: "", businessB: "" };

async function makeUser(label: string) {
  return client.user.create({ data: { email: `notice-${label}-${stamp}@example.test`, name: `Notice ${label}`, passwordHash: "not-a-real-login" } });
}

async function makeBusiness(ownerId: string, label: string) {
  return client.business.create({ data: { ownerId, slug: `notice-${label}-${stamp}`, name: `Notice ${label}`, category: "retail" } });
}

describe.skipIf(!enabled)("notifications against real PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    const ownerA = await makeUser("owner-a");
    const ownerB = await makeUser("owner-b");
    const staffA = await makeUser("staff-a");
    const staffA2 = await makeUser("staff-a2");
    ids.ownerA = ownerA.id;
    ids.ownerB = ownerB.id;
    ids.staffA = staffA.id;
    ids.staffA2 = staffA2.id;
    const businessA = await makeBusiness(ownerA.id, "a");
    const businessB = await makeBusiness(ownerB.id, "b");
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;
    await client.businessMember.create({ data: { userId: staffA.id, businessId: businessA.id, role: "STAFF" } });
    await client.businessMember.create({ data: { userId: staffA2.id, businessId: businessA.id, role: "STAFF" } });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.erpNotificationRead.deleteMany({ where: { businessId: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.erpNotification.deleteMany({ where: { businessId: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.erpTask.deleteMany({ where: { businessId: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.erpAuditEvent.deleteMany({ where: { businessId: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.business.deleteMany({ where: { id: { in: [ids.businessA, ids.businessB].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB, ids.staffA, ids.staffA2].filter(Boolean) } } });
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("stores a notice and reads it back inside its tenant", async () => {
    const created = await createNotification(client, {
      businessId: ids.businessA,
      kind: "TASK_ASSIGNED",
      title: "Assigned to you: count the shelves",
      body: "Due Friday.",
      priority: "HIGH",
      recipientId: ids.staffA,
      audienceRole: "ALL",
      sourceType: "TASK",
      sourceId: "task-x",
      dedupeKey: `pg-store-${stamp}`,
    });
    const stored = await client.erpNotification.findUnique({ where: { id: created.notification.id } });
    expect(stored).toMatchObject({ businessId: ids.businessA, recipientId: ids.staffA, deliveryStatus: "IN_APP", priority: "HIGH" });
    expect(stored.deliveredAt).toBeNull();
  });

  it("lets the unique index — not application memory — stop a duplicate", async () => {
    const input = {
      businessId: ids.businessA,
      kind: "SYSTEM" as const,
      title: "Daily close reminder",
      body: "Close the day before you leave.",
      dedupeKey: `pg-dedupe-${stamp}`,
    };
    const first = await createNotification(client, input);
    const second = await createNotification(client, input);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, deduplicated: true });
    const rows = await client.erpNotification.findMany({ where: { businessId: ids.businessA, dedupeKey: `pg-dedupe-${stamp}` } });
    expect(rows).toHaveLength(1);
  });

  it("survives two concurrent writes of the same key", async () => {
    const input = {
      businessId: ids.businessA,
      kind: "SYSTEM" as const,
      title: "Concurrent notice",
      body: "Two writers, one row.",
      dedupeKey: `pg-race-${stamp}`,
    };
    const results = await Promise.all([createNotification(client, input), createNotification(client, input)]);
    const created = results.filter((result) => result.created).length;
    expect(created).toBe(1);
    const rows = await client.erpNotification.findMany({ where: { businessId: ids.businessA, dedupeKey: `pg-race-${stamp}` } });
    expect(rows).toHaveLength(1);
  });

  it("keeps read state per person for a shared notice", async () => {
    const created = await createNotification(client, {
      businessId: ids.businessA,
      kind: "SYSTEM",
      title: "Price list changed",
      body: "The new list applies from Monday.",
      audienceRole: "ALL",
      dedupeKey: `pg-shared-${stamp}`,
    });
    const row = created.notification;
    const staffOne = { userId: ids.staffA, role: "STAFF" };
    const staffTwo = { userId: ids.staffA2, role: "STAFF" };

    // One shared notice, two people: reading it moves exactly one person's badge.
    const staffOneBefore = await unreadNotificationCount(client, { businessId: ids.businessA, viewer: staffOne });
    const staffTwoBefore = await unreadNotificationCount(client, { businessId: ids.businessA, viewer: staffTwo });

    const marked = await markNotificationRead(client, { businessId: ids.businessA, notificationId: row.id, viewer: staffOne });
    expect(marked.marked).toBe(true);
    expect(await unreadNotificationCount(client, { businessId: ids.businessA, viewer: staffOne })).toBe(staffOneBefore - 1);
    expect(await unreadNotificationCount(client, { businessId: ids.businessA, viewer: staffTwo })).toBe(staffTwoBefore);

    const again = await markNotificationRead(client, { businessId: ids.businessA, notificationId: row.id, viewer: staffOne });
    expect(again.marked).toBe(false);
    const readRows = await client.erpNotificationRead.findMany({ where: { notificationId: row.id } });
    expect(readRows).toHaveLength(1);
  });

  it("refuses a cross-tenant read and leaves no read row behind", async () => {
    const created = await createNotification(client, {
      businessId: ids.businessA,
      kind: "SYSTEM",
      title: "Tenant A only",
      body: "Not for tenant B.",
      dedupeKey: `pg-tenant-${stamp}`,
    });
    await expect(
      markNotificationRead(client, { businessId: ids.businessB, notificationId: created.notification.id, viewer: { userId: ids.ownerB, role: "OWNER" } }),
    ).rejects.toThrow(/not in this workspace/i);
    const readRows = await client.erpNotificationRead.findMany({ where: { notificationId: created.notification.id } });
    expect(readRows).toHaveLength(0);
  });

  it("never shows another tenant's notice in the list", async () => {
    await createNotification(client, { businessId: ids.businessB, kind: "SYSTEM", title: "Tenant B secret", body: "B only.", dedupeKey: `pg-b-${stamp}` });
    const listForA = await listNotifications(client, { businessId: ids.businessA, viewer: { userId: ids.ownerA, role: "OWNER" }, limit: 200 });
    expect(listForA.notifications.some((row: any) => row.title === "Tenant B secret")).toBe(false);
    expect(listForA.notifications.every((row: any) => row.businessId === ids.businessA)).toBe(true);
  });

  it("marks everything read once and reports zero the second time", async () => {
    const viewer = { userId: ids.ownerA, role: "OWNER" };
    const first = await markAllNotificationsRead(client, { businessId: ids.businessA, viewer });
    expect(first.marked).toBeGreaterThan(0);
    const again = await markAllNotificationsRead(client, { businessId: ids.businessA, viewer });
    expect(again.marked).toBe(0);
  });

  it("raises exactly one overdue notice per task per day, even across repeated sweeps", async () => {
    const { task } = await createTask(client, {
      businessId: ids.businessA,
      title: "Renew the trading licence",
      dueAt: new Date(Date.now() - 3 * 86_400_000),
      assignedTo: ids.staffA,
      actorId: ids.ownerA,
    });
    const now = new Date();
    const first = await sweepOverdueTasks(client, { businessId: ids.businessA, now });
    const second = await sweepOverdueTasks(client, { businessId: ids.businessA, now });
    expect(first.raised).toBeGreaterThanOrEqual(1);
    expect(second.raised).toBe(0);
    const overdue = await client.erpNotification.findMany({ where: { businessId: ids.businessA, kind: "TASK_OVERDUE", sourceId: task.id } });
    expect(overdue).toHaveLength(1);
  });

  it("notifies a person when work is assigned to them, and again when it moves to somebody else", async () => {
    const { task } = await createTask(client, { businessId: ids.businessA, title: "Stock take", assignedTo: ids.staffA, actorId: ids.ownerA });
    const firstNotices = await client.erpNotification.findMany({ where: { businessId: ids.businessA, kind: "TASK_ASSIGNED", sourceId: task.id } });
    expect(firstNotices).toHaveLength(1);
    expect(firstNotices[0].recipientId).toBe(ids.staffA);

    await updateTask(client, { businessId: ids.businessA, taskId: task.id, assignedTo: ids.staffA2, actorId: ids.ownerA });
    const afterMove = await client.erpNotification.findMany({ where: { businessId: ids.businessA, kind: "TASK_ASSIGNED", sourceId: task.id } });
    expect(afterMove).toHaveLength(2);
    expect(afterMove.map((row: any) => row.recipientId).sort()).toEqual([ids.staffA, ids.staffA2].sort());
  });

  it("records an audited failure rather than claiming a send", async () => {
    const created = await createNotification(client, {
      businessId: ids.businessA,
      kind: "SYSTEM",
      title: "Attempted external send",
      body: "Provider configured, no phone on the account.",
      dedupeKey: `pg-delivery-${stamp}`,
      channel: { channel: "SMS", status: "ACTIVE" },
      dispatchEnabled: true,
      recipientPhone: null,
      actorId: ids.ownerA,
    });
    expect(created.notification.deliveryStatus).toBe("FAILED");
    expect(created.notification.deliveredAt).toBeNull();
    const audits = await client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, action: "NOTIFICATION_DELIVERY_FAILED", targetId: created.notification.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("FAILED");
  });
});
