/**
 * Requisitions — the rules, with a fake client.
 *
 * A requisition's whole value is the control around it: anybody who is not read-only may ask, only
 * authority may decide, the asker may never decide their own request, an amendment sends the
 * request back for a fresh decision, and an approved request becomes exactly one purchase order.
 * Those are pinned here; tenant isolation and the real audit rows are proven against PostgreSQL in
 * tests/integration/erp-requisitions-postgres.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  amendRequisition,
  canDecideRequisition,
  canRaiseRequisition,
  cancelRequisition,
  convertRequisition,
  createRequisition,
  decideRequisition,
  isOpenRequisitionStatus,
  normalizeRequisitionPriority,
  normalizeRequisitionStatus,
  requisitionLineTotals,
  requisitionTotals,
  requisitionTransitionAllowed,
  submitRequisition,
  validateRequisitionInput,
} from "@/lib/erp/requisitions";

const owner = { userId: "owner-1", role: "OWNER", name: "Owner One" };
const manager = { userId: "manager-1", role: "MANAGER", name: "Manager One" };
const staff = { userId: "staff-1", role: "STAFF", name: "Staff One" };
const viewer = { userId: "viewer-1", role: "VIEWER", name: "Viewer One" };

function fakeClient() {
  const requests: any[] = [];
  const lines: any[] = [];
  const audits: any[] = [];
  const notifications: any[] = [];
  const orders: any[] = [];
  const sequences: Record<string, number> = {};
  const suppliers = [{ id: "sup-1", name: "Cement Traders", businessId: "biz-a" }];
  let counter = 0;

  const match = (where: any) =>
    requests.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null;

  const client: any = {
    requests, lines, audits, notifications, orders,
    posSupplier: {
      findFirst: async ({ where }: any) => suppliers.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null,
    },
    erpSequence: {
      upsert: async ({ where }: any) => {
        const key = where.businessId_key.key;
        sequences[key] = (sequences[key] ?? 0) + 1;
        return { value: sequences[key] };
      },
    },
    erpRequisition: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_idempotencyKey;
        return requests.find((row) => row.businessId === key.businessId && row.idempotencyKey && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      findFirst: async ({ where, include }: any) => {
        const row = match(where) ?? requests.find((request) => request.businessId === where.businessId && !where.id) ?? null;
        if (!row) return null;
        return include?.lines ? { ...row, lines: lines.filter((line) => line.requisitionId === row.id) } : row;
      },
      findMany: async () => requests.slice(),
      count: async () => requests.length,
      create: async ({ data }: any) => {
        counter += 1;
        const created: any = { id: `req-${counter}`, createdAt: new Date(), updatedAt: new Date(), submittedAt: null, ...data };
        const { lines: lineData, ...rest } = created;
        const row = { ...rest };
        requests.push(row);
        for (const [index, line] of (lineData?.create ?? []).entries()) {
          lines.push({ id: `reql-${counter}-${index}`, requisitionId: row.id, sortOrder: index, ...line });
        }
        return { ...row, lines: lines.filter((line) => line.requisitionId === row.id) };
      },
      update: async ({ where, data }: any) => {
        const row = requests.find((request) => request.id === where.id);
        if (!row) throw new Error("not found");
        const { lines: lineData, ...rest } = data;
        Object.assign(row, rest);
        if (lineData?.create) {
          for (const [index, line] of lineData.create.entries()) {
            lines.push({ id: `reql-${row.id}-${index}`, requisitionId: row.id, sortOrder: index, ...line });
          }
        }
        return row;
      },
    },
    erpRequisitionLine: {
      deleteMany: async ({ where }: any) => {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          if (lines[index].requisitionId === where.requisitionId) lines.splice(index, 1);
        }
        return { count: 0 };
      },
    },
    erpPurchaseOrder: {
      findFirst: async ({ where }: any) => orders.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null,
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const order = { id: `po-${orders.length + 1}`, status: "DRAFT", orderNumber: `PO-00000${orders.length + 1}`, ...data };
        orders.push(order);
        return order;
      },
      update: async ({ where, data }: any) => {
        const order = orders.find((row) => row.id === where.id);
        if (!order) throw new Error("not found");
        Object.assign(order, data);
        return order;
      },
    },
    erpAuditEvent: { create: async ({ data }: any) => { audits.push(data); return data; } },
    erpNotification: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `note-${notifications.length + 1}`, ...data };
        notifications.push(row);
        return row;
      },
    },
    $transaction: async (fn: any) => fn(client),
  };
  return client;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    businessId: "biz-a",
    title: "Bulk cement for the Kajiado site",
    justification: "Stock is below the reorder level",
    department: "Operations",
    priority: "HIGH",
    neededBy: null,
    supplierId: "sup-1",
    requestedBy: staff.userId,
    requestedName: staff.name,
    idempotencyKey: "key-1",
    lines: [{ description: "50 kg bag of cement", quantity: 40, estimatedUnitCostCents: 75_000, taxRateBps: 1600 }],
    ...overrides,
  } as any;
}

describe("requisition state machine", () => {
  it("allows the documented path and refuses the shortcuts", () => {
    expect(requisitionTransitionAllowed("DRAFT", "SUBMITTED").ok).toBe(true);
    expect(requisitionTransitionAllowed("SUBMITTED", "APPROVED").ok).toBe(true);
    expect(requisitionTransitionAllowed("APPROVED", "CONVERTED").ok).toBe(true);
    expect(requisitionTransitionAllowed("SUBMITTED", "DRAFT").ok).toBe(true);
    expect(requisitionTransitionAllowed("DRAFT", "APPROVED").ok).toBe(false);
    expect(requisitionTransitionAllowed("REJECTED", "APPROVED").ok).toBe(false);
    expect(requisitionTransitionAllowed("CONVERTED", "APPROVED").ok).toBe(false);
    expect(requisitionTransitionAllowed("CANCELLED", "DRAFT").ok).toBe(false);
  });

  it("labels an unknown status as a draft rather than inventing one", () => {
    expect(normalizeRequisitionStatus("nonsense")).toBe("DRAFT");
    expect(normalizeRequisitionPriority("urgent")).toBe("URGENT");
    expect(normalizeRequisitionPriority("whatever")).toBe("NORMAL");
  });

  it("treats only draft, submitted and approved as open", () => {
    expect(isOpenRequisitionStatus("DRAFT")).toBe(true);
    expect(isOpenRequisitionStatus("APPROVED")).toBe(true);
    expect(isOpenRequisitionStatus("REJECTED")).toBe(false);
    expect(isOpenRequisitionStatus("CONVERTED")).toBe(false);
  });
});

describe("requisition totals and validation", () => {
  it("computes line and document totals from the lines", () => {
    const line = requisitionLineTotals({ quantity: 40, estimatedUnitCostCents: 75_000, taxRateBps: 1600 });
    expect(line).toEqual({ lineSubtotalCents: 3_000_000, lineTaxCents: 480_000 });
    const totals = requisitionTotals([
      { quantity: 40, estimatedUnitCostCents: 75_000, taxRateBps: 1600 },
      { quantity: 2, estimatedUnitCostCents: 10_000, taxRateBps: 0 },
    ]);
    expect(totals).toEqual({ estimatedSubtotalCents: 3_020_000, estimatedTaxCents: 480_000, estimatedTotalCents: 3_500_000 });
  });

  it("rejects a request with no lines, a bad quantity or a non-integer cost", () => {
    expect(validateRequisitionInput({ title: "Buy cement", lines: [] }).ok).toBe(false);
    expect(validateRequisitionInput({ title: "Buy cement", lines: [{ description: "Cement", quantity: 0, estimatedUnitCostCents: 100 }] }).ok).toBe(false);
    expect(validateRequisitionInput({ title: "Buy cement", lines: [{ description: "Cement", quantity: 1.5, estimatedUnitCostCents: 10.5 }] }).ok).toBe(false);
    expect(validateRequisitionInput({ title: "Buy cement", lines: [{ description: "Cement", quantity: 1.5, estimatedUnitCostCents: 10, taxRateBps: 9900 }] }).ok).toBe(false);
  });

  it("accepts a sane request and normalises the priority", () => {
    const result = validateRequisitionInput({ title: "  Buy cement ", priority: "urgent", lines: [{ description: "Cement", quantity: 2, estimatedUnitCostCents: 1_000 }] });
    expect(result.ok).toBe(true);
    expect(result.value.title).toBe("Buy cement");
    expect(result.value.priority).toBe("URGENT");
    expect(result.value.estimatedSubtotalCents).toBe(2_000);
  });
});

describe("raising a requisition", () => {
  it("numbers it from the tenant sequence and audits the creation", async () => {
    const client = fakeClient();
    const { request, created } = await createRequisition(client, input());
    expect(created).toBe(true);
    expect(request.requisitionNumber).toBe("REQ-000001");
    expect(request.status).toBe("DRAFT");
    expect(request.estimatedSubtotalCents).toBe(3_000_000);
    expect(request.estimatedTaxCents).toBe(480_000);
    expect(client.lines).toHaveLength(1);
    expect(client.audits[0].action).toBe("REQUISITION_CREATED");
    expect(client.audits[0].businessId).toBe("biz-a");
  });

  it("does not raise a second request for the same idempotency key", async () => {
    const client = fakeClient();
    await createRequisition(client, input());
    const again = await createRequisition(client, input());
    expect(again.created).toBe(false);
    expect(again.deduplicated).toBe(true);
    expect(client.requests).toHaveLength(1);
  });

  it("refuses a supplier that belongs to another tenant", async () => {
    const client = fakeClient();
    await expect(createRequisition(client, input({ supplierId: "sup-other" }))).rejects.toThrow(/not on this business/i);
  });

  it("gives each tenant its own numbering", async () => {
    const client = fakeClient();
    const first = await createRequisition(client, input());
    const second = await createRequisition(client, input({ idempotencyKey: "key-2", supplierId: null }));
    expect(first.request.requisitionNumber).toBe("REQ-000001");
    expect(second.request.requisitionNumber).toBe("REQ-000002");
  });
});

describe("deciding a requisition", () => {
  it("lets a manager approve somebody else's submitted request", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    const decided = await decideRequisition(client, {
      businessId: "biz-a",
      requisitionId: request.id,
      decision: "APPROVE",
      approverRole: manager.role,
      actorId: manager.userId,
      actorName: manager.name,
    });
    expect(decided.status).toBe("APPROVED");
    expect(client.audits.map((row) => row.action)).toContain("REQUISITION_APPROVED");
    // The requester is told, once.
    expect(client.notifications).toHaveLength(1);
    expect(client.notifications[0].recipientId).toBe(staff.userId);
  });

  it("refuses self-approval even for the owner", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input({ requestedBy: owner.userId, requestedName: owner.name }));
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: owner.userId });
    await expect(
      decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "APPROVE", approverRole: "OWNER", actorId: owner.userId }),
    ).rejects.toThrow(/cannot decide your own/i);
  });

  it("refuses a role without spending authority", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    await expect(
      decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "APPROVE", approverRole: "STAFF", actorId: staff.userId }),
    ).rejects.toThrow(/cannot approve spending/i);
    await expect(
      decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "APPROVE", approverRole: "VIEWER", actorId: "viewer-1" }),
    ).rejects.toThrow(/cannot approve spending/i);
  });

  it("refuses to decide a draft that was never submitted", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await expect(
      decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "APPROVE", approverRole: "MANAGER", actorId: manager.userId }),
    ).rejects.toThrow(/cannot go from draft/i);
  });

  it("requires a reason to reject", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    await expect(
      decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "REJECT", approverRole: "MANAGER", actorId: manager.userId }),
    ).rejects.toThrow(/why the request is being rejected/i);
    const rejected = await decideRequisition(client, {
      businessId: "biz-a",
      requisitionId: request.id,
      decision: "REJECT",
      approverRole: "MANAGER",
      actorId: manager.userId,
      note: "Use the existing stock first",
    });
    expect(rejected.status).toBe("REJECTED");
  });
});

describe("amending a requisition", () => {
  it("sends a submitted request back to draft so the decision is about what was asked", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    const amended = await amendRequisition(client, {
      businessId: "biz-a",
      requisitionId: request.id,
      actorId: staff.userId,
      reason: "Supplier quoted less",
      lines: [{ description: "50 kg bag of cement", quantity: 40, estimatedUnitCostCents: 70_000, taxRateBps: 1600 }],
    });
    expect(amended.status).toBe("DRAFT");
    expect(amended.submittedAt).toBeNull();
    expect(amended.estimatedSubtotalCents).toBe(2_800_000);
    const audit = client.audits.find((row) => row.action === "REQUISITION_AMENDED");
    // Both versions are kept as JSON, so an audit reader can see what changed and when.
    expect(JSON.parse(audit.beforeJson).estimatedTotalCents).toBe(3_480_000);
    expect(JSON.parse(audit.afterJson).estimatedTotalCents).toBe(3_248_000);
    expect(JSON.parse(audit.beforeJson).status).toBe("SUBMITTED");
    expect(JSON.parse(audit.afterJson).status).toBe("DRAFT");
  });

  it("refuses an amendment from somebody other than the requester", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await expect(
      amendRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: owner.userId, lines: [{ description: "Cement", quantity: 1, estimatedUnitCostCents: 100 }] }),
    ).rejects.toThrow(/only the person who raised/i);
  });
});

describe("converting a requisition", () => {
  async function approved() {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    await decideRequisition(client, { businessId: "biz-a", requisitionId: request.id, decision: "APPROVE", approverRole: "MANAGER", actorId: manager.userId });
    return { client, request };
  }

  it("raises exactly one purchase order from an approved request", async () => {
    const { client, request } = await approved();
    const first = await convertRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: manager.userId });
    expect(first.created).toBe(true);
    expect(first.order.orderNumber).toBe("PO-000001");
    expect(client.orders).toHaveLength(1);
    expect(client.requests[0].status).toBe("CONVERTED");
    expect(client.requests[0].purchaseOrderId).toBe(first.order.id);
    expect(client.audits.map((row) => row.action)).toContain("REQUISITION_CONVERTED");
  });

  it("is idempotent: a second conversion returns the same order", async () => {
    const { client, request } = await approved();
    const first = await convertRequisition(client, { businessId: "biz-a", requisitionId: request.id });
    const second = await convertRequisition(client, { businessId: "biz-a", requisitionId: request.id });
    expect(second.alreadyConverted).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(client.orders).toHaveLength(1);
  });

  it("refuses to convert a request that was not approved", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await submitRequisition(client, { businessId: "biz-a", requisitionId: request.id, actorId: staff.userId });
    await expect(convertRequisition(client, { businessId: "biz-a", requisitionId: request.id })).rejects.toThrow(/only an approved request/i);
    expect(client.orders).toHaveLength(0);
  });

  it("refuses a request from another tenant", async () => {
    const { client, request } = await approved();
    await expect(convertRequisition(client, { businessId: "biz-b", requisitionId: request.id })).rejects.toThrow(/was not found/i);
  });
});

describe("cancelling and permissions", () => {
  it("requires a reason and records who cancelled", async () => {
    const client = fakeClient();
    const { request } = await createRequisition(client, input());
    await expect(cancelRequisition(client, { businessId: "biz-a", requisitionId: request.id, reason: "" })).rejects.toThrow(/why the request is being cancelled/i);
    const cancelled = await cancelRequisition(client, { businessId: "biz-a", requisitionId: request.id, reason: "No longer needed", actorId: staff.userId });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("No longer needed");
  });

  it("keeps read-only roles out of raising and deciding", () => {
    expect(canRaiseRequisition("VIEWER")).toBe(false);
    expect(canRaiseRequisition("STAFF")).toBe(true);
    expect(canDecideRequisition("STAFF")).toBe(false);
    expect(canDecideRequisition("FINANCE")).toBe(true);
    expect(canDecideRequisition("MANAGER")).toBe(true);
    expect(canDecideRequisition(viewer.role)).toBe(false);
  });
});
