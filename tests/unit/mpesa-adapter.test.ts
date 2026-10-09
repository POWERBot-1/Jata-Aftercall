/**
 * The M-PESA (Daraja) adapter, with an injected `fetch`: nothing here reaches a network, and every
 * credential is an obviously fake placeholder.
 *
 * What these tests pin: the right host for the declared environment and never the other one; an
 * OAuth token that is cached per environment and refreshed once — and only once — when Safaricom
 * rejects it; STK requests that obey Daraja's documented limits; a status query that never closes
 * a payment the customer is still completing; callback authentication; and a reversal that sends
 * money out at most once and never claims more than it knows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adapterContext } from "@/lib/payments/context";
import {
  createMpesaAdapter,
  darajaTimestamp,
  mpesaFailureMessage,
  resetMpesaTokenCache,
  safeEqual,
  stkAccountReference,
  STK_TRANSACTION_DESC,
} from "@/lib/payments/providers/mpesa";
import type { DestinationRecord, TransactionRecord } from "@/lib/payments/types";
import type { ProviderEventRequest } from "@/lib/payments/providers/types";
import { TEST_MPESA, applyMpesaEnv, jsonResponse } from "@/tests/helpers/mpesaEnv";

const NOW = new Date("2026-10-04T10:15:30.000Z"); // 13:15:30 EAT
const TOKEN = TEST_MPESA.MPESA_CALLBACK_TOKEN;

type Call = { url: string; method: string; headers: Record<string, string>; body: any };

/**
 * A scripted Daraja. `route` decides each reply; throwing from it simulates a transport failure.
 * Every call is recorded so a test can assert exactly what was (and was not) sent.
 */
function scriptedFetch(route: (call: Call, nth: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: String(init?.method ?? "GET"),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const key = new URL(url).pathname;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);
    return route(call, nth);
  }) as typeof fetch;
  const to = (pathname: string) => calls.filter((call) => new URL(call.url).pathname === pathname);
  return { fetchImpl, calls, to };
}

const OAUTH = "/oauth/v1/generate";
const STK = "/mpesa/stkpush/v1/processrequest";
const QUERY = "/mpesa/stkpushquery/v1/query";
const REVERSAL = "/mpesa/reversal/v1/request";

const oauthOk = (nth = 1) => jsonResponse({ access_token: `tok_${nth}`, expires_in: "3599" });
// A Response body can be read once, so every use needs a fresh one.
const accepted = () => jsonResponse({ MerchantRequestID: "29115-1", CheckoutRequestID: "ws_CO_123", ResponseCode: "0", ResponseDescription: "Success", CustomerMessage: "Success" });

function ctx(fetchImpl: typeof fetch) {
  return adapterContext(NOW, { fetchImpl, verifyWithProvider: true });
}

function destination(overrides: Record<string, unknown> = {}): DestinationRecord {
  return {
    id: "dest_1",
    businessId: "bizA",
    kind: "MPESA_TILL",
    provider: "MPESA",
    label: "M-PESA Till •••3456",
    providerDestinationId: "4123456",
    providerAccountRef: "",
    currency: "KES",
    capabilities: [],
    status: "CONNECTED",
    isPrimary: true,
    isActive: true,
    ...overrides,
  } as unknown as DestinationRecord;
}

function initiation(overrides: Record<string, unknown> = {}) {
  return {
    jataPaymentId: "JTP-20261004-1048-X8K2",
    providerReference: "MPES-JTP-20261004-1048-X8K2",
    amountMinor: 35_000,
    currency: "KES",
    destination: destination(),
    customer: { name: "Jane", phone: "0712111111", emailHint: null },
    description: null,
    connection: null,
    ...overrides,
  } as any;
}

function transaction(overrides: Record<string, unknown> = {}): TransactionRecord {
  return {
    id: "tx_1",
    jataPaymentId: "JTP-20261004-1048-X8K2",
    businessId: "bizA",
    destinationId: "dest_1",
    provider: "MPESA",
    status: "PAID",
    providerReference: "MPES-JTP-20261004-1048-X8K2",
    providerTransactionId: "ws_CO_123",
    providerReceipt: "NLJ7RT61SV",
    method: "MPESA_STK",
    amountMinor: 35_000,
    amountPaidMinor: 35_000,
    amountRefundedMinor: 0,
    currency: "KES",
    ...overrides,
  } as unknown as TransactionRecord;
}

function eventRequest(path: string, payload: Record<string, unknown>, options: { token?: string | null; headers?: Record<string, string> } = {}): ProviderEventRequest {
  const token = options.token === undefined ? TOKEN : options.token;
  return {
    rawBody: JSON.stringify(payload),
    payload,
    headers: new Headers(options.headers ?? {}),
    url: new URL(`https://jata.test${path}${token === null ? "" : `?token=${token}`}`),
  };
}

const stkCallback = (code: number | string, items: Record<string, unknown>[] | null, checkout = "ws_CO_123") => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "29115-1",
      CheckoutRequestID: checkout,
      ResultCode: code,
      ResultDesc: "desc from safaricom",
      ...(items ? { CallbackMetadata: { Item: items } } : {}),
    },
  },
});
const successItems = (overrides: { amount?: unknown; receipt?: unknown } = {}) => [
  { Name: "Amount", Value: "amount" in overrides ? overrides.amount : 350 },
  { Name: "MpesaReceiptNumber", Value: "receipt" in overrides ? overrides.receipt : "NLJ7RT61SV" },
  { Name: "TransactionDate", Value: 20261004131530 },
  { Name: "PhoneNumber", Value: 254712111111 },
];

const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = applyMpesaEnv();
  resetMpesaTokenCache();
});
afterEach(() => {
  restore();
  resetMpesaTokenCache();
});

// ───────────────────────────── transport ─────────────────────────────

describe("endpoints and OAuth", () => {
  it("talks only to the official sandbox host in sandbox, with HTTP Basic OAuth then a Bearer token", async () => {
    const { fetchImpl, calls } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
    await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `GET https://sandbox.safaricom.co.ke${OAUTH}?grant_type=client_credentials`,
      `POST https://sandbox.safaricom.co.ke${STK}`,
    ]);
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from(`${TEST_MPESA.MPESA_CONSUMER_KEY}:${TEST_MPESA.MPESA_CONSUMER_SECRET}`).toString("base64")}`,
    );
    expect(calls[1].headers.Authorization).toBe("Bearer tok_1");
  });

  it("talks only to the official production host in production — never the sandbox", async () => {
    restore();
    restore = applyMpesaEnv({ MPESA_ENV: "production", MPESA_SHORTCODE: "4123456" });
    const { fetchImpl, calls } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
    await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.startsWith("https://api.safaricom.co.ke/")).toBe(true);
      expect(call.url).not.toContain("sandbox");
    }
  });

  it("makes no network call at all when the connector is not ready", async () => {
    restore();
    restore = applyMpesaEnv({ MPESA_ENV: undefined });
    const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
    const result = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(result.kind).toBe("manual");
    expect(calls).toHaveLength(0);
  });

  it("caches the token per environment: reuses it within one, never across sandbox and production", async () => {
    const { fetchImpl, calls, to } = scriptedFetch((call) =>
      call.url.includes(OAUTH) ? jsonResponse({ access_token: call.url.includes("sandbox") ? "tok_sandbox" : "tok_production", expires_in: "3599" }) : accepted(),
    );
    const adapter = createMpesaAdapter();
    await adapter.createPaymentRequest(initiation(), ctx(fetchImpl));
    await adapter.createPaymentRequest(initiation({ jataPaymentId: "JTP-20261004-1049-ABCD" }), ctx(fetchImpl));
    expect(to(OAUTH)).toHaveLength(1); // second request reused the sandbox token

    restore();
    restore = applyMpesaEnv({ MPESA_ENV: "production", MPESA_SHORTCODE: "4123456" });
    await adapter.createPaymentRequest(initiation(), ctx(fetchImpl));
    const production = calls.filter((call) => call.url.startsWith("https://api.safaricom.co.ke"));
    expect(production.find((call) => call.method === "POST")?.headers.Authorization).toBe("Bearer tok_production");
    expect(production.some((call) => call.headers.Authorization === "Bearer tok_sandbox")).toBe(false);
    expect(to(OAUTH)).toHaveLength(2);
  });

  it("mints a fresh token once and retries once when Safaricom rejects an expired token", async () => {
    const { fetchImpl, to } = scriptedFetch((call, nth) => {
      if (call.url.includes(OAUTH)) return oauthOk(nth);
      return nth === 1 ? jsonResponse({ requestId: "r", errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 401) : accepted();
    });
    const result = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(result.kind).toBe("initiated");
    expect(to(OAUTH)).toHaveLength(2);
    expect(to(STK)).toHaveLength(2);
    expect(to(STK)[1].headers.Authorization).toBe("Bearer tok_2");
  });

  it("recognises an invalid token by its error code even when the status is not 401", async () => {
    const { fetchImpl, to } = scriptedFetch((call, nth) => {
      if (call.url.includes(OAUTH)) return oauthOk(nth);
      return nth === 1 ? jsonResponse({ errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 404) : accepted();
    });
    expect((await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl))).kind).toBe("initiated");
    expect(to(STK)).toHaveLength(2);
  });

  it("retries an authentication rejection exactly once — never in a loop", async () => {
    const { fetchImpl, to } = scriptedFetch((call, nth) =>
      call.url.includes(OAUTH) ? oauthOk(nth) : jsonResponse({ errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 401),
    );
    const result = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(result.kind).toBe("failed");
    expect(to(STK)).toHaveLength(2);
    expect(to(OAUTH)).toHaveLength(2);
  });

  it("sends nothing when OAuth itself fails, and says the credentials need attention", async () => {
    const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? jsonResponse({ errorMessage: "Bad Request" }, 400) : accepted()));
    const result: any = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(result).toMatchObject({ kind: "failed", code: "MPESA_AUTH_FAILED", retryable: false });
    expect(to(STK)).toHaveLength(0);
    expect(result.message).not.toContain(TEST_MPESA.MPESA_CONSUMER_SECRET);
  });

  it("never sends a request body or a message containing a secret in a diagnostic", async () => {
    const { fetchImpl } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : jsonResponse({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }, 400)));
    const result: any = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    const text = JSON.stringify(result);
    for (const secret of [TEST_MPESA.MPESA_CONSUMER_KEY, TEST_MPESA.MPESA_CONSUMER_SECRET, TEST_MPESA.MPESA_PASSKEY, TOKEN, "tok_1"]) {
      expect(text).not.toContain(secret);
    }
  });
});

// ───────────────────────────── STK push ─────────────────────────────

describe("STK Push request", () => {
  it("sends a request that obeys every documented Daraja rule", async () => {
    const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
    const result: any = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    const body = to(STK)[0].body;
    expect(body.BusinessShortCode).toBe("174379");
    expect(body.Timestamp).toBe("20261004131530");
    expect(body.Timestamp).toBe(darajaTimestamp(NOW));
    expect(body.Password).toBe(Buffer.from(`174379${TEST_MPESA.MPESA_PASSKEY}20261004131530`).toString("base64"));
    expect(body.TransactionType).toBe("CustomerBuyGoodsOnline");
    expect(body.Amount).toBe(350);
    expect(Number.isInteger(body.Amount)).toBe(true);
    expect(body.PartyA).toBe("254712111111");
    expect(body.PhoneNumber).toBe("254712111111");
    expect(body.PartyB).toBe("4123456");
    expect(body.CallBackURL).toBe(`https://jata.test/api/payments/webhooks/daraja/stk?token=${TOKEN}`);
    expect(body.AccountReference).toBe("10041048X8K2");
    expect(body.AccountReference).toMatch(/^[A-Z0-9]{1,12}$/);
    expect(body.TransactionDesc).toBe(STK_TRANSACTION_DESC);
    expect(body.TransactionDesc.length).toBeLessThanOrEqual(13);
    expect(result).toMatchObject({ kind: "initiated", method: "MPESA_STK", providerTransactionId: "ws_CO_123" });
  });

  it("does not send the long JATA provider reference as the account reference (Daraja's limit is 12)", async () => {
    const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
    await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
    expect(to(STK)[0].body.AccountReference).not.toContain("MPES-");
    expect(String(to(STK)[0].body.AccountReference).length).toBeLessThanOrEqual(12);
  });

  it("normalises Kenyan phone formats to 2547… / 2541…", async () => {
    for (const [given, expected] of [["0712 111 111", "254712111111"], ["+254712111111", "254712111111"], ["0112111111", "254112111111"], ["712111111", "254712111111"]]) {
      const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
      resetMpesaTokenCache();
      await createMpesaAdapter().createPaymentRequest(initiation({ customer: { phone: given } }), ctx(fetchImpl));
      expect(to(STK)[0].body.PhoneNumber).toBe(expected);
    }
  });

  it("falls back to showing the customer how to pay when there is no usable phone or the destination is Pochi", async () => {
    for (const overrides of [{ customer: { phone: "12345" } }, { customer: { phone: null } }, { destination: destination({ kind: "MPESA_POCHI" }) }]) {
      const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
      const result = await createMpesaAdapter().createPaymentRequest(initiation(overrides), ctx(fetchImpl));
      expect(result.kind).toBe("manual");
      expect(calls).toHaveLength(0);
    }
  });

  describe("amount", () => {
    it.each([
      ["a fractional shilling amount", 10_050, "MPESA_AMOUNT_NOT_WHOLE"],
      ["a single cent", 1, "MPESA_AMOUNT_NOT_WHOLE"],
      ["less than one shilling", 99, "MPESA_AMOUNT_NOT_WHOLE"],
      ["zero", 0, "MPESA_AMOUNT_OUT_OF_RANGE"],
      ["above the M-PESA transaction limit", 25_000_100, "MPESA_AMOUNT_OUT_OF_RANGE"],
      ["a non-integer", 100.5, "MPESA_AMOUNT_NOT_WHOLE"],
    ])("refuses %s without sending anything (it is never rounded)", async (_label, amountMinor, code) => {
      const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
      const result: any = await createMpesaAdapter().createPaymentRequest(initiation({ amountMinor }), ctx(fetchImpl));
      expect(result).toMatchObject({ kind: "failed", code, retryable: false });
      expect(calls).toHaveLength(0);
    });

    it.each([[100, 1], [25_000_000, 250_000]])("accepts the boundary amount %i minor units as KES %i", async (amountMinor, kes) => {
      const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
      const result = await createMpesaAdapter().createPaymentRequest(initiation({ amountMinor }), ctx(fetchImpl));
      expect(result.kind).toBe("initiated");
      expect(to(STK)[0].body.Amount).toBe(kes);
    });
  });

  describe("PayBill destinations", () => {
    const paybill = (overrides: Record<string, unknown> = {}) =>
      destination({ kind: "MPESA_PAYBILL", providerDestinationId: "174379", providerAccountRef: "ACC12", ...overrides });

    it("uses CustomerPayBillOnline, PartyB equal to the shortcode, and the account number unchanged", async () => {
      const { fetchImpl, to } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : accepted()));
      await createMpesaAdapter().createPaymentRequest(initiation({ destination: paybill() }), ctx(fetchImpl));
      expect(to(STK)[0].body).toMatchObject({ TransactionType: "CustomerPayBillOnline", PartyB: "174379", AccountReference: "ACC12" });
    });

    it("does not prompt for a PayBill that is not the connector's own shortcode (Daraja requires PartyB = shortcode)", async () => {
      const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
      const result = await createMpesaAdapter().createPaymentRequest(initiation({ destination: paybill({ providerDestinationId: "400200" }) }), ctx(fetchImpl));
      expect(result.kind).toBe("manual");
      expect(calls).toHaveLength(0);
    });

    it("does not alter a PayBill account number that cannot fit the 12-character limit — it shows how to pay instead", async () => {
      const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
      const result = await createMpesaAdapter().createPaymentRequest(initiation({ destination: paybill({ providerAccountRef: "ACCOUNT-NUMBER-13+" }) }), ctx(fetchImpl));
      expect(result.kind).toBe("manual");
      expect(calls).toHaveLength(0);
    });

    it("refuses a destination that is not a 5–7 digit number", async () => {
      const { fetchImpl, calls } = scriptedFetch(() => jsonResponse({}));
      const result: any = await createMpesaAdapter().createPaymentRequest(initiation({ destination: destination({ providerDestinationId: "123" }) }), ctx(fetchImpl));
      expect(result).toMatchObject({ kind: "failed", code: "MPESA_DESTINATION_INVALID" });
      expect(calls).toHaveLength(0);
    });
  });

  it("derives account references that always fit Daraja's 12-character alphanumeric limit", () => {
    for (const jataPaymentId of ["JTP-20261004-1048-X8K2", "JTP-20261004-0-AB", "x", "", "JTP-99999999-12345678-ZZZZ"]) {
      const reference = stkAccountReference({ jataPaymentId, destination: { kind: "MPESA_TILL", providerAccountRef: "" } });
      expect(reference).toMatch(/^[A-Z0-9]{1,12}$/);
    }
  });

  describe("provider answers", () => {
    it.each([
      ["a transport timeout", () => { throw timeoutError(); }, "MPESA_TIMEOUT", true],
      ["a connection failure", () => { throw new TypeError("fetch failed"); }, "MPESA_UNREACHABLE", true],
    ])("reports %s as an unconfirmed request, sent once, never auto-retried", async (_label, boom, code, retryable) => {
      const { fetchImpl, to } = scriptedFetch((call) => {
        if (call.url.includes(OAUTH)) return oauthOk();
        return boom() as never;
      });
      const result: any = await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl));
      expect(result).toMatchObject({ kind: "failed", code, retryable });
      expect(result.message).toMatch(/customer.*(sees a prompt|still)/i);
      expect(to(STK)).toHaveLength(1);
    });

    it.each([
      ["a validation error", 400, { requestId: "r", errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }, "400.002.02", false],
      ["a locked subscriber", 500, { requestId: "r", errorCode: "500.001.1001", errorMessage: "Unable to lock subscriber" }, "500.001.1001", true],
      ["a rate limit", 429, { errorCode: "429.001.01", errorMessage: "Spike arrest" }, "429.001.01", true],
    ])("surfaces %s as a failure with Safaricom's code", async (_label, status, body, code, retryable) => {
      const { fetchImpl } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : jsonResponse(body, status)));
      expect(await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl))).toMatchObject({ kind: "failed", code, retryable });
    });

    it("treats a 200 without ResponseCode 0 as a failure", async () => {
      const { fetchImpl } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : jsonResponse({ ResponseCode: "1", CheckoutRequestID: "ws_CO_1" })));
      expect(await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl))).toMatchObject({ kind: "failed", code: "MPESA_RESPONSE_1" });
    });

    it("treats an acceptance without a CheckoutRequestID as a failure — there would be nothing to match the callback to", async () => {
      const { fetchImpl } = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : jsonResponse({ ResponseCode: "0" })));
      expect(await createMpesaAdapter().createPaymentRequest(initiation(), ctx(fetchImpl))).toMatchObject({ kind: "failed" });
    });
  });
});

// ───────────────────────────── STK Query ─────────────────────────────

describe("STK Query (status check)", () => {
  const ask = async (route: Parameters<typeof scriptedFetch>[0], tx: TransactionRecord = transaction({ status: "PENDING", providerReceipt: null })) => {
    const scripted = scriptedFetch((call, nth) => (call.url.includes(OAUTH) ? oauthOk(nth) : route(call, nth)));
    const report = await createMpesaAdapter().getPaymentStatus(tx, destination(), ctx(scripted.fetchImpl));
    return { report, ...scripted };
  };
  const answer = (ResultCode: string) => jsonResponse({ ResponseCode: "0", ResponseDescription: "ok", MerchantRequestID: "m", CheckoutRequestID: "ws_CO_123", ResultCode, ResultDesc: "d" });

  it("asks Daraja about the CheckoutRequestID, on the declared host", async () => {
    const { to } = await ask(() => answer("0"));
    expect(to(QUERY)).toHaveLength(1);
    expect(to(QUERY)[0].url).toBe(`https://sandbox.safaricom.co.ke${QUERY}`);
    expect(to(QUERY)[0].body).toMatchObject({ BusinessShortCode: "174379", CheckoutRequestID: "ws_CO_123", Timestamp: "20261004131530" });
  });

  it("reports ResultCode 0 as confirmed, flagged as not independently reporting the amount or a receipt", async () => {
    const { report } = await ask(() => answer("0"));
    expect(report).toMatchObject({ status: "CONFIRMED", amountMinor: 35_000, amountVerified: false, providerReceipt: null });
  });

  it.each([
    ["1032", /cancelled the payment/],
    ["1037", /did not respond/],
    ["2001", /wrong M-PESA PIN/],
    ["1", /balance was too low/],
  ])("reports the final failure code %s as FAILED with an accurate message", async (code, message) => {
    const { report } = await ask(() => answer(code));
    expect(report.status).toBe("FAILED");
    expect(report.message).toMatch(message);
  });

  it("reports ResultCode 4999 (still under processing) as PENDING — never as a failure", async () => {
    expect((await ask(() => answer("4999"))).report.status).toBe("PENDING");
  });

  it.each(["3", "17", "1019", "1025", "9999", "1031", "abc"])("treats the unrecognised code %s as still pending, not failed", async (code) => {
    const { report } = await ask(() => answer(code));
    expect(report.status).toBe("PENDING");
    expect(report.status).not.toBe("FAILED");
  });

  it.each([
    ["500.001.1001 (which Safaricom also uses while a transaction is in flight)", 500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }],
    ["a rate limit", 429, { errorCode: "429.001.01" }],
    ["a bad request", 400, { errorCode: "400.002.02", errorMessage: "Bad Request" }],
    ["an unreadable body", 502, null],
  ])("treats %s as UNKNOWN — not a verdict", async (_label, status, body) => {
    const { report } = await ask(() => (body === null ? new Response("<html>bad gateway</html>", { status }) : jsonResponse(body, status)));
    expect(report.status).toBe("UNKNOWN");
  });

  it("treats a transport failure as UNKNOWN", async () => {
    const { report } = await ask(() => { throw timeoutError(); });
    expect(report.status).toBe("UNKNOWN");
  });

  it("refreshes an expired token once, then reports UNKNOWN if Safaricom still refuses it", async () => {
    const { report, to } = await ask(() => jsonResponse({ errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, 401));
    expect(report.status).toBe("UNKNOWN");
    expect(to(QUERY)).toHaveLength(2);
  });

  it("recovers from an expired token and then answers", async () => {
    const { report, to } = await ask((_call, nth) => (nth === 1 ? jsonResponse({ errorCode: "404.001.03" }, 401) : answer("0")));
    expect(report.status).toBe("CONFIRMED");
    expect(to(QUERY)).toHaveLength(2);
  });

  it("makes no call and says why when the connector is not ready", async () => {
    restore();
    restore = applyMpesaEnv({ MPESA_ENV: undefined });
    const { report, calls } = await ask(() => answer("0"));
    expect(report.status).toBe("UNKNOWN");
    expect(report.message).toMatch(/not active in this deployment/);
    expect(calls).toHaveLength(0);
  });

  it("has nothing to ask for a payment that was never an STK request", async () => {
    const { report, calls } = await ask(() => answer("0"), transaction({ method: "MPESA_TILL_MANUAL", providerTransactionId: null }));
    expect(report.status).toBe("UNKNOWN");
    expect(calls).toHaveLength(0);
  });
});

describe("customer-facing failure messages", () => {
  it.each([
    ["1", /balance was too low/],
    ["1001", /already open/],
    ["1019", /expired/],
    ["1025", /could not send the prompt/],
    ["1032", /cancelled/],
    ["1037", /did not respond/],
    ["2001", /wrong M-PESA PIN/],
  ])("code %s", (code, message) => {
    expect(mpesaFailureMessage(code, "")).toMatch(message);
  });

  it("does not describe a cancelled request as an unresponsive customer, or insufficient funds as a cancellation", () => {
    expect(mpesaFailureMessage("1032", "")).not.toMatch(/did not (enter|respond)/);
    expect(mpesaFailureMessage("1", "")).not.toMatch(/cancel/);
  });

  it("never echoes Safaricom's free text, and never claims success, for an unknown code", () => {
    const message = mpesaFailureMessage("77777", "internal detail: shortcode 174379 key=abc");
    expect(message).not.toContain("internal detail");
    expect(message).not.toMatch(/\b(paid|received|successful)\b(?! unless)/i);
    expect(message).toMatch(/Nothing is marked paid unless M-PESA confirms it/);
  });
});

// ───────────────────────────── callbacks ─────────────────────────────

describe("callback authentication (verifyEvent)", () => {
  const adapter = () => createMpesaAdapter();
  const stkPayload = stkCallback(0, successItems());

  it("accepts a callback carrying the registered token, on either path family", async () => {
    for (const path of ["/api/payments/webhooks/daraja/stk", "/api/payments/webhooks/mpesa/stk"]) {
      const result = await adapter().verifyEvent(eventRequest(path, stkPayload), ctx(fetch));
      expect(result).toMatchObject({ ok: true, eventId: "stk:ws_CO_123:0", eventType: "STK_CALLBACK" });
    }
  });

  it.each([
    ["a wrong token", "wrong_token_value_0123456789abc"],
    ["a token of a different length", "x"],
    ["an empty token", ""],
    ["no token at all", null],
  ])("refuses a callback with %s", async (_label, token) => {
    const result: any = await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { token }), ctx(fetch));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("CALLBACK_TOKEN_INVALID");
  });

  it("compares tokens by content and length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("refuses everything when no token is registered, unless test mode is explicitly on (off production)", async () => {
    restore();
    restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: undefined });
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { token: null }), ctx(fetch))).toMatchObject({ ok: false, code: "CALLBACK_TOKEN_NOT_CONFIGURED" });
    restore();
    restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: undefined, JATA_PAYMENTS_TEST_MODE: "on" });
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { token: null }), ctx(fetch))).toMatchObject({ ok: true });
  });

  it.each([
    ["MPESA_ENV=production", { MPESA_ENV: "production", MPESA_SHORTCODE: "4123456" }],
    ["a Vercel Production deployment", { VERCEL_ENV: "production" }],
  ])("never accepts an unauthenticated callback on %s, even with test mode on", async (_label, env) => {
    restore();
    restore = applyMpesaEnv({ MPESA_CALLBACK_TOKEN: undefined, JATA_PAYMENTS_TEST_MODE: "on", ...env });
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { token: null }), ctx(fetch))).toMatchObject({ ok: false, code: "CALLBACK_TOKEN_NOT_CONFIGURED" });
  });

  it("test mode never skips a token that IS registered", async () => {
    restore();
    restore = applyMpesaEnv({ JATA_PAYMENTS_TEST_MODE: "on" });
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { token: "wrong" }), ctx(fetch))).toMatchObject({ ok: false, code: "CALLBACK_TOKEN_INVALID" });
  });

  it("refuses a payload that names nothing to act on", async () => {
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", { Body: { stkCallback: { ResultCode: 0 } } }), ctx(fetch))).toMatchObject({ ok: false, code: "INVALID_EVENT" });
    expect(await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/confirmation", {}), ctx(fetch))).toMatchObject({ ok: false, code: "INVALID_EVENT" });
  });

  describe("source address allowlist", () => {
    beforeEach(() => {
      restore();
      restore = applyMpesaEnv({ MPESA_ALLOWED_IPS: "196.201.214.200,196.201.214.206" });
    });
    const verify = (headers: Record<string, string>) =>
      adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/stk", stkPayload, { headers }), ctx(fetch));

    it("accepts a listed address, including behind a proxy chain and as an IPv4-mapped IPv6 address", async () => {
      expect(await verify({ "x-forwarded-for": "196.201.214.200" })).toMatchObject({ ok: true });
      expect(await verify({ "x-forwarded-for": "196.201.214.206, 10.0.0.1" })).toMatchObject({ ok: true });
      expect(await verify({ "x-forwarded-for": "::ffff:196.201.214.200" })).toMatchObject({ ok: true });
      expect(await verify({ "x-real-ip": "196.201.214.206" })).toMatchObject({ ok: true });
    });

    it("refuses an unlisted address, and a request that names none — even with the right token", async () => {
      expect(await verify({ "x-forwarded-for": "203.0.113.9" })).toMatchObject({ ok: false, code: "CALLBACK_IP_REJECTED" });
      expect(await verify({})).toMatchObject({ ok: false, code: "CALLBACK_IP_REJECTED" });
    });
  });

  describe("event ids (the idempotency keys)", () => {
    const resultPayload = (code: number) => ({ Result: { ResultCode: code, ConversationID: "AG_1", OriginatorConversationID: "OC_1" } });

    it("keys a timeout separately from the result that may still follow for the same conversation", async () => {
      const result: any = await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/result", resultPayload(0)), ctx(fetch));
      const timeout: any = await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/timeout", resultPayload(1)), ctx(fetch));
      expect(result).toMatchObject({ ok: true, eventType: "REVERSAL_RESULT", eventId: "result:AG_1:0" });
      expect(timeout).toMatchObject({ ok: true, eventType: "REVERSAL_TIMEOUT", eventId: "timeout:AG_1" });
      expect(result.eventId).not.toBe(timeout.eventId);
    });

    it("keys a timeout that names no conversation by a digest of its body — stable for repeats, distinct for others", async () => {
      const id = async (payload: Record<string, unknown>) => ((await adapter().verifyEvent(eventRequest("/api/payments/webhooks/daraja/timeout", payload), ctx(fetch))) as any).eventId as string;
      const a = await id({ Result: { ResultCode: 1, ResultDesc: "timed out" } });
      expect(a).toMatch(/^timeout:body:[0-9a-f]{32}$/);
      expect(await id({ Result: { ResultCode: 1, ResultDesc: "timed out" } })).toBe(a);
      expect(await id({ Result: { ResultCode: 1, ResultDesc: "different" } })).not.toBe(a);
    });

    it("distinguishes the callback types by path", async () => {
      const type = async (path: string, payload: Record<string, unknown>) => ((await adapter().verifyEvent(eventRequest(path, payload), ctx(fetch))) as any).eventType;
      const c2b = { TransID: "RJ9XXQK1", TransAmount: "350", BusinessShortCode: "4123456" };
      expect(await type("/api/payments/webhooks/daraja/confirmation", c2b)).toBe("C2B_CONFIRMATION");
      expect(await type("/api/payments/webhooks/daraja/validation", c2b)).toBe("C2B_VALIDATION");
      expect(await type("/api/payments/webhooks/daraja/stk/", stkPayload)).toBe("STK_CALLBACK");
    });
  });
});

describe("callback parsing (parseEvent)", () => {
  const parse = (path: string, payload: Record<string, unknown>) =>
    createMpesaAdapter().parseEvent(eventRequest(path, payload), ctx(fetch)) as Promise<any>;
  const STK_PATH = "/api/payments/webhooks/daraja/stk";

  it("turns an STK success into a confirmation carrying the amount and the receipt, with the phone masked", async () => {
    const outcome = await parse(STK_PATH, stkCallback(0, successItems()));
    expect(outcome).toMatchObject({
      kind: "confirmation",
      providerTransactionId: "ws_CO_123",
      providerReceipt: "NLJ7RT61SV",
      amountMinor: 35_000,
      currency: "KES",
      method: "MPESA_STK",
    });
    expect(JSON.stringify(outcome)).not.toContain("254712111111");
    expect(outcome.customerPhoneMasked).toMatch(/^2547••••111$/);
  });

  it("keeps the CheckoutRequestID as the correlation handle, never the receipt", async () => {
    const outcome = await parse(STK_PATH, stkCallback(0, successItems()));
    expect(outcome.providerTransactionId).toBe("ws_CO_123");
    expect(outcome.providerTransactionId).not.toBe(outcome.providerReceipt);
  });

  it("carries a missing or malformed receipt as null, never as something plausible", async () => {
    for (const receipt of [undefined, null, "", "short", "NOT A RECEIPT!!", 12345]) {
      const outcome = await parse(STK_PATH, stkCallback(0, successItems({ receipt })));
      expect(outcome.providerReceipt).toBeNull();
    }
  });

  it.each([
    ["is missing", undefined],
    ["is not numeric", "abc"],
    ["is zero", 0],
    ["is negative", -5],
    ["is empty", ""],
  ])("never turns a success whose amount %s into a FAILURE — the customer paid", async (_label, amount) => {
    const outcome = await parse(STK_PATH, stkCallback(0, successItems({ amount })));
    expect(outcome.kind).toBe("confirmation");
    expect(outcome.amountMinor).toBe(0);
    expect(outcome.sanitized.amountStatus).toBe("MISSING_OR_INVALID");
  });

  it.each([
    ["1032", "MPESA_1032", /cancelled/],
    ["1037", "MPESA_1037", /did not respond/],
    ["2001", "MPESA_2001", /wrong M-PESA PIN/],
    ["1", "MPESA_1", /balance was too low/],
  ])("turns result code %s into a failure for the right attempt", async (code, expected, message) => {
    const outcome = await parse(STK_PATH, stkCallback(Number(code), null));
    expect(outcome).toMatchObject({ kind: "failure", code: expected, providerTransactionId: "ws_CO_123" });
    expect(outcome.message).toMatch(message);
  });

  it("parses a C2B confirmation, attributing it to the shortcode and the JATA reference if the customer typed one", async () => {
    const payload = { TransID: "RJ9XXQK1AB", TransAmount: "350.00", BusinessShortCode: "4123456", BillRefNumber: "MPES-JTP-20261004-1048-X8K2", MSISDN: "254712111111", FirstName: "Jane", TransTime: "20261004131530" };
    const outcome = await parse("/api/payments/webhooks/daraja/confirmation", payload);
    expect(outcome).toMatchObject({
      kind: "confirmation",
      providerTransactionId: "RJ9XXQK1AB",
      providerReference: "MPES-JTP-20261004-1048-X8K2",
      amountMinor: 35_000,
      method: "MPESA_C2B_PAYBILL",
    });
    expect(outcome.destination).toMatchObject({ providerDestinationId: "4123456" });
    expect(JSON.stringify(outcome)).not.toContain("254712111111");
  });

  it("does not trust an arbitrary account reference as a JATA reference", async () => {
    const outcome = await parse("/api/payments/webhooks/daraja/confirmation", { TransID: "RJ9XXQK1AB", TransAmount: "350", BusinessShortCode: "4123456", BillRefNumber: "somebody elses order" });
    expect(outcome.providerReference).toBe("");
  });

  it("accepts a complete C2B validation and flags an incomplete one", async () => {
    const complete = { TransID: "RJ9XXQK1AB", TransAmount: "350", BusinessShortCode: "4123456" };
    expect(await parse("/api/payments/webhooks/daraja/validation", complete)).toMatchObject({ kind: "ignored", reason: "VALIDATION_ACCEPTED" });
    expect(await parse("/api/payments/webhooks/daraja/validation", { TransID: "RJ9XXQK1AB" })).toMatchObject({ kind: "ignored", reason: "VALIDATION_INCOMPLETE" });
  });

  describe("reversal results and timeouts", () => {
    const result = (code: number, extra: Record<string, unknown> = {}) => ({
      Result: {
        ResultType: 0,
        ResultCode: code,
        ResultDesc: "The service request is processed successfully.",
        OriginatorConversationID: "OC_1",
        ConversationID: "AG_1",
        TransactionID: "REVTRANS99",
        ResultParameters: { ResultParameter: [{ Key: "Amount", Value: "350.00" }, { Key: "OriginalTransactionID", Value: "nlj7rt61sv" }] },
        ...extra,
      },
    });

    it("turns a successful result into a reversal tied to both the conversation and the reversed receipt", async () => {
      const outcome = await parse("/api/payments/webhooks/daraja/result", result(0));
      expect(outcome).toMatchObject({
        kind: "reversal",
        providerReference: "OC_1",
        providerTransactionId: "AG_1",
        originalTransactionId: "NLJ7RT61SV",
        amountMinor: 35_000,
      });
    });

    it("turns a non-zero result into a definitive failure", async () => {
      const outcome = await parse("/api/payments/webhooks/daraja/result", result(2001));
      expect(outcome).toMatchObject({ kind: "failure", code: "MPESA_2001", providerReference: "OC_1", originalTransactionId: "NLJ7RT61SV" });
    });

    it("turns a queue timeout into a timeout NOTICE — the same payload at /result is a failure, at /timeout it is not", async () => {
      const atResult = await parse("/api/payments/webhooks/daraja/result", result(1));
      const atTimeout = await parse("/api/payments/webhooks/daraja/timeout", result(1));
      expect(atResult.kind).toBe("failure");
      expect(atTimeout).toMatchObject({ kind: "reversal_timeout", providerReference: "OC_1", originalTransactionId: "NLJ7RT61SV" });
      expect(atTimeout.kind).not.toBe("failure");
    });

    it("still reads a timeout notice that names no conversation", async () => {
      const outcome = await parse("/api/payments/webhooks/daraja/timeout", { Result: { ResultCode: 1 } });
      expect(outcome).toMatchObject({ kind: "reversal_timeout", providerReference: null });
    });

    it("has a reversal with no amount carry 0, so it can never match a refund by accident", async () => {
      const outcome = await parse("/api/payments/webhooks/daraja/result", result(0, { ResultParameters: undefined }));
      expect(outcome.amountMinor).toBe(0);
    });
  });

  it("ignores a payload it does not recognise", async () => {
    expect(await parse("/api/payments/webhooks/daraja/confirmation", { hello: "world" })).toMatchObject({ kind: "ignored", reason: "UNSUPPORTED_PAYLOAD" });
  });
});

// ───────────────────────────── reversals ─────────────────────────────

describe("reversal (money out)", () => {
  const reverse = async (route: Parameters<typeof scriptedFetch>[0], input: Record<string, unknown> = {}) => {
    const scripted = scriptedFetch((call, nth) => (call.url.includes(OAUTH) ? oauthOk(nth) : route(call, nth)));
    const result: any = await createMpesaAdapter().reverse(
      { transaction: transaction(), destination: null, amountMinor: 35_000, reason: "Customer cancellation", ...input } as any,
      ctx(scripted.fetchImpl),
    );
    return { result, ...scripted };
  };
  const acceptedReversal = () => jsonResponse({ OriginatorConversationID: "OC_1", ConversationID: "AG_1", ResponseCode: "0", ResponseDescription: "Accept the service request successfully." });

  it("sends a complete TransactionReversal request, authenticated by the configured initiator", async () => {
    const { result, to } = await reverse(acceptedReversal);
    const body = to(REVERSAL)[0].body;
    expect(to(REVERSAL)[0].url).toBe(`https://sandbox.safaricom.co.ke${REVERSAL}`);
    expect(body).toMatchObject({
      Initiator: TEST_MPESA.MPESA_INITIATOR_NAME,
      CommandID: "TransactionReversal",
      TransactionID: "NLJ7RT61SV",
      Amount: 350,
      ReceiverParty: "174379",
      RecieverIdentifierType: "11",
      ResultURL: `https://jata.test/api/payments/webhooks/daraja/result?token=${TOKEN}`,
      QueueTimeOutURL: `https://jata.test/api/payments/webhooks/daraja/timeout?token=${TOKEN}`,
    });
    expect(body.SecurityCredential).toBe(TEST_MPESA.MPESA_SECURITY_CREDENTIAL);
    expect(body.Initiator).not.toBe("JATA"); // no invented default initiator
    expect(result).toMatchObject({ ok: true, providerReference: "OC_1" });
  });

  it("names the receiving till as the receiver party when the destination is known", async () => {
    const { to } = await reverse(acceptedReversal, { destination: destination() });
    expect(to(REVERSAL)[0].body.ReceiverParty).toBe("4123456");
  });

  it("delegates refund() to the same reversal", async () => {
    const scripted = scriptedFetch((call) => (call.url.includes(OAUTH) ? oauthOk() : acceptedReversal()));
    const result: any = await createMpesaAdapter().refund(
      { transaction: transaction(), destination: null, amountMinor: 35_000, reason: "Customer cancellation" } as any,
      ctx(scripted.fetchImpl),
    );
    expect(result.ok).toBe(true);
    expect(scripted.to(REVERSAL)).toHaveLength(1);
  });

  describe("refuses locally, sending nothing", () => {
    it.each([
      ["no initiator", { MPESA_INITIATOR_NAME: undefined }, "MPESA_REVERSAL_NOT_CONFIGURED"],
      ["no SecurityCredential", { MPESA_SECURITY_CREDENTIAL: undefined }, "MPESA_REVERSAL_NOT_CONFIGURED"],
      ["a malformed SecurityCredential", { MPESA_SECURITY_CREDENTIAL: "not base64!" }, "MPESA_REVERSAL_NOT_CONFIGURED"],
      ["an unconfigured connector", { MPESA_ENV: undefined }, "MPESA_NOT_CONNECTED"],
    ])("with %s", async (_label, env, code) => {
      restore();
      restore = applyMpesaEnv(env);
      const { result, calls } = await reverse(acceptedReversal);
      expect(result).toMatchObject({ ok: false, code, retryable: false });
      expect(calls).toHaveLength(0);
    });

    it.each([
      ["a partial amount", { amountMinor: 10_000 }],
      ["a payment that was already partly refunded", { transaction: transaction({ amountRefundedMinor: 5_000 }) }],
    ])("for %s — M-PESA reverses a payment in full, once", async (_label, input) => {
      const { result, calls } = await reverse(acceptedReversal, input);
      expect(result).toMatchObject({ ok: false, code: "MPESA_PARTIAL_REVERSAL_UNSUPPORTED", retryable: false });
      expect(calls).toHaveLength(0);
    });

    it("for an STK payment with no receipt on record — the CheckoutRequestID is never substituted", async () => {
      const { result, calls } = await reverse(acceptedReversal, { transaction: transaction({ providerReceipt: null }) });
      expect(result).toMatchObject({ ok: false, code: "MISSING_MPESA_RECEIPT" });
      expect(calls).toHaveLength(0);
    });
  });

  describe("never claims more than it knows, and never sends twice", () => {
    it.each([
      ["a server error", () => jsonResponse({ errorCode: "500.001.1001", errorMessage: "Server error" }, 500)],
      ["a server error with no body", () => new Response("", { status: 503 })],
      ["an acceptance with no conversation id", () => jsonResponse({ ResponseCode: "0" })],
      ["an answer without ResponseCode 0", () => jsonResponse({ OriginatorConversationID: "OC_1", ResponseCode: "1" })],
      ["a transport timeout", () => { throw timeoutError(); }],
      ["a dropped connection", () => { throw new TypeError("fetch failed"); }],
    ])("records %s as an UNKNOWN outcome that must not be retried, and sends the reversal once", async (_label, answer) => {
      const { result, to } = await reverse(answer as never);
      expect(result).toMatchObject({ ok: false, code: "MPESA_REVERSAL_RESULT_UNKNOWN", retryable: false, outcomeUnknown: true });
      expect(to(REVERSAL)).toHaveLength(1);
      expect(result.message).toMatch(/will not (send|resend)|not send it again/i);
    });

    it("treats a 4xx with an error code as Safaricom refusing the request — a definite failure, not unknown", async () => {
      const { result, to } = await reverse(() => jsonResponse({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid ReceiverParty" }, 400));
      expect(result).toMatchObject({ ok: false, code: "400.002.02", retryable: false });
      expect(result.outcomeUnknown).toBeUndefined();
      expect(to(REVERSAL)).toHaveLength(1);
    });

    it("treats an authentication failure as not-sent, not unknown", async () => {
      const scripted = scriptedFetch((call) => (call.url.includes(OAUTH) ? jsonResponse({ errorMessage: "unauthorized" }, 401) : acceptedReversal()));
      const result: any = await createMpesaAdapter().reverse(
        { transaction: transaction(), destination: null, amountMinor: 35_000, reason: "Customer cancellation" } as any,
        ctx(scripted.fetchImpl),
      );
      expect(result).toMatchObject({ ok: false, code: "MPESA_AUTH_FAILED", retryable: false });
      expect(result.outcomeUnknown).toBeUndefined();
      expect(scripted.to(REVERSAL)).toHaveLength(0);
    });

    it("re-sends only after an authentication rejection, which proves nothing was processed", async () => {
      const { result, to } = await reverse((_call, nth) => (nth === 1 ? jsonResponse({ errorCode: "404.001.03" }, 401) : acceptedReversal()));
      expect(result.ok).toBe(true);
      expect(to(REVERSAL)).toHaveLength(2);
    });
  });

  it("uses the C2B transaction id for a till or PayBill payment", async () => {
    const { to } = await reverse(acceptedReversal, { transaction: transaction({ method: "MPESA_C2B_TILL", providerTransactionId: "RJ12ABC789", providerReceipt: null }) });
    expect(to(REVERSAL)[0].body.TransactionID).toBe("RJ12ABC789");
  });
});

describe("refund pre-flight (validateRefund)", () => {
  const validate = (input: Record<string, unknown>) =>
    createMpesaAdapter().validateRefund!({
      transaction: transaction(),
      destination: null,
      amountMinor: 35_000,
      alreadyRefundedMinor: 0,
      outstandingMinor: 0,
      ...input,
    } as any);

  it("allows one full reversal", () => {
    expect(validate({})).toEqual({ ok: true });
  });

  it.each([
    ["a partial amount", { amountMinor: 10_000 }],
    ["a second reversal", { alreadyRefundedMinor: 35_000 }],
    ["a reversal while one is already reserved", { outstandingMinor: 35_000 }],
  ])("refuses %s, by policy", (_label, input) => {
    expect(validate(input)).toMatchObject({ ok: false, code: "MPESA_PARTIAL_REVERSAL_UNSUPPORTED" });
  });

  it("refuses a Pochi payment", () => {
    expect(validate({ destination: destination({ kind: "MPESA_POCHI" }) })).toMatchObject({ ok: false, code: "MPESA_NOT_REVERSIBLE" });
  });

  it("leaves data and configuration problems to the reversal itself, so they keep their durable record", () => {
    expect(validate({ transaction: transaction({ providerReceipt: null }) })).toEqual({ ok: true });
    restore();
    restore = applyMpesaEnv({ MPESA_INITIATOR_NAME: undefined });
    expect(validate({})).toEqual({ ok: true });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
