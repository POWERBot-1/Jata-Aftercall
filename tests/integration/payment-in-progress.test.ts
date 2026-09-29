import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the in-progress Paystack status defect (current-main remediation).
// Before the fix, "ongoing", "pending", "processing" and "queued" were written as FAILED, so a
// later successful charge hit PAYMENT_NOT_PENDING and a paying customer was never activated.

const db = vi.hoisted(() => ({
  payment: { id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "biz-a", planId: "plan-a", amount: 14900, currency: "KES", status: "PENDING" } as any,
}));
const mocks = vi.hoisted(() => ({ verify: vi.fn(), activate: vi.fn(), updateMany: vi.fn(), audit: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => ({ userId: "user-a", role: "CUSTOMER" })) }));
vi.mock("@/lib/tenant", () => ({ assertBusinessOwnership: vi.fn(async () => undefined), TenantError: class TenantError extends Error { status = 403; } }));
vi.mock("@/lib/db", () => ({
  default: {
    payment: {
      findUnique: vi.fn(async () => ({ ...db.payment })),
      updateMany: mocks.updateMany.mockImplementation(async ({ where, data }: any) => {
        if (where.status && where.status !== db.payment.status) return { count: 0 };
        db.payment = { ...db.payment, ...data };
        return { count: 1 };
      }),
    },
    subscription: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
  },
}));
vi.mock("@/lib/paystack", () => ({ verifyTransaction: mocks.verify, activateSubscriptionForPayment: mocks.activate }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { GET } from "@/app/api/paystack/verify/route";
import { PAYSTACK_IN_PROGRESS_STATUSES } from "@/lib/paymentVerification";

const evidence = (status: string) => ({ id: 55, status, reference: "jata-ref", amount: 14900, currency: "KES" });
const request = () => new Request("https://example.test/api/paystack/verify?reference=jata-ref");

describe("verify route keeps in-progress Paystack payments PENDING", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payment = { ...db.payment, status: "PENDING" };
    mocks.activate.mockImplementation(async () => {
      if (db.payment.status !== "PENDING") throw new Error("PAYMENT_NOT_PENDING");
      db.payment = { ...db.payment, status: "PAID" };
      return { subscription: { status: "ACTIVE" }, alreadySettled: false };
    });
    vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential");
    vi.stubEnv("NODE_ENV", "test");
  });

  it("covers exactly the four documented in-progress statuses", () => {
    expect([...PAYSTACK_IN_PROGRESS_STATUSES].sort()).toEqual(["ongoing", "pending", "processing", "queued"]);
  });

  it.each(["ongoing", "pending", "processing", "queued"])("'%s' returns PENDING, never writes FAILED, never activates", async (status) => {
    mocks.verify.mockResolvedValue(evidence(status));
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("PENDING");
    expect(body.message).toMatch(/still processing/i);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(db.payment.status).toBe("PENDING");
  });

  it.each(["ongoing", "pending", "processing", "queued"])("'%s' followed by success settles the payment exactly once", async (status) => {
    mocks.verify.mockResolvedValueOnce(evidence(status));
    expect(await (await GET(request())).json()).toMatchObject({ status: "PENDING" });
    mocks.verify.mockResolvedValueOnce(evidence("success"));
    const second = await GET(request());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE" });
    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(db.payment.status).toBe("PAID");
  });

  it.each([["failed", "FAILED"], ["abandoned", "CANCELLED"], ["reversed", "FAILED"], ["expired", "EXPIRED"]])("final status '%s' is still recorded as %s", async (status, expected) => {
    mocks.verify.mockResolvedValue(evidence(status));
    const body = await (await GET(request())).json();
    expect(body.status).toBe(expected);
    expect(db.payment.status).toBe(expected);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("an in-progress status never bypasses amount/currency verification", async () => {
    mocks.verify.mockResolvedValue({ ...evidence("processing"), amount: 100 });
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "FAILED" });
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});
