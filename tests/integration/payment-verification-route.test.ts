import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "CUSTOMER" } as any,
  payment: { id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "biz-a", planId: "plan-a", amount: 14900, currency: "KES", status: "PENDING" } as any,
  findPayment: vi.fn(), findSubscription: vi.fn(), updateMany: vi.fn(), ownership: vi.fn(), verify: vi.fn(), activate: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({ assertBusinessOwnership: mocks.ownership, TenantError: class TenantError extends Error { status = 403; } }));
vi.mock("@/lib/db", () => ({ default: { payment: { findUnique: mocks.findPayment, updateMany: mocks.updateMany }, subscription: { findUnique: mocks.findSubscription } } }));
vi.mock("@/lib/paystack", () => ({ verifyTransaction: mocks.verify, activateSubscriptionForPayment: mocks.activate }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
import { GET } from "@/app/api/paystack/verify/route";

function request(reference = "jata-ref", suffix = "") { return new Request(`https://example.test/api/paystack/verify?reference=${reference}${suffix}`); }

describe("server payment verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "user-a", role: "CUSTOMER" };
    mocks.payment = { id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "biz-a", planId: "plan-a", amount: 14900, currency: "KES", status: "PENDING" };
    mocks.findPayment.mockResolvedValue(mocks.payment);
    mocks.findSubscription.mockResolvedValue({ status: "ACTIVE" });
    mocks.ownership.mockResolvedValue(undefined);
    mocks.verify.mockResolvedValue({ id: 55, status: "success", reference: "jata-ref", amount: 14900, currency: "KES" });
    mocks.activate.mockResolvedValue({ subscription: { status: "ACTIVE" }, alreadySettled: false });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential");
    vi.stubEnv("NODE_ENV", "test");
  });

  it("does not let anonymous or another user verify a payment", async () => {
    mocks.session = null;
    expect((await GET(request())).status).toBe(401);
    mocks.session = { userId: "other-user", role: "CUSTOMER" };
    expect((await GET(request())).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("settles only a matching server-verified successful transaction", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE" });
    expect(mocks.activate).toHaveBeenCalledWith("pay-a", undefined, expect.objectContaining({ paystackId: "55" }));
  });

  it("keeps exact verification lookup for an already-stored legacy reference", async () => {
    const legacyReference = "jata_0123456789abcdef";
    mocks.payment = { ...mocks.payment, reference: legacyReference };
    mocks.findPayment.mockResolvedValue(mocks.payment);
    mocks.verify.mockResolvedValue({ id: 55, status: "success", reference: legacyReference, amount: 14900, currency: "KES" });

    const response = await GET(request(legacyReference));
    expect(response.status).toBe(200);
    expect(mocks.findPayment).toHaveBeenCalledWith({ where: { reference: legacyReference } });
    expect(mocks.verify).toHaveBeenCalledWith(legacyReference);
    expect(mocks.activate).toHaveBeenCalledWith("pay-a", undefined, expect.any(Object));
  });

  it("rejects amount and currency mismatches without activation", async () => {
    for (const evidence of [
      { id: 55, status: "success", reference: "jata-ref", amount: 100, currency: "KES" },
      { id: 55, status: "success", reference: "jata-ref", amount: 14900, currency: "NGN" },
    ]) {
      mocks.verify.mockResolvedValueOnce(evidence);
      const response = await GET(request());
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ status: "FAILED" });
    }
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 55, status: "abandoned", reference: "jata-ref", amount: 14900, currency: "KES" }, "CANCELLED"],
    [{ id: 55, status: "failed", reference: "jata-ref", amount: 14900, currency: "KES" }, "FAILED"],
  ])("does not activate an incomplete payment", async (evidence, expected) => {
    mocks.verify.mockResolvedValue(evidence);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: expected });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("allows only an authenticated non-production mock settlement without Paystack credentials", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await GET(request("jata-ref", "&mock=success"))).status).toBe(200);
    expect(mocks.activate).toHaveBeenCalled();
    mocks.activate.mockClear();
    vi.stubEnv("NODE_ENV", "production");
    mocks.verify.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await GET(request("jata-ref", "&mock=success"));
    expect(response.status).toBe(502);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("repairs a legacy paid payment whose subscription row is missing", async () => {
    mocks.payment.status = "PAID";
    mocks.findSubscription.mockResolvedValueOnce(null);
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", idempotent: true });
    expect(mocks.verify).toHaveBeenCalledWith("jata-ref");
    expect(mocks.activate).toHaveBeenCalledWith("pay-a", undefined, expect.objectContaining({ paystackId: "55" }));
  });

  it("is idempotent once already paid", async () => {
    mocks.payment.status = "PAID";
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", idempotent: true });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});
