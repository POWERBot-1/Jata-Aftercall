import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));
vi.mock("@prisma/client", async (original) => {
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (!harness) return original();
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)(`${harness}/generated/wasm.js`);
});
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import { applyReversal } from "@/lib/payments/engine";
import { resolvePendingProviderRefund } from "@/lib/payments/refunds";
import { summarizeSales } from "@/lib/pos/reports";
import { finalizeReportSnapshot } from "@/lib/pos/report-snapshots";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any, ownerId: string, businessId: string, otherId: string;
describe.skipIf(!realPrismaConfigured)("provider reversal persistence on PostgreSQL", () => {
  beforeAll(async () => {
    db = makeRealPrisma(); holder.client = db;
    ownerId = (await db.user.create({ data: { email: `reverse-${stamp}@example.test`, name: "Owner", passwordHash: "not-a-real-login" } })).id;
    businessId = (await db.business.create({ data: { ownerId, slug: `reverse-${stamp}`, name: "Business", category: "retail" } })).id;
    otherId = (await db.business.create({ data: { ownerId, slug: `reverse-other-${stamp}`, name: "Other", category: "retail" } })).id;
  });
  afterAll(async () => {
    if (businessId) await db.business.delete({ where: { id: businessId } });
    if (otherId) await db.business.delete({ where: { id: otherId } });
    if (ownerId) await db.user.delete({ where: { id: ownerId } });
    if (db) await db.$disconnect();
  });

  it("posts one reversal under concurrent verified-event delivery and reports zero net collection", async () => {
    const ref = `reverse-ref-${stamp}`;
    const sale = await db.posSale.create({ data: { businessId, receiptNumber: `R-${stamp}`, totalKES: 100, subtotalKES: 100, paidKES: 100, status: "COMPLETED", createdAt: new Date("2005-01-01T12:00:00Z") } });
    await db.posPayment.create({ data: { businessId, saleId: sale.id, direction: "IN", purpose: "SALE", status: "SETTLED", method: "mpesa", amountKES: 100, createdAt: new Date("2005-01-01T12:00:00Z") } });
    const transaction = await db.paymentTransaction.create({ data: { businessId, jataPaymentId: `JTP-${stamp}`, provider: "PAYSTACK", providerReference: ref, idempotencyKey: `reverse-${stamp}`, status: "PAID", method: "mpesa", amountMinor: 10000, amountPaidMinor: 10000, currency: "KES", posSaleId: sale.id } });
    const capture = await finalizeReportSnapshot({ businessId, branchId: null, actorId: ownerId, from: "2005-01-01", to: "2005-01-01" });
    const priorPayload = capture.payload;
    expect(priorPayload.periodLedger.payments).toHaveLength(1);
    expect(priorPayload.saleCohort.totals.paidKES).toBe(100);
    const event = { kind: "reversal" as const, providerReference: ref, providerTransactionId: null, amountMinor: 10000, reason: "test verified event", sanitized: {} };
    let arrivals = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const run = () => db.$transaction(async (tx: any) => {
      const wrapped = new Proxy(tx, { get(target, property) {
        if (property === "paymentTransaction") return new Proxy(target.paymentTransaction, { get(model, key) {
          if (key !== "findFirst") return Reflect.get(model, key, model);
          return async (...args: any[]) => {
            const result = await model.findFirst(...args);
            if (args[0]?.where?.provider) { if (++arrivals === 2) release(); await barrier; }
            return result;
          };
        } });
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return applyReversal({ provider: "PAYSTACK", event, client: wrapped });
    }, { timeout: 15000 });
    const results = await Promise.all([run(), run()]);
    expect(arrivals).toBe(2);
    expect(results.filter((r: any) => r.kind === "settled")).toHaveLength(1);
    expect(results.filter((r: any) => r.kind === "duplicate")).toHaveLength(1);
    expect((await applyReversal({ provider: "PAYSTACK", event, client: db })).kind).toBe("duplicate");
    expect((await db.paymentTransaction.findUnique({ where: { id: transaction.id } })).status).toBe("REVERSED");
    const rows = await db.posPayment.findMany({ where: { businessId, saleId: sale.id, status: "SETTLED" } });
    expect(rows.filter((row: any) => row.direction === "OUT")).toHaveLength(1);
    expect(rows.find((row: any) => row.direction === "OUT").createdAt.getTime()).toBeGreaterThan(capture.periodEnd.getTime());
    expect(rows.reduce((sum: number, row: any) => sum + (row.direction === "OUT" ? -row.amountKES : row.amountKES), 0)).toBe(0);
    expect(summarizeSales([{ ...sale, status: "REVERSED", payments: rows }]).paidKES).toBe(0);
    expect((await db.posReportSnapshot.findUnique({ where: { id: capture.id } })).payload).toEqual(priorPayload);
    expect(await db.posPayment.count({ where: { businessId: otherId } })).toBe(0);
  }, 30000);
  async function fixture(label: string) {
    const ref = `${label}-${stamp}`;
    const sale = await db.posSale.create({ data: { businessId, receiptNumber: ref, totalKES: 100, subtotalKES: 100, paidKES: 100 } });
    await db.posPayment.create({ data: { businessId, saleId: sale.id, direction: "IN", purpose: "SALE", status: "SETTLED", method: "mpesa", amountKES: 100 } });
    const payment = await db.paymentTransaction.create({ data: { businessId, jataPaymentId: ref, provider: "PAYSTACK", providerReference: ref, idempotencyKey: ref, status: "PAID", method: "mpesa", amountMinor: 10000, amountPaidMinor: 10000, posSaleId: sale.id } });
    return { ref, sale, payment };
  }

  it("settles one reserved partial refund and ignores a duplicate", async () => {
    const f = await fixture("partial");
    const ref = `partial-refund-${stamp}`;
    await db.refund.create({ data: { businessId, transactionId: f.payment.id, provider: "PAYSTACK", providerReference: ref, amountMinor: 3000, status: "PENDING_PROVIDER", reason: "test" } });
    const event = { kind: "reversal" as const, providerReference: ref, providerTransactionId: f.ref, amountMinor: 3000, reason: "test event", sanitized: {} };
    const result = await Promise.all([applyReversal({ provider: "PAYSTACK", event, client: db }), applyReversal({ provider: "PAYSTACK", event, client: db })]);
    expect(result.map(r => r.kind).sort()).toEqual(["duplicate", "settled"]);
    const payment = await db.paymentTransaction.findUnique({ where: { id: f.payment.id } });
    expect(payment).toMatchObject({ status: "PARTIALLY_REFUNDED", amountRefundedMinor: 3000 });
    const rows = await db.posPayment.findMany({ where: { businessId, saleId: f.sale.id, status: "SETTLED" } });
    expect(rows.filter((p: any) => p.direction === "OUT")).toHaveLength(1);
    expect(summarizeSales([{ ...f.sale, payments: rows }]).paidKES).toBe(70);
    expect(await db.posPayment.count({ where: { businessId: otherId, saleId: f.sale.id } })).toBe(0);
  });

  it("keeps failed and unmatched partial reversals from posting an outflow", async () => {
    const f = await fixture("failed");
    const ref = `failed-refund-${stamp}`;
    await db.refund.create({ data: { businessId, transactionId: f.payment.id, provider: "PAYSTACK", providerReference: ref, amountMinor: 3000, status: "PENDING_PROVIDER", reason: "test" } });
    const blocked = await applyReversal({ provider: "PAYSTACK", client: db, event: { kind: "reversal", providerReference: f.ref, providerTransactionId: null, amountMinor: 10000, reason: null, sanitized: {} } });
    expect(blocked).toMatchObject({ kind: "exception", reason: "REVERSAL_WITH_PENDING_REFUND" });
    expect(await resolvePendingProviderRefund({ provider: "PAYSTACK", providerReference: ref, succeeded: false, failureReason: "refused", client: db })).toMatchObject({ kind: "failed" });
    expect(await resolvePendingProviderRefund({ provider: "PAYSTACK", providerReference: ref, succeeded: false, client: db })).toMatchObject({ kind: "duplicate" });
    const partial = await applyReversal({ provider: "PAYSTACK", client: db, event: { kind: "reversal", providerReference: f.ref, providerTransactionId: null, amountMinor: 3000, reason: null, sanitized: {} } });
    expect(partial).toMatchObject({ kind: "exception", reason: "UNSUPPORTED_REVERSAL_AMOUNT" });
    expect(await db.posPayment.count({ where: { businessId, saleId: f.sale.id, direction: "OUT" } })).toBe(0);
    expect((await db.paymentTransaction.findUnique({ where: { id: f.payment.id } })).status).toBe("PAID");
  });

  it("rolls back a reversal if the outer accounting transaction fails", async () => {
    const f = await fixture("rollback");
    await expect(db.$transaction(async (tx: any) => {
      const result = await applyReversal({ provider: "PAYSTACK", client: tx, event: { kind: "reversal", providerReference: f.ref, providerTransactionId: null, amountMinor: 10000, reason: null, sanitized: {} } });
      expect(result.kind).toBe("settled");
      throw new Error("rollback test");
    })).rejects.toThrow("rollback test");
    expect((await db.paymentTransaction.findUnique({ where: { id: f.payment.id } })).status).toBe("PAID");
    expect(await db.posPayment.count({ where: { businessId, saleId: f.sale.id, direction: "OUT" } })).toBe(0);
  });

});
