/**
 * Order payment settlement and confirmation against real Prisma + PostgreSQL. Only the Paystack HTTP client is replaced
 * (so no network call is made). Runs only when PRISMA_TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";

const paystack = vi.hoisted(() => ({ verifyTransaction: vi.fn() }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack")>();
  return { ...actual, verifyTransaction: paystack.verifyTransaction };
});

import { settleOrderPayment, verifyOrderPayment } from "@/lib/experience/payments";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);

/** Test-only fault: rejects a Notification insert whose title contains the marker "FAULT-". Dropped in afterAll. */
async function installFault() {
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION jata_test_fault() RETURNS trigger AS $$
    BEGIN
      IF NEW.title LIKE '%FAULT-%' THEN RAISE EXCEPTION 'injected test fault'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS jata_test_fault_trg ON "Notification";`);
  await p.$executeRawUnsafe(`CREATE TRIGGER jata_test_fault_trg BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION jata_test_fault();`);
}
async function removeFault() {
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS jata_test_fault_trg ON "Notification";`);
}

async function unpaidOrder(businessId: string, opts: { status?: string; ref?: string; amount?: number } = {}) {
  const ref = opts.ref ?? `ORD-${uid()}`;
  const order = await p.order.create({
    data: {
      orderReference: ref, businessId, customerName: "Asha", customerPhone: "0700000001", status: opts.status ?? "PENDING_PAYMENT",
      paymentStatus: "UNPAID", subtotalKES: opts.amount ?? 800, deliveryFeeKES: 0, discountKES: 0, totalKES: opts.amount ?? 800,
      currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT",
    },
  });
  return order;
}

async function pendingPayment(businessId: string, userId: string, orderId: string, amount = 800, status = "PENDING") {
  return p.payment.create({
    data: { reference: `JATA-PAY-${uid()}`, businessId, userId, amount, currency: "KES", status, purpose: "ORDER", orderId },
  });
}

const providerSuccess = (reference: string, amount: number) => ({ id: 9001, status: "success", reference, amount, currency: "KES" });

describe.skipIf(!realPrismaConfigured)("real Prisma: order payment settlement and confirmation", () => {
  let owner: any, business: any;
  // Without a provider key, non-production code runs a test-only confirmation that settles without asking Paystack.
  // Set a dummy key so verification goes through the provider path under test (Paystack itself is mocked above).
  const priorKey = process.env.PAYSTACK_SECRET_KEY;
  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_mocked_provider_only";
    ({ owner, business } = await seedBusiness(p));
    await installFault();
  });
  afterAll(async () => {
    await removeFault();
    if (priorKey === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = priorKey;
    if (p) await p.$disconnect();
  });
  beforeEach(() => paystack.verifyTransaction.mockReset());

  const notifications = (orderRef: string, eventType: string) =>
    p.notification.count({ where: { businessId: business.id, eventType, title: { contains: orderRef } } });

  it("a verified payment confirms a pending order: payment PAID, order CONFIRMED, one PAYMENT_VERIFIED notice", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    const res = await settleOrderPayment(payment.id, { verification: { paystackId: "1" } });
    expect(res.alreadySettled).toBe(false);
    expect(await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } })).toEqual({ status: "PAID" });
    expect(await p.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } })).toEqual({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(await notifications(order.orderReference, "PAYMENT_VERIFIED")).toBe(1);
  });

  it("four concurrent settlements of one payment settle it once and send one notice", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => settleOrderPayment(payment.id, { verification: { paystackId: "2" } })));
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    expect(fulfilled.filter((r) => r.value.alreadySettled === false)).toHaveLength(1);
    expect(await notifications(order.orderReference, "PAYMENT_VERIFIED")).toBe(1);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
  });

  it("a replayed webhook after success is a no-op", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    await settleOrderPayment(payment.id, { verification: { paystackId: "3" } });
    const again = await settleOrderPayment(payment.id, { verification: { paystackId: "3" } });
    expect(again.alreadySettled).toBe(true);
    expect(await notifications(order.orderReference, "PAYMENT_VERIFIED")).toBe(1);
  });

  it("a failure inside the settlement transaction rolls everything back; a retry then settles", async () => {
    const order = await unpaidOrder(business.id, { ref: `ORD-FAULT-${uid()}` });
    const payment = await pendingPayment(business.id, owner.id, order.id);
    await expect(settleOrderPayment(payment.id, { verification: { paystackId: "4" } })).rejects.toThrow(/injected test fault/);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PENDING");
    expect((await p.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } }))).toEqual({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID" });
    expect(await p.auditEvent.count({ where: { targetId: payment.id, action: "ORDER_PAYMENT_SETTLED" } })).toBe(0);
    // The fault only fires for FAULT- titles, so the order can be retried once the title is different. Drop the fault and retry.
    await removeFault();
    try {
      const retry = await settleOrderPayment(payment.id, { verification: { paystackId: "4" } });
      expect(retry.alreadySettled).toBe(false);
      expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    } finally {
      await installFault();
    }
  });

  it("a FAILED payment that Paystack now reports as successful is settled, not reported as FAILED", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id, 800, "FAILED");
    paystack.verifyTransaction.mockResolvedValue(providerSuccess(payment.reference, 800));
    const result = await verifyOrderPayment(payment.reference);
    expect(result.state).toBe("SUCCESS");
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
  });

  it("Paystack still processing: the state is PENDING and a FAILED record is not changed", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id, 800, "FAILED");
    paystack.verifyTransaction.mockResolvedValue({ id: 1, status: "ongoing", reference: payment.reference, amount: 800, currency: "KES" });
    expect((await verifyOrderPayment(payment.reference)).state).toBe("PENDING");
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("FAILED");
  });

  it("Paystack reports a final failure on a pending payment: that failure is recorded and reported", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    paystack.verifyTransaction.mockResolvedValue({ id: 2, status: "abandoned", reference: payment.reference, amount: 800, currency: "KES" });
    expect((await verifyOrderPayment(payment.reference)).state).toBe("CANCELLED");
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("CANCELLED");
    expect((await p.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true, status: true } }))).toEqual({ paymentStatus: "UNPAID", status: "PENDING_PAYMENT" });
  });

  it("a provider success with the wrong amount settles nothing", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    paystack.verifyTransaction.mockResolvedValue(providerSuccess(payment.reference, 1));
    expect((await verifyOrderPayment(payment.reference)).state).toBe("PENDING");
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PENDING");
    expect((await p.order.findUnique({ where: { id: order.id }, select: { paymentStatus: true } }))?.paymentStatus).toBe("UNPAID");
  });

  it("money received on a CANCELLED order is recorded, the order stays cancelled, and the owner is asked to refund or reinstate", async () => {
    const order = await unpaidOrder(business.id, { status: "CANCELLED" });
    const payment = await pendingPayment(business.id, owner.id, order.id);
    await settleOrderPayment(payment.id, { verification: { paystackId: "5" } });
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect((await p.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } }))).toEqual({ status: "CANCELLED", paymentStatus: "PAID" });
    expect(await notifications(order.orderReference, "PAYMENT_ON_CANCELLED_ORDER")).toBe(1);
    expect(await notifications(order.orderReference, "PAYMENT_VERIFIED")).toBe(0);
    expect(await p.auditEvent.count({ where: { targetId: payment.id, action: "ORDER_PAID_AFTER_CANCELLATION" } })).toBe(1);
  });

  it("a settled payment cannot later move to REFUNDED-like or FAILED states through confirmation", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id);
    await settleOrderPayment(payment.id, { verification: { paystackId: "6" } });
    paystack.verifyTransaction.mockResolvedValue({ id: 3, status: "failed", reference: payment.reference, amount: 800, currency: "KES" });
    expect((await verifyOrderPayment(payment.reference)).state).toBe("SUCCESS");
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
  });

  it("a second successful payment on an already-PAID order is recorded but does not re-confirm the order; the owner is asked to refund", async () => {
    const order = await unpaidOrder(business.id);
    const first = await pendingPayment(business.id, owner.id, order.id);
    await settleOrderPayment(first.id, { verification: { paystackId: "7" } });
    const second = await pendingPayment(business.id, owner.id, order.id);
    const res = await settleOrderPayment(second.id, { verification: { paystackId: "8" } });
    expect(res.alreadySettled).toBe(false);
    expect((await p.payment.findUnique({ where: { id: second.id }, select: { status: true } }))?.status).toBe("PAID");
    expect(await p.order.findUnique({ where: { id: order.id }, select: { status: true, paymentStatus: true } })).toEqual({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(await notifications(order.orderReference, "PAYMENT_DUPLICATE_ON_ORDER")).toBe(1);
    expect(await notifications(order.orderReference, "PAYMENT_VERIFIED")).toBe(1);
    expect(await p.auditEvent.count({ where: { targetId: second.id, action: "ORDER_DUPLICATE_PAYMENT" } })).toBe(1);
  });

  it("when the provider gives no usable answer, confirmation reports providerChecked=false and changes nothing", async () => {
    const order = await unpaidOrder(business.id);
    const payment = await pendingPayment(business.id, owner.id, order.id, 800, "FAILED");
    paystack.verifyTransaction.mockResolvedValue(null); // no usable provider answer: the same no-verdict path as an outage
    const verdict = await verifyOrderPayment(payment.reference);
    expect(verdict.providerChecked).toBe(false);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("FAILED");
  });
});
