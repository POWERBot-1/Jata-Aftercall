/**
 * Subscription-payment revival — the release-blocker gap at
 * tests/prisma/subscription-payment.test.ts:87, tested without a live database.
 *
 * What is pinned here
 * -------------------
 * A *provider-verified* successful charge must settle a payment whose local row says
 * FAILED/CANCELLED/EXPIRED, exactly as the order/booking path already does
 * (lib/experience/payments.ts, SETTLEABLE_PAYMENT_STATES). Anything else — a REFUNDED payment, an
 * unknown provider answer, a mismatched amount — must still change nothing.
 *
 * Why a fake and not only PostgreSQL
 * ----------------------------------
 * The database-backed suite (tests/prisma/subscription-payment.test.ts) runs the real webhook and
 * verify routes against real Prisma + PostgreSQL in CI. It cannot run where no database is
 * reachable, and "not run" is not a result. These tests exercise the same settlement function
 * through the in-memory Prisma double used by the POS suites, so the state machine is verified on
 * every run, and the PostgreSQL suite remains the authoritative check of the SQL behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb({
    ...standardSeed(),
    subscription: [],
    auditEvent: [],
    aIPackageEntitlement: [],
    planConfig: [
      { id: "plan_aftercall", key: "PRO", name: "Pro", priceKES: 150000, durationDays: 30, isActive: true },
      { id: "plan_pos", key: "BUSINESS_POS", name: "Business POS", priceKES: 49900, durationDays: 30, isActive: true },
    ],
    payment: [],
  });
  (globalThis as any).__settlementFake = fake;
  return { default: fake.db };
});

import { activateSubscriptionForPayment } from "@/lib/paystack";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__settlementFake as FakeDb;

function seedPayment(overrides: Record<string, unknown> = {}) {
  const payment = {
    id: `pay_${Math.random().toString(36).slice(2, 10)}`,
    reference: `JATA-SUB-${Math.random().toString(36).slice(2, 10)}`,
    businessId: "bizA",
    userId: "userA",
    planId: "plan_aftercall",
    amount: 150000,
    currency: "KES",
    status: "FAILED",
    purpose: "SUBSCRIPTION",
    orderId: null,
    bookingId: null,
    ...overrides,
  };
  fake().rows("payment").push(payment);
  return payment;
}

const verification = (id = "7001") => ({
  paystackId: id,
  raw: { status: "success", reference: "provider-confirmed", amount: 150000, currency: "KES", id },
});

beforeEach(() => {
  fake().reset();
  fake().rows("payment").length = 0;
  fake().rows("subscription").length = 0;
  fake().rows("processedWebhook").length = 0;
  fake().rows("auditEvent").length = 0;
  fake().rows("posSubscription").length = 0;
});

describe("a verified provider success settles a subscription payment", () => {
  it("revives a FAILED payment and activates the subscription", async () => {
    const payment = seedPayment({ status: "FAILED" });
    const result = await activateSubscriptionForPayment(payment.id, "evt_1", verification());

    expect(result.alreadySettled).toBe(false);
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("payment")[0].paystackId).toBe("7001");
    const subscription = fake().rows("subscription")[0];
    expect(subscription).toMatchObject({ businessId: "bizA", planId: "plan_aftercall", status: "ACTIVE" });
    expect(new Date(subscription.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("records the state it corrected, for reconciliation and support", async () => {
    const payment = seedPayment({ status: "EXPIRED" });
    await activateSubscriptionForPayment(payment.id, "evt_expired", verification("7002"));

    const audit = fake().rows("auditEvent").find((row) => row.action === "SUBSCRIPTION_ACTIVATED");
    expect(audit).toBeTruthy();
    expect(JSON.parse(String(audit.metadata))).toMatchObject({ paymentReference: payment.reference, settledFrom: "EXPIRED" });
  });

  it("still settles a PENDING payment (no regression)", async () => {
    const payment = seedPayment({ status: "PENDING" });
    await activateSubscriptionForPayment(payment.id, "evt_pending", verification("7003"));
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("subscription")).toHaveLength(1);
  });

  it("settles a CANCELLED payment once the provider confirms the money arrived", async () => {
    const payment = seedPayment({ status: "CANCELLED" });
    await activateSubscriptionForPayment(payment.id, "evt_cancelled", verification("7004"));
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("subscription")).toHaveLength(1);
  });
});

describe("the revival is idempotent and cannot double-activate", () => {
  it("claims a webhook event exactly once", async () => {
    const payment = seedPayment({ status: "FAILED" });
    await activateSubscriptionForPayment(payment.id, "evt_same", verification("7005"));
    const second = await activateSubscriptionForPayment(payment.id, "evt_same", verification("7005"));

    expect(second.alreadySettled).toBe(true);
    expect(fake().rows("subscription")).toHaveLength(1);
    expect(fake().rows("auditEvent").filter((row) => row.action === "SUBSCRIPTION_ACTIVATED")).toHaveLength(1);
  });

  it("reports an already-paid payment as settled without extending it again", async () => {
    const payment = seedPayment({ status: "PENDING" });
    await activateSubscriptionForPayment(payment.id, "evt_first", verification("7006"));
    const firstExpiry = new Date(fake().rows("subscription")[0].expiresAt).getTime();

    const again = await activateSubscriptionForPayment(payment.id, "evt_second", verification("7006"));
    expect(again.alreadySettled).toBe(true);
    expect(new Date(fake().rows("subscription")[0].expiresAt).getTime()).toBe(firstExpiry);
  });
});

describe("the settlement gate still refuses what it must", () => {
  it("never revives a REFUNDED payment", async () => {
    const payment = seedPayment({ status: "REFUNDED" });
    await expect(activateSubscriptionForPayment(payment.id, "evt_refunded", verification("7007"))).rejects.toThrow("PAYMENT_NOT_SETTLEABLE");
    expect(fake().rows("payment")[0].status).toBe("REFUNDED");
    expect(fake().rows("subscription")).toHaveLength(0);
  });

  it("revives a non-PENDING payment only with provider evidence from the caller's verification", async () => {
    // Defence in depth: the webhook and the verify route both pass the Paystack transaction id they
    // verified, so a local FAILED row is corrected only by a real provider answer — never by a
    // caller (or a future refactor) that reaches this function without one.
    const payment = seedPayment({ status: "FAILED" });
    await expect(activateSubscriptionForPayment(payment.id, "evt_no_evidence")).rejects.toThrow("PAYMENT_EVIDENCE_REQUIRED");
    expect(fake().rows("payment")[0].status).toBe("FAILED");
    expect(fake().rows("subscription")).toHaveLength(0);

    // The same call *with* the verified id succeeds, so the refusal above is the evidence rule and
    // not a broken revival path.
    await activateSubscriptionForPayment(payment.id, "evt_with_evidence", verification("7011"));
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("subscription")).toHaveLength(1);
  });

  it("refuses a payment with no business or plan context", async () => {
    const payment = seedPayment({ status: "FAILED", businessId: null });
    await expect(activateSubscriptionForPayment(payment.id, "evt_noctx", verification("7008"))).rejects.toThrow("PAYMENT_CONTEXT_INVALID");
  });

  it("refuses a payment in the wrong currency", async () => {
    const payment = seedPayment({ status: "FAILED", currency: "USD" });
    await expect(activateSubscriptionForPayment(payment.id, "evt_usd", verification("7009"))).rejects.toThrow("PAYMENT_CURRENCY_MISMATCH");
  });

  it("refuses a payment whose plan no longer exists", async () => {
    const payment = seedPayment({ status: "FAILED", planId: "plan_missing" });
    await expect(activateSubscriptionForPayment(payment.id, "evt_noplan", verification("7010"))).rejects.toThrow("PLAN_NOT_FOUND");
  });
});

describe("the same rule holds for the Business POS subscription", () => {
  it("settles a FAILED POS payment once the provider confirms it", async () => {
    const payment = seedPayment({ status: "FAILED", planId: "plan_pos", amount: 49900, reference: "JATA-POS-1" });
    const result = await activateSubscriptionForPayment(payment.id, "evt_pos", verification("8001"));

    expect(result.alreadySettled).toBe(false);
    expect(fake().rows("payment")[0].status).toBe("PAID");
    expect(fake().rows("posSubscription")[0]).toMatchObject({ businessId: "bizA", status: "ACTIVE" });
    // Additive product (§80): the AFTERCALL plan is untouched.
    expect(fake().rows("subscription")).toHaveLength(0);
  });
});
