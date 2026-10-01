import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signatureValid: true,
  alreadyProcessed: false,
  paymentFind: vi.fn(),
  webhookUpsert: vi.fn(),
  webhookCreate: vi.fn(),
  paymentUpdateMany: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  activate: vi.fn(),
  audit: vi.fn(),
  processedCheck: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    payment: { findUnique: mocks.paymentFind },
    processedWebhook: { upsert: mocks.webhookUpsert },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/paystack", () => ({
  verifyWebhookSignature: vi.fn(() => mocks.signatureValid),
  isWebhookProcessed: mocks.processedCheck,
  verifyTransaction: mocks.verify,
  activateSubscriptionForPayment: mocks.activate,
}));
vi.mock("@/lib/audit", () => ({ logAudit: mocks.audit }));

import { POST } from "@/app/api/paystack/webhook/route";

const payload = {
  id: 1234,
  event: "charge.success",
  data: { id: 56, reference: "jata-ref", amount: 14900, currency: "KES" },
};
const partialRefund = {
  id: 1234,
  event: "refund.processed",
  data: { id: 902, transaction_reference: "jata-ref", amount: 1, currency: "KES" },
};

function request(body: unknown = payload) {
  return new Request("https://example.test/api/paystack/webhook", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-paystack-signature": "signature" },
  });
}

type TransactionOutcome = "committed" | "rolled_back";
type EventClaim = { completion: Promise<TransactionOutcome>; finish: (outcome: TransactionOutcome) => void };

/**
 * Deterministic Prisma transaction double. It models the ProcessedWebhook.id
 * primary-key lock: concurrent inserts for one id wait for the first transaction,
 * then either observe its commit as a unique-key conflict or claim after rollback.
 */
function installAtomicWebhookStore(barrierEventId?: string) {
  const committedEvents = new Set<string>();
  const pendingClaims = new Map<string, EventClaim>();
  const auditRows: Array<Record<string, unknown>> = [];
  let precheckCount = 0;
  let releasePrechecks!: () => void;
  const prechecksReleased = new Promise<void>((resolve) => { releasePrechecks = resolve; });

  mocks.processedCheck.mockImplementation(async (id: string) => {
    if (id === barrierEventId && precheckCount < 2) {
      precheckCount += 1;
      if (precheckCount === 2) releasePrechecks();
      await prechecksReleased;
    }
    return committedEvents.has(id);
  });

  mocks.transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => {
    let claimedEventId: string | undefined;
    const transactionAudits: Array<Record<string, unknown>> = [];
    const uniqueConstraintError = () => Object.assign(new Error("ProcessedWebhook.id is unique"), { code: "P2002" });
    const tx = {
      processedWebhook: {
        create: async ({ data }: { data: { id: string } }) => {
          const { id } = data;
          const existingClaim = pendingClaims.get(id);
          if (existingClaim) {
            const outcome = await existingClaim.completion;
            if (outcome === "committed" || committedEvents.has(id)) throw uniqueConstraintError();
          }
          if (committedEvents.has(id)) throw uniqueConstraintError();

          let finish!: (outcome: TransactionOutcome) => void;
          const completion = new Promise<TransactionOutcome>((resolve) => { finish = resolve; });
          pendingClaims.set(id, { completion, finish });
          claimedEventId = id;
          await mocks.webhookCreate({ data: { id } });
          return {};
        },
      },
      auditEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const result = await mocks.auditCreate({ data });
          transactionAudits.push(data);
          return result;
        },
      },
      payment: { updateMany: mocks.paymentUpdateMany },
      subscription: { updateMany: mocks.subscriptionUpdateMany },
    };

    try {
      const result = await work(tx);
      if (claimedEventId) {
        committedEvents.add(claimedEventId);
        auditRows.push(...transactionAudits);
        pendingClaims.get(claimedEventId)?.finish("committed");
        pendingClaims.delete(claimedEventId);
      }
      return result;
    } catch (error) {
      if (claimedEventId) {
        pendingClaims.get(claimedEventId)?.finish("rolled_back");
        pendingClaims.delete(claimedEventId);
      }
      throw error;
    }
  });

  return { committedEvents, auditRows };
}

describe("Paystack webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signatureValid = true;
    mocks.alreadyProcessed = false;
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a",
      reference: "jata-ref",
      userId: "user-a",
      amount: 14900,
      currency: "KES",
      status: "PENDING",
    });
    mocks.webhookUpsert.mockResolvedValue({});
    mocks.webhookCreate.mockResolvedValue({});
    mocks.paymentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.subscriptionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (work: (tx: any) => Promise<unknown>) => work({
      processedWebhook: { create: mocks.webhookCreate },
      auditEvent: { create: mocks.auditCreate },
      payment: { updateMany: mocks.paymentUpdateMany },
      subscription: { updateMany: mocks.subscriptionUpdateMany },
    }));
    mocks.processedCheck.mockImplementation(async () => mocks.alreadyProcessed);
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

  it("returns a retryable failure when provider verification fails", async () => {
    mocks.verify.mockRejectedValue(new Error("Paystack unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("processes a full refund and preserves the paid-state and subscription transition", async () => {
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      amount: 99900, currency: "KES", status: "PAID",
    });
    const refund = { ...partialRefund, data: { ...partialRefund.data, amount: 99900 } };

    const response = await POST(request(refund));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "refund_processed" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.webhookCreate).toHaveBeenCalledWith({ data: { id: "1234" } });
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({ where: { id: "pay-a", status: "PAID" }, data: { status: "REFUNDED" } });
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({ where: { businessId: "business-a" }, data: { status: "SUSPENDED" } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "WEBHOOK_REFUND_PROCESSED", targetId: "pay-a" }));
  });

  it.each([
    [100000, "KES"],
    [99900, "USD"],
  ])("rejects mismatched refund evidence (%i %s) without changing payment state", async (amount, currency) => {
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      amount: 99900, currency: "KES", status: "PAID",
    });
    const refund = { ...partialRefund, data: { ...partialRefund.data, amount, currency } };

    const response = await POST(request(refund));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it("acknowledges an unknown refund reference without changing any payment", async () => {
    mocks.paymentFind.mockResolvedValue(null);
    const response = await POST(request(partialRefund));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(mocks.webhookUpsert).toHaveBeenCalledWith({ where: { id: "1234" }, update: {}, create: { id: "1234" } });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("records a partial refund for manual review without marking the payment fully refunded", async () => {
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      purpose: "SUBSCRIPTION", amount: 99900, currency: "KES", status: "PAID",
    });
    const response = await POST(request(partialRefund));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "partial_refund_requires_review" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.webhookCreate).toHaveBeenCalledWith({ data: { id: "1234" } });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: "user-a",
        action: "WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED",
        targetType: "PAYMENT",
        targetId: "pay-a",
        metadata: JSON.stringify({ amount: 1, currency: "KES" }),
      },
    });
    expect(mocks.audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "WEBHOOK_PARTIAL_REFUND_REVIEW_REQUIRED" }));
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentFind).toHaveBeenCalledWith({ where: { reference: "jata-ref" } });
  });

  it("processes sequential partial-refund duplicates only once", async () => {
    const store = installAtomicWebhookStore();
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      purpose: "SUBSCRIPTION", amount: 99900, currency: "KES", status: "PAID",
    });

    const first = await POST(request(partialRefund));
    const replay = await POST(request(partialRefund));

    expect(first.status).toBe(200);
    expect(await replay.json()).toEqual({ status: "already_processed" });
    expect(store.committedEvents).toEqual(new Set(["1234"]));
    expect(store.auditRows).toHaveLength(1);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });

  it("atomically claims one concurrent partial-refund delivery and writes one review audit", async () => {
    const store = installAtomicWebhookStore("1234");
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      purpose: "SUBSCRIPTION", amount: 99900, currency: "KES", status: "PAID",
    });

    const responses = await Promise.all([POST(request(partialRefund)), POST(request(partialRefund))]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies.map((body) => body.status).sort()).toEqual(["already_processed", "partial_refund_requires_review"]);
    expect(store.committedEvents).toEqual(new Set(["1234"]));
    expect(store.auditRows).toHaveLength(1);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.paymentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
  });

  it("rolls back the event claim and returns a retryable failure when the review audit write fails", async () => {
    const store = installAtomicWebhookStore();
    mocks.paymentFind.mockResolvedValue({
      id: "pay-a", reference: "jata-ref", userId: "user-a", businessId: "business-a",
      purpose: "SUBSCRIPTION", amount: 99900, currency: "KES", status: "PAID",
    });
    mocks.auditCreate.mockRejectedValueOnce(new Error("audit database unavailable"));

    const failedAttempt = await POST(request(partialRefund));
    expect(failedAttempt.status).toBe(503);
    expect(await failedAttempt.json()).toEqual({ error: "Refund event could not be processed; Paystack may retry." });
    expect(store.committedEvents.size).toBe(0);
    expect(store.auditRows).toHaveLength(0);

    const retry = await POST(request(partialRefund));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ status: "partial_refund_requires_review" });
    expect(store.committedEvents).toEqual(new Set(["1234"]));
    expect(store.auditRows).toHaveLength(1);
  });

  it("acknowledges an already processed event idempotently", async () => {
    mocks.alreadyProcessed = true;
    expect(await (await POST(request())).json()).toEqual({ status: "already_processed" });
    expect(mocks.paymentFind).not.toHaveBeenCalled();
  });
});
