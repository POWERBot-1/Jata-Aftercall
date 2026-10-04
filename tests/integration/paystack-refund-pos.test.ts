/**
 * Production audit 2026-10-04 — a refunded Business POS payment must revoke the POS.
 *
 * The refund branch of the webhook only ever suspended the AFTERCALL `Subscription` (and the AI
 * row). A POS payment settles the separate `PosSubscription`, so refunding it left the POS ACTIVE
 * and — worse — suspended the business's unrelated AFTERCALL page plan. The plan is resolved from
 * the stored payment, never from the webhook body.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentFind: vi.fn(),
  planFind: vi.fn(),
  processedCheck: vi.fn(),
  webhookCreate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  aiUpdateMany: vi.fn(),
  posSubUpdateMany: vi.fn(),
  posEntUpdateMany: vi.fn(),
  posConfigUpdateMany: vi.fn(),
  posAuditCreate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    payment: { findUnique: mocks.paymentFind },
    planConfig: { findUnique: mocks.planFind },
    processedWebhook: { upsert: vi.fn() },
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({
      processedWebhook: { create: mocks.webhookCreate },
      auditEvent: { create: vi.fn() },
      payment: { updateMany: mocks.paymentUpdateMany },
      subscription: { updateMany: mocks.subscriptionUpdateMany },
      aIPackageEntitlement: { updateMany: mocks.aiUpdateMany },
      posSubscription: { updateMany: mocks.posSubUpdateMany },
      posEntitlement: { updateMany: mocks.posEntUpdateMany },
      posConfiguration: { updateMany: mocks.posConfigUpdateMany },
      posAuditEvent: { create: mocks.posAuditCreate },
    }),
  },
}));
vi.mock("@/lib/paystack", () => ({
  verifyWebhookSignature: vi.fn(() => true),
  isWebhookProcessed: mocks.processedCheck,
  verifyTransaction: vi.fn(),
  activateSubscriptionForPayment: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { POST } from "@/app/api/paystack/webhook/route";
import { derivePosEntitlement } from "@/lib/pos/entitlement";

const refund = { id: 7001, event: "refund.processed", data: { id: 1, transaction_reference: "ref-1", amount: 49900, currency: "KES" } };
const request = (body: unknown = refund) => new Request("https://example.test/api/paystack/webhook", {
  method: "POST", body: JSON.stringify(body), headers: { "x-paystack-signature": "sig" },
});
const payment = (planId: string | null, amount = 49900) => ({
  id: "pay-1", reference: "ref-1", userId: "user-1", businessId: "biz-1", planId, amount, currency: "KES", status: "PAID",
});

describe("refund.processed routes to the product that was paid for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processedCheck.mockResolvedValue(false);
    mocks.webhookCreate.mockResolvedValue({});
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    for (const fn of [mocks.subscriptionUpdateMany, mocks.aiUpdateMany, mocks.posSubUpdateMany, mocks.posEntUpdateMany, mocks.posConfigUpdateMany]) fn.mockResolvedValue({ count: 1 });
    mocks.posAuditCreate.mockResolvedValue({});
  });

  it("a refunded Business POS payment suspends the POS and leaves the AFTERCALL plan alone", async () => {
    mocks.paymentFind.mockResolvedValue(payment("plan-pos"));
    mocks.planFind.mockResolvedValue({ key: "BUSINESS_POS" });

    const response = await POST(request());
    expect(await response.json()).toEqual({ status: "refund_processed" });

    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({ where: { id: "pay-1", status: "PAID" }, data: { status: "REFUNDED" } });
    expect(mocks.posSubUpdateMany).toHaveBeenCalledWith({ where: { businessId: "biz-1" }, data: { status: "SUSPENDED" } });
    expect(mocks.posEntUpdateMany).toHaveBeenCalledWith({ where: { businessId: "biz-1" }, data: { status: "SUSPENDED" } });
    expect(mocks.posConfigUpdateMany).toHaveBeenCalledWith({ where: { businessId: "biz-1", status: "LIVE" }, data: { status: "SUSPENDED" } });
    expect(mocks.posAuditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ businessId: "biz-1", action: "POS_SUSPENDED" }) });
    // The unrelated AFTERCALL page plan and AI package are untouched.
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.aiUpdateMany).not.toHaveBeenCalled();
  });

  it("a refunded AFTERCALL plan payment still suspends the AFTERCALL subscription and never the POS", async () => {
    mocks.paymentFind.mockResolvedValue(payment("plan-monthly", 14900));
    mocks.planFind.mockResolvedValue({ key: "MONTHLY" });

    const response = await POST(request({ ...refund, data: { ...refund.data, amount: 14900 } }));
    expect(await response.json()).toEqual({ status: "refund_processed" });

    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({ where: { businessId: "biz-1" }, data: { status: "SUSPENDED" } });
    expect(mocks.aiUpdateMany).toHaveBeenCalled();
    expect(mocks.posSubUpdateMany).not.toHaveBeenCalled();
    expect(mocks.posEntUpdateMany).not.toHaveBeenCalled();
    expect(mocks.posConfigUpdateMany).not.toHaveBeenCalled();
  });

  it("replaying a POS refund event changes nothing a second time", async () => {
    mocks.paymentFind.mockResolvedValue(payment("plan-pos"));
    mocks.planFind.mockResolvedValue({ key: "BUSINESS_POS" });
    mocks.processedCheck.mockResolvedValue(true);

    const response = await POST(request());
    expect(await response.json()).toEqual({ status: "already_processed" });
    expect(mocks.posSubUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
  });

  it("a payment whose status was already changed does not suspend anything (compare-and-set)", async () => {
    mocks.paymentFind.mockResolvedValue(payment("plan-pos"));
    mocks.planFind.mockResolvedValue({ key: "BUSINESS_POS" });
    mocks.paymentUpdateMany.mockResolvedValue({ count: 0 });

    await POST(request());
    expect(mocks.posSubUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it("the state the refund writes is NOT entitled, while the pre-refund state was", () => {
    const future = new Date(Date.now() + 10 * 86_400_000);
    const before = derivePosEntitlement({ subscription: { status: "ACTIVE", planKey: "BUSINESS_POS", expiresAt: future }, paidPayment: { status: "PAID" }, configurationStatus: "LIVE" });
    const after = derivePosEntitlement({ subscription: { status: "SUSPENDED", planKey: "BUSINESS_POS", expiresAt: future }, entitlement: { status: "SUSPENDED" }, paidPayment: null, configurationStatus: "SUSPENDED" });
    expect(before.entitled).toBe(true);
    expect(after.entitled).toBe(false);
  });
});
