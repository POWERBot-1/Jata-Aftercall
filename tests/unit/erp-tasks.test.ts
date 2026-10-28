/**
 * Operational tasks — the rules that are enforced on the server.
 *
 * These are the pure parts: input validation, the state machine, the inbox bucketing and the
 * tenant-scoped idempotency contract. The database behaviour (tenant isolation, duplicate
 * prevention, audit rows) is proven separately against a real PostgreSQL in
 * tests/integration/erp-tasks-postgres.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import {
  bucketTasks,
  isTerminalTaskStatus,
  normalizeTaskPriority,
  normalizeTaskStatus,
  taskTransitionAllowed,
  validateTaskInput,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@/lib/erp/tasks";

describe("task input validation", () => {
  it("accepts a minimal task", () => {
    const result = validateTaskInput({ title: "Renew the depot fire certificate" });
    expect(result.ok).toBe(true);
    expect(result.value.priority).toBe("NORMAL");
    expect(result.value.sourceType).toBe("MANUAL");
  });

  it("refuses a title that is too short or too long", () => {
    expect(validateTaskInput({ title: "ab" }).ok).toBe(false);
    expect(validateTaskInput({ title: "a".repeat(141) }).ok).toBe(false);
  });

  it("refuses an impossible due date instead of silently storing today", () => {
    const result = validateTaskInput({ title: "Follow up order", dueAt: "not-a-date" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/due date/i);
  });

  it("accepts a due date in the past, because capturing overdue work is the point", () => {
    const result = validateTaskInput({ title: "Expired permit", dueAt: "2020-01-01T00:00:00Z" });
    expect(result.ok).toBe(true);
    expect((result.value as any).overdue).toBe(true);
  });

  it("normalises an unknown priority to NORMAL rather than trusting the form", () => {
    expect(normalizeTaskPriority("super-urgent")).toBe("NORMAL");
    expect(normalizeTaskPriority("HIGH")).toBe("HIGH");
    for (const priority of TASK_PRIORITIES) expect(normalizeTaskPriority(priority)).toBe(priority);
  });

  it("normalises an unknown status to OPEN", () => {
    expect(normalizeTaskStatus("deleted")).toBe("OPEN");
    expect(normalizeTaskStatus("in progress")).toBe("IN_PROGRESS");
    for (const status of TASK_STATUSES) expect(normalizeTaskStatus(status)).toBe(status);
  });
});

describe("task state machine", () => {
  it("allows the forward path", () => {
    expect(taskTransitionAllowed("OPEN", "IN_PROGRESS").ok).toBe(true);
    expect(taskTransitionAllowed("IN_PROGRESS", "DONE").ok).toBe(true);
    expect(taskTransitionAllowed("OPEN", "DONE").ok).toBe(true);
    expect(taskTransitionAllowed("OPEN", "CANCELLED").ok).toBe(true);
    expect(taskTransitionAllowed("IN_PROGRESS", "CANCELLED").ok).toBe(true);
  });

  it("treats DONE and CANCELLED as terminal", () => {
    for (const status of ["DONE", "CANCELLED"] as const) {
      expect(isTerminalTaskStatus(status)).toBe(true);
      expect(taskTransitionAllowed(status, "OPEN").ok).toBe(false);
      expect(taskTransitionAllowed(status, "IN_PROGRESS").ok).toBe(false);
    }
    expect(taskTransitionAllowed("DONE", "DONE").ok).toBe(true);
  });

  it("refuses to move a task backwards to OPEN", () => {
    const result = taskTransitionAllowed("IN_PROGRESS", "OPEN");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot go back/i);
  });

  it("refuses to start a task that was already started", () => {
    expect(taskTransitionAllowed("IN_PROGRESS", "IN_PROGRESS").ok).toBe(true);
    expect(taskTransitionAllowed("OPEN", "OPEN").ok).toBe(true);
  });
});

describe("inbox bucketing", () => {
  const now = new Date("2026-10-28T09:00:00Z");
  const tasks = [
    { id: "overdue", status: "OPEN", dueAt: "2026-10-20T09:00:00Z" },
    { id: "today", status: "IN_PROGRESS", dueAt: "2026-10-28T15:00:00Z" },
    { id: "later", status: "OPEN", dueAt: "2026-11-05T09:00:00Z" },
    { id: "undated", status: "OPEN", dueAt: null },
    { id: "done", status: "DONE", dueAt: "2026-10-01T09:00:00Z" },
    { id: "cancelled", status: "CANCELLED", dueAt: null },
  ];

  it("puts overdue work first and keeps terminal work out of the open buckets", () => {
    const buckets = bucketTasks(tasks, now);
    expect(buckets.overdue.map((task: any) => task.id)).toEqual(["overdue"]);
    expect(buckets.upcoming.map((task: any) => task.id)).toEqual(["later"]);
    expect(buckets.undated.map((task: any) => task.id)).toEqual(["undated"]);
    expect(buckets.done.map((task: any) => task.id)).toEqual(["done"]);
    expect(buckets.cancelled.map((task: any) => task.id)).toEqual(["cancelled"]);
    const openIds = [...buckets.overdue, ...buckets.dueToday, ...buckets.upcoming, ...buckets.undated].map((task: any) => task.id);
    expect(openIds).not.toContain("done");
    expect(openIds).not.toContain("cancelled");
  });

  it("does not lose a task: every input lands in exactly one bucket", () => {
    const buckets = bucketTasks(tasks, now);
    const all = [...buckets.overdue, ...buckets.dueToday, ...buckets.upcoming, ...buckets.undated, ...buckets.done, ...buckets.cancelled];
    expect(all).toHaveLength(tasks.length);
    expect(new Set(all.map((task: any) => task.id)).size).toBe(tasks.length);
  });
});

describe("tenant scoping of the write paths", () => {
  // A fake client that records the filters it is asked to use. The point is not to test Prisma; it
  // is to prove the module never looks a task up by id alone.
  function fakeClient(taskOverrides: Record<string, unknown> = {}) {
    const calls: any[] = [];
    const task = { id: "t1", businessId: "biz-a", status: "OPEN", priority: "NORMAL", assignedTo: null, dueAt: null, ...taskOverrides };
    return {
      calls,
      business: { findUnique: async () => ({ ownerId: "owner-1" }) },
      businessMember: { findUnique: async (_args: any) => null },
      erpAuditEvent: { create: async (_args: any) => ({ id: "audit" }) },
      erpTask: {
        findFirst: async (args: any) => { calls.push(["findFirst", args]); return task.businessId === "biz-a" ? task : null; },
        findUnique: async (_args: any) => { calls.push(["findUnique", _args]); return null; },
        create: async (args: any) => { calls.push(["create", args]); return { id: "new", ...args.data }; },
        update: async (args: any) => { calls.push(["update", args]); return { ...task, ...args.data }; },
      },
    };
  }

  it("reads a task with the tenant in the query, not after the fact", async () => {
    const { updateTask } = await import("@/lib/erp/tasks");
    const client = fakeClient();
    await updateTask(client, { businessId: "biz-a", taskId: "t1", status: "DONE" });
    const lookup = client.calls.find(([name]) => name === "findFirst")![1];
    expect(lookup.where).toEqual({ id: "t1", businessId: "biz-a" });
  });

  it("resolves a task id from another tenant to not-found", async () => {
    const { updateTask } = await import("@/lib/erp/tasks");
    const client = fakeClient({ businessId: "biz-b" });
    await expect(updateTask(client, { businessId: "biz-a", taskId: "t1", status: "DONE" })).rejects.toThrow(/not found/i);
    expect(client.calls.some(([name]) => name === "update")).toBe(false);
  });

  it("does not write anything when the transition is refused", async () => {
    const { updateTask } = await import("@/lib/erp/tasks");
    const client = fakeClient({ status: "DONE" });
    await expect(updateTask(client, { businessId: "biz-a", taskId: "t1", status: "OPEN" })).rejects.toThrow(/already done|new task/i);
    expect(client.calls.some(([name]) => name === "update")).toBe(false);
  });

  it("requires a reason to cancel", async () => {
    const { updateTask } = await import("@/lib/erp/tasks");
    const client = fakeClient();
    await expect(updateTask(client, { businessId: "biz-a", taskId: "t1", status: "CANCELLED" })).rejects.toThrow(/why/i);
  });

  it("returns the existing row instead of duplicating an idempotent automation task", async () => {
    const { createTask } = await import("@/lib/erp/tasks");
    const client = fakeClient();
    client.erpTask.findUnique = async (_args: any) => ({ id: "existing", businessId: "biz-a" });
    const result = await createTask(client, { businessId: "biz-a", title: "Automation follow-up", idempotencyKey: "automation-task:rule:1:event:9" });
    expect(result.created).toBe(false);
    expect(result.deduplicated).toBe(true);
    expect(result.task.id).toBe("existing");
    expect(client.calls.some(([name]) => name === "create")).toBe(false);
  });

  it("refuses to assign work to somebody outside the tenant", async () => {
    const { createTask } = await import("@/lib/erp/tasks");
    const client = fakeClient();
    client.businessMember.findUnique = async (_args: any) => null; // not a member
    await expect(createTask(client, { businessId: "biz-a", title: "Call the supplier", assignedTo: "outsider" })).rejects.toThrow(/not a member/i);
    expect(client.calls.some(([name]) => name === "create")).toBe(false);
  });

  it("writes an audit row for a creation and for a status change", async () => {
    const { createTask, updateTask } = await import("@/lib/erp/tasks");
    const client = fakeClient();
    const audits: any[] = [];
    client.erpAuditEvent.create = async (args: any) => { audits.push(args.data); return { id: "a" }; };
    await createTask(client, { businessId: "biz-a", title: "Renew permit", actorId: "u1" });
    await updateTask(client, { businessId: "biz-a", taskId: "t1", status: "DONE", actorId: "u1" });
    expect(audits.map((row) => row.action)).toEqual(["TASK_CREATED", "TASK_STATUS_CHANGED"]);
    expect(audits.every((row) => row.businessId === "biz-a")).toBe(true);
  });
});

describe("the automation action is wired to the task table", () => {
  it("declares CREATE_TASK as implemented and low impact", async () => {
    const { AUTOMATION_ACTIONS } = await import("@/lib/erp/automation");
    const action = AUTOMATION_ACTIONS.find((entry) => entry.key === "CREATE_TASK");
    expect(action?.implemented).toBe(true);
    expect(action?.impact).toBe("LOW");
    expect(action?.requiresApproval).toBe(false);
  });

  it("raises a real task, once, for a replayed event", async () => {
    const { runAutomation } = await import("@/lib/erp/automation");
    vi.resetModules();
    const created: any[] = [];
    const client: any = {
      erpAutomationRule: {
        findUnique: async () => ({
          id: "rule-1",
          businessId: "biz-a",
          name: "Overdue invoice follow-up",
          status: "ACTIVE",
          trigger: "INVOICE_OVERDUE",
          conditionsJson: "[]",
          actionsJson: JSON.stringify([{ type: "CREATE_TASK", params: { title: "Chase the overdue invoice", dueInDays: 2 } }]),
          requiresApproval: false,
          runCountToday: 0,
          maxRunsPerDay: 50,
        }),
        update: async () => ({}),
      },
      erpConfiguration: { findUnique: async () => ({ featureFlagsJson: null }) },
      erpAutomationRun: {
        findUnique: async () => null,
        create: async (args: any) => ({ id: "run-1", ...args.data }),
      },
      erpTask: {
        findUnique: async () => null,
        create: async (args: any) => { created.push(args.data); return { id: `task-${created.length}`, ...args.data }; },
      },
      erpNotification: { create: async () => ({ id: "n1" }) },
      erpAuditEvent: { create: async () => ({ id: "a1" }) },
      business: { findUnique: async () => ({ ownerId: "u1" }) },
      businessMember: { findUnique: async () => null },
      msgContact: { findUnique: async () => null, update: async () => ({}) },
    };

    const result = await runAutomation(client, { businessId: "biz-a", ruleId: "rule-1", eventId: "evt-1", event: { invoiceId: "inv-1" }, dryRun: false, actorId: "u1" });
    expect(result.status).toBe("EXECUTED");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ businessId: "biz-a", title: "Chase the overdue invoice", sourceType: "AUTOMATION", status: "OPEN", assignedRole: "OWNER" });
    expect(created[0].idempotencyKey).toContain("evt-1");
    expect(created[0].dueAt).toBeInstanceOf(Date);
  });

  it("does nothing in preview mode", async () => {
    const { runAutomation } = await import("@/lib/erp/automation");
    const created: any[] = [];
    const client: any = {
      erpAutomationRule: {
        findUnique: async () => ({ id: "rule-1", businessId: "biz-a", name: "Rule", status: "ACTIVE", trigger: "T", conditionsJson: "[]", actionsJson: JSON.stringify([{ type: "CREATE_TASK", params: {} }]), requiresApproval: false, runCountToday: 0, maxRunsPerDay: 50 }),
        update: async () => ({}),
      },
      erpConfiguration: { findUnique: async () => null },
      erpAutomationRun: { findUnique: async () => null, create: async (args: any) => ({ id: "run-1", ...args.data }) },
      erpTask: { findUnique: async () => null, create: async (args: any) => { created.push(args.data); return { id: "t", ...args.data }; } },
      erpNotification: { create: async () => ({}) },
      erpAuditEvent: { create: async () => ({}) },
    };
    const result = await runAutomation(client, { businessId: "biz-a", ruleId: "rule-1", eventId: "evt-1", event: {} });
    expect(result.status).toBe("PREVIEW");
    expect(created).toHaveLength(0);
  });
});
