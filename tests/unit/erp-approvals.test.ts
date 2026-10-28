/**
 * Approvals — the rules, with a fake client.
 *
 * The point of this object is that authority cannot be asserted by the caller: it is derived from the
 * decider's role, the amount and the per-tenant threshold, and it is re-derived on every decision. These
 * tests pin that, plus self-approval, terminal states, withdrawal rights, idempotency and the two
 * notifications a request raises.
 */
import { describe, expect, it } from "vitest";
import {
  approvalAuthority,
  approvalLimitFor,
  approvalSummary,
  createApprovalRequest,
  decideApprovalRequest,
  isTerminalApprovalStatus,
  listApprovalRequests,
  normalizeApprovalKind,
  validateApprovalInput,
  withdrawApprovalRequest,
} from "@/lib/erp/approvals";

function fakeClient() {
  const requests: any[] = [];
  const events: any[] = [];
  const notifications: any[] = [];
  const audits: any[] = [];
  let sequence = 0;
  const duplicate = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  const client: any = {
    requests,
    events,
    notifications,
    audits,
    erpApprovalRequest: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_idempotencyKey;
        return requests.find((row) => row.businessId === key.businessId && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      findFirst: async ({ where }: any) => requests.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null,
      create: async ({ data }: any) => {
        if (data.idempotencyKey && requests.some((row) => row.businessId === data.businessId && row.idempotencyKey === data.idempotencyKey)) throw duplicate();
        const row = { id: `req-${++sequence}`, decidedBy: null, decidedAt: null, decisionNote: null, ...data };
        requests.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = requests.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }: any) => {
        let rows = requests.filter((row) => row.businessId === where.businessId);
        if (where.status) rows = rows.filter((row) => row.status === where.status);
        if (where.OR) {
          rows = rows.filter((row) => where.OR.some((clause: any) =>
            (clause.requestedBy && row.requestedBy === clause.requestedBy) || (clause.approverId && row.approverId === clause.approverId)));
        }
        return rows.map((row) => ({ ...row, events: events.filter((event) => event.requestId === row.id) }));
      },
      count: async ({ where }: any) => requests.filter((row) => row.businessId === where.businessId && (!where.status || row.status === where.status)).length,
    },
    erpApprovalEvent: {
      create: async ({ data }: any) => {
        const row = { id: `evt-${++sequence}`, ...data };
        events.push(row);
        return row;
      },
    },
    erpNotification: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_dedupeKey;
        return notifications.find((row) => row.businessId === key.businessId && row.dedupeKey === key.dedupeKey) ?? null;
      },
      create: async ({ data }: any) => {
        if (data.dedupeKey && notifications.some((row) => row.businessId === data.businessId && row.dedupeKey === data.dedupeKey)) throw duplicate();
        const row = { id: `note-${++sequence}`, ...data };
        notifications.push(row);
        return row;
      },
    },
    erpAuditEvent: { create: async ({ data }: any) => { audits.push(data); return { id: `audit-${++sequence}` }; } },
  };
  return client;
}

const staff = { userId: "staff-1", role: "STAFF", name: "Staff One" };
const manager = { userId: "manager-1", role: "MANAGER", name: "Manager One" };
const owner = { userId: "owner-1", role: "OWNER", name: "Owner One" };

async function raise(client: any, overrides: Record<string, unknown> = {}) {
  return createApprovalRequest(client, {
    businessId: "biz-a",
    kind: "SPEND",
    title: "Buy 40 bags of cement",
    amountCents: 500_000,
    approverRole: "MANAGER",
    requestedBy: staff.userId,
    requestedName: staff.name,
    requestedRole: staff.role,
    ...overrides,
  });
}

describe("validation", () => {
  it("accepts a well-formed request and normalises the kind", () => {
    const result = validateApprovalInput({ kind: "purchase", title: "Order cement", amountCents: 100_000, approverRole: "manager" });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe("PURCHASE");
    expect(result.value.approverRole).toBe("MANAGER");
  });

  it("refuses a short title, a fractional amount and a link that leaves the workspace", () => {
    expect(validateApprovalInput({ title: "ab", amountCents: 1, approverRole: "OWNER" }).ok).toBe(false);
    expect(validateApprovalInput({ title: "Buy cement", amountCents: 10.5, approverRole: "OWNER" }).ok).toBe(false);
    expect(validateApprovalInput({ title: "Buy cement", amountCents: 10, approverRole: "OWNER", href: "https://evil.example" }).ok).toBe(false);
  });

  it("refuses to address a request to a viewer, who cannot approve anything", () => {
    const result = validateApprovalInput({ title: "Buy cement", amountCents: 10, approverRole: "VIEWER" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/viewer cannot approve/i);
  });

  it("falls back to OTHER for an unknown kind rather than inventing one", () => {
    expect(normalizeApprovalKind("BRIBE")).toBe("OTHER");
    expect(isTerminalApprovalStatus("APPROVED")).toBe(true);
    expect(isTerminalApprovalStatus("PENDING")).toBe(false);
  });
});

describe("authority to decide", () => {
  const pending = { requestedBy: "staff-1", approverRole: "MANAGER", approverId: null, amountCents: 500_000, status: "PENDING" };

  it("lets a manager decide a request addressed to a manager, inside their limit", () => {
    expect(approvalAuthority({ request: pending, decider: manager }).allowed).toBe(true);
  });

  it("refuses a manager above their limit and lets an owner through", () => {
    const big = { ...pending, amountCents: 5_000_000 };
    const managerDecision = approvalAuthority({ request: big, decider: manager });
    expect(managerDecision.allowed).toBe(false);
    expect(managerDecision.reason).toMatch(/above your approval limit/i);
    expect(approvalAuthority({ request: big, decider: owner }).allowed).toBe(true);
  });

  it("refuses self-approval even for the owner", () => {
    const own = { ...pending, requestedBy: owner.userId, approverRole: "OWNER" as const };
    expect(approvalAuthority({ request: own, decider: owner }).allowed).toBe(false);
  });

  it("refuses a role without the permission, a lower role, and a request addressed to somebody else", () => {
    expect(approvalAuthority({ request: pending, decider: staff }).allowed).toBe(false);
    const forOwner = { ...pending, approverRole: "OWNER" };
    expect(approvalAuthority({ request: forOwner, decider: manager }).allowed).toBe(false);
    // A request addressed to one named person is only decidable by that person, even by an owner:
    // "ask somebody specific" is a deliberate choice, not a suggestion.
    const named = { ...pending, approverId: manager.userId };
    expect(approvalAuthority({ request: named, decider: manager }).allowed).toBe(true);
    expect(approvalAuthority({ request: named, decider: owner }).allowed).toBe(false);
    expect(approvalAuthority({ request: named, decider: { userId: "manager-2", role: "MANAGER" } }).allowed).toBe(false);
  });

  it("refuses once the request is no longer pending", () => {
    expect(approvalAuthority({ request: { ...pending, status: "APPROVED" }, decider: manager }).allowed).toBe(false);
  });

  it("honours a per-tenant threshold below the role limit", () => {
    const decision = approvalAuthority({ request: { ...pending, amountCents: 300_000 }, decider: manager, thresholdCents: 100_000 });
    expect(decision.allowed).toBe(false);
  });

  it("reports the limit each role carries", () => {
    expect(approvalLimitFor("MANAGER")).toBe(1_000_000);
    expect(approvalLimitFor("FINANCE")).toBe(5_000_000);
    expect(approvalLimitFor("STAFF")).toBe(0);
    expect(approvalLimitFor("accountant")).toBe(5_000_000);
  });
});

describe("raising and deciding", () => {
  it("stores the request, appends REQUESTED, notifies the decider and audits it", async () => {
    const client = fakeClient();
    const { request, created } = await raise(client);
    expect(created).toBe(true);
    expect(request).toMatchObject({ businessId: "biz-a", status: "PENDING", amountCents: 500_000, approverRole: "MANAGER" });
    expect(client.events.map((event: any) => event.action)).toEqual(["REQUESTED"]);
    expect(client.notifications).toHaveLength(1);
    expect(client.notifications[0]).toMatchObject({ kind: "APPROVAL_REQUESTED", audienceRole: "MANAGER", priority: "HIGH" });
    expect(client.audits.map((row: any) => row.action)).toEqual(["APPROVAL_REQUESTED"]);
  });

  it("notifies one named decider when the request names somebody", async () => {
    const client = fakeClient();
    await raise(client, { approverRole: "MANAGER", approverId: manager.userId });
    expect(client.notifications[0]).toMatchObject({ recipientId: manager.userId, audienceRole: "ALL" });
  });

  it("is idempotent on the key, so a double-submitted form raises one request", async () => {
    const client = fakeClient();
    const first = await raise(client, { idempotencyKey: "form-1" });
    const second = await raise(client, { idempotencyKey: "form-1" });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, deduplicated: true });
    expect(client.requests).toHaveLength(1);
  });

  it("approves, records the decider, appends an event, notifies the requester and audits", async () => {
    const client = fakeClient();
    const { request } = await raise(client);
    const result = await decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "APPROVE", note: "Within budget", decider: manager });
    expect(result.status).toBe("APPROVED");
    expect(client.requests[0]).toMatchObject({ status: "APPROVED", decidedBy: manager.userId, decidedRole: "MANAGER", decisionNote: "Within budget" });
    expect(client.events.map((event: any) => event.action)).toEqual(["REQUESTED", "APPROVED"]);
    expect(client.notifications.some((row: any) => row.kind === "APPROVAL_DECIDED" && row.recipientId === staff.userId)).toBe(true);
    expect(client.audits.map((row: any) => row.action)).toContain("APPROVAL_GRANTED");
  });

  it("refuses self-approval at the decision point, not only in the UI", async () => {
    const client = fakeClient();
    const { request } = await raise(client, { requestedBy: manager.userId, requestedName: manager.name });
    await expect(decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "APPROVE", decider: manager })).rejects.toThrow(/cannot approve your own/i);
    expect(client.requests[0].status).toBe("PENDING");
  });

  it("requires a reason to reject and records it", async () => {
    const client = fakeClient();
    const { request } = await raise(client);
    await expect(decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "REJECT", note: "", decider: manager })).rejects.toThrow(/why/i);
    const result = await decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "REJECT", note: "Supplier is not approved", decider: manager });
    expect(result.status).toBe("REJECTED");
    expect(client.audits.some((row: any) => row.action === "APPROVAL_REJECTED" && row.reason === "Supplier is not approved")).toBe(true);
  });

  it("refuses a second decision on a decided request", async () => {
    const client = fakeClient();
    const { request } = await raise(client);
    await decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "APPROVE", decider: manager });
    await expect(decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "REJECT", note: "changed my mind", decider: owner })).rejects.toThrow(/already been decided/i);
  });

  it("refuses a decision on another tenant's request", async () => {
    const client = fakeClient();
    const { request } = await raise(client);
    await expect(decideApprovalRequest(client, { businessId: "biz-b", requestId: request.id, decision: "APPROVE", decider: owner })).rejects.toThrow(/not found/i);
  });

  it("lets the requester withdraw, and nobody else", async () => {
    const client = fakeClient();
    const { request } = await raise(client, { requestedBy: staff.userId });
    await expect(withdrawApprovalRequest(client, { businessId: "biz-a", requestId: request.id, requester: { userId: "someone-else" } })).rejects.toThrow(/only the person who asked/i);
    const result = await withdrawApprovalRequest(client, { businessId: "biz-a", requestId: request.id, requester: staff });
    expect(result.request.status).toBe("WITHDRAWN");
    await expect(withdrawApprovalRequest(client, { businessId: "biz-a", requestId: request.id, requester: staff })).rejects.toThrow(/already been decided/i);
  });
});

describe("the queue", () => {
  it("marks which rows this person may decide and never shows another tenant's rows", async () => {
    const client = fakeClient();
    const mine = await raise(client);
    await raise(client, { businessId: "biz-b", title: "Other tenant request" });
    const rows = await listApprovalRequests(client, { businessId: "biz-a", decider: manager });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: mine.request.id, canDecide: true });
    const asStaff = await listApprovalRequests(client, { businessId: "biz-a", decider: staff });
    expect(asStaff[0].canDecide).toBe(false);
  });

  it("scopes to `mine` for people who cannot see the whole queue", async () => {
    const client = fakeClient();
    await raise(client, { title: "Raised by staff" });
    await raise(client, { requestedBy: owner.userId, requestedName: owner.name, title: "Raised by owner" });
    const mine = await listApprovalRequests(client, { businessId: "biz-a", decider: manager, scope: "mine" });
    expect(mine).toHaveLength(0);
    const theirs = await listApprovalRequests(client, { businessId: "biz-a", decider: staff, scope: "mine" });
    expect(theirs).toHaveLength(1);
    expect(theirs[0].title).toBe("Raised by staff");
  });

  it("counts waiting, approved and rejected separately", async () => {
    const client = fakeClient();
    const one = await raise(client);
    const two = await raise(client, { title: "Second request" });
    await decideApprovalRequest(client, { businessId: "biz-a", requestId: one.request.id, decision: "APPROVE", decider: manager });
    await decideApprovalRequest(client, { businessId: "biz-a", requestId: two.request.id, decision: "REJECT", note: "No budget", decider: manager });
    expect(await approvalSummary(client, "biz-a")).toEqual({ pending: 0, approved: 1, rejected: 1 });
  });
});
