import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapterContext } from "@/lib/payments/context";
import { createMpesaAdapter, resetMpesaTokenCache } from "@/lib/payments/providers/mpesa";
import type { TransactionRecord } from "@/lib/payments/types";
import { applyMpesaEnv } from "@/tests/helpers/mpesaEnv";

let restoreEnv: () => void = () => undefined;

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-reversal",
    jataPaymentId: "JTP-REFUND-1",
    businessId: "biz-a",
    destinationId: "dest-a",
    provider: "MPESA",
    status: "PAID",
    providerReference: "JTP-REFUND-1",
    providerTransactionId: "ws_CO_191220191020363925",
    providerReceipt: "NLJ7RT61SV",
    method: "MPESA_STK",
    amountMinor: 35_000,
    amountPaidMinor: 35_000,
    amountRefundedMinor: 0,
    currency: "KES",
    customerName: null,
    customerPhoneMasked: null,
    posSaleId: null,
    orderId: null,
    receiptNumber: null,
    receiptToken: null,
    failureCode: null,
    failureReason: null,
    createdAt: new Date("2026-10-04T10:00:00Z"),
    ...overrides,
  } as unknown as TransactionRecord;
}

function configuredFetch(capture: (url: string, init?: RequestInit) => void) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    capture(url, init);
    if (url.includes("/oauth/v1/generate")) {
      return new Response(JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ OriginatorConversationID: "AG_TEST_REVERSAL_1", ResponseCode: "0" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  // A complete, valid (and obviously fake) sandbox configuration — including the reversal initiator.
  restoreEnv = applyMpesaEnv();
  resetMpesaTokenCache();
});

afterEach(() => {
  restoreEnv();
  resetMpesaTokenCache();
});

describe("M-PESA reversal transaction identity", () => {
  it("sends the persisted STK receipt, never its CheckoutRequestID", async () => {
    let reversalBody: Record<string, unknown> | null = null;
    const adapter = createMpesaAdapter();
    const fetchImpl = configuredFetch((url, init) => {
      if (url.endsWith("/mpesa/reversal/v1/request")) reversalBody = JSON.parse(String(init?.body ?? "{}"));
    });
    const result = await adapter.reverse({
      transaction: transaction(),
      destination: null,
      amountMinor: 35_000,
      reason: "Customer cancellation",
    }, adapterContext(new Date("2026-10-04T10:00:00Z"), { fetchImpl, verifyWithProvider: true }));

    expect(result.ok).toBe(true);
    expect(reversalBody?.TransactionID).toBe("NLJ7RT61SV");
    expect(reversalBody?.TransactionID).not.toBe("ws_CO_191220191020363925");
  });

  it("fails closed without a valid persisted STK receipt and makes no provider call", async () => {
    const fetchImpl = vi.fn(configuredFetch(() => undefined));
    const result = await createMpesaAdapter().reverse({
      transaction: transaction({ providerReceipt: null }),
      destination: null,
      amountMinor: 35_000,
      reason: "Customer cancellation",
    }, adapterContext(new Date(), { fetchImpl, verifyWithProvider: true }));

    expect(result).toMatchObject({ ok: false, code: "MISSING_MPESA_RECEIPT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("continues to use the C2B/till provider transaction reference", async () => {
    let reversalBody: Record<string, unknown> | null = null;
    const fetchImpl = configuredFetch((url, init) => {
      if (url.endsWith("/mpesa/reversal/v1/request")) reversalBody = JSON.parse(String(init?.body ?? "{}"));
    });
    const result = await createMpesaAdapter().reverse({
      transaction: transaction({
        providerTransactionId: "RJ12ABC789",
        providerReceipt: null,
        method: "MPESA_C2B_TILL",
      }),
      destination: null,
      amountMinor: 35_000,
      reason: "Customer cancellation",
    }, adapterContext(new Date(), { fetchImpl, verifyWithProvider: true }));

    expect(result.ok).toBe(true);
    expect(reversalBody?.TransactionID).toBe("RJ12ABC789");
  });
});
