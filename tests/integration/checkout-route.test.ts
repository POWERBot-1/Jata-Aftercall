import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "CUSTOMER", email: "owner@example.test" } as any,
  ownershipError: null as Error | null,
  businessFind: vi.fn(), planFind: vi.fn(), userFind: vi.fn(), paymentCreate: vi.fn(), paymentFindFirst: vi.fn(), paymentUpdate: vi.fn(), paymentUpdateMany: vi.fn(),
  initialize: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ assertBusinessOwnership: vi.fn(async () => { if (mocks.ownershipError) throw mocks.ownershipError; }), TenantError: class TenantError extends Error { status = 403; } }));
vi.mock("@/lib/db", () => ({ default: {
  business: { findUnique: mocks.businessFind }, planConfig: { findUnique: mocks.planFind }, user: { findUnique: mocks.userFind },
  payment: { create: mocks.paymentCreate, findFirst: mocks.paymentFindFirst, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
} }));
vi.mock("@/lib/paystack", () => ({ initializeTransaction: mocks.initialize, toKobo: (kes: number) => kes * 100 }));

import { POST } from "@/app/api/checkout/route";
import { TenantError } from "@/lib/tenant";

function request(body: unknown) { return new Request("https://example.test/api/checkout", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }); }

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "user-a", role: "CUSTOMER" };
    mocks.ownershipError = null;
    mocks.businessFind.mockResolvedValue({ id: "business-a" });
    mocks.planFind.mockResolvedValue({ id: "plan-month", key: "MONTH", name: "Monthly", priceKES: 149, durationDays: 30, isActive: true });
    mocks.userFind.mockResolvedValue({ email: "owner@example.test" });
    mocks.paymentFindFirst.mockResolvedValue(null);
    mocks.paymentUpdate.mockResolvedValue({ id: "payment-a", status: "FAILED" });
    mocks.paymentCreate.mockResolvedValue({ id: "payment-a", reference: "jata-generated", amount: 14900, currency: "KES", status: "PENDING" });
    mocks.initialize.mockResolvedValue({ authorization_url: "https://checkout.paystack.test/authorize", reference: "jata-generated", access_code: "opaque" });
    vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential");
    vi.stubEnv("NODE_ENV", "test");
  });

  it("authenticates, checks ownership, and initializes using the DB plan amount, ignoring client amount", async () => {
    const response = await POST(request({ businessId: "business-a", planId: "plan-month", amount: 1 }));
    expect(response.status).toBe(200);
    expect(mocks.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: 14900, planId: "plan-month", businessId: "business-a", userId: "user-a" }) }));
    expect(mocks.initialize).toHaveBeenCalledWith(expect.objectContaining({ amount: 14900, email: "owner@example.test" }));
  });

  it("rejects unauthenticated and unauthorized requests", async () => {
    mocks.session = null;
    expect((await POST(request({ businessId: "business-a", planId: "plan-month" }))).status).toBe(401);
    mocks.session = { userId: "intruder", role: "CUSTOMER" };
    mocks.ownershipError = new TenantError("not owner");
    expect((await POST(request({ businessId: "business-a", planId: "plan-month" }))).status).toBe(403);
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it("rejects missing/inactive plans before creating payment", async () => {
    expect((await POST(request({ businessId: "business-a" }))).status).toBe(400);
    mocks.planFind.mockResolvedValue({ id: "inactive", isActive: false, priceKES: 1, durationDays: 30 });
    expect((await POST(request({ businessId: "business-a", planId: "inactive" }))).status).toBe(400);
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
  });

  it("uses a clearly isolated local test checkout only outside production", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(request({ businessId: "business-a", planId: "plan-month" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mock: true, authorization_url: expect.stringContaining("/checkout/mock") });
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("fails closed if live checkout configuration is missing", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(request({ businessId: "business-a", planId: "plan-month" }));
    expect(response.status).toBe(503);
    expect(mocks.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));
  });

  it("prevents an accidental second pending payment for the same business and plan", async () => {
    mocks.paymentFindFirst.mockResolvedValue({ reference: "existing-ref" });
    const response = await POST(request({ businessId: "business-a", planId: "plan-month" }));
    expect(response.status).toBe(409);
    expect(mocks.paymentCreate).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("fails the pending record safely when Paystack initialization fails", async () => {
    mocks.initialize.mockRejectedValue(new Error("provider error with sensitive detail"));
    const response = await POST(request({ businessId: "business-a", planId: "plan-month" }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sensitive detail");
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "FAILED" } }));
  });
});
