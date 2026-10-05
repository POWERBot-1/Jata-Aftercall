import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapterContext } from "@/lib/payments/context";
import { createMpesaAdapter, resetMpesaTokenCache } from "@/lib/payments/providers/mpesa";
import type { TransactionRecord } from "@/lib/payments/types";

const envKeys = [
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_ENV",
  "MPESA_INITIATOR_NAME",
  "MPESA_SECURITY_CREDENTIAL",
  "MPESA_CALLBACK_TOKEN",
  "MPESA_C2B_CONFIRMATION_URL",
  "MPESA_C2B_VALIDATION_URL",
] as const;
const previousEnv = new Map<string, string | undefined>();

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
  previousEnv.clear();
  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.MPESA_CONSUMER_KEY = "test-consumer-key";
  process.env.MPESA_CONSUMER_SECRET = "test-consumer-secret";
  process.env.MPESA_SHORTCODE = "174379";
  process.env.MPESA_PASSKEY = "test-passkey";
  process.env.MPESA_ENV = "sandbox";
  process.env.MPESA_INITIATOR_NAME = "JATA_TEST";
  process.env.MPESA_SECURITY_CREDENTIAL = "test-security-credential";
  // A connected deployment has registered its callback token; readiness requires it, and the
  // C2B URLs above carry it.
  process.env.MPESA_CALLBACK_TOKEN = "test";
  process.env.MPESA_C2B_CONFIRMATION_URL = "https://jata.test/api/payments/webhooks/mpesa/confirmation?token=test";
  process.env.MPESA_C2B_VALIDATION_URL = "https://jata.test/api/payments/webhooks/mpesa/validation?token=test";
  resetMpesaTokenCache();
});

afterEach(() => {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
      amountMinor: 10_000,
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
      amountMinor: 10_000,
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
      amountMinor: 10_000,
      reason: "Customer cancellation",
    }, adapterContext(new Date(), { fetchImpl, verifyWithProvider: true }));

    expect(result.ok).toBe(true);
    expect(reversalBody?.TransactionID).toBe("RJ12ABC789");
  });
});
