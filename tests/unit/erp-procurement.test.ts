/**
 * Procurement — the rules, with a fake client.
 *
 * The point of this module is that buying has a paper trail and authority: a line is priced once,
 * an order cannot skip its approval, an over-receipt is refused rather than quietly capped, and a
 * delivery only moves stock through the POS ledger. These tests pin those rules; the database
 * behaviour (tenant isolation, real stock rows, a balanced bill journal) is proven separately in
 * tests/integration/erp-procurement-postgres.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  lineTotals,
  normalizePurchaseOrderStatus,
  purchaseOrderTotals,
  purchaseOrderTransitionAllowed,
  receivePurchaseOrder,
  submitPurchaseOrder,
  validatePurchaseOrderInput,
  canManageProcurement,
} from "@/lib/erp/procurement";
import { createApprovalRequest, decideApprovalRequest } from "@/lib/erp/approvals";

const manager = { userId: "manager-1", role: "MANAGER", name: "Manager One" };
const owner = { userId: "owner-1", role: "OWNER", name: "Owner One" };
const staff = { userId: "staff-1", role: "STAFF", name: "Staff One" };

let movementCalls: any[] = [];

function fakeClient() {
  const orders: any[] = [];
  const lines: any[] = [];
  const receipts: any[] = [];
  const receiptLines: any[] = [];
  const approvals: any[] = [];
  const approvalEvents: any[] = [];
  const notifications: any[] = [];
  const audits: any[] = [];
  const sequences: Record<string, number> = {};
  const suppliers = [{ id: "sup-1", name: "Cement Traders", isActive: true, businessId: "biz-a" }];
  let sequence = 0;
  movementCalls = [];

  const duplicate = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  const matchOrder = (where: any) =>
    orders.filter((row) => row.businessId === where.businessId
      && (!where.id || row.id === where.id)
      && (!where.status || row.status === where.status)
      && (!where.idempotencyKey || row.idempotencyKey === where.idempotencyKey))[0];

  const client: any = {
    orders, lines, receipts, receiptLines, approvals, notifications, audits, movementCalls,
    posSupplier: {
      findFirst: async ({ where }: any) => suppliers.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null,
    },
    posProduct: {
      findFirst: async () => ({ id: "prod-1", trackInventory: true, unitKey: "bag" }),
    },
    $transaction: async (fn: any) => fn(client),
    erpSequence: {
      upsert: async ({ where }: any) => {
        const key = where.businessId_key.key;
        sequences[key] = (sequences[key] ?? 0) + 1;
        return { value: sequences[key] };
      },
    },
    erpPurchaseOrder: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_idempotencyKey;
        return orders.find((row) => row.businessId === key.businessId && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      findFirst: async ({ where }: any) => {
        const row = matchOrder(where);
        if (!row) return null;
        return { ...row, lines: lines.filter((line) => line.purchaseOrderId === row.id) };
      },
      findMany: async ({ where }: any) => {
        const rows = orders.filter((row) => row.businessId === where.businessId && (!where.status || row.status === where.status));
        return rows.map((row) => ({ ...row, lines: lines.filter((line) => line.purchaseOrderId === row.id), receipts: [] }));
      },
      count: async ({ where }: any) => orders.filter((row) => row.businessId === where.businessId
        && (typeof where.status === "string" ? row.status === where.status : true)
        && (where.status?.in ? where.status.in.includes(row.status) : true)).length,
      create: async ({ data }: any) => {
        if (data.idempotencyKey && orders.some((row) => row.businessId === data.businessId && row.idempotencyKey === data.idempotencyKey)) throw duplicate();
        const row = { id: `po-${++sequence}`, status: "DRAFT", createdAt: new Date(), approvedAt: null, orderedAt: null, receivedAt: null, cancellationReason: null, ...data, lines: undefined };
        orders.push(row);
        for (const line of data.lines?.create ?? []) {
          lines.push({ id: `line-${++sequence}`, purchaseOrderId: row.id, receivedQuantity: 0, ...line });
        }
        return { ...row, lines: lines.filter((line) => line.purchaseOrderId === row.id) };
      },
      update: async ({ where, data }: any) => {
        const row = orders.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return { ...row, lines: lines.filter((line) => line.purchaseOrderId === row.id) };
      },
    },
    erpPurchaseOrderLine: {
      update: async ({ where, data }: any) => {
        const row = lines.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    erpGoodsReceipt: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_idempotencyKey;
        return receipts.find((row) => row.businessId === key.businessId && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      create: async ({ data }: any) => {
        if (data.idempotencyKey && receipts.some((row) => row.businessId === data.businessId && row.idempotencyKey === data.idempotencyKey)) throw duplicate();
        const row = { id: `receipt-${++sequence}`, ...data };
        receipts.push(row);
        return row;
      },
      findMany: async ({ where }: any) => receipts.filter((row) => row.businessId === where.businessId),
    },
    erpGoodsReceiptLine: {
      create: async ({ data }: any) => {
        const row = { id: `receipt-line-${++sequence}`, ...data };
        receiptLines.push(row);
        return row;
      },
    },
    erpApprovalRequest: {
      findUnique: async ({ where }: any) => {
        const key = where.businessId_idempotencyKey;
        return approvals.find((row) => row.businessId === key.businessId && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      findFirst: async ({ where }: any) => approvals.find((row) => row.id === where.id && row.businessId === where.businessId) ?? null,
      findMany: async ({ where }: any) => approvals.filter((row) => row.businessId === where.businessId
        && (!where.status || row.status === where.status)
        && (!where.kind || row.kind === where.kind)
        && (!where.requestedBy || row.requestedBy === where.requestedBy)
        && (where.consumedAt === null ? row.consumedAt == null : true)
        && (where.amountCents?.gte !== undefined ? row.amountCents >= where.amountCents.gte : true)),
      create: async ({ data }: any) => {
        if (data.idempotencyKey && approvals.some((row) => row.businessId === data.businessId && row.idempotencyKey === data.idempotencyKey)) throw duplicate();
        const row = { id: `req-${++sequence}`, status: "PENDING", decidedAt: null, decidedBy: null, decidedName: null, decisionNote: null, consumedAt: null, consumedBy: null, consumedRef: null, createdAt: new Date(), ...data };
        approvals.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = approvals.find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = approvals.find((entry) => entry.id === where.id
          && entry.businessId === where.businessId
          && (!where.status || entry.status === where.status)
          && (where.consumedAt === null ? entry.consumedAt == null : true));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      count: async ({ where }: any) => approvals.filter((row) => row.businessId === where.businessId && (!where.status || row.status === where.status)).length,
    },
    erpApprovalEvent: { create: async ({ data }: any) => { approvalEvents.push(data); return { id: `evt-${++sequence}` }; } },
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

const sampleLines = [
  { description: "40 bags of cement", quantity: 40, unitCostCents: 75_000, taxRateBps: 1600 },
];

async function raise(client: any, overrides: Record<string, unknown> = {}) {
  return createPurchaseOrder(client, {
    businessId: "biz-a",
    supplierId: "sup-1",
    lines: sampleLines,
    requestedBy: staff.userId,
    requestedName: staff.name,
    ...overrides,
  });
}

describe("purchase order arithmetic", () => {
  it("prices a line once and rounds the tax to whole cents", () => {
    // 99,999 × 16% = 15,999.84 — rounded to the nearest cent, once, here.
    expect(lineTotals({ quantity: 3, unitCostCents: 33_333, taxRateBps: 1600 })).toEqual({ lineSubtotalCents: 99_999, lineTaxCents: 16_000 });
    expect(lineTotals({ quantity: 1.5, unitCostCents: 200, taxRateBps: 0 })).toEqual({ lineSubtotalCents: 300, lineTaxCents: 0 });
  });

  it("adds the lines up into subtotal, tax and total", () => {
    const totals = purchaseOrderTotals([
      { quantity: 2, unitCostCents: 1_000, taxRateBps: 1600 },
      { quantity: 1, unitCostCents: 5_000, taxRateBps: 0 },
    ]);
    expect(totals).toEqual({ subtotalCents: 7_000, taxCents: 320, totalCents: 7_320 });
  });
});

describe("purchase order validation", () => {
  it("accepts a well-formed order and computes the totals", () => {
    const result = validatePurchaseOrderInput({ supplierId: "sup-1", lines: sampleLines } as any);
    expect(result.ok).toBe(true);
    expect(result.value.subtotalCents).toBe(3_000_000);
    expect(result.value.taxCents).toBe(480_000);
    expect(result.value.totalCents).toBe(3_480_000);
  });

  it("refuses no supplier, no lines, a zero quantity, fractional cents and a bad date", () => {
    expect(validatePurchaseOrderInput({ lines: sampleLines } as any).ok).toBe(false);
    expect(validatePurchaseOrderInput({ supplierId: "sup-1", lines: [] } as any).ok).toBe(false);
    expect(validatePurchaseOrderInput({ supplierId: "sup-1", lines: [{ description: "Cement", quantity: 0, unitCostCents: 100 }] } as any).ok).toBe(false);
    const fractional = validatePurchaseOrderInput({ supplierId: "sup-1", lines: [{ description: "Cement", quantity: 1, unitCostCents: 10.5 }] } as any);
    expect(fractional.ok).toBe(false);
    expect(fractional.errors.join(" ")).toMatch(/whole cents/i);
    expect(validatePurchaseOrderInput({ supplierId: "sup-1", lines: sampleLines, expectedAt: "not-a-date" } as any).ok).toBe(false);
  });
});

describe("purchase order state machine", () => {
  it("allows the buying path and refuses to reopen finished work", () => {
    expect(purchaseOrderTransitionAllowed("DRAFT", "APPROVED").ok).toBe(true);
    expect(purchaseOrderTransitionAllowed("APPROVED", "ORDERED").ok).toBe(true);
    expect(purchaseOrderTransitionAllowed("ORDERED", "PARTIALLY_RECEIVED").ok).toBe(true);
    expect(purchaseOrderTransitionAllowed("PARTIALLY_RECEIVED", "RECEIVED").ok).toBe(true);
    expect(purchaseOrderTransitionAllowed("RECEIVED", "DRAFT").ok).toBe(false);
    expect(purchaseOrderTransitionAllowed("CANCELLED", "APPROVED").ok).toBe(false);
    expect(normalizePurchaseOrderStatus("partially received")).toBe("PARTIALLY_RECEIVED");
    expect(normalizePurchaseOrderStatus("nonsense")).toBe("DRAFT");
  });

  it("lets every role that can touch stock buy, and viewers only read", () => {
    expect(canManageProcurement("STAFF")).toBe(true);
    expect(canManageProcurement("MANAGER")).toBe(true);
    expect(canManageProcurement("VIEWER")).toBe(false);
  });
});

describe("raising an order", () => {
  it("numbers it per tenant and stores one line per row", async () => {
    const client = fakeClient();
    const first = await raise(client);
    const second = await raise(client);
    expect(first.order.orderNumber).toBe("PO-000001");
    expect(second.order.orderNumber).toBe("PO-000002");
    expect(client.lines).toHaveLength(2);
    expect(client.audits.filter((row: any) => row.action === "PURCHASE_ORDER_CREATED")).toHaveLength(2);
  });

  it("refuses a supplier that belongs to another business", async () => {
    const client = fakeClient();
    await expect(raise(client, { businessId: "biz-b" })).rejects.toThrow(/not in this business/i);
  });

  it("reuses the order when the form is retried with the same key", async () => {
    const client = fakeClient();
    const first = await raise(client, { idempotencyKey: "form-1" });
    const replay = await raise(client, { idempotencyKey: "form-1" });
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.order.id).toBe(first.order.id);
    expect(client.orders).toHaveLength(1);
  });
});

describe("submitting an order", () => {
  it("approves immediately when the total is inside the requester's limit", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    const result = await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: owner });
    expect(result.approved).toBe(true);
    expect(result.order.status).toBe("APPROVED");
  });

  it("waits for a decision above the limit, and nothing is ordered", async () => {
    const client = fakeClient();
    const { order } = await raise(client); // KES 34,800 — above a manager's KES 10,000
    const result = await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    expect(result.approved).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/above the KES 10,000/);
    expect(client.orders[0].status).toBe("AWAITING_APPROVAL");
    expect(client.approvals).toHaveLength(1);
    expect(client.approvals[0]).toMatchObject({ kind: "PURCHASE", approverRole: "ADMIN", amountCents: 3_480_000 });
  });

  it("approves on the second submit once the owner has decided, spending the grant", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    const blocked = await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    await decideApprovalRequest(client, { businessId: "biz-a", requestId: blocked.requestId as string, decision: "APPROVE", decider: owner });
    const second = await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    expect(second.approved).toBe(true);
    expect(client.approvals[0].consumedRef).toBe(`purchase-order:${order.id}`);
    expect(client.audits.filter((row: any) => row.action === "PURCHASE_ORDER_APPROVED")).toHaveLength(1);
  });

  it("refuses to submit an order that was already received", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    client.orders[0].status = "RECEIVED";
    await expect(submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: owner })).rejects.toThrow(/already been submitted/i);
  });
});

describe("receiving goods", () => {
  async function approvedOrder(client: any) {
    const { order } = await raise(client);
    await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: owner });
    client.orders[0].status = "ORDERED";
    return order;
  }

  it("refuses to receive against an order nobody approved", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    await expect(receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId: client.lines[0].id, quantity: 1 }] })).rejects.toThrow(/has not been approved/i);
  });

  it("refuses an over-receipt instead of silently capping it", async () => {
    const client = fakeClient();
    const order = await approvedOrder(client);
    const lineId = client.lines[0].id;
    await expect(receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 41 }] })).rejects.toThrow(/cannot receive 41/i);
  });

  it("records a partial delivery without marking the order received", async () => {
    const client = fakeClient();
    const order = await approvedOrder(client);
    const lineId = client.lines[0].id;
    const result = await receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 10 }], actorId: staff.userId, actorName: staff.name });
    expect(result.order.status).toBe("PARTIALLY_RECEIVED");
    expect(client.lines[0].receivedQuantity).toBe(10);
    expect(client.receiptLines).toHaveLength(1);
    expect(client.audits.filter((row: any) => row.action === "PURCHASE_ORDER_RECEIVED")).toHaveLength(1);
  });

  it("marks the order received when the rest arrives, and tells the person who asked", async () => {
    const client = fakeClient();
    const order = await approvedOrder(client);
    const lineId = client.lines[0].id;
    await receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 10 }], actorId: staff.userId });
    const result = await receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 30 }], actorId: staff.userId });
    expect(result.order.status).toBe("RECEIVED");
    expect(client.lines[0].receivedQuantity).toBe(40);
    expect(client.notifications).toHaveLength(2);
    expect(client.notifications[0].recipientId).toBe(staff.userId);
  });

  it("returns the same receipt when the same submit is retried", async () => {
    const client = fakeClient();
    const order = await approvedOrder(client);
    const lineId = client.lines[0].id;
    const first = await receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 5 }], idempotencyKey: "delivery-1" });
    const replay = await receivePurchaseOrder(client, { businessId: "biz-a", orderId: order.id, lines: [{ lineId, quantity: 5 }], idempotencyKey: "delivery-1" });
    expect(replay.created).toBe(false);
    expect(replay.receipt.id).toBe(first.receipt.id);
    expect(client.lines[0].receivedQuantity).toBe(5);
    expect(client.receipts).toHaveLength(1);
  });
});

describe("cancelling an order", () => {
  it("needs a reason and refuses after delivery", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    await expect(cancelPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, reason: "" })).rejects.toThrow(/why/i);
    await cancelPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, reason: "Supplier raised the price", actorId: manager.userId });
    expect(client.orders[0].status).toBe("CANCELLED");

    client.orders[0].status = "RECEIVED";
    await expect(cancelPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, reason: "Too late" })).rejects.toThrow(/fully received/i);
  });
});

describe("approval requests raised by procurement", () => {
  it("show up in the approvals queue with the order as their source", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    const request = client.approvals[0];
    expect(request.kind).toBe("PURCHASE");
    expect(request.title).toContain(order.orderNumber);
    expect(request.requestedBy).toBe(manager.userId);
    // And the object itself still refuses a self-approval.
    await expect(decideApprovalRequest(client, { businessId: "biz-a", requestId: request.id, decision: "APPROVE", decider: manager })).rejects.toThrow(/own request/i);
  });

  it("reuses one request when the form is submitted twice", async () => {
    const client = fakeClient();
    const { order } = await raise(client);
    await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    await submitPurchaseOrder(client, { businessId: "biz-a", orderId: order.id, requester: manager });
    expect(client.approvals).toHaveLength(1);
  });
});

describe("a hand-made request still works", () => {
  it("can be raised and decided outside procurement", async () => {
    const client = fakeClient();
    const raised = await createApprovalRequest(client, {
      businessId: "biz-a",
      kind: "SPEND",
      title: "Diesel for the truck",
      amountCents: 500_000,
      approverRole: "MANAGER",
      requestedBy: staff.userId,
    });
    const decided = await decideApprovalRequest(client, { businessId: "biz-a", requestId: raised.request.id, decision: "APPROVE", decider: manager });
    expect(decided.request.status).toBe("APPROVED");
  });
});
