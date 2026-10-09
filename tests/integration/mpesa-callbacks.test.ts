/**
 * The M-PESA callback pipeline, end to end against the in-memory database: the real route
 * handlers, the webhook pipeline, the payment engine, STK Query reconciliation and the refund
 * workflow. Nothing reaches a network — Safaricom is a scripted `fetch`.
 *
 * What these tests pin: Safaricom is answered in Daraja's format; a callback is applied exactly
 * once however many times it arrives; a forged callback can neither settle a payment nor stop the
 * genuine one from settling; a failure mid-pipeline is recoverable; late, malformed, mismatched
 * and cross-tenant callbacks are recorded rather than trusted; a lost callback is recovered by
 * asking Daraja; and money going OUT is reserved, sent at most once, and never released on a
 * timeout.
 *
 * Postgres-specific behaviour (row locks, real rollback) is covered by the DATABASE_URL-backed
 * suites, which run in CI against a real database and self-skip here.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { applyProviderEvent } from "@/lib/payments/webhooks";
import { checkPaymentStatus, recheckPaymentForOperator } from "@/lib/payments/orchestrator";
import { refundOutcomeState, refundSummary, requestRefund } from "@/lib/payments/refunds";
import { resetMpesaTokenCache } from "@/lib/payments/providers/mpesa";
import { paystackSignature } from "@/lib/payments/providers/paystack";
import { darajaAcknowledgement } from "@/app/api/payments/webhooks/mpesa/handler";
import { GET as stkGet, POST as stkPost } from "@/app/api/payments/webhooks/daraja/stk/route";
import { POST as confirmationPost, GET as confirmationGet } from "@/app/api/payments/webhooks/daraja/confirmation/route";
import { POST as validationPost, GET as validationGet } from "@/app/api/payments/webhooks/daraja/validation/route";
import { POST as resultPost, GET as resultGet } from "@/app/api/payments/webhooks/daraja/result/route";
import { POST as timeoutPost, GET as timeoutGet } from "@/app/api/payments/webhooks/daraja/timeout/route";
import { POST as legacyStkPost } from "@/app/api/payments/webhooks/mpesa/stk/route";
import type { FakeDb } from "@/tests/helpers/posFakeDb";
import { TEST_MPESA, applyMpesaEnv, jsonResponse } from "@/tests/helpers/mpesaEnv";

const fake = () => (globalThis as any).__posFake as FakeDb;
const TOKEN = TEST_MPESA.MPESA_CALLBACK_TOKEN;
const NOW = new Date("2026-10-04T10:15:30.000Z");
const CHECKOUT = "ws_CO_191220191020363925";
const RECEIPT = "NLJ7RT61SV";
const REFERENCE = "MPES-JTP-20261004-1048-X8K2";

let restore: () => void = () => undefined;

// ───────────────────────────── fixtures ─────────────────────────────

function seedDestination(overrides: Record<string, unknown> = {}) {
  fake().rows("paymentDestination").push({
    id: "dest_a1",
    businessId: "bizA",
    kind: "MPESA_TILL",
    provider: "MPESA",
    label: "M-PESA Till •••3456",
    providerDestinationId: "4123456",
    providerAccountRef: "",
    currency: "KES",
    capabilities: ["PAYMENT_INSTRUCTIONS", "REAL_TIME_CONFIRMATION", "WEBHOOKS", "REVERSALS"],
    status: "CONNECTED",
    verificationSource: "LIVE",
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  });
}

function seedPayment(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "tx_a1",
    jataPaymentId: "JTP-20261004-1048-X8K2",
    businessId: "bizA",
    destinationId: "dest_a1",
    provider: "MPESA",
    status: "PENDING",
    providerReference: REFERENCE,
    providerTransactionId: CHECKOUT,
    providerReceipt: null,
    idempotencyKey: `idem_${Math.random().toString(36).slice(2)}`,
    method: "MPESA_STK",
    amountMinor: 35_000,
    amountPaidMinor: 0,
    amountRefundedMinor: 0,
    currency: "KES",
    paymentContext: null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    createdAt: new Date(),
    ...overrides,
  };
  fake().rows("paymentTransaction").push(row);
  return row;
}

const tx = (id = "tx_a1") => fake().rows("paymentTransaction").find((row) => row.id === id)!;
const events = () => fake().rows("paymentEvent");
const audits = (action: string) => fake().rows("paymentAuditEvent").filter((row) => row.action === action);
const reconciliations = (result?: string) => fake().rows("paymentReconciliation").filter((row) => !result || row.result === result);

const stkPayload = (overrides: { code?: number; amount?: unknown; receipt?: unknown; checkout?: string; items?: boolean } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-34620561-1",
      CheckoutRequestID: overrides.checkout ?? CHECKOUT,
      ResultCode: overrides.code ?? 0,
      ResultDesc: "The service request is processed successfully.",
      ...((overrides.code ?? 0) === 0 && overrides.items !== false
        ? {
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: "amount" in overrides ? overrides.amount : 350 },
                { Name: "MpesaReceiptNumber", Value: "receipt" in overrides ? overrides.receipt : RECEIPT },
                { Name: "TransactionDate", Value: 20261004131530 },
                { Name: "PhoneNumber", Value: 254712111111 },
              ],
            },
          }
        : {}),
    },
  },
});

const c2bPayload = (overrides: Record<string, unknown> = {}) => ({
  TransactionType: "Pay Bill",
  TransID: "RJ9XXQK1AB",
  TransTime: "20261004131530",
  TransAmount: "350.00",
  BusinessShortCode: "4123456",
  BillRefNumber: "",
  MSISDN: "254712111111",
  FirstName: "Jane",
  ...overrides,
});

const resultPayload = (code: number, extra: Record<string, unknown> = {}) => ({
  Result: {
    ResultType: 0,
    ResultCode: code,
    ResultDesc: code === 0 ? "The service request is processed successfully." : "The reversal was not completed.",
    OriginatorConversationID: "OC_REFUND_1",
    ConversationID: "AG_REFUND_1",
    TransactionID: "REVTRANS99",
    ResultParameters: { ResultParameter: [{ Key: "Amount", Value: "350.00" }, { Key: "OriginalTransactionID", Value: RECEIPT }] },
    ...extra,
  },
});

/** A request to the real route handlers, exactly as Safaricom would send it. */
function darajaRequest(path: string, body: unknown, token: string | null = TOKEN, init: RequestInit = {}) {
  return new Request(`https://jata.test${path}${token === null ? "" : `?token=${token}`}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "196.201.214.200" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}
const DARAJA = "/api/payments/webhooks/daraja";
const LEGACY = "/api/payments/webhooks/mpesa";

/** The same event, applied through the pipeline directly (so a test can control the clock). */
function pipeline(path: string, payload: Record<string, unknown>, options: { token?: string; now?: Date } = {}) {
  return applyProviderEvent({
    provider: "MPESA",
    rawBody: JSON.stringify(payload),
    payload,
    headers: new Headers({ "x-forwarded-for": "196.201.214.200" }),
    url: new URL(`https://jata.test${path}?token=${options.token ?? TOKEN}`),
    client: prisma,
    now: options.now,
  });
}

/** A scripted Safaricom: oauth always succeeds; `route` answers everything else. */
function safaricom(route: (url: string, nth: number, body: any) => Response) {
  const calls: { url: string; body: any }[] = [];
  const counts = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.includes("/oauth/v1/generate")) return jsonResponse({ access_token: "tok", expires_in: "3599" });
    const path = new URL(url).pathname;
    const nth = (counts.get(path) ?? 0) + 1;
    counts.set(path, nth);
    return route(path, nth, body);
  }) as typeof fetch;
  return { fetchImpl, calls, to: (path: string) => calls.filter((call) => new URL(call.url).pathname === path) };
}
const queryAnswer = (ResultCode: string) =>
  jsonResponse({ ResponseCode: "0", ResponseDescription: "ok", MerchantRequestID: "m", CheckoutRequestID: CHECKOUT, ResultCode, ResultDesc: "d" });
const reversalAccepted = () =>
  jsonResponse({ OriginatorConversationID: "OC_REFUND_1", ConversationID: "AG_REFUND_1", ResponseCode: "0", ResponseDescription: "Accept the service request successfully." });

const OWNER = { actorId: "userA", actorName: "Owner A", roleKey: "OWNER", permissions: ["REFUND_PAYMENT"], confirmed: true };

beforeEach(() => {
  restore = applyMpesaEnv();
  resetMpesaTokenCache();
  fake().reset();
  // PostgreSQL stamps `receivedAt` with @default(now()); the fake needs to be told.
  const create = fake().db.paymentEvent.create;
  fake().db.paymentEvent.create = async (args: any) => create({ ...args, data: { receivedAt: new Date(), ...args.data } });
});
afterEach(() => {
  restore();
  resetMpesaTokenCache();
});

// ───────────────────────── Daraja acknowledgements ─────────────────────────

describe("Safaricom is answered in Daraja's format", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment();
  });

  it("acknowledges an STK result with ResultCode 0 / Accepted, alongside JATA's own status", async () => {
    const response = await stkPost(darajaRequest(`${DARAJA}/stk`, stkPayload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ResultCode: 0, ResultDesc: "Accepted", status: "processed" });
    expect(tx().status).toBe("PAID");
  });

  it("serves the legacy path with exactly the same behaviour", async () => {
    const response = await legacyStkPost(darajaRequest(`${LEGACY}/stk`, stkPayload()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(tx().status).toBe("PAID");
  });

  it("answers a refused callback with 401 and NEVER tells it 'Accepted'", async () => {
    const response = await stkPost(darajaRequest(`${DARAJA}/stk`, stkPayload(), "wrong_token_value_0123456789abc"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: "Event refused." });
    expect(body).not.toHaveProperty("ResultCode");
    expect(tx().status).toBe("PENDING");
  });

  it.each([
    ["an empty body", ""],
    ["invalid JSON", "{not json"],
    ["a JSON array", "[1,2,3]"],
    ["a JSON string", '"hello"'],
    ["an oversized body", JSON.stringify({ pad: "x".repeat(130_000) })],
  ])("refuses %s with 400 before touching the database", async (_label, body) => {
    const response = await stkPost(darajaRequest(`${DARAJA}/stk`, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid payload." });
    expect(events()).toHaveLength(0);
  });

  describe("C2B validation — the body is the decision", () => {
    it("accepts a well-formed validation with ResultCode '0'", async () => {
      const response = await validationPost(darajaRequest(`${DARAJA}/validation`, c2bPayload()));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ResultCode: "0", ResultDesc: "Accepted" });
    });

    it("rejects an unusable validation payload with a C2B reject code", async () => {
      const response = await validationPost(darajaRequest(`${DARAJA}/validation`, { TransID: "RJ9XXQK1AB" }));
      expect(await response.json()).toEqual({ ResultCode: "C2B00016", ResultDesc: "Rejected" });
    });

    it("accepts a repeated validation again — the first answer is what the customer's payment is waiting on", async () => {
      await validationPost(darajaRequest(`${DARAJA}/validation`, c2bPayload()));
      const again = await validationPost(darajaRequest(`${DARAJA}/validation`, c2bPayload()));
      expect(await again.json()).toEqual({ ResultCode: "0", ResultDesc: "Accepted" });
    });

    it("never accepts a payment on behalf of an unauthenticated caller", async () => {
      const response = await validationPost(darajaRequest(`${DARAJA}/validation`, c2bPayload(), "wrong_token_value_0123456789abc"));
      expect(response.status).toBe(401);
      expect(await response.json()).not.toHaveProperty("ResultCode");
    });
  });

  it("acknowledges C2B confirmations, reversal results and timeout notices", async () => {
    for (const [handler, path, payload] of [
      [confirmationPost, `${DARAJA}/confirmation`, c2bPayload()],
      [resultPost, `${DARAJA}/result`, resultPayload(0)],
      [timeoutPost, `${DARAJA}/timeout`, resultPayload(1)],
    ] as const) {
      const response = await handler(darajaRequest(path, payload));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ResultCode: 0, ResultDesc: "Accepted" });
    }
  });

  it("answers GET probes without side effects on every callback route", async () => {
    for (const handler of [stkGet, confirmationGet, validationGet, resultGet, timeoutGet]) {
      expect(await (await handler()).json()).toEqual({ status: "ok" });
    }
    expect(events()).toHaveLength(0);
  });

  it("keeps refusals and server errors out of the acknowledgement format", () => {
    expect(darajaAcknowledgement("/x/stk", { status: "rejected", httpStatus: 401, body: { error: "Event refused." } })).toEqual({ body: { error: "Event refused." }, status: 401 });
    expect(darajaAcknowledgement("/x/stk", { status: "failed", httpStatus: 500, body: { error: "boom" } })).toEqual({ body: { error: "boom" }, status: 500 });
  });
});

// ───────────────────── idempotency, duplicates and forgeries ─────────────────────

describe("exactly one effect per callback", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment();
  });

  it("applies a callback once and acknowledges every redelivery without applying it again", async () => {
    const first = await pipeline(`${DARAJA}/stk`, stkPayload());
    const second = await pipeline(`${DARAJA}/stk`, stkPayload());
    const third = await pipeline(`${DARAJA}/stk`, stkPayload());
    expect(first.status).toBe("processed");
    expect(second.status).toBe("already_processed");
    expect(third.status).toBe("already_processed");
    expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    expect(audits("PAYMENT_CONFIRMATION_RECEIVED")).toHaveLength(1);
    expect(audits("PAYMENT_SETTLED")).toHaveLength(1);
    expect(reconciliations("MATCHED")).toHaveLength(1);
  });

  it("keeps the first record intact when a duplicate arrives", async () => {
    await pipeline(`${DARAJA}/stk`, stkPayload());
    await pipeline(`${DARAJA}/stk`, stkPayload());
    expect(events()).toHaveLength(1);
    expect(events()[0].status).toBe("PROCESSED");
  });

  it("applies one financial effect when the same callback arrives twice at the same instant", async () => {
    const [a, b] = await Promise.all([pipeline(`${DARAJA}/stk`, stkPayload()), pipeline(`${DARAJA}/stk`, stkPayload())]);
    expect([a.status, b.status].filter((status) => status === "processed")).toHaveLength(1);
    expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    expect(audits("PAYMENT_SETTLED")).toHaveLength(1);
  });

  it("does not let a replay with a different receipt overwrite the recorded one", async () => {
    await pipeline(`${DARAJA}/stk`, stkPayload());
    await pipeline(`${DARAJA}/stk`, stkPayload({ receipt: "ABCD123456" }));
    expect(tx().providerReceipt).toBe(RECEIPT);
  });

  describe("a refused forgery cannot stop the genuine callback", () => {
    it("records the forgery under its own namespace, so the genuine event id stays free", async () => {
      const forged = await pipeline(`${DARAJA}/stk`, stkPayload(), { token: "forged_token_value_0123456789abc" });
      expect(forged).toMatchObject({ status: "rejected", httpStatus: 401 });
      expect(tx().status).toBe("PENDING");
      expect(events()).toHaveLength(1);
      expect(events()[0].providerEventId).toMatch(/^rejected:[0-9a-f]{40}$/);
      expect(events()[0].providerEventId).not.toBe(`stk:${CHECKOUT}:0`);
      expect(events()[0]).toMatchObject({ status: "REJECTED", signatureVerified: false });

      const genuine = await pipeline(`${DARAJA}/stk`, stkPayload());
      expect(genuine.status).toBe("processed");
      expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    });

    it("dedupes repeats of the same forgery without letting them accumulate", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) await pipeline(`${DARAJA}/stk`, stkPayload(), { token: "forged_token_value_0123456789abc" });
      expect(events()).toHaveLength(1);
    });

    it("heals a genuine event id that an earlier, unauthenticated request had parked", async () => {
      // What the previous implementation left behind: a REJECTED row under the genuine event id.
      events().push({ id: "pre", provider: "MPESA", providerEventId: `stk:${CHECKOUT}:0`, eventType: "STK_CALLBACK", status: "REJECTED", signatureVerified: false, receivedAt: new Date() });
      const result = await pipeline(`${DARAJA}/stk`, stkPayload());
      expect(result.status).toBe("processed");
      expect(tx().status).toBe("PAID");
      expect(events().find((row) => row.id === "pre")).toMatchObject({ status: "PROCESSED", signatureVerified: true });
    });

    it("applies the same protection to Paystack events, whose ids are guessable", async () => {
      process.env.PAYSTACK_SECRET_KEY = "sk_test_jata_webhook";
      seedDestination({ id: "dest_ps", kind: "PAYSTACK", provider: "PAYSTACK", providerDestinationId: "acct_jata" });
      seedPayment({ id: "tx_ps", provider: "PAYSTACK", destinationId: "dest_ps", method: "PAYSTACK_CHECKOUT", providerReference: "JTP-PS-1", providerTransactionId: null });
      const data = { reference: "JTP-PS-1", amount: 35_000, currency: "KES", status: "success" };
      const rawBody = JSON.stringify({ id: 302961, event: "charge.success", data });
      const request = (signature: string) => ({
        provider: "PAYSTACK" as const,
        rawBody,
        payload: { id: 302961, event: "charge.success", data },
        headers: new Headers({ "x-paystack-signature": signature }),
        url: new URL("https://jata.test/api/payments/webhooks/paystack"),
        client: prisma,
        fetchImpl: (async () => jsonResponse({ status: true, data: { status: "success", amount: 35_000, currency: "KES", id: 99_001 } })) as unknown as typeof fetch,
      });
      expect((await applyProviderEvent(request("deadbeef"))).status).toBe("rejected");
      const genuine = await applyProviderEvent(request(paystackSignature(rawBody, "sk_test_jata_webhook")));
      expect(genuine.status).toBe("processed");
      expect(tx("tx_ps").status).toBe("PAID");
    });
  });
});

describe("a failure inside the pipeline is recoverable", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment();
  });

  it("marks the event FAILED, then completes it exactly once on redelivery", async () => {
    const original = fake().db.paymentTransaction.updateMany;
    let failures = 1;
    fake().db.paymentTransaction.updateMany = async (args: any) => {
      if (failures-- > 0) throw new Error("connection terminated unexpectedly");
      return original(args);
    };

    await expect(pipeline(`${DARAJA}/stk`, stkPayload())).rejects.toThrow("connection terminated");
    expect(tx()).toMatchObject({ status: "PENDING", amountPaidMinor: 0 });
    expect(events()[0]).toMatchObject({ status: "FAILED", errorCode: "PROCESSING_ERROR" });

    const retry = await pipeline(`${DARAJA}/stk`, stkPayload());
    expect(retry.status).toBe("processed");
    expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    expect(events()).toHaveLength(1);
    expect(events()[0].status).toBe("PROCESSED");
    expect(audits("PAYMENT_SETTLED")).toHaveLength(1);
  });

  it("surfaces the failure as a server error so Safaricom's delivery is not mistaken for success", async () => {
    const original = fake().db.paymentTransaction.updateMany;
    fake().db.paymentTransaction.updateMany = async () => {
      throw new Error("db down");
    };
    await expect(stkPost(darajaRequest(`${DARAJA}/stk`, stkPayload()))).rejects.toThrow("db down");
    fake().db.paymentTransaction.updateMany = original;
    expect(tx().status).toBe("PENDING");
  });

  it("takes over an event whose first attempt died mid-flight, once its lease has lapsed", async () => {
    events().push({ id: "ev1", provider: "MPESA", providerEventId: `stk:${CHECKOUT}:0`, eventType: "STK_CALLBACK", status: "RECEIVED", signatureVerified: true, receivedAt: new Date(NOW.getTime() - 5 * 60_000) });
    const result = await pipeline(`${DARAJA}/stk`, stkPayload(), { now: NOW });
    expect(result.status).toBe("processed");
    expect(tx().status).toBe("PAID");
    expect(events().find((row) => row.id === "ev1")?.status).toBe("PROCESSED");
  });

  it("leaves an event alone while another delivery is still working on it", async () => {
    events().push({ id: "ev1", provider: "MPESA", providerEventId: `stk:${CHECKOUT}:0`, eventType: "STK_CALLBACK", status: "RECEIVED", signatureVerified: true, receivedAt: new Date(NOW.getTime() - 5_000) });
    const result = await pipeline(`${DARAJA}/stk`, stkPayload(), { now: NOW });
    expect(result.status).toBe("already_processed");
    expect(tx().status).toBe("PENDING");
  });

  it("does not re-run an unmatched event that is parked for a person, so it records one exception, not many", async () => {
    fake().rows("paymentTransaction").length = 0;
    await pipeline(`${DARAJA}/confirmation`, c2bPayload(), { now: NOW });
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const again = await pipeline(`${DARAJA}/confirmation`, c2bPayload(), { now: later });
    expect(again.status).toBe("already_processed");
    expect(reconciliations("UNKNOWN_PAYMENT")).toHaveLength(1);
  });
});

// ───────────────────── invalid, mismatched and late callbacks ─────────────────────

describe("callbacks are validated against the payment they claim to belong to", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment();
  });

  it("records a callback for a payment JATA never made, and invents nothing for it", async () => {
    const result = await pipeline(`${DARAJA}/stk`, stkPayload({ checkout: "ws_CO_999999999999999999" }));
    expect(result.status).toBe("unmatched");
    expect(tx()).toMatchObject({ status: "PENDING", amountPaidMinor: 0 });
    expect(reconciliations()).toHaveLength(0);
  });

  it("refuses to mark paid when the amount differs, and records the mismatch", async () => {
    const result = await pipeline(`${DARAJA}/stk`, stkPayload({ amount: 400 }));
    expect(result.status).toBe("amount_mismatch");
    expect(tx()).toMatchObject({ status: "PENDING", amountPaidMinor: 0 });
    expect(reconciliations("AMOUNT_MISMATCH")[0]).toMatchObject({ expectedAmountMinor: 35_000, receivedAmountMinor: 40_000 });
    expect(audits("PAYMENT_AMOUNT_MISMATCH").length).toBeGreaterThan(0);
  });

  it("refuses a short payment as readily as an over-payment", async () => {
    expect((await pipeline(`${DARAJA}/stk`, stkPayload({ amount: 349 }))).status).toBe("amount_mismatch");
    expect(tx().status).toBe("PENDING");
  });

  it.each([
    ["missing", undefined],
    ["not a number", "abc"],
    ["zero", 0],
  ])("never closes a payment as FAILED because a success callback's amount is %s — the customer paid", async (_label, amount) => {
    const result = await pipeline(`${DARAJA}/stk`, stkPayload({ amount }));
    expect(result.status).toBe("amount_mismatch");
    expect(tx().status).toBe("PENDING"); // still open, not terminally FAILED
    expect(tx().status).not.toBe("FAILED");
    expect(reconciliations("AMOUNT_MISMATCH")[0].notes).toMatch(/no verifiable amount/);
  });

  it("does not trust a callback's receipt to identify the payment", async () => {
    const result = await pipeline(`${DARAJA}/stk`, stkPayload({ checkout: "ws_CO_000" , receipt: RECEIPT }));
    expect(result.status).toBe("unmatched");
    expect(tx().providerReceipt).toBeNull();
  });

  it("refuses a confirmation whose destination belongs to another business than the payment's", async () => {
    seedDestination({ id: "dest_b1", businessId: "bizB", providerDestinationId: "4999999" });
    seedPayment({ id: "tx_manual", providerReference: "MPES-JTP-MANUAL-1", providerTransactionId: null, method: "MPESA_TILL_MANUAL", status: "PAYMENT_REQUESTED", amountMinor: 35_000 });
    const result = await pipeline(`${DARAJA}/confirmation`, c2bPayload({ BusinessShortCode: "4999999", BillRefNumber: "MPES-JTP-MANUAL-1" }));
    expect(tx("tx_manual").status).toBe("PAYMENT_REQUESTED");
    expect(result.status).toBe("processed");
    expect(events()[0].errorCode).toBe("DESTINATION_MISMATCH");
    expect(reconciliations("UNCONFIRMED")[0]).toMatchObject({ businessId: "bizA", transactionId: "tx_manual" });
  });

  describe("late callbacks", () => {
    it("settles a payment JATA had stopped waiting for — expiry is not failure", async () => {
      tx().status = "EXPIRED";
      expect((await pipeline(`${DARAJA}/stk`, stkPayload())).status).toBe("processed");
      expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    });

    it.each(["FAILED", "CANCELLED"])("records a success after the payment was %s as an exception rather than silently re-opening it", async (status) => {
      tx().status = status;
      const result = await pipeline(`${DARAJA}/stk`, stkPayload());
      expect(result.status).toBe("processed");
      expect(tx().status).toBe(status);
      expect(events()[0].errorCode).toBe(`LATE_CONFIRMATION_${status}`);
      expect(reconciliations("UNCONFIRMED")[0].notes).toMatch(new RegExp(`marked ${status}`));
    });

    it("ignores a failure that arrives after the payment was already paid", async () => {
      await pipeline(`${DARAJA}/stk`, stkPayload());
      await pipeline(`${DARAJA}/stk`, stkPayload({ code: 1032 }));
      expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    });
  });

  describe("failure callbacks", () => {
    it.each([
      [1032, "MPESA_1032", /cancelled/],
      [1037, "MPESA_1037", /did not respond/],
      [2001, "MPESA_2001", /wrong M-PESA PIN/],
      [1, "MPESA_1", /balance was too low/],
    ])("records result code %i as a failure with an accurate reason — never as paid", async (code, failureCode, reason) => {
      await pipeline(`${DARAJA}/stk`, stkPayload({ code }));
      expect(tx()).toMatchObject({ status: "FAILED", failureCode, amountPaidMinor: 0 });
      expect(tx().failureReason).toMatch(reason);
    });
  });

  describe("unmatched money (C2B)", () => {
    const open = (id: string, extra: Record<string, unknown> = {}) =>
      seedPayment({ id, providerReference: `MPES-JTP-${id}`, providerTransactionId: null, method: "MPESA_TILL_MANUAL", status: "PAYMENT_REQUESTED", amountMinor: 35_000, ...extra });

    beforeEach(() => fake().rows("paymentTransaction").length = 0);

    it("settles the one open payment at that destination for that amount", async () => {
      open("only");
      const result = await pipeline(`${DARAJA}/confirmation`, c2bPayload());
      expect(result.status).toBe("processed");
      expect(tx("only")).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    });

    it("does not guess between two open payments of the same amount — one customer's sale must not take another's money", async () => {
      open("one");
      open("two");
      const result = await pipeline(`${DARAJA}/confirmation`, c2bPayload());
      expect(result.status).toBe("unmatched");
      expect(tx("one").status).toBe("PAYMENT_REQUESTED");
      expect(tx("two").status).toBe("PAYMENT_REQUESTED");
      expect(reconciliations("UNKNOWN_PAYMENT")[0]).toMatchObject({ businessId: "bizA", receivedAmountMinor: 35_000 });
      expect(reconciliations("UNKNOWN_PAYMENT")[0].notes).toMatch(/more than one open payment/);
      expect(events()[0].errorCode).toBe("AMBIGUOUS_MATCH");
    });

    it("still matches by the JATA reference the customer typed, even when several payments are open", async () => {
      open("one");
      open("two");
      const result = await pipeline(`${DARAJA}/confirmation`, c2bPayload({ BillRefNumber: "MPES-JTP-two" }));
      expect(result.status).toBe("processed");
      expect(tx("two").status).toBe("PAID");
      expect(tx("one").status).toBe("PAYMENT_REQUESTED");
    });

    it("does not match a payment of a different amount", async () => {
      open("only");
      expect((await pipeline(`${DARAJA}/confirmation`, c2bPayload({ TransAmount: "351.00" }))).status).toBe("unmatched");
      expect(tx("only").status).toBe("PAYMENT_REQUESTED");
    });
  });

  describe("tenant isolation", () => {
    it("never lets one business check, or pay out, another business's payment", async () => {
      const { fetchImpl, calls } = safaricom(() => queryAnswer("0"));
      expect(await checkPaymentStatus({ businessId: "bizB", transactionId: "tx_a1", fetchImpl, client: prisma, now: NOW })).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(calls).toHaveLength(0);
      tx().status = "PAID";
      Object.assign(tx(), { amountPaidMinor: 35_000, providerReceipt: RECEIPT });
      const outcome = await requestRefund({ businessId: "bizB", transactionId: "tx_a1", amountKES: 350, reason: "Customer cancellation", actor: OWNER, client: prisma, fetchImpl });
      expect(outcome).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(calls).toHaveLength(0);
      expect(fake().rows("refund")).toHaveLength(0);
    });
  });
});

// ───────────────────── reconciliation: a lost callback is recovered by asking ─────────────────────

describe("STK Query reconciliation", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment();
  });
  const check = (route: Parameters<typeof safaricom>[0], now = NOW) => {
    const scripted = safaricom(route);
    return checkPaymentStatus({ businessId: "bizA", transactionId: "tx_a1", fetchImpl: scripted.fetchImpl, client: prisma, now }).then((result) => ({ result, ...scripted }));
  };

  it("settles a payment whose callback was lost when Safaricom confirms it, and says how it knows", async () => {
    const { result } = await check(() => queryAnswer("0"));
    expect(result).toMatchObject({ ok: true, status: "PAID" });
    expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000, providerReceipt: null });
    expect(audits("PAYMENT_CONFIRMED_BY_STATUS_CHECK")).toHaveLength(1);
    expect(audits("PAYMENT_CONFIRMED_BY_STATUS_CHECK")[0].summary).toMatch(/not carry the amount or the M-PESA receipt/);
    expect(reconciliations("UNCONFIRMED")).toHaveLength(0);
  });

  it("settles once however often it is asked", async () => {
    await check(() => queryAnswer("0"));
    await check(() => queryAnswer("0"));
    await check(() => queryAnswer("0"));
    expect(tx()).toMatchObject({ status: "PAID", amountPaidMinor: 35_000 });
    expect(audits("PAYMENT_SETTLED")).toHaveLength(1);
  });

  it("records the receipt when the real callback arrives after the status check did the work", async () => {
    await check(() => queryAnswer("0"));
    const late = await pipeline(`${DARAJA}/stk`, stkPayload());
    expect(late.status).toBe("duplicate");
    expect(tx()).toMatchObject({ status: "PAID", providerReceipt: RECEIPT, amountPaidMinor: 35_000 });
    expect(audits("PAYMENT_RECEIPT_RECORDED")).toHaveLength(1);
    expect(audits("PAYMENT_SETTLED")).toHaveLength(1);
  });

  it("does not record a receipt from a late callback whose amount is wrong", async () => {
    await check(() => queryAnswer("0"));
    await pipeline(`${DARAJA}/stk`, stkPayload({ amount: 999 }));
    expect(tx().providerReceipt).toBeNull();
  });

  it("recovers a payment whose success callback arrived without a usable amount", async () => {
    await pipeline(`${DARAJA}/stk`, stkPayload({ amount: undefined }));
    expect(tx().status).toBe("PENDING");
    const { result } = await check(() => queryAnswer("0"));
    expect(result.status).toBe("PAID");
  });

  it.each([
    ["in flight (ResultCode 4999)", () => queryAnswer("4999")],
    ["Safaricom's non-discriminating 500.001.1001", () => jsonResponse({ errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }, 500)],
    ["an unrecognised result code", () => queryAnswer("3")],
    ["a rate limit", () => jsonResponse({ errorCode: "429.001.01" }, 429)],
  ])("leaves the payment open when Safaricom says it is %s", async (_label, answer) => {
    const { result } = await check(answer);
    expect(result.status).toBe("PENDING");
    expect(tx()).toMatchObject({ status: "PENDING", amountPaidMinor: 0 });
    expect(tx().status).not.toBe("FAILED");
  });

  it("closes the payment as failed only on a final failure code", async () => {
    const { result } = await check(() => queryAnswer("1032"));
    expect(result.status).toBe("FAILED");
    expect(tx()).toMatchObject({ status: "FAILED", failureCode: "PROVIDER_STATUS_FAILED" });
    expect(tx().failureReason).toMatch(/cancelled/);
  });

  it("stops waiting once JATA's own window has passed, without calling it a failure", async () => {
    const later = new Date(Date.now() + 10 * 60_000);
    const { result } = await check(() => queryAnswer("4999"), later);
    expect(result.status).toBe("EXPIRED");
    expect(tx().status).toBe("EXPIRED");
    expect(audits("PAYMENT_EXPIRED")).toHaveLength(1);
  });

  it("settles an expired payment if Safaricom later confirms it", async () => {
    tx().status = "EXPIRED";
    const { result } = await check(() => queryAnswer("0"));
    expect(result.status).toBe("PAID");
  });

  it("does not expire a payment that is still inside its window", async () => {
    const { result } = await check(() => queryAnswer("4999"));
    expect(result.status).toBe("PENDING");
  });

  it("lets an operator re-check any payment, with the same rules", async () => {
    const scripted = safaricom(() => queryAnswer("0"));
    const outcome: any = await recheckPaymentForOperator({ transactionId: "tx_a1", fetchImpl: scripted.fetchImpl, client: prisma, now: NOW });
    expect(outcome).toMatchObject({ ok: true, status: "PAID", before: "PENDING" });
    expect(audits("PAYMENT_RECHECKED_BY_OPERATOR")).toHaveLength(1);
  });

  it("says plainly that nothing can be checked when the connector is not ready, and changes nothing", async () => {
    restore();
    restore = applyMpesaEnv({ MPESA_ENV: undefined });
    const { result, calls } = await check(() => queryAnswer("0"));
    expect(result.status).toBe("PENDING");
    expect(calls).toHaveLength(0);
  });
});

// ───────────────────── reversals: money out ─────────────────────

describe("refunds and reversals", () => {
  beforeEach(() => {
    seedDestination();
    seedPayment({ status: "PAID", amountPaidMinor: 35_000, providerReceipt: RECEIPT });
  });
  const refund = (route: Parameters<typeof safaricom>[0], overrides: Record<string, unknown> = {}) => {
    const scripted = safaricom(route);
    return requestRefund({
      businessId: "bizA",
      transactionId: "tx_a1",
      amountKES: 350,
      reason: "Customer cancellation",
      actor: OWNER,
      client: prisma,
      fetchImpl: scripted.fetchImpl,
      now: NOW,
      ...overrides,
    } as any).then((outcome) => ({ outcome: outcome as any, ...scripted }));
  };
  const refunds = () => fake().rows("refund");

  describe("authorization and eligibility", () => {
    it("refuses a role without the refund permission, and sends nothing", async () => {
      const { outcome, calls } = await refund(reversalAccepted, { actor: { ...OWNER, permissions: [] } });
      expect(outcome).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
      expect(calls).toHaveLength(0);
      expect(refunds()).toHaveLength(0);
    });

    it("refuses an unconfirmed request, a missing reason and an unpaid payment", async () => {
      expect((await refund(reversalAccepted, { actor: { ...OWNER, confirmed: false } })).outcome.code).toBe("CONFIRMATION_REQUIRED");
      expect((await refund(reversalAccepted, { reason: "no" })).outcome.code).toBe("REASON_REQUIRED");
      tx().status = "PENDING";
      expect((await refund(reversalAccepted)).outcome.code).toBe("NOT_REFUNDABLE");
      expect(refunds()).toHaveLength(0);
    });

    it("refuses a partial reversal by policy — no reservation, no refund row, nothing sent", async () => {
      const { outcome, calls } = await refund(reversalAccepted, { amountKES: 100 });
      expect(outcome).toMatchObject({ ok: false, code: "MPESA_PARTIAL_REVERSAL_UNSUPPORTED" });
      expect(refunds()).toHaveLength(0);
      expect(calls).toHaveLength(0);
      expect(tx().amountRefundedMinor).toBe(0);
    });

    it("refuses a Pochi payment", async () => {
      fake().rows("paymentDestination")[0].kind = "MPESA_POCHI";
      const { outcome, calls } = await refund(reversalAccepted);
      expect(outcome).toMatchObject({ ok: false, code: "MPESA_NOT_REVERSIBLE" });
      expect(calls).toHaveLength(0);
    });

    it("records a payment with no receipt on file as a durable failed refund and a reconciliation exception", async () => {
      tx().providerReceipt = null;
      const { outcome, calls } = await refund(reversalAccepted);
      expect(outcome).toMatchObject({ ok: false, code: "MISSING_MPESA_RECEIPT" });
      expect(refunds()[0]).toMatchObject({ status: "FAILED", amountMinor: 35_000 });
      expect(reconciliations("UNCONFIRMED")).toHaveLength(1);
      expect(audits("REFUND_FAILED")).toHaveLength(1);
      expect(calls.filter((call) => call.url.includes("reversal"))).toHaveLength(0);
    });

    it("records an unconfigured initiator as a durable failure — and sends nothing", async () => {
      restore();
      restore = applyMpesaEnv({ MPESA_INITIATOR_NAME: undefined });
      const { outcome, calls } = await refund(reversalAccepted);
      expect(outcome).toMatchObject({ ok: false, code: "MPESA_REVERSAL_NOT_CONFIGURED" });
      expect(refunds()[0].status).toBe("FAILED");
      expect(calls).toHaveLength(0);
    });
  });

  describe("an accepted reversal", () => {
    it("is reserved and PENDING_PROVIDER until Safaricom's result arrives, and cannot be requested twice", async () => {
      const { outcome, to } = await refund(reversalAccepted);
      expect(outcome).toMatchObject({ ok: true, status: "PENDING_PROVIDER", amountKES: 350, remainingKES: 0 });
      expect(refunds()[0]).toMatchObject({ status: "PENDING_PROVIDER", providerReference: "OC_REFUND_1", amountMinor: 35_000 });
      expect(refundOutcomeState(refunds()[0])).toBe("AWAITING_PROVIDER");
      expect(tx().amountRefundedMinor).toBe(0); // nothing is claimed as returned yet

      const again = await refund(reversalAccepted);
      expect(again.outcome.ok).toBe(false);
      expect(again.to("/mpesa/reversal/v1/request")).toHaveLength(0);
      expect(to("/mpesa/reversal/v1/request")).toHaveLength(1);
      expect(refunds()).toHaveLength(1);
    });

    it("completes when the authenticated success result arrives, once", async () => {
      await refund(reversalAccepted);
      const first = await pipeline(`${DARAJA}/result`, resultPayload(0));
      const duplicate = await pipeline(`${DARAJA}/result`, resultPayload(0));
      expect(first.status).toBe("processed");
      expect(duplicate.status).toBe("already_processed");
      expect(refunds()[0]).toMatchObject({ status: "COMPLETED" });
      expect(tx()).toMatchObject({ status: "FULLY_REFUNDED", amountRefundedMinor: 35_000 });
      expect(audits("REFUND_COMPLETED")).toHaveLength(1);
    });

    it("releases the reservation when the authenticated result is a failure, leaving the payment paid", async () => {
      await refund(reversalAccepted);
      await pipeline(`${DARAJA}/result`, resultPayload(2001));
      expect(refunds()[0]).toMatchObject({ status: "FAILED" });
      expect(tx()).toMatchObject({ status: "PAID", amountRefundedMinor: 0 });
      expect(refundSummary(tx(), refunds())).toMatchObject({ refundableKES: 350, reservedKES: 0 });
    });

    it("keeps the reservation, and flags it for review, when the result's amount does not match", async () => {
      await refund(reversalAccepted);
      await pipeline(`${DARAJA}/result`, resultPayload(0, { ResultParameters: { ResultParameter: [{ Key: "Amount", Value: "100.00" }] } }));
      expect(refunds()[0].status).toBe("PENDING_PROVIDER");
      expect(tx().amountRefundedMinor).toBe(0);
      expect(reconciliations("UNCONFIRMED").some((row) => /did not match the reserved refund amount/.test(row.notes))).toBe(true);
    });

    it("ignores a result from an unauthenticated caller", async () => {
      await refund(reversalAccepted);
      const forged = await pipeline(`${DARAJA}/result`, resultPayload(0), { token: "forged_token_value_0123456789abc" });
      expect(forged.status).toBe("rejected");
      expect(refunds()[0].status).toBe("PENDING_PROVIDER");
      expect(tx().amountRefundedMinor).toBe(0);
    });
  });

  describe("a queue timeout is a notice, never a verdict", () => {
    it("keeps an accepted reversal reserved with an explicit unknown outcome — it is NOT released as failed", async () => {
      await refund(reversalAccepted);
      const result = await pipeline(`${DARAJA}/timeout`, resultPayload(1));
      expect(result.status).toBe("processed");
      expect(refunds()[0].status).toBe("PENDING_PROVIDER");
      expect(refunds()[0].status).not.toBe("FAILED");
      expect(refunds()[0].failureReason).toMatch(/^OUTCOME UNKNOWN — /);
      expect(refundOutcomeState(refunds()[0])).toBe("UNKNOWN");
      expect(refundSummary(tx(), refunds())).toMatchObject({ unknownOutcomeRefunds: 1, refundableKES: 0, reservedKES: 350 });
      expect(audits("REFUND_OUTCOME_UNKNOWN")).toHaveLength(1);
      expect(reconciliations("UNCONFIRMED").some((row) => /outcome unknown/i.test(row.notes))).toBe(true);
    });

    it("cannot be re-sent while the outcome is unknown", async () => {
      await refund(reversalAccepted);
      await pipeline(`${DARAJA}/timeout`, resultPayload(1));
      const again = await refund(reversalAccepted);
      expect(again.outcome.ok).toBe(false);
      expect(again.to("/mpesa/reversal/v1/request")).toHaveLength(0);
    });

    it("still completes if the result arrives after the timeout notice", async () => {
      await refund(reversalAccepted);
      await pipeline(`${DARAJA}/timeout`, resultPayload(1));
      await pipeline(`${DARAJA}/result`, resultPayload(0));
      expect(refunds()[0]).toMatchObject({ status: "COMPLETED", failureReason: null });
      expect(tx()).toMatchObject({ status: "FULLY_REFUNDED", amountRefundedMinor: 35_000 });
    });

    it("is idempotent, and changes nothing after the refund has completed", async () => {
      await refund(reversalAccepted);
      await pipeline(`${DARAJA}/timeout`, resultPayload(1));
      expect((await pipeline(`${DARAJA}/timeout`, resultPayload(1))).status).toBe("already_processed");
      expect(audits("REFUND_OUTCOME_UNKNOWN")).toHaveLength(1);
      await pipeline(`${DARAJA}/result`, resultPayload(0));
      await pipeline(`${DARAJA}/timeout`, resultPayload(1, { OriginatorConversationID: "OC_REFUND_1", ConversationID: "AG_OTHER" }));
      expect(refunds()[0].status).toBe("COMPLETED");
    });

    it("records a timeout for a conversation it does not know without inventing a refund", async () => {
      await pipeline(`${DARAJA}/timeout`, resultPayload(1, { OriginatorConversationID: "OC_NOBODY", ConversationID: "AG_NOBODY", ResultParameters: undefined }));
      expect(refunds()).toHaveLength(0);
      expect(events()[0]).toMatchObject({ status: "PROCESSED", errorCode: "NO_MATCHING_REFUND" });
    });
  });

  describe("when Safaricom's answer to the request is lost or inconclusive", () => {
    it.each([
      ["a transport timeout", () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }],
      ["a 503 from the gateway", () => new Response("", { status: 503 })],
      ["an acceptance without a conversation id", () => jsonResponse({ ResponseCode: "0" })],
    ])("keeps the amount reserved with an explicit unknown outcome after %s, and sends exactly once", async (_label, answer) => {
      const { outcome, to } = await refund(answer as never);
      expect(outcome).toMatchObject({ ok: false, code: "MPESA_REVERSAL_RESULT_UNKNOWN", outcomeUnknown: true });
      expect(to("/mpesa/reversal/v1/request")).toHaveLength(1);
      expect(refunds()[0]).toMatchObject({ status: "PENDING_PROVIDER", providerReference: null });
      expect(refunds()[0].failureReason).toMatch(/^OUTCOME UNKNOWN — /);
      expect(refundOutcomeState(refunds()[0])).toBe("UNKNOWN");
      expect(audits("REFUND_OUTCOME_UNKNOWN")).toHaveLength(1);
      expect(refundSummary(tx(), refunds())).toMatchObject({ unknownOutcomeRefunds: 1, refundableKES: 0 });

      // …and it cannot be sent again behind the person's back.
      const again = await refund(reversalAccepted);
      expect(again.outcome.ok).toBe(false);
      expect(again.to("/mpesa/reversal/v1/request")).toHaveLength(0);
    });

    it("ties a late result back to the refund by the receipt it reversed, and records the conversation id", async () => {
      await refund(() => new Response("", { status: 503 }));
      expect(refunds()[0].providerReference).toBeNull();
      const result = await pipeline(`${DARAJA}/result`, resultPayload(0));
      expect(result.status).toBe("processed");
      expect(refunds()[0]).toMatchObject({ status: "COMPLETED", providerReference: "OC_REFUND_1", failureReason: null });
      expect(tx()).toMatchObject({ status: "FULLY_REFUNDED", amountRefundedMinor: 35_000 });
    });

    it("lets a late timeout notice find the refund by the reversed receipt too", async () => {
      await refund(() => new Response("", { status: 503 }));
      await pipeline(`${DARAJA}/timeout`, resultPayload(1));
      expect(refunds()[0]).toMatchObject({ status: "PENDING_PROVIDER", providerReference: "OC_REFUND_1" });
      expect(audits("REFUND_OUTCOME_UNKNOWN")).toHaveLength(2);
    });

    it("refuses to guess when two payments carry the same receipt", async () => {
      await refund(() => new Response("", { status: 503 }));
      seedPayment({ id: "tx_dup", providerReference: "MPES-JTP-DUP", providerTransactionId: "ws_CO_dup", providerReceipt: RECEIPT, status: "PAID", amountPaidMinor: 35_000 });
      await pipeline(`${DARAJA}/result`, resultPayload(0));
      expect(refunds()[0].status).toBe("PENDING_PROVIDER");
      expect(tx().amountRefundedMinor).toBe(0);
    });

    it("treats Safaricom refusing the request (4xx) as a definite failure that releases the reservation", async () => {
      const { outcome, to } = await refund(() => jsonResponse({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid ReceiverParty" }, 400));
      expect(outcome).toMatchObject({ ok: false, code: "400.002.02" });
      expect(outcome.outcomeUnknown).toBeUndefined();
      expect(to("/mpesa/reversal/v1/request")).toHaveLength(1);
      expect(refunds()[0].status).toBe("FAILED");
      expect(refundOutcomeState(refunds()[0])).toBe("FAILED");
      expect(refundSummary(tx(), refunds())).toMatchObject({ refundableKES: 350, reservedKES: 0 });
    });
  });

  it("derives an explicit lifecycle state for every refund", () => {
    expect(refundOutcomeState({ status: "REQUESTED" })).toBe("RESERVED");
    expect(refundOutcomeState({ status: "PENDING_PROVIDER", providerReference: "OC_1" })).toBe("AWAITING_PROVIDER");
    expect(refundOutcomeState({ status: "PENDING_PROVIDER", providerReference: null })).toBe("UNKNOWN");
    expect(refundOutcomeState({ status: "PENDING_PROVIDER", providerReference: "OC_1", failureReason: "OUTCOME UNKNOWN — queue timeout" })).toBe("UNKNOWN");
    expect(refundOutcomeState({ status: "COMPLETED" })).toBe("COMPLETED");
    expect(refundOutcomeState({ status: "FAILED" })).toBe("FAILED");
    expect(refundOutcomeState({ status: "REJECTED" })).toBe("REJECTED");
  });
});

// ───────────────────── secrets never reach what is stored ─────────────────────

describe("nothing secret is stored or answered", () => {
  it("keeps the callback token, credentials and full phone number out of events, audits and responses", async () => {
    seedDestination();
    seedPayment();
    const response = await stkPost(darajaRequest(`${DARAJA}/stk`, stkPayload()));
    const everything = JSON.stringify({
      response: await response.json(),
      events: events(),
      audits: fake().rows("paymentAuditEvent"),
      reconciliations: fake().rows("paymentReconciliation"),
      notifications: fake().rows("paymentNotification"),
    });
    for (const secret of [TOKEN, TEST_MPESA.MPESA_CONSUMER_KEY, TEST_MPESA.MPESA_CONSUMER_SECRET, TEST_MPESA.MPESA_PASSKEY, TEST_MPESA.MPESA_SECURITY_CREDENTIAL, "254712111111"]) {
      expect(everything).not.toContain(secret);
    }
  });
});
