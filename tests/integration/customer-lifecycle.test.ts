import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  session: { userId: "user-a", role: "CUSTOMER", email: "owner@example.test" } as any,
  business: null as any,
  payment: null as any,
  subscription: null as any,
  plan: { id: "plan-month", key: "MONTH", name: "Monthly", priceKES: 149, durationDays: 30, isActive: true } as any,
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/tenant", () => {
  class TenantError extends Error { status: number; constructor(message: string, status = 403) { super(message); this.status = status; } }
  return {
    TenantError,
    assertBusinessOwnership: vi.fn(async (businessId: string, session: any) => {
      if (!state.business || state.business.id !== businessId) throw new TenantError("missing", 404);
      if (session.role !== "ADMIN" && session.userId !== state.business.ownerId) throw new TenantError("not authorized", 403);
    }),
    guardTenantMutation: vi.fn(async (session: any, businessId: string) => {
      if (!session) return { ok: false, status: 401, error: "Sign in" };
      if (!state.business || businessId !== state.business.id || (session.role !== "ADMIN" && session.userId !== state.business.ownerId)) return { ok: false, status: 403, error: "No access" };
      return { ok: true };
    }),
  };
});
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/paystack", () => ({
  toKobo: (kes: number) => kes * 100,
  initializeTransaction: vi.fn(),
  verifyTransaction: vi.fn(),
  activateSubscriptionForPayment: vi.fn(async (paymentId: string, _eventId?: string, verification?: any) => {
    if (!state.payment || state.payment.id !== paymentId) throw new Error("missing payment");
    if (state.payment.status === "PAID") return { subscription: state.subscription, alreadySettled: true };
    state.payment.status = "PAID";
    state.payment.paystackId = verification?.paystackId;
    const startAt = new Date();
    state.subscription = {
      id: "sub-a", businessId: state.business.id, userId: state.session.userId, planId: state.plan.id,
      status: "ACTIVE", startAt, expiresAt: new Date(startAt.getTime() + state.plan.durationDays * 86400000),
    };
    state.business.status = "ACTIVE";
    return { subscription: state.subscription, alreadySettled: false };
  }),
}));
vi.mock("@/lib/db", () => {
  const db: any = {};
  db.business = {
    findUnique: vi.fn(async ({ where }: any) => state.business && (where.id === state.business.id || where.slug === state.business.slug) ? state.business : null),
    create: vi.fn(async ({ data }: any) => { state.business = { id: "biz-a", ...data, isPublished: false, status: "PENDING" }; return state.business; }),
    update: vi.fn(async ({ data }: any) => { state.business = { ...state.business, ...data }; return state.business; }),
  };
  db.businessMember = { create: vi.fn(async ({ data }: any) => ({ id: "member-a", ...data })) };
  db.planConfig = { findUnique: vi.fn(async ({ where }: any) => where.id === state.plan.id ? state.plan : null) };
  db.user = { findUnique: vi.fn(async () => ({ email: "owner@example.test" })) };
  db.payment = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => { state.payment = { id: "payment-a", ...data }; return { ...state.payment }; }),
    findUnique: vi.fn(async ({ where }: any) => state.payment && (where.id === state.payment.id || where.reference === state.payment.reference) ? state.payment : null),
    update: vi.fn(async ({ data }: any) => { state.payment = { ...state.payment, ...data }; return state.payment; }),
    updateMany: vi.fn(async ({ where, data }: any) => { if (!state.payment || state.payment.id !== where.id || state.payment.status !== where.status) return { count: 0 }; state.payment = { ...state.payment, ...data }; return { count: 1 }; }),
  };
  db.subscription = {
    findUnique: vi.fn(async () => state.subscription),
    upsert: vi.fn(async ({ create, update }: any) => { state.subscription = { id: "sub-a", ...(state.subscription ? update : create) }; return state.subscription; }),
  };
  db.processedWebhook = { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})) };
  db.auditEvent = { create: vi.fn(async () => ({})) };
  db.$transaction = async (callback: (tx: any) => unknown) => callback(db);
  return { default: db };
});

import { POST as createBusiness } from "@/app/api/business/route";
import { PATCH as updateBusiness } from "@/app/api/business/route";
import { POST as startCheckout } from "@/app/api/checkout/route";
import { GET as verifyPayment } from "@/app/api/paystack/verify/route";
import { getDirectionsUrl } from "@/lib/location";
import { publicPageDecision } from "@/lib/publication";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("deterministic customer lifecycle (database and payment provider mocked)", () => {
  beforeEach(() => {
    state.session = { userId: "user-a", role: "CUSTOMER", email: "owner@example.test" };
    state.business = null;
    state.payment = null;
    state.subscription = null;
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  it("creates a business with location, starts authoritative plan checkout, verifies settlement, and respects publication", async () => {
    const created = await createBusiness(jsonRequest("https://app.test/api/business", "POST", {
      name: "Sample Cafe", category: "Restaurant", location: "Nairobi CBD", lat: "-1.286389", lng: "36.817223",
    }));
    expect(created.status).toBe(201);
    expect(state.business).toMatchObject({ ownerId: "user-a", location: "Nairobi CBD", lat: -1.286389, lng: 36.817223, isPublished: false });

    const checkout = await startCheckout(jsonRequest("https://app.test/api/checkout", "POST", {
      businessId: "biz-a", planId: "plan-month", amount: 1,
    }));
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toMatchObject({ mock: true, payment: { amount: 14900, status: "PENDING", currency: "KES" } });
    expect(state.payment).toMatchObject({ businessId: "biz-a", userId: "user-a", planId: "plan-month", amount: 14900 });

    const verified = await verifyPayment(new Request(`https://app.test/api/paystack/verify?reference=${state.payment.reference}&mock=success`));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE" });
    expect(state.payment.status).toBe("PAID");
    expect(state.subscription).toMatchObject({ businessId: "biz-a", status: "ACTIVE", planId: "plan-month" });
    expect(state.subscription.expiresAt.getTime() - state.subscription.startAt.getTime()).toBe(30 * 86400000);

    expect(publicPageDecision({ business: { isPublished: state.business.isPublished, ownerId: "user-a" }, viewer: null })).toBe("not_found");
    const published = await updateBusiness(jsonRequest("https://app.test/api/business", "PATCH", { businessId: "biz-a", isPublished: true }));
    expect(published.status).toBe(200);
    expect(publicPageDecision({ business: { isPublished: state.business.isPublished, ownerId: "user-a" }, viewer: null })).toBe("public");
    expect(getDirectionsUrl(state.business.location, state.business.lat, state.business.lng)).toContain("-1.286389%2C36.817223");
  });
});
