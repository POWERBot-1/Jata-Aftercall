/**
 * Subscription payments through the real webhook and verify routes against real Prisma + PostgreSQL.
 * Only the Paystack HTTP call (verifyTransaction) is replaced. Signatures are real HMAC-SHA512 over the raw body.
 *
 * The previously recorded KNOWN GAP (line 87 — a provider-verified success on a FAILED subscription
 * payment was refused with 503 and never activated) was closed on 2026-10-13: the subscription
 * settlement now accepts the same provider-verified states the order/booking path always accepted
 * (PENDING, FAILED, CANCELLED, EXPIRED — never REFUNDED). The `it.fails` marker was therefore
 * removed, as the marker's own contract required, and the former characterization tests now assert
 * the corrected behaviour. A no-verdict provider answer still changes nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, uid } from "../helpers/prisma-fixtures";

const mocks = vi.hoisted(() => ({ verifyTransaction: vi.fn(), session: { current: null as null | { userId: string; role: string } } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getSession: async () => mocks.session.current }));
vi.mock("@/lib/paystack", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/paystack")>()), verifyTransaction: mocks.verifyTransaction }));

import { POST as webhook } from "@/app/api/paystack/webhook/route";
import { GET as verifyRoute } from "@/app/api/paystack/verify/route";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);
const SECRET = "sk_test_mocked_provider_only";

function signedWebhook(event: string, data: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt-${uid()}`, event, data });
  const signature = crypto.createHmac("sha512", SECRET).update(body).digest("hex");
  return new Request("https://jata.test/api/paystack/webhook", { method: "POST", body, headers: { "x-paystack-signature": signature, "content-type": "application/json" } });
}

describe.skipIf(!realPrismaConfigured)("real Prisma: subscription payments", () => {
  let owner: any;
  let business: any;
  let plan: any;
  const priorKey = process.env.PAYSTACK_SECRET_KEY;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    ({ owner, business } = await seedBusiness(p));
    plan = await p.planConfig.create({ data: { key: `plan-${uid()}`, name: "Pro", priceKES: 1500, durationDays: 30, isActive: true } });
  });
  afterAll(async () => {
    if (priorKey === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = priorKey;
    if (p) await p.$disconnect();
  });
  beforeEach(() => { mocks.verifyTransaction.mockReset(); mocks.session.current = { userId: owner.id, role: "CUSTOMER" }; });

  async function subscriptionPayment(status: string) {
    // A fresh business per payment keeps subscription rows independent.
    const { business: biz, owner: own } = await seedBusiness(p);
    const reference = `JATA-SUB-${uid()}`;
    const payment = await p.payment.create({
      data: { reference, businessId: biz.id, userId: own.id, planId: plan.id, amount: plan.priceKES, currency: "KES", status, purpose: "SUBSCRIPTION" },
    });
    return { biz, own, payment, reference };
  }
  const success = (reference: string, amount: number, id = 7001) => ({ id, status: "success", reference, amount, currency: "KES" });

  it("regression: a PENDING subscription payment activates the subscription through the webhook", async () => {
    const { biz, payment, reference } = await subscriptionPayment("PENDING");
    mocks.verifyTransaction.mockResolvedValue(success(reference, payment.amount));
    const res = await webhook(signedWebhook("charge.success", { reference, id: 7001, amount: payment.amount, currency: "KES", status: "success" }));
    expect(res.status).toBe(200);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect((await p.subscription.findUnique({ where: { businessId: biz.id }, select: { status: true } }))?.status).toBeTruthy();
  });

  it("a verified charge.success after charge.failed settles the payment and activates the subscription", async () => {
    const { biz, payment, reference } = await subscriptionPayment("PENDING");
    const failed = await webhook(signedWebhook("charge.failed", { reference, id: 7002, amount: payment.amount, currency: "KES", status: "failed" }));
    expect(failed.status).toBe(200);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("FAILED");
    mocks.verifyTransaction.mockResolvedValue(success(reference, payment.amount, 7003));
    const later = await webhook(signedWebhook("charge.success", { reference, id: 7003, amount: payment.amount, currency: "KES", status: "success" }));
    // Paystack independently confirms the money arrived, so the stale local FAILED record must not
    // keep a paying customer's subscription off (the same rule the order path already applies).
    expect(later.status).toBe(200);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect(await p.subscription.count({ where: { businessId: biz.id } })).toBe(1);
  });

  it("the verify route re-checks a stored FAILED with Paystack and activates on a verified success", async () => {
    const { biz, payment, own, reference } = await subscriptionPayment("FAILED");
    mocks.session.current = { userId: own.id, role: "CUSTOMER" };
    mocks.verifyTransaction.mockResolvedValue(success(reference, payment.amount, 7004));
    const res = await verifyRoute(new Request(`https://jata.test/api/paystack/verify?reference=${payment.reference}`));
    expect(mocks.verifyTransaction).toHaveBeenCalledWith(reference);
    expect(await res.json()).toMatchObject({ status: "PAID" });
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect(await p.subscription.count({ where: { businessId: biz.id } })).toBe(1);
  });

  it("a provider verdict that is still a failure leaves a FAILED payment failed and activates nothing", async () => {
    const { biz, payment, own, reference } = await subscriptionPayment("FAILED");
    mocks.session.current = { userId: own.id, role: "CUSTOMER" };
    mocks.verifyTransaction.mockResolvedValue({ id: 7005, status: "failed", reference, amount: payment.amount, currency: "KES" });
    const res = await verifyRoute(new Request(`https://jata.test/api/paystack/verify?reference=${payment.reference}`));
    expect(await res.json()).toMatchObject({ status: "FAILED" });
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("FAILED");
    expect(await p.subscription.count({ where: { businessId: biz.id } })).toBe(0);
  });

  it("GAP CLOSED: a provider-verified success on a FAILED subscription payment activates the subscription", async () => {
    const { biz, payment, reference } = await subscriptionPayment("FAILED");
    mocks.verifyTransaction.mockResolvedValue(success(reference, payment.amount, 7010));
    const res = await webhook(signedWebhook("charge.success", { reference, id: 7010, amount: payment.amount, currency: "KES", status: "success" }));
    expect(res.status).toBe(200);
    expect((await p.payment.findUnique({ where: { id: payment.id }, select: { status: true } }))?.status).toBe("PAID");
    expect(await p.subscription.count({ where: { businessId: biz.id } })).toBe(1);
  });
});
