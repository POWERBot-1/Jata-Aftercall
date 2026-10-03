/**
 * Confirming a Business POS payment over HTTP (§4, §43, §44, §67, §80)
 *
 * The last step of the owner journey is "payment confirmed → provisioned → LIVE", and it is the
 * step a browser most wants to fake. These tests drive the real verification route: the status a
 * POS buyer sees comes from the POS subscription their payment actually settled, the browser is
 * told which workspace to return to, and every other plan keeps exactly the behaviour it had
 * before the POS existed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-a", role: "CUSTOMER" } as any,
  payment: null as any,
  findPayment: vi.fn(),
  findSubscription: vi.fn(),
  findPosSubscription: vi.fn(),
  updateMany: vi.fn(),
  ownership: vi.fn(),
  verify: vi.fn(),
  activate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/tenant", () => ({
  assertBusinessOwnership: mocks.ownership,
  TenantError: class TenantError extends Error { status = 403; },
}));
vi.mock("@/lib/db", () => ({
  default: {
    payment: { findUnique: mocks.findPayment, updateMany: mocks.updateMany },
    subscription: { findUnique: mocks.findSubscription },
    posSubscription: { findUnique: mocks.findPosSubscription },
  },
}));
vi.mock("@/lib/paystack", () => ({ verifyTransaction: mocks.verify, activateSubscriptionForPayment: mocks.activate }));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { GET } from "@/app/api/paystack/verify/route";

const posPayment = {
  id: "pay-pos",
  reference: "jata-pos-ref",
  userId: "user-a",
  businessId: "biz-a",
  planId: "plan-pos",
  amount: 49900,
  currency: "KES",
  status: "PENDING",
  plan: { key: "BUSINESS_POS" },
};

const aftercallPayment = {
  ...posPayment,
  id: "pay-month",
  reference: "jata-month-ref",
  planId: "plan-month",
  amount: 14900,
  plan: { key: "MONTHLY" },
};

function request(reference = "jata-pos-ref") {
  return new Request(`https://example.test/api/paystack/verify?reference=${reference}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { userId: "user-a", role: "CUSTOMER" };
  mocks.payment = posPayment;
  mocks.findPayment.mockImplementation(async () => mocks.payment);
  mocks.findSubscription.mockResolvedValue(null);
  mocks.findPosSubscription.mockResolvedValue({ status: "ACTIVE" });
  mocks.ownership.mockResolvedValue(undefined);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.verify.mockResolvedValue({ id: 55, status: "success", reference: "jata-pos-ref", amount: 49900, currency: "KES" });
  mocks.activate.mockResolvedValue({ subscription: { status: "ACTIVE" }, alreadySettled: false });
  vi.stubEnv("PAYSTACK_SECRET_KEY", "test-only-not-a-credential");
  vi.stubEnv("NODE_ENV", "test");
});

describe("GET /api/paystack/verify for a Business POS payment", () => {
  it("confirms from the POS subscription the payment settled, not the AFTERCALL one (§4, §45, §80)", async () => {
    mocks.payment = { ...posPayment, status: "PAID" };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", idempotent: true, posBusinessId: "biz-a" });

    expect(mocks.findPosSubscription).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "biz-a" } }));
    // The AFTERCALL subscription row is never consulted for a POS payment, and no re-verification
    // round trip is made: the payment is already settled and the POS subscription proves it.
    expect(mocks.findSubscription).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("settles a pending POS payment server-side and says where to go next (§43)", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", posBusinessId: "biz-a" });

    expect(mocks.verify).toHaveBeenCalledWith("jata-pos-ref");
    expect(mocks.activate).toHaveBeenCalledWith("pay-pos", undefined, expect.objectContaining({ paystackId: "55" }));
  });

  it("keeps a POS payment that is still processing pending, and does not activate it (§44)", async () => {
    mocks.verify.mockResolvedValue({ id: 55, status: "pending", reference: "jata-pos-ref", amount: 49900, currency: "KES" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "PENDING", posBusinessId: "biz-a" });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.findPosSubscription).not.toHaveBeenCalled();
  });

  it("refuses a POS payment that does not match the provider's own record (§75)", async () => {
    mocks.verify.mockResolvedValue({ id: 55, status: "success", reference: "jata-pos-ref", amount: 1, currency: "KES" });
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "FAILED" });
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.findPosSubscription).not.toHaveBeenCalled();
  });

  it("still sends a POS buyer back to their POS when the payment does not go through (§4, §43)", async () => {
    mocks.verify.mockResolvedValue({ id: 55, status: "failed", reference: "jata-pos-ref", amount: 49900, currency: "KES" });
    const failed = await GET(request());
    expect(failed.status).toBe(200);
    // The failure answer still says which POS this payment was for, so the callback page can
    // offer the owner their own plan again instead of an AFTERCALL page (§67).
    expect((await failed.json()).posBusinessId).toBe("biz-a");
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.findPosSubscription).not.toHaveBeenCalled();
  });

  it("never hands a POS payment to somebody else, whatever they claim (§5, §75)", async () => {
    mocks.session = { userId: "intruder", role: "CUSTOMER" };
    expect((await GET(request())).status).toBe(403);
    mocks.session = null;
    expect((await GET(request())).status).toBe(401);
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});

describe("every other plan is untouched (§80)", () => {
  it("still reads the AFTERCALL subscription and returns no POS workspace", async () => {
    mocks.payment = { ...aftercallPayment, status: "PAID" };
    mocks.findSubscription.mockResolvedValue({ status: "ACTIVE" });
    const response = await GET(request("jata-month-ref"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE", idempotent: true });
    expect(payload.posBusinessId).toBeUndefined();
    expect(mocks.findSubscription).toHaveBeenCalled();
    expect(mocks.findPosSubscription).not.toHaveBeenCalled();
  });

  it("still repairs a legacy paid payment with no subscription row", async () => {
    mocks.payment = aftercallPayment;
    mocks.findSubscription.mockResolvedValue(null);
    mocks.verify.mockResolvedValue({ id: 77, status: "success", reference: "jata-month-ref", amount: 14900, currency: "KES" });
    const response = await GET(request("jata-month-ref"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ status: "PAID", subscriptionStatus: "ACTIVE" });
    expect(payload.posBusinessId).toBeUndefined();
    expect(mocks.verify).toHaveBeenCalledWith("jata-month-ref");
    expect(mocks.activate).toHaveBeenCalledWith("pay-month", undefined, expect.objectContaining({ paystackId: "77" }));
  });
});

describe("the callback page returns a POS buyer to their POS, safely (§4, §67)", () => {
  const source = readFileSync(join(process.cwd(), "app/checkout/callback/page.tsx"), "utf8");

  it("builds the link from the server-resolved business id and shape-checks it", () => {
    expect(source).toContain("posBusinessId");
    expect(source).toContain("posReturnHref");
    expect(source).toMatch(/\/\^\[A-Za-z0-9_-\]\{1,64\}\$\//);
    expect(source).toContain("/dashboard/pos/");
  });

  it("never takes a destination from the query string, so it cannot be redirected (§56, §67)", () => {
    // `reference`/`trxref`/`mock` are the only parameters this page reads.
    const params = [...source.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(params.sort()).toEqual(["mock", "reference", "trxref"]);
    expect(source).not.toMatch(/searchParams\.get\("(returnTo|redirect|next|to|url|dest)"/i);
  });

  it("keeps the ordinary AFTERCALL journey exactly as it was", () => {
    expect(source).toContain('posHref ?? "/dashboard"');
    expect(source).toContain('posHref ? `${posHref}/plan` : "/dashboard/subscription"');
  });
});
