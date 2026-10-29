/**
 * Procurement against a real PostgreSQL database.
 *
 * What only the database can prove: the document number comes from the tenant sequence and does not
 * repeat, a supplier from another business cannot be bought from, a delivery writes the POS stock
 * ledger (so the till and the ERP agree), an over-receipt is refused before any stock moves, the bill
 * journal balances and its variance is audited, a re-submitted supplier invoice cannot post twice, and
 * two concurrent receives with one key leave one receipt.
 *
 * Environment: PRISMA_TEST_DATABASE_URL (an isolated, migrated database — never production) and,
 * where the native engine cannot be downloaded, PRISMA_WASM_HARNESS_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPurchaseOrder,
  markPurchaseOrderOrdered,
  recordPurchaseBill,
  receivePurchaseOrder,
  submitPurchaseOrder,
  purchaseOrderSummary,
} from "@/lib/erp/procurement";
import { ensureChartOfAccounts } from "@/lib/erp/accounting";
import { decideApprovalRequest } from "@/lib/erp/approvals";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = {
  ownerA: "",
  ownerB: "",
  staffA: "",
  managerA: "",
  businessA: "",
  businessB: "",
  supplierA: "",
  supplierB: "",
  productA: "",
  branchId: "",
};

async function makeUser(label: string) {
  return client.user.create({ data: { email: `proc-${label}-${stamp}@example.test`, name: `Proc ${label}`, passwordHash: "not-a-real-login" } });
}

describe.skipIf(!enabled)("procurement against real PostgreSQL", () => {
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

    const businessA = await client.business.create({ data: { ownerId: ownerA.id, slug: `proc-a-${stamp}`, name: "Proc A", category: "retail" } });
    const businessB = await client.business.create({ data: { ownerId: ownerB.id, slug: `proc-b-${stamp}`, name: "Proc B", category: "retail" } });
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;

    // The supplier-bill journal posts to 1200 / 1150 / 2000, so the tenant needs its chart first.
    await ensureChartOfAccounts(client, businessA.id);

    await client.businessMember.create({ data: { userId: staffA.id, businessId: businessA.id, role: "STAFF" } });
    await client.businessMember.create({ data: { userId: managerA.id, businessId: businessA.id, role: "MANAGER" } });

    const supplierA = await client.posSupplier.create({ data: { businessId: businessA.id, name: "Cement Traders", termsDays: 30 } });
    const supplierB = await client.posSupplier.create({ data: { businessId: businessB.id, name: "Other Tenant Supplier" } });
    ids.supplierA = supplierA.id;
    ids.supplierB = supplierB.id;

    const product = await client.posProduct.create({
      data: { businessId: businessA.id, name: "Cement 50kg", unitKey: "bag", priceKES: 90_000, costKES: 75_000, trackInventory: true, kind: "PRODUCT" },
    });
    ids.productA = product.id;
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    try {
      const businesses = [ids.businessA, ids.businessB].filter(Boolean);
      await client.erpGoodsReceiptLine.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpGoodsReceipt.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpPurchaseOrderLine.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpPurchaseOrder.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpSupplierBill.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpApprovalEvent.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpApprovalRequest.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpNotificationRead.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpNotification.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpJournalLine.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpJournal.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpIdempotencyRecord.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpPeriod.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpAccount.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpAuditEvent.deleteMany({ where: { businessId: { in: businesses } } });
      await client.erpSequence.deleteMany({ where: { businessId: { in: businesses } } });
      await client.posInventoryMovement.deleteMany({ where: { businessId: { in: businesses } } });
      await client.posInventoryItem.deleteMany({ where: { businessId: { in: businesses } } });
      await client.posProduct.deleteMany({ where: { businessId: { in: businesses } } });
      await client.posSupplier.deleteMany({ where: { businessId: { in: businesses } } });
      await client.business.deleteMany({ where: { id: { in: businesses } } });
      await client.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.ownerB, ids.staffA, ids.managerA].filter(Boolean) } } });
    } finally {
      await client.$disconnect?.();
    }
  }, 120_000);

  async function raiseOrder(overrides: Record<string, unknown> = {}) {
    return createPurchaseOrder(client, {
      businessId: ids.businessA,
      supplierId: ids.supplierA,
      lines: [
        { productId: ids.productA, description: "Cement 50kg", quantity: 40, unitCostCents: 75_000, taxRateBps: 1600 },
      ],
      requestedBy: ids.ownerA,
      requestedName: "Owner A",
      ...overrides,
    });
  }

  it("numbers orders from the tenant sequence, not from a row count", async () => {
    const first = await raiseOrder();
    const second = await raiseOrder();
    expect(first.order.orderNumber).toMatch(/^PO-\d{6}$/);
    expect(second.order.orderNumber).not.toBe(first.order.orderNumber);
    expect(Number(second.order.orderNumber.split("-")[1])).toBe(Number(first.order.orderNumber.split("-")[1]) + 1);
    const lines = await client.erpPurchaseOrderLine.findMany({ where: { purchaseOrderId: first.order.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].lineSubtotalCents).toBe(3_000_000);
    expect(lines[0].lineTaxCents).toBe(480_000);
  });

  it("refuses another tenant's supplier", async () => {
    await expect(raiseOrder({ supplierId: ids.supplierB, businessId: ids.businessA })).rejects.toThrow(/not in this business/i);
  });

  it("holds an over-limit order until an owner approves, then approves it and spends the grant", async () => {
    const { order } = await raiseOrder();
    const blocked = await submitPurchaseOrder(client, {
      businessId: ids.businessA,
      orderId: order.id,
      requester: { userId: ids.managerA, role: "MANAGER", name: "Manager A" },
    });
    expect(blocked.blocked).toBe(true);
    const stored = await client.erpPurchaseOrder.findUnique({ where: { id: order.id } });
    expect(stored.status).toBe("AWAITING_APPROVAL");
    expect(stored.approvalRequestId).toBeTruthy();

    await decideApprovalRequest(client, {
      businessId: ids.businessA,
      requestId: blocked.requestId as string,
      decision: "APPROVE",
      decider: { userId: ids.ownerA, role: "OWNER", name: "Owner A" },
    });

    const approved = await submitPurchaseOrder(client, {
      businessId: ids.businessA,
      orderId: order.id,
      requester: { userId: ids.managerA, role: "MANAGER", name: "Manager A" },
    });
    expect(approved.approved).toBe(true);
    const consumption = await client.erpApprovalRequest.findUnique({ where: { id: blocked.requestId } });
    expect(consumption.consumedRef).toBe(`purchase-order:${order.id}`);
    const audits = await client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, action: "PURCHASE_ORDER_APPROVED", targetId: order.id } });
    expect(audits).toHaveLength(1);
  });

  it("moves real stock when goods arrive, and refuses an over-receipt", async () => {
    const { order } = await raiseOrder();
    await submitPurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, requester: { userId: ids.ownerA, role: "OWNER" } });
    await client.erpPurchaseOrder.update({ where: { id: order.id }, data: { status: "ORDERED" } });
    const line = (await client.erpPurchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } }))[0];

    const before = await client.posInventoryItem.findFirst({ where: { businessId: ids.businessA, productId: ids.productA } });
    await receivePurchaseOrder(client, {
      businessId: ids.businessA,
      orderId: order.id,
      lines: [{ lineId: line.id, quantity: 40 }],
      actorId: ids.staffA,
      actorName: "Staff A",
    });

    const movement = await client.posInventoryMovement.findFirst({ where: { businessId: ids.businessA, productId: ids.productA, refId: order.id } });
    expect(movement).toBeTruthy();
    expect(movement.reason).toBe("PURCHASE");
    expect(movement.delta).toBeCloseTo(40, 3);

    const afterItem = await client.posInventoryItem.findFirst({ where: { businessId: ids.businessA, productId: ids.productA } });
    expect(Number(afterItem?.quantity ?? 0) - Number(before?.quantity ?? 0)).toBeCloseTo(40, 3);

    const reloaded = await client.erpPurchaseOrder.findUnique({ where: { id: order.id } });
    expect(reloaded.status).toBe("RECEIVED");

    const notice = await client.erpNotification.findFirst({ where: { businessId: ids.businessA, sourceId: order.id, kind: "STORE_ORDER" } });
    expect(notice).toBeTruthy();

    await expect(
      receivePurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, lines: [{ lineId: line.id, quantity: 1 }] }),
    ).rejects.toThrow(/cannot receive 1/i);
  }, 60_000);

  it("keeps a receipt unique per tenant when the same submit races", async () => {
    const { order } = await raiseOrder();
    await submitPurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, requester: { userId: ids.ownerA, role: "OWNER" } });
    await client.erpPurchaseOrder.update({ where: { id: order.id }, data: { status: "ORDERED" } });
    const line = (await client.erpPurchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } }))[0];

    const key = `delivery-race-${stamp}-${order.id}`;
    const [a, b] = await Promise.all([
      receivePurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, lines: [{ lineId: line.id, quantity: 1 }], idempotencyKey: key }),
      receivePurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, lines: [{ lineId: line.id, quantity: 1 }], idempotencyKey: key }),
    ]);
    expect(a.receipt.id).toBe(b.receipt.id);
    const receipts = await client.erpGoodsReceipt.findMany({ where: { businessId: ids.businessA, purchaseOrderId: order.id } });
    expect(receipts).toHaveLength(1);
  }, 60_000);

  it("marks an approved order as ordered once, and a second click neither resets it nor re-audits it", async () => {
    const { order } = await raiseOrder();
    await submitPurchaseOrder(client, {
      businessId: ids.businessA,
      orderId: order.id,
      requester: { userId: ids.ownerA, role: "OWNER", name: "Owner A" },
    });

    const ordered = await markPurchaseOrderOrdered(client, {
      businessId: ids.businessA,
      orderId: order.id,
      actorId: ids.ownerA,
      actorName: "Owner A",
    });
    expect(ordered.status).toBe("ORDERED");
    expect(ordered.orderedAt).toBeTruthy();

    const audits = () =>
      client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, action: "PURCHASE_ORDER_ORDERED", targetId: order.id } });
    expect(await audits()).toHaveLength(1);

    // A retried click is idempotent: same timestamp, still one audit row for one event.
    const again = await markPurchaseOrderOrdered(client, {
      businessId: ids.businessA,
      orderId: order.id,
      actorId: ids.ownerA,
      actorName: "Owner A",
    });
    expect(again.orderedAt).toEqual(ordered.orderedAt);
    expect(await audits()).toHaveLength(1);
  });

  it("cannot be received by another tenant", async () => {
    const { order } = await raiseOrder();
    await submitPurchaseOrder(client, { businessId: ids.businessA, orderId: order.id, requester: { userId: ids.ownerA, role: "OWNER" } });
    const line = (await client.erpPurchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } }))[0];
    await expect(
      receivePurchaseOrder(client, { businessId: ids.businessB, orderId: order.id, lines: [{ lineId: line.id, quantity: 1 }] }),
    ).rejects.toThrow(/not found/i);
    const untouched = await client.erpPurchaseOrderLine.findUnique({ where: { id: line.id } });
    expect(untouched.receivedQuantity).toBe(0);
  });

  it("posts a supplier bill once, balances its journal, and refuses the same invoice twice", async () => {
    const { order } = await raiseOrder();
    await submitPurchaseOrder(client, {
      businessId: ids.businessA,
      orderId: order.id,
      requester: { userId: ids.ownerA, role: "OWNER", name: "Owner A" },
    });

    const billNumber = `INV-${stamp}`;
    const bill = {
      businessId: ids.businessA,
      orderId: order.id,
      billNumber,
      netCents: 3_000_000,
      taxCents: 480_000,
      actorId: ids.ownerA,
      actorName: "Owner A",
    };

    const first = await recordPurchaseBill(client, bill);
    expect(first.bill.billNumber).toBe(billNumber);
    expect(first.bill.totalCents).toBe(3_480_000);
    expect(first.bill.status).toBe("OPEN");
    expect(first.bill.journalId).toBe(first.journal.id);
    // The order totals 3,000,000 net + 480,000 VAT, so the invoice matches it exactly.
    expect(first.varianceCents).toBe(0);

    // Balanced double entry: stocked lines debit inventory, VAT input is recoverable, AP is credited.
    expect(first.journal.totalDebitCents).toBe(3_480_000);
    expect(first.journal.totalCreditCents).toBe(3_480_000);
    const journalLines = await client.erpJournalLine.findMany({ where: { journalId: first.journal.id } });
    const byAccount = (code: string) => journalLines.find((line: any) => line.accountCode === code);
    expect(byAccount("1200")).toMatchObject({ debitCents: 3_000_000, creditCents: 0 });
    expect(byAccount("1150")).toMatchObject({ debitCents: 480_000, creditCents: 0 });
    expect(byAccount("2000")).toMatchObject({ debitCents: 0, creditCents: 3_480_000 });

    // A second submission of the same supplier invoice is refused, not posted a second time.
    await expect(recordPurchaseBill(client, bill)).rejects.toThrow(/already recorded/i);

    const bills = await client.erpSupplierBill.findMany({ where: { businessId: ids.businessA, purchaseOrderId: order.id } });
    expect(bills).toHaveLength(1);
    const journals = await client.erpJournal.findMany({ where: { businessId: ids.businessA, sourceType: "SUPPLIER_BILL", sourceId: order.id } });
    expect(journals).toHaveLength(1);
    const audits = await client.erpAuditEvent.findMany({ where: { businessId: ids.businessA, action: "SUPPLIER_BILL_POSTED", targetId: order.id } });
    expect(audits).toHaveLength(1);
  });

  it("counts the order summary for this tenant only", async () => {
    const mine = await purchaseOrderSummary(client, ids.businessA);
    const theirs = await purchaseOrderSummary(client, ids.businessB);
    expect(mine.draft + mine.awaiting + mine.open + mine.received).toBeGreaterThan(0);
    expect(theirs).toEqual({ draft: 0, awaiting: 0, open: 0, received: 0 });
  });
});
