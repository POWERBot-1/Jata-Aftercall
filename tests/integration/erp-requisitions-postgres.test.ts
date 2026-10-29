/**
 * Requisitions against a real PostgreSQL database.
 *
 * What only the database can prove: the request number comes from the tenant sequence and does not
 * repeat, another tenant's request cannot be read, decided or converted, the acceptance audit rows
 * really land with both versions of the record, the same idempotency key cannot raise two requests
 * even under concurrency, and conversion produces one purchase order that its lines trace back to.
 *
 * Environment: PRISMA_TEST_DATABASE_URL (an isolated, migrated database — never production) and,
 * where the native engine cannot be downloaded, PRISMA_WASM_HARNESS_DIR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  amendRequisition,
  convertRequisition,
  createRequisition,
  decideRequisition,
  listRequisitions,
  requisitionSummary,
  submitRequisition,
} from "@/lib/erp/requisitions";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = { ownerA: "", ownerB: "", staffA: "", managerA: "", businessA: "", businessB: "", supplierA: "", supplierB: "" };

async function makeUser(label: string) {
  return client.user.create({ data: { email: `req-${label}-${stamp}@example.test`, name: `Req ${label}`, passwordHash: "not-a-real-login" } });
}

function line(overrides: Record<string, unknown> = {}) {
  return { description: "50 kg bag of cement", quantity: 40, estimatedUnitCostCents: 75_000, taxRateBps: 1600, ...overrides };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    businessId: ids.businessA,
    title: "Bulk cement for the Kajiado site",
    justification: "Below the reorder level",
    department: "Operations",
    priority: "HIGH",
    supplierId: ids.supplierA,
    requestedBy: ids.staffA,
    requestedName: "Staff A",
    lines: [line()],
    ...overrides,
  } as any;
}

describe.skipIf(!enabled)("requisitions against real PostgreSQL", () => {
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

    const businessA = await client.business.create({ data: { ownerId: ownerA.id, slug: `req-a-${stamp}`, name: "Req A", category: "retail" } });
    const businessB = await client.business.create({ data: { ownerId: ownerB.id, slug: `req-b-${stamp}`, name: "Req B", category: "retail" } });
    ids.businessA = businessA.id;
    ids.businessB = businessB.id;

    await client.businessMember.create({ data: { userId: staffA.id, businessId: businessA.id, role: "STAFF" } });
    await client.businessMember.create({ data: { userId: managerA.id, businessId: businessA.id, role: "MANAGER" } });

    const supplierA = await client.posSupplier.create({ data: { businessId: businessA.id, name: "Cement Traders", termsDays: 30 } });
    const supplierB = await client.posSupplier.create({ data: { businessId: businessB.id, name: "Other Tenant Supplier" } });
    ids.supplierA = supplierA.id;
    ids.supplierB = supplierB.id;
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    for (const businessId of [ids.businessA, ids.businessB]) {
      if (!businessId) continue;
      await client.erpRequisitionLine.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpRequisition.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpPurchaseOrderLine.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpPurchaseOrder.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpAuditEvent.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpNotification.deleteMany({ where: { businessId } }).catch(() => null);
      await client.erpSequence.deleteMany({ where: { businessId } }).catch(() => null);
      await client.posSupplier.deleteMany({ where: { businessId } }).catch(() => null);
      await client.businessMember.deleteMany({ where: { businessId } }).catch(() => null);
      await client.business.delete({ where: { id: businessId } }).catch(() => null);
    }
    await client.user.deleteMany({ where: { email: { contains: stamp } } }).catch(() => null);
    await client.$disconnect().catch(() => null);
  }, 60_000);

  it("numbers from the tenant sequence, stores exact money and writes the creation audit", async () => {
    const first = await createRequisition(client, input({ idempotencyKey: `pg-1-${stamp}` }));
    const second = await createRequisition(client, input({ idempotencyKey: `pg-2-${stamp}`, title: "Cleaning supplies" }));

    expect(first.request.requisitionNumber).toMatch(/^REQ-\d{6}$/);
    expect(second.request.requisitionNumber).toBe(`REQ-${String(Number(first.request.requisitionNumber.slice(4)) + 1).padStart(6, "0")}`);
    expect(first.request.estimatedSubtotalCents).toBe(3_000_000);
    expect(first.request.estimatedTaxCents).toBe(480_000);
    expect(first.request.estimatedTotalCents).toBe(3_480_000);

    const stored = await client.erpRequisition.findUnique({ where: { id: first.request.id }, include: { lines: true } });
    expect(stored?.businessId).toBe(ids.businessA);
    expect(stored?.lines).toHaveLength(1);
    expect(stored?.lines[0].lineSubtotalCents).toBe(3_000_000);

    const audit = await client.erpAuditEvent.findFirst({ where: { businessId: ids.businessA, action: "REQUISITION_CREATED", targetId: first.request.id } });
    expect(audit).toBeTruthy();
    expect(audit?.actorId).toBe(ids.staffA);
  }, 60_000);

  it("cannot read or act on another tenant's request", async () => {
    const created = await createRequisition(client, input({ idempotencyKey: `pg-tenant-${stamp}` }));
    const otherTenant = await client.erpRequisition.findFirst({ where: { id: created.request.id, businessId: ids.businessB } });
    expect(otherTenant).toBeNull();

    await submitRequisition(client, { businessId: ids.businessA, requisitionId: created.request.id, actorId: ids.staffA });

    await expect(
      decideRequisition(client, {
        businessId: ids.businessB,
        requisitionId: created.request.id,
        decision: "APPROVE",
        approverRole: "OWNER",
        actorId: ids.ownerB,
      }),
    ).rejects.toThrow(/was not found/i);

    await expect(convertRequisition(client, { businessId: ids.businessB, requisitionId: created.request.id })).rejects.toThrow(/was not found/i);

    // The request itself is untouched by the attempts from the other tenant.
    const stillSubmitted = await client.erpRequisition.findUnique({ where: { id: created.request.id } });
    expect(stillSubmitted?.status).toBe("SUBMITTED");
    expect(stillSubmitted?.businessId).toBe(ids.businessA);

    const leaked = await listRequisitions(client, { businessId: ids.businessB });
    expect(leaked.some((row: any) => row.id === created.request.id)).toBe(false);
  }, 60_000);

  it("refuses a supplier from another tenant at the database boundary", async () => {
    await expect(createRequisition(client, input({ supplierId: ids.supplierB, idempotencyKey: `pg-cross-${stamp}` }))).rejects.toThrow(/not on this business/i);
    const count = await client.erpRequisition.count({ where: { businessId: ids.businessA, idempotencyKey: `pg-cross-${stamp}` } });
    expect(count).toBe(0);
  }, 60_000);

  it("keeps one request per idempotency key under concurrent submission", async () => {
    const key = `pg-race-${stamp}`;
    const results = await Promise.allSettled([
      createRequisition(client, input({ idempotencyKey: key })),
      createRequisition(client, input({ idempotencyKey: key })),
      createRequisition(client, input({ idempotencyKey: key })),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    // Either the losers deduplicated (returning the winner) or the unique index refused them; both
    // are correct, and both leave exactly one row.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const rows = await client.erpRequisition.findMany({ where: { businessId: ids.businessA, idempotencyKey: key } });
    expect(rows).toHaveLength(1);
  }, 60_000);

  it("records both versions of an amended request and sends it back to draft", async () => {
    const created = await createRequisition(client, input({ idempotencyKey: `pg-amend-${stamp}` }));
    await submitRequisition(client, { businessId: ids.businessA, requisitionId: created.request.id, actorId: ids.staffA });
    const amended = await amendRequisition(client, {
      businessId: ids.businessA,
      requisitionId: created.request.id,
      actorId: ids.staffA,
      reason: "Supplier quoted less",
      lines: [line({ estimatedUnitCostCents: 70_000 })],
    });
    expect(amended.status).toBe("DRAFT");
    expect(amended.estimatedSubtotalCents).toBe(2_800_000);

    const audit = await client.erpAuditEvent.findFirst({
      where: { businessId: ids.businessA, action: "REQUISITION_AMENDED", targetId: created.request.id },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(audit?.afterJson ?? "{}").estimatedTotalCents).toBe(3_248_000);
    expect(JSON.parse(audit?.beforeJson ?? "{}").status).toBe("SUBMITTED");
    expect(JSON.parse(audit?.afterJson ?? "{}").status).toBe("DRAFT");

    // The old lines are gone, not duplicated.
    const lines = await client.erpRequisitionLine.findMany({ where: { businessId: ids.businessA, requisitionId: created.request.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].estimatedUnitCostCents).toBe(70_000);
  }, 60_000);

  it("turns an approved request into exactly one purchase order, once", async () => {
    const created = await createRequisition(client, input({ idempotencyKey: `pg-convert-${stamp}` }));
    await submitRequisition(client, { businessId: ids.businessA, requisitionId: created.request.id, actorId: ids.staffA });
    await decideRequisition(client, {
      businessId: ids.businessA,
      requisitionId: created.request.id,
      decision: "APPROVE",
      approverRole: "MANAGER",
      actorId: ids.managerA,
      actorName: "Manager A",
    });

    const first = await convertRequisition(client, { businessId: ids.businessA, requisitionId: created.request.id, actorId: ids.managerA });
    expect(first.created).toBe(true);
    expect(first.order.orderNumber).toMatch(/^PO-\d{6}$/);
    expect(first.order.totalCents).toBe(3_480_000);
    expect(first.order.requestedBy).toBe(ids.staffA);

    const orderLines = await client.erpPurchaseOrderLine.findMany({ where: { businessId: ids.businessA, purchaseOrderId: first.order.id } });
    expect(orderLines).toHaveLength(1);
    expect(orderLines[0].quantity).toBe(40);
    expect(orderLines[0].unitCostCents).toBe(75_000);

    const second = await convertRequisition(client, { businessId: ids.businessA, requisitionId: created.request.id, actorId: ids.managerA });
    expect(second.alreadyConverted).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const orders = await client.erpPurchaseOrder.count({ where: { businessId: ids.businessA } });
    const converted = await client.erpRequisition.findUnique({ where: { id: created.request.id } });
    expect(converted?.status).toBe("CONVERTED");
    expect(converted?.purchaseOrderId).toBe(first.order.id);
    expect(orders).toBeGreaterThanOrEqual(1);

    const audit = await client.erpAuditEvent.findFirst({ where: { businessId: ids.businessA, action: "REQUISITION_CONVERTED", targetId: created.request.id } });
    expect(JSON.parse(audit?.afterJson ?? "{}").orderNumber).toBe(first.order.orderNumber);
  }, 60_000);

  it("summarises only this tenant's requests", async () => {
    const summary = await requisitionSummary(client, ids.businessB);
    expect(summary).toEqual({ draft: 0, submitted: 0, approved: 0, converted: 0, rejected: 0 });
    const mine = await requisitionSummary(client, ids.businessA);
    expect(mine.converted).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
