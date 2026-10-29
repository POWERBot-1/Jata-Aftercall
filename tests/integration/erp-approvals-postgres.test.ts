/**
 * Approvals against a real PostgreSQL database.
 *
 * What only the database can prove: a request belongs to one tenant and cannot be decided from
 * another, the idempotency key survives a concurrent double submit, the event history is append-only
 * in practice, and the notification each transition raises is deduplicated by its unique key.
 *
 * Environment: PRISMA_TEST_DATABASE_URL (an isolated, migrated database — never production) and,
 * where the native engine cannot be downloaded, PRISMA_WASM_HARNESS_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approvalSummary,
  consumeApproval,
  createApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
  requireApprovalFor,
  withdrawApprovalRequest,
} from "@/lib/erp/approvals";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = { ownerA: "", ownerB: "", staffA: "", managerA: "", businessA: "", businessB: "" };

async function makeUser(label: string) {
  return client.user.create({ data: { email: `approval-${label}-${stamp}@example.test`, name: `Approval ${label}`, passwordHash: "not-a-real-login" } });
}

describe.skipIf(!enabled)("approvals against real PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    const ownerA = await makeUser("owner-a");
    const ownerB = await makeUser("owner-b");
    const staffA = await makeUser("staff-a");
    const managerA = await makeUser("manager-a");
    ids.ownerA = ownerA.id;
    ids.ownerB = ownerB.id;
    ids.staffA = staffA.id;
    ids.managerA = managerA.id;
    const businessA = await client.business.create({ data: { ownerId: ownerA.id, slug: `approval-a-${stamp}`, name: "Approval A", category: "retail" } });
    const businessB = await client.business.create({ data: { ownerId: ownerB.id, slug: `approval-b-${stamp}`, name: "Approval B", category: "retail" } });
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;
    await client.businessMember.create({ data: { userId: staffA.id, businessId: businessA.id, role: "STAFF" } });
    await client.businessMember.create({ data: { userId: managerA.id, businessId: businessA.id, role: "MANAGER" } });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      const businesses = [ids.businessA, ids.businessB].filter(Boolean);
      await client.erpApprovalEvent.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpApprovalRequest.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpNotificationRead.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpNotification.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpAuditEvent.deleteMany({ where: { businessId: { in: businesses } } });
      await client.business.deleteMany({ where: { id: { in: businesses } } });
      await client.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB, ids.staffA, ids.managerA].filter(Boolean) } } });
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("stores a request with its first event", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      kind: "SPEND",
      title: "Buy 40 bags of cement",
      amountCents: 500_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
      requestedName: "Staff A",
      requestedRole: "STAFF",
    });
    const stored = await client.erpApprovalRequest.findUnique({ where: { id: request.id }, include: { events: true } });
    expect(stored).toMatchObject({ businessId: ids.businessA, status: "PENDING", amountCents: 500_000, decidedBy: null });
    expect(stored.events.map((event: any) => event.action)).toEqual(["REQUESTED"]);
  });

  it("refuses a decision from another tenant and leaves the request pending", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "Tenant A spend",
      amountCents: 100_000,
      approverRole: "OWNER",
      requestedBy: ids.staffA,
    });
    await expect(
      decideApprovalRequest(client, { businessId: ids.businessB, requestId: request.id, decision: "APPROVE", decider: { userId: ids.ownerB, role: "OWNER" } }),
    ).rejects.toThrow(/not found/i);
    const stored = await client.erpApprovalRequest.findUnique({ where: { id: request.id } });
    expect(stored.status).toBe("PENDING");
  });

  it("refuses self-approval on the server", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "Owner's own spend",
      amountCents: 50_000,
      approverRole: "OWNER",
      requestedBy: ids.ownerA,
    });
    await expect(
      decideApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, decision: "APPROVE", decider: { userId: ids.ownerA, role: "OWNER" } }),
    ).rejects.toThrow(/cannot approve your own/i);
  });

  it("enforces the role limit and the per-tenant threshold", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "Big purchase",
      amountCents: 2_000_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
    });
    await expect(
      decideApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, decision: "APPROVE", decider: { userId: ids.managerA, role: "MANAGER" } }),
    ).rejects.toThrow(/above your approval limit/i);

    await expect(
      decideApprovalRequest(client, {
        businessId: ids.businessA,
        requestId: request.id,
        decision: "APPROVE",
        decider: { userId: ids.managerA, role: "MANAGER" },
        thresholdCents: 100_000,
      }),
    ).rejects.toThrow(/above your approval limit/i);

    const decided = await decideApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, decision: "APPROVE", decider: { userId: ids.ownerA, role: "OWNER" } });
    expect(decided.status).toBe("APPROVED");
  });

  it("survives two concurrent submissions with the same key", async () => {
    const input = {
      businessId: ids.businessA,
      kind: "PURCHASE" as const,
      title: "Concurrent request",
      amountCents: 10_000,
      approverRole: "OWNER",
      requestedBy: ids.staffA,
      idempotencyKey: `pg-approval-race-${stamp}`,
    };
    const results = await Promise.all([
      createApprovalRequest(client, input).catch((error) => ({ error })),
      createApprovalRequest(client, input).catch((error) => ({ error })),
    ]);
    const rows = await client.erpApprovalRequest.findMany({ where: { businessId: ids.businessA, idempotencyKey: input.idempotencyKey } });
    expect(rows).toHaveLength(1);
    expect(results.filter((result: any) => result.created === true)).toHaveLength(1);
  });

  it("appends one event per transition and never rewrites history", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "History check",
      amountCents: 20_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
    });
    await decideApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, decision: "REJECT", note: "No budget this month", decider: { userId: ids.managerA, role: "MANAGER" } });
    const events = await client.erpApprovalEvent.findMany({ where: { requestId: request.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event: any) => event.action)).toEqual(["REQUESTED", "REJECTED"]);
    expect(events[1].note).toBe("No budget this month");
    expect(events[1].actorId).toBe(ids.managerA);
  });

  it("lets only the requester withdraw, and only while pending", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "Withdraw check",
      amountCents: 0,
      approverRole: "OWNER",
      requestedBy: ids.staffA,
    });
    await expect(
      withdrawApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, requester: { userId: ids.managerA } }),
    ).rejects.toThrow(/only the person who asked/i);
    const withdrawn = await withdrawApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, requester: { userId: ids.staffA } });
    expect(withdrawn.request.status).toBe("WITHDRAWN");
    await expect(
      withdrawApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, requester: { userId: ids.staffA } }),
    ).rejects.toThrow(/already been decided/i);
  });

  it("raises one request notice and one decision notice, deduplicated by key", async () => {
    const { request } = await createApprovalRequest(client, {
      businessId: ids.businessA,
      title: "Notice check",
      amountCents: 30_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
      requestedName: "Staff A",
    });
    const asked = await client.erpNotification.findMany({ where: { businessId: ids.businessA, sourceType: "APPROVAL", sourceId: request.id } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: "APPROVAL_REQUESTED", audienceRole: "MANAGER" });

    await decideApprovalRequest(client, { businessId: ids.businessA, requestId: request.id, decision: "APPROVE", decider: { userId: ids.managerA, role: "MANAGER", name: "Manager A" } });
    const decided = await client.erpNotification.findMany({ where: { businessId: ids.businessA, sourceType: "APPROVAL", sourceId: request.id, kind: "APPROVAL_DECIDED" } });
    expect(decided).toHaveLength(1);
    expect(decided[0].recipientId).toBe(ids.staffA);
  });

  it("scopes the queue per tenant and per viewer", async () => {
    await createApprovalRequest(client, { businessId: ids.businessB, title: "Tenant B request", amountCents: 1, approverRole: "OWNER", requestedBy: ids.ownerB });
    const queueA = await listApprovalRequests(client, { businessId: ids.businessA, decider: { userId: ids.ownerA, role: "OWNER" }, limit: 200 });
    expect(queueA.every((row: any) => row.businessId === ids.businessA)).toBe(true);
    expect(queueA.some((row: any) => row.title === "Tenant B request")).toBe(false);

    const ownScope = await listApprovalRequests(client, { businessId: ids.businessA, decider: { userId: ids.staffA, role: "STAFF" }, scope: "mine", limit: 200 });
    expect(ownScope.every((row: any) => row.requestedBy === ids.staffA || row.approverId === ids.staffA)).toBe(true);
  });

  it("spends a grant exactly once, even when two submits race", async () => {
    const raised = await createApprovalRequest(client, {
      businessId: ids.businessA,
      kind: "SPEND",
      title: "Bulk order deposit",
      amountCents: 900_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
      requestedName: "Staff A",
      requestedRole: "STAFF",
      idempotencyKey: `consume-${stamp}`,
    });
    await decideApprovalRequest(client, { businessId: ids.businessA, requestId: raised.request.id, decision: "APPROVE", decider: { userId: ids.managerA, role: "MANAGER", name: "Manager A" } });

    const [first, second] = await Promise.all([
      consumeApproval(client, { businessId: ids.businessA, requesterId: ids.staffA, kind: "SPEND", amountCents: 900_000, ref: `expense:${stamp}:a` }),
      consumeApproval(client, { businessId: ids.businessA, requesterId: ids.staffA, kind: "SPEND", amountCents: 900_000, ref: `expense:${stamp}:b` }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const stored = await client.erpApprovalRequest.findUnique({ where: { id: raised.request.id } });
    expect(stored.consumedAt).not.toBeNull();
    expect(stored.consumedRef).toMatch(new RegExp(`^expense:${stamp}:[ab]$`));
    const consumedEvents = await client.erpApprovalEvent.findMany({ where: { requestId: raised.request.id, action: "CONSUMED" } });
    expect(consumedEvents).toHaveLength(1);

    const replay = await consumeApproval(client, { businessId: ids.businessA, requesterId: ids.staffA, kind: "SPEND", amountCents: 900_000, ref: `expense:${stamp}:c` });
    expect(replay).toBeNull();
  });

  it("refuses a grant from another tenant and a grant that is too small", async () => {
    const small = await createApprovalRequest(client, {
      businessId: ids.businessA,
      kind: "SPEND",
      title: "Small purchase",
      amountCents: 50_000,
      approverRole: "MANAGER",
      requestedBy: ids.staffA,
      requestedRole: "STAFF",
      idempotencyKey: `small-${stamp}`,
    });
    await decideApprovalRequest(client, { businessId: ids.businessA, requestId: small.request.id, decision: "APPROVE", decider: { userId: ids.managerA, role: "MANAGER" } });

    expect(await consumeApproval(client, { businessId: ids.businessA, requesterId: ids.staffA, kind: "SPEND", amountCents: 50_001, ref: `x:${stamp}` })).toBeNull();
    expect(await consumeApproval(client, { businessId: ids.businessB, requesterId: ids.staffA, kind: "SPEND", amountCents: 100, ref: `y:${stamp}` })).toBeNull();
    const stored = await client.erpApprovalRequest.findUnique({ where: { id: small.request.id } });
    expect(stored.consumedAt).toBeNull();
  });

  it("raises a request instead of posting when a manager exceeds the limit, then lets the owner unblock it", async () => {
    const ref = `journal:${stamp}:gate`;
    const blocked = await requireApprovalFor({
      client,
      businessId: ids.businessA,
      requester: { userId: ids.managerA, role: "MANAGER", name: "Manager A" },
      kind: "JOURNAL",
      amountCents: 3_000_000,
      title: "Journal: Reclassify stock",
      ref,
    });
    expect(blocked.blocked).toBe(true);
    if (!blocked.blocked) throw new Error("unreachable");
    expect(blocked.request.approverRole).toBe("ADMIN");

    await decideApprovalRequest(client, { businessId: ids.businessA, requestId: blocked.request.id, decision: "APPROVE", decider: { userId: ids.ownerA, role: "OWNER", name: "Owner A" } });
    const unblocked = await requireApprovalFor({
      client,
      businessId: ids.businessA,
      requester: { userId: ids.managerA, role: "MANAGER", name: "Manager A" },
      kind: "JOURNAL",
      amountCents: 3_000_000,
      title: "Journal: Reclassify stock",
      ref,
    });
    expect(unblocked.blocked).toBe(false);
    if (unblocked.blocked) throw new Error("unreachable");
    expect(unblocked.consumed?.consumedRef).toBe(ref);
    const audits = await client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, action: "APPROVAL_CONSUMED", targetId: blocked.request.id } });
    expect(audits).toHaveLength(1);
  });

  it("counts the queue for the dashboard", async () => {
    const summary = await approvalSummary(client, ids.businessA);
    expect(summary.pending + summary.approved + summary.rejected).toBeGreaterThan(0);
  });
});
