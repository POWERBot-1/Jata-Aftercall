import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  payment: null as any, plan: null as any, subscription: null as any, processed: new Set<string>(), upsertCount: 0, businessUpdates: 0,
}));
const mocksTx = {
  payment: {
    findUnique: vi.fn(async () => state.payment),
    updateMany: vi.fn(async ({ where, data }: any) => {
      if (state.payment.id !== where.id || state.payment.status !== where.status) return { count: 0 };
      state.payment = { ...state.payment, ...data };
      return { count: 1 };
    }),
  },
  processedWebhook: {
    findUnique: vi.fn(async ({ where }: any) => state.processed.has(where.id) ? { id: where.id } : null),
    create: vi.fn(async ({ data }: any) => { state.processed.add(data.id); return { id: data.id }; }),
  },
  planConfig: { findUnique: vi.fn(async () => state.plan) },
  subscription: {
    findUnique: vi.fn(async () => state.subscription),
    upsert: vi.fn(async ({ create, update }: any) => {
      state.upsertCount++;
      state.subscription = { id: "sub-a", ...(state.subscription ? update : create) };
      return state.subscription;
    }),
  },
  business: { update: vi.fn(async () => { state.businessUpdates++; return {}; }) },
  auditEvent: { create: vi.fn(async () => ({})) },
};
vi.mock("@/lib/db", () => ({ default: { $transaction: vi.fn(async (callback: (client: typeof mocksTx) => unknown) => callback(mocksTx)) } }));
import { activateSubscriptionForPayment } from "@/lib/paystack";

describe("atomic, idempotent payment settlement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    state.payment = { id: "pay-a", reference: "jata-ref", status: "PENDING", businessId: "biz-a", userId: "user-a", planId: "plan-a", currency: "KES" };
    state.plan = { id: "plan-a", key: "MONTH", durationDays: 30 };
    state.subscription = null;
    state.processed = new Set();
    state.upsertCount = 0;
    state.businessUpdates = 0;
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("settles payment, subscription, business status and event marker together", async () => {
    const result = await activateSubscriptionForPayment("pay-a", "event-1", { paystackId: "56", raw: { verified: true } });
    expect(result.alreadySettled).toBe(false);
    expect(state.payment).toMatchObject({ status: "PAID", paystackId: "56" });
    expect(state.subscription).toMatchObject({ status: "ACTIVE", businessId: "biz-a", userId: "user-a", planId: "plan-a" });
    expect(state.subscription.startAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(state.subscription.expiresAt.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(state.processed.has("event-1")).toBe(true);
    expect(state.businessUpdates).toBe(1);
  });

  it("does not create or extend a second subscription on duplicate callback or webhook", async () => {
    await activateSubscriptionForPayment("pay-a", "event-1");
    const afterFirst = state.subscription.expiresAt.getTime();
    expect((await activateSubscriptionForPayment("pay-a", "event-1")).alreadySettled).toBe(true);
    expect((await activateSubscriptionForPayment("pay-a")).alreadySettled).toBe(true);
    expect(state.upsertCount).toBe(1);
    expect(state.subscription.expiresAt.getTime()).toBe(afterFirst);
    expect(state.businessUpdates).toBe(1);
  });

  it("repairs a legacy PAID payment missing its subscription without extending it twice", async () => {
    state.payment.status = "PAID";
    const result = await activateSubscriptionForPayment("pay-a");
    expect(result.alreadySettled).toBe(false);
    expect(state.subscription.expiresAt.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(mocksTx.payment.updateMany).not.toHaveBeenCalled();
    expect(state.upsertCount).toBe(1);
  });

  it("cannot settle a payment recorded in a non-KES currency", async () => {
    state.payment.currency = "USD";
    await expect(activateSubscriptionForPayment("pay-a")).rejects.toThrow("PAYMENT_CURRENCY_MISMATCH");
    expect(state.subscription).toBeNull();
    expect(state.upsertCount).toBe(0);
  });

  it("does not activate a failed/cancelled payment", async () => {
    state.payment.status = "CANCELLED";
    await expect(activateSubscriptionForPayment("pay-a")).rejects.toThrow("PAYMENT_NOT_PENDING");
    expect(state.subscription).toBeNull();
    expect(state.upsertCount).toBe(0);
  });
});
