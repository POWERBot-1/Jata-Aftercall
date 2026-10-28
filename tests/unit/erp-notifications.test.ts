/**
 * Notifications — the rules, with a fake client.
 *
 * What matters here and cannot be checked from the screen: a notice addressed to a person is theirs
 * alone, read state is per person (so one teammate opening a shared notice does not clear everybody
 * else's badge), a retried job cannot notify twice, and the module never claims a delivery that did
 * not happen.
 */
import { describe, expect, it } from "vitest";
import {
  createNotification,
  deliveryDecision,
  isActionablePriority,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotificationPriority,
  notificationIsRead,
  notificationKind,
  notificationVisibleTo,
  notifyTaskOverdue,
  sweepOverdueTasks,
  unreadNotificationCount,
  validateNotificationInput,
} from "@/lib/erp/notifications";
import { createTask } from "@/lib/erp/tasks";

const NOW = new Date("2026-10-29T09:00:00.000Z");

/**
 * A fake Prisma client that models the constraints this module depends on: the unique dedupe index on
 * (businessId, dedupeKey) and the unique read row on (notificationId, userId).
 */
function fakeClient() {
  const notifications: any[] = [];
  const reads: any[] = [];
  const tasks: any[] = [];
  const calls: Array<[string, any]> = [];
  let sequence = 0;

  const duplicate = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  const client: any = {
    notifications,
    reads,
    tasks,
    calls,
    erpNotification: {
      findUnique: async ({ where }: any) => {
        calls.push(["notification.findUnique", where]);
        const key = where.businessId_dedupeKey;
        if (key) return notifications.find((row) => row.businessId === key.businessId && row.dedupeKey === key.dedupeKey) ?? null;
        return notifications.find((row) => row.id === where.id) ?? null;
      },
      create: async ({ data }: any) => {
        calls.push(["notification.create", data]);
        if (data.dedupeKey && notifications.some((row) => row.businessId === data.businessId && row.dedupeKey === data.dedupeKey)) throw duplicate();
        const row = { id: `n${++sequence}`, readAt: null, createdAt: NOW, updatedAt: NOW, ...data };
        notifications.push(row);
        return row;
      },
      findMany: async ({ where }: any) => {
        calls.push(["notification.findMany", where]);
        const wanted = where.OR?.map((clause: any) => clause.recipientId) ?? [];
        return notifications
          .filter((row) => row.businessId === where.businessId && (wanted.includes(row.recipientId) || wanted.includes(null)))
          .map((row) => ({ ...row, reads: reads.filter((read) => read.notificationId === row.id) }));
      },
    },
    erpNotificationRead: {
      findUnique: async ({ where }: any) => {
        const key = where.notificationId_userId;
        return reads.find((row) => row.notificationId === key.notificationId && row.userId === key.userId) ?? null;
      },
      create: async ({ data }: any) => {
        if (reads.some((row) => row.notificationId === data.notificationId && row.userId === data.userId)) throw duplicate();
        const row = { id: `r${++sequence}`, readAt: NOW, ...data };
        reads.push(row);
        return row;
      },
    },
    erpTask: {
      findMany: async ({ where }: any) => {
        calls.push(["task.findMany", where]);
        return tasks.filter((task) => task.businessId === where.businessId);
      },
    },
    erpAuditEvent: { create: async ({ data }: any) => { calls.push(["audit", data]); return { id: `a${++sequence}` }; } },
  };
  return client;
}

function seedTask(client: any, overrides: Record<string, unknown> = {}) {
  const task = {
    id: "t1",
    businessId: "biz-a",
    title: "Renew the fire certificate",
    status: "OPEN",
    priority: "HIGH",
    assignedTo: "staff-1",
    assignedRole: null,
    href: null,
    dueAt: new Date("2026-10-20T09:00:00.000Z"),
    ...overrides,
  };
  client.tasks.push(task);
  return task;
}

describe("notification validation", () => {
  it("accepts a well-formed notice and normalises its kind", () => {
    const result = validateNotificationInput({ kind: "task_assigned", title: "Assigned to you", body: "Open the board." });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("TASK_ASSIGNED");
  });

  it("refuses a title that is too short and a body that is empty", () => {
    expect(validateNotificationInput({ kind: "SYSTEM", title: "ab", body: "Hello there." }).ok).toBe(false);
    expect(validateNotificationInput({ kind: "SYSTEM", title: "A real title", body: "" }).ok).toBe(false);
  });

  it("refuses a link that leaves the workspace, including a protocol-relative one", () => {
    expect(validateNotificationInput({ kind: "SYSTEM", title: "A real title", body: "Body text.", href: "https://evil.example" }).ok).toBe(false);
    expect(validateNotificationInput({ kind: "SYSTEM", title: "A real title", body: "Body text.", href: "//evil.example/x" }).ok).toBe(false);
    expect(validateNotificationInput({ kind: "SYSTEM", title: "A real title", body: "Body text.", href: "/dashboard/erp/x/tasks" }).ok).toBe(true);
  });

  it("falls back to SYSTEM for an unknown kind instead of inventing one", () => {
    expect(notificationKind("SOMETHING_NEW")).toBe("SYSTEM");
    expect(normalizeNotificationPriority("panicky")).toBe("NORMAL");
    expect(isActionablePriority("urgent")).toBe(true);
    expect(isActionablePriority("low")).toBe(false);
  });
});

describe("who may see a notice", () => {
  it("keeps a personal notice to its recipient", () => {
    const row = { recipientId: "staff-1", audienceRole: "ALL" };
    expect(notificationVisibleTo(row, { userId: "staff-1", role: "STAFF" })).toBe(true);
    expect(notificationVisibleTo(row, { userId: "staff-2", role: "STAFF" })).toBe(false);
    // Even an owner does not read somebody else's personal notice.
    expect(notificationVisibleTo(row, { userId: "owner-1", role: "OWNER" })).toBe(false);
  });

  it("shows a broadcast to its audience role, to ALL, and to the people who run the workspace", () => {
    const forFinance = { recipientId: null, audienceRole: "FINANCE" };
    expect(notificationVisibleTo(forFinance, { userId: "f1", role: "FINANCE" })).toBe(true);
    expect(notificationVisibleTo(forFinance, { userId: "s1", role: "STAFF" })).toBe(false);
    expect(notificationVisibleTo(forFinance, { userId: "o1", role: "OWNER" })).toBe(true);
    expect(notificationVisibleTo({ recipientId: null, audienceRole: "ALL" }, { userId: "v1", role: "VIEWER" })).toBe(true);
  });
});

describe("read state", () => {
  it("is per person: one teammate reading a shared notice leaves it unread for the other", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Price list changed", body: "The new list applies from Monday.", audienceRole: "ALL" });
    const staffOne = { userId: "staff-1", role: "STAFF" };
    const staffTwo = { userId: "staff-2", role: "STAFF" };

    const marked = await markNotificationRead(client, { businessId: "biz-a", notificationId: "n1", viewer: staffOne });
    expect(marked.marked).toBe(true);
    expect(await unreadNotificationCount(client, { businessId: "biz-a", viewer: staffOne })).toBe(0);
    expect(await unreadNotificationCount(client, { businessId: "biz-a", viewer: staffTwo })).toBe(1);
  });

  it("treats a legacy broadcast read flag as read for everybody, which is what it meant", () => {
    expect(notificationIsRead({ readAt: NOW, recipientId: null }, { userId: "anyone", role: "STAFF" })).toBe(true);
    // A personal row is not read just because an old flag was set on the broadcast.
    expect(notificationIsRead({ readAt: NOW, recipientId: "staff-1" }, { userId: "staff-1", role: "STAFF" })).toBe(false);
  });

  it("is idempotent: marking read twice writes one row", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Noticed", body: "Something happened." });
    const viewer = { userId: "owner-1", role: "OWNER" };
    const first = await markNotificationRead(client, { businessId: "biz-a", notificationId: "n1", viewer });
    const second = await markNotificationRead(client, { businessId: "biz-a", notificationId: "n1", viewer });
    expect(first.marked).toBe(true);
    expect(second.marked).toBe(false);
    expect(client.reads).toHaveLength(1);
  });

  it("refuses a notice from another tenant and one this person may not see", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Private notice", body: "For tenant A only." });
    await expect(markNotificationRead(client, { businessId: "biz-b", notificationId: "n1", viewer: { userId: "owner-b", role: "OWNER" } })).rejects.toThrow(/not in this workspace/i);

    const financeOnly = await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Finance only", body: "Budget detail.", audienceRole: "FINANCE" });
    await expect(
      markNotificationRead(client, { businessId: "biz-a", notificationId: financeOnly.notification.id, viewer: { userId: "staff-1", role: "STAFF" } }),
    ).rejects.toThrow(/not yours/i);
  });

  it("marks everything the person can see, and counts what it changed", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "One", body: "First notice." });
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Two", body: "Second notice." });
    const viewer = { userId: "owner-1", role: "OWNER" };
    const result = await markAllNotificationsRead(client, { businessId: "biz-a", viewer });
    expect(result).toMatchObject({ marked: 2, considered: 2 });
    const again = await markAllNotificationsRead(client, { businessId: "biz-a", viewer });
    expect(again.marked).toBe(0);
  });

  it("filters unread without changing what is visible", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "One", body: "First notice." });
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Two", body: "Second notice." });
    const viewer = { userId: "owner-1", role: "OWNER" };
    await markNotificationRead(client, { businessId: "biz-a", notificationId: "n1", viewer });
    const unread = await listNotifications(client, { businessId: "biz-a", viewer, unreadOnly: true });
    const all = await listNotifications(client, { businessId: "biz-a", viewer });
    expect(unread.notifications.map((row: any) => row.id)).toEqual(["n2"]);
    expect(all.notifications).toHaveLength(2);
    expect(all.unread).toBe(1);
  });
});

describe("delivery is recorded honestly", () => {
  it("stays in-app when no provider is connected", () => {
    expect(deliveryDecision({ channel: null })).toMatchObject({ status: "IN_APP", channel: null });
  });

  it("skips, rather than claims a send, when a provider exists but out-of-product delivery is off", () => {
    expect(deliveryDecision({ channel: { channel: "SMS", status: "ACTIVE" }, dispatchEnabled: false, recipientPhone: "254700000000" })).toMatchObject({ status: "SKIPPED", channel: "SMS" });
  });

  it("records a failure when there is nowhere to send it, and audits it", async () => {
    const client = fakeClient();
    const result = await createNotification(client, {
      businessId: "biz-a",
      kind: "SYSTEM",
      title: "Attempted send",
      body: "No phone number on the account.",
      channel: { channel: "SMS", status: "ACTIVE" },
      dispatchEnabled: true,
      recipientPhone: null,
    });
    expect(result.notification.deliveryStatus).toBe("FAILED");
    expect(client.calls.some(([name]) => name === "audit")).toBe(true);
  });

  it("never reports SENT for a notice it did not send", async () => {
    const client = fakeClient();
    const result = await createNotification(client, {
      businessId: "biz-a",
      kind: "SYSTEM",
      title: "Attempted send",
      body: "Provider present, dispatch on, number present.",
      channel: { channel: "SMS", status: "ACTIVE" },
      dispatchEnabled: true,
      recipientPhone: "254700000000",
    });
    expect(result.notification.deliveryStatus).not.toBe("SENT");
    expect(result.notification.deliveredAt).toBeNull();
  });
});

describe("deduplication", () => {
  it("does not write the same notice twice", async () => {
    const client = fakeClient();
    const input = { businessId: "biz-a", kind: "TASK_OVERDUE", title: "Overdue: renew permit", body: "Still open.", dedupeKey: "task-overdue:t1:2026-10-29" };
    const first = await createNotification(client, input);
    const second = await createNotification(client, input);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, deduplicated: true });
    expect(client.notifications).toHaveLength(1);
  });

  it("loses a race to the unique index without erroring", async () => {
    const client = fakeClient();
    await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Race winner", body: "Written first.", dedupeKey: "race-1" });
    // Simulate the loser of a race: its dedupe lookup ran before the winner committed.
    const realFind = client.erpNotification.findUnique;
    let firstCall = true;
    client.erpNotification.findUnique = async (args: any) => {
      if (firstCall) {
        firstCall = false;
        return null;
      }
      return realFind(args);
    };
    const result = await createNotification(client, { businessId: "biz-a", kind: "SYSTEM", title: "Race winner", body: "Written first.", dedupeKey: "race-1" });
    expect(result).toMatchObject({ created: false, deduplicated: true });
    expect(client.notifications.filter((row) => row.dedupeKey === "race-1")).toHaveLength(1);
  });

  it("scopes the key per tenant, so two businesses may use the same key", async () => {
    const client = fakeClient();
    const shared = { kind: "SYSTEM", title: "Daily close", body: "Close the day.", dedupeKey: "daily-close:2026-10-29" };
    await createNotification(client, { businessId: "biz-a", ...shared });
    await createNotification(client, { businessId: "biz-b", ...shared });
    expect(client.notifications).toHaveLength(2);
  });
});

describe("task integration", () => {
  it("notifies the person a task is assigned to, once", async () => {
    const client = fakeClient();
    client.business = { findUnique: async () => ({ ownerId: "owner-1" }) };
    client.businessMember = { findUnique: async (_args: any) => ({ id: "membership" }) };
    let taskSequence = 0;
    const store: any[] = [];
    client.erpTask.create = async ({ data }: any) => {
      const row = { id: `task-${++taskSequence}`, ...data };
      store.push(row);
      return row;
    };
    client.erpTask.findUnique = async ({ where }: any) => {
      const key = where.businessId_idempotencyKey;
      return store.find((row) => row.businessId === key.businessId && row.idempotencyKey === key.idempotencyKey) ?? null;
    };
    client.erpTask.findFirst = async () => null;

    const { task } = await createTask(client, { businessId: "biz-a", title: "Count the shelves", assignedTo: "staff-1", actorId: "owner-1" });
    const notices = client.notifications.filter((row) => row.kind === "TASK_ASSIGNED");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ recipientId: "staff-1", businessId: "biz-a", sourceType: "TASK", sourceId: task.id });

    // A different task is a different notice.
    await createTask(client, { businessId: "biz-a", title: "Call the supplier", assignedTo: "staff-1", actorId: "owner-1" });
    expect(client.notifications.filter((row) => row.kind === "TASK_ASSIGNED")).toHaveLength(2);

    // A retried automation write (same idempotency key) returns the existing task and notifies nobody.
    const first = await createTask(client, { businessId: "biz-a", title: "File the return", assignedTo: "staff-1", idempotencyKey: "k-1" });
    const replay = await createTask(client, { businessId: "biz-a", title: "File the return", assignedTo: "staff-1", idempotencyKey: "k-1" });
    expect(replay.task.id).toBe(first.task.id);
    expect(client.notifications.filter((row) => row.kind === "TASK_ASSIGNED")).toHaveLength(3);
  });

  it("does not notify anybody when a task has no named owner", async () => {
    const client = fakeClient();
    client.erpTask.create = async ({ data }: any) => ({ id: "task-10", ...data });
    client.erpAuditEvent.create = async () => ({ id: "audit" });
    await createTask(client, { businessId: "biz-a", title: "Unassigned work", assignedRole: "FINANCE" });
    expect(client.notifications).toHaveLength(0);
  });

  it("raises one overdue notice per task per day and reuses it on a second sweep", async () => {
    const client = fakeClient();
    seedTask(client);
    const first = await sweepOverdueTasks(client, { businessId: "biz-a", now: NOW });
    const second = await sweepOverdueTasks(client, { businessId: "biz-a", now: NOW });
    expect(first.raised).toBe(1);
    expect(second.raised).toBe(0);
    expect(client.notifications).toHaveLength(1);
    expect(client.notifications[0]).toMatchObject({ kind: "TASK_OVERDUE", recipientId: "staff-1", priority: "HIGH" });
  });

  it("addresses an unassigned overdue task to its role instead of a person", async () => {
    const client = fakeClient();
    seedTask(client, { id: "t2", assignedTo: null, assignedRole: "FINANCE" });
    await notifyTaskOverdue(client, { businessId: "biz-a", task: client.tasks[0], now: NOW });
    expect(client.notifications[0]).toMatchObject({ recipientId: null, audienceRole: "FINANCE" });
  });
});
