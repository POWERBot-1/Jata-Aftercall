import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  signatureValid: true, alreadyProcessed: false,
  paymentFind: vi.fn(), webhookUpsert: vi.fn(), verify: vi.fn(), activate: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ default: { payment: { findUnique: mocks.paymentFind }, processedWebhook: { upsert: mocks.webhookUpsert } } }));
vi.mock("@/lib/paystack", () => ({
  verifyWebhookSignature: vi.fn(() => mocks.signatureValid), isWebhookProcessed: vi.fn(async () => mocks.alreadyProcessed),
  verifyTransaction: mocks.verify, activateSubscriptionForPayment: mocks.activate,
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));
import { POST } from "@/app/api/paystack/webhook/route";

const payload = { id: 1234, event: "charge.success", data: { id: 56, reference: "jata-ref", amount: 14900, currency: "KES" } };
function request(body: unknown = payload) { return new Request("https://example.test/api/paystack/webhook", { method: "POST", body: JSON.stringify(body), headers: { "x-paystack-signature": "signature" } }); }

describe("Paystack webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signatureValid = true;
    mocks.alreadyProcessed = false;
    mocks.paymentFind.mockResolvedValue({ id: "pay-a", reference: "jata-ref", userId: "user-a", amount: 14900, currency: "KES", status: "PENDING" });
    mocks.verify.mockResolvedValue({ id: 56, status: "success", reference: "jata-ref", amount: 14900, currency: "KES" });
    mocks.activate.mockResolvedValue({ subscription: { status: "ACTIVE" }, alreadySettled: false });
  });
  it("rejects invalid signatures and malformed payloads", async () => {
    mocks.signatureValid = false;
    expect((await POST(request())).status).toBe(401);
    mocks.signatureValid = true;
    expect((await POST(new Request("https://example.test/api/paystack/webhook", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(request({ id: {}, event: "charge.success", data: {} }))).status).toBe(400);
  });
  it("verifies matching transaction and activates once with the event id", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "processed" });
    expect(mocks.activate).toHaveBeenCalledWith("pay-a", "1234", expect.objectContaining({ paystackId: "56" }));
  });
  it("correlates webhook verification against an existing stored reference without rewriting it", async () => {
    const legacyReference = "jata_0123456789abcdef";
    const legacyPayload = { ...payload, data: { ...payload.data, reference: legacyReference } };
    mocks.paymentFind.mockResolvedValue({ id: "pay-a", reference: legacyReference, userId: "user-a", amount: 14900, currency: "KES", status: "PENDING" });
    mocks.verify.mockResolvedValue({ id: 56, status: "success", reference: legacyReference, amount: 14900, currency: "KES" });

    const response = await POST(request(legacyPayload));
    expect(response.status).toBe(200);
    expect(mocks.paymentFind).toHaveBeenCalledWith({ where: { reference: legacyReference } });
    expect(mocks.verify).toHaveBeenCalledWith(legacyReference);
    expect(mocks.activate).toHaveBeenCalledWith("pay-a", "1234", expect.any(Object));
  });

  it("rejects amount/currency mismatches and does not activate", async () => {
    mocks.verify.mockResolvedValue({ id: 56, status: "success", reference: "jata-ref", amount: 100, currency: "KES" });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it("acknowledges and audits a partial subscription refund without marking it fully refunded", async () => {
    mocks.paymentFind.mockResolvedValue({ id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a", purpose: "SUBSCRIPTION", amount: 99900, currency: "KES", status: "PAID" });
    const refund = { id: 1234, event: "refund.processed", data: { id: 902, transaction_reference: "jata-ref", amount: 1, currency: "KES" } };
    const response = await POST(request(refund));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "partial_refund_requires_review" });
    expect(mocks.webhookUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "1234" } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED", targetId: "pay-a", metadata: { amount: 1, currency: "KES" } }));
    expect(mocks.paymentFind).toHaveBeenCalledWith({ where: { reference: "jata-ref" } });
  });
  it("acknowledges duplicate events idempotently", async () => {
    mocks.alreadyProcessed = true;
    expect(await (await POST(request())).json()).toEqual({ status: "already_processed" });
    expect(mocks.paymentFind).not.toHaveBeenCalled();
  });
});
