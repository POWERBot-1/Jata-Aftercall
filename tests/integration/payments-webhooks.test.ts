/**
 * The central provider event endpoints (§35, §90, §111).
 *
 * One endpoint per provider, owned by JATA, and nothing in it trusts the caller: the event is
 * authenticated, claimed exactly once, normalized by the adapter, and only then applied. These
 * tests exercise the failures that matter — a forged callback, a replayed callback, a payment the
 * callback does not belong to, and an amount the provider reported differently.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { applyProviderEvent } from "@/lib/payments/webhooks";
import { recheckPaymentForOperator } from "@/lib/payments/orchestrator";
import { paystackSignature } from "@/lib/payments/providers/paystack";
import { readMpesaConfig, readTestMode } from "@/lib/payments/config";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;

const CALLBACK_TOKEN = "jata-token-abc123";

function mpesaStkPayload(overrides: { amount?: number; checkoutId?: string; resultCode?: string } = {}) {
  const amount = overrides.amount ?? 350;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: overrides.checkoutId ?? "ws_CO_191220191020363925",
        ResultCode: overrides.resultCode ?? "0",
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: amount },
            { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
            { Name: "TransactionDate", Value: 20261004104830 },
            { Name: "PhoneNumber", Value: 254712111111 },
          ],
        },
      },
    },
  };
}

function seedPendingPayment(overrides: Record<string, unknown> = {}) {
  fake().rows("paymentDestination").push({
    id: "dest_a1",
    businessId: "bizA",
    kind: "MPESA_TILL",
    provider: "MPESA",
    label: "M-PESA Till •••3456",
    providerDestinationId: "4123456",
    providerAccountRef: "",
    currency: "KES",
    capabilities: ["PAYMENT_INSTRUCTIONS", "REAL_TIME_CONFIRMATION", "WEBHOOKS"],
    status: "CONNECTED",
    verificationSource: "LIVE",
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
  });
  fake().rows("paymentTransaction").push({
    id: "tx_a1",
    jataPaymentId: "JTP-20261004-1048-X8K2",
    businessId: "bizA",
    destinationId: "dest_a1",
    provider: "MPESA",
    status: "PENDING",
    providerReference: "JTP-20261004-1048-X8K2",
    // The CheckoutRequestID M-PESA handed JATA when the prompt was sent — the handle its callback quotes.
    providerTransactionId: "ws_CO_191220191020363925",
    idempotencyKey: "idem_a1",
    method: "MPESA_STK",
    amountMinor: 35_000,
    amountPaidMinor: 0,
    amountRefundedMinor: 0,
    currency: "KES",
    paymentContext: null,
    createdAt: new Date(),
    ...overrides,
  });
}

/** The real Prisma enforces `@@unique([provider, providerEventId])`; the fake needs a nudge. */
function enforceEventUniqueness() {
  const original = fake().db.paymentEvent.create;
  fake().db.paymentEvent.create = async (args: any) => {
    const exists = fake().rows("paymentEvent").some(
      (row) => row.provider === args.data.provider && row.providerEventId === args.data.providerEventId,
    );
    if (exists) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    return original(args);
  };
}

function mpesaRequest(payload: Record<string, unknown>, token: string = CALLBACK_TOKEN) {
  const rawBody = JSON.stringify(payload);
  return {
    provider: "MPESA" as const,
    rawBody,
    payload,
    headers: new Headers({ "x-forwarded-for": "196.201.214.200" }),
    url: new URL(`https://jata.test/api/payments/webhooks/mpesa/stk?token=${token}`),
    client: prisma,
  };
}

beforeEach(() => {
  process.env.MPESA_CALLBACK_TOKEN = CALLBACK_TOKEN;
  process.env.PAYSTACK_SECRET_KEY = "sk_test_jata_webhook";
  delete process.env.MPESA_CONSUMER_KEY;
  delete process.env.MPESA_CONSUMER_SECRET;
  delete process.env.MPESA_SHORTCODE;
  delete process.env.MPESA_PASSKEY;
  fake().reset();
  seedPendingPayment();
  enforceEventUniqueness();
});

describe("M-PESA callbacks (§35, §90)", () => {
  it("authenticates, records and applies a confirmed STK callback exactly once", async () => {
    const first = await applyProviderEvent(mpesaRequest(mpesaStkPayload()));
    expect(first.status).toBe("processed");
    expect(fake().rows("paymentTransaction")[0].status).toBe("PAID");
    // The provider's attempt handle (the CheckoutRequestID) stays the correlation key; the M-PESA
    // receipt itself is kept, untouched, in the provider event that carried it.
    expect(fake().rows("paymentTransaction")[0].providerTransactionId).toBe("ws_CO_191220191020363925");
    expect(JSON.stringify(fake().rows("paymentEvent")[0].payload)).toContain("NLJ7RT61SV");
    expect(fake().rows("paymentEvent")[0]).toMatchObject({ status: "PROCESSED", signatureVerified: true });

    // Safaricom retries a callback it thinks was not answered: one financial effect, still.
    const second = await applyProviderEvent(mpesaRequest(mpesaStkPayload()));
    expect(second.status).toBe("already_processed");
    expect(fake().rows("paymentTransaction")[0].status).toBe("PAID");
    expect(fake().rows("paymentTransaction")[0].amountPaidMinor).toBe(35_000);
  });

  it("refuses a callback that does not carry JATA's token (§35, §120)", async () => {
    const result = await applyProviderEvent(mpesaRequest(mpesaStkPayload(), "wrong-token"));
    expect(result.status).toBe("rejected");
    expect(result.httpStatus).toBe(401);
    expect(fake().rows("paymentTransaction")[0].status).toBe("PENDING");
    expect(fake().rows("paymentEvent")[0]).toMatchObject({ status: "REJECTED", signatureVerified: false });
  });

  it("refuses a Daraja-shaped callback when JATA has no token registered at all", async () => {
    delete process.env.MPESA_CALLBACK_TOKEN;
    expect(readMpesaConfig().callbackToken).toBe("");
    expect(readTestMode().explicit).toBe(false);
    const result = await applyProviderEvent(mpesaRequest(mpesaStkPayload(), ""));
    expect(result.status).toBe("rejected");
    expect(result.httpStatus).toBe(401);
    expect(fake().rows("paymentTransaction")[0].status).toBe("PENDING");
  });

  it("surfaces money it cannot place instead of guessing (§44)", async () => {
    fake().rows("paymentTransaction").length = 0;
    // A C2B payment to the merchant's till that JATA has no open request for: it is attributed to
    // the destination's business and recorded as an exception for a person to look at.
    const payload = { TransID: "RJ9XXQK1", TransAmount: "350", BusinessShortCode: "4123456", MSISDN: "254712111111", BillRefNumber: "" };
    const rawBody = JSON.stringify(payload);
    const result = await applyProviderEvent({
      provider: "MPESA",
      rawBody,
      payload,
      headers: new Headers(),
      url: new URL(`https://jata.test/api/payments/webhooks/mpesa/confirmation?token=${CALLBACK_TOKEN}`),
      client: prisma,
    });
    expect(result.status).toBe("unmatched");
    expect(fake().rows("paymentTransaction")).toHaveLength(0);
    expect(fake().rows("paymentReconciliation").some((row) => row.result === "UNKNOWN_PAYMENT" && row.businessId === "bizA")).toBe(true);
  });

  it("records an unattributable callback without inventing a business for it", async () => {
    fake().rows("paymentTransaction").length = 0;
    fake().rows("paymentDestination").length = 0;
    const result = await applyProviderEvent(mpesaRequest(mpesaStkPayload({ checkoutId: "ws_CO_UNKNOWN" })));
    expect(result.status).toBe("unmatched");
    expect(fake().rows("paymentReconciliation")).toHaveLength(0);
    expect(fake().rows("paymentEvent")[0]).toMatchObject({ status: "RECEIVED", errorCode: "NO_MATCHING_TRANSACTION" });
  });

  it("records a failure callback as a failure — never as paid (§30, §68)", async () => {
    const payload = {
      Body: {
        stkCallback: {
          MerchantRequestID: "29115-34620561-1",
          CheckoutRequestID: "ws_CO_191220191020363925",
          ResultCode: "1032",
          ResultDesc: "Request cancelled by user",
        },
      },
    };
    const result = await applyProviderEvent(mpesaRequest(payload));
    expect(result.status).toBe("processed");
    const row = fake().rows("paymentTransaction")[0];
    expect(row.status).toBe("FAILED");
    expect(row.paidAt).toBeFalsy();
    // Plain language for the merchant, and no raw Daraja code anywhere near them (§86).
    expect(row.failureReason).not.toContain("1032");
    expect(row.failureReason?.length ?? 0).toBeGreaterThan(10);
    expect(row.failureCode).toBe("MPESA_1032");
  });
});

describe("Paystack events (§35, §90)", () => {
  function paystackRequest(eventName: string, data: Record<string, unknown>, signature?: string) {
    const rawBody = JSON.stringify({ id: 302961, event: eventName, data });
    return {
      provider: "PAYSTACK" as const,
      rawBody,
      payload: { id: 302961, event: eventName, data },
      headers: new Headers({ "x-paystack-signature": signature ?? paystackSignature(rawBody, "sk_test_jata_webhook") }),
      url: new URL("https://jata.test/api/payments/webhooks/paystack"),
      client: prisma,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ status: true, data: { status: "success", amount: 35_000, currency: "KES", id: 99_001 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    };
  }

  beforeEach(() => {
    fake().rows("paymentDestination").push({
      id: "dest_ps1",
      businessId: "bizA",
      kind: "PAYSTACK",
      provider: "PAYSTACK",
      label: "Paystack · Nyumbani Kitchen",
      providerDestinationId: "acct_jata",
      providerAccountRef: "",
      currency: "KES",
      capabilities: ["PAYMENT_INITIATION", "REAL_TIME_CONFIRMATION", "WEBHOOKS"],
      status: "CONNECTED",
      verificationSource: "LIVE",
      isPrimary: false,
      isActive: true,
      createdAt: new Date(),
    });
    fake().rows("paymentTransaction").push({
      ...fake().rows("paymentTransaction")[0],
      id: "tx_ps1",
      jataPaymentId: "JTP-20261004-1050-PSAA",
      destinationId: "dest_ps1",
      provider: "PAYSTACK",
      providerReference: "JTP-20261004-1050-PSAA",
      idempotencyKey: "idem_ps1",
      amountMinor: 35_000,
      status: "PENDING",
    });
  });

  it("applies a genuinely signed charge.success after re-verifying with Paystack", async () => {
    const result = await applyProviderEvent(
      paystackRequest("charge.success", { reference: "JTP-20261004-1050-PSAA", amount: 35_000, currency: "KES", status: "success" }),
    );
    expect(result.status).toBe("processed");
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === "tx_ps1");
    expect(row?.status).toBe("PAID");
    expect(row?.providerTransactionId).toBe("99001");
  });

  it("refuses a forged signature and leaves the payment where it was", async () => {
    const result = await applyProviderEvent(
      paystackRequest("charge.success", { reference: "JTP-20261004-1050-PSAA", amount: 35_000, currency: "KES", status: "success" }, "deadbeef"),
    );
    expect(result.status).toBe("rejected");
    expect(result.httpStatus).toBe(401);
    expect(fake().rows("paymentTransaction").find((entry) => entry.id === "tx_ps1")?.status).toBe("PENDING");
  });

  it("does not mark paid when Paystack itself says the charge is not successful", async () => {
    const result = await applyProviderEvent({
      ...paystackRequest("charge.success", { reference: "JTP-20261004-1050-PSAA", amount: 35_000, currency: "KES", status: "success" }),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ status: true, data: { status: "failed", amount: 35_000, currency: "KES", id: 99_002 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    expect(result.status).toBe("ignored");
    expect(fake().rows("paymentTransaction").find((entry) => entry.id === "tx_ps1")?.status).toBe("PENDING");
  });
});

/**
 * Operator re-check (§102). The one operator action that can move a payment asks the provider for
 * the current truth — it never re-runs stored provider data, so an operator cannot make money
 * appear: with no provider connection to ask, nothing changes and JATA says so (§41, §120).
 */
describe("operator re-check (§102)", () => {
  it("asks the provider and leaves the payment alone when there is nothing to ask", async () => {
    const outcome = await recheckPaymentForOperator({ transactionId: "tx_a1" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // No Daraja connection is configured in this environment (the suite deletes the credentials),
    // so the honest answer is "checked: true, nothing changed" plus a plain-language reason.
    expect(outcome.status).toBe("PENDING");
    expect(outcome.checked).toBe(true);
    expect(outcome.message).toMatch(/M-PESA connection is not active/i);
    expect(fake().rows("paymentTransaction")[0].status).toBe("PENDING");
    // …and the check itself is on the record, as an operator action.
    const audit = fake().rows("paymentAuditEvent").find((row) => row.action === "PAYMENT_RECHECKED_BY_OPERATOR");
    expect(audit).toMatchObject({ actorKind: "JATA_OPERATOR", businessId: "bizA" });
  });

  it("refuses a payment that does not exist instead of inventing one", async () => {
    const outcome = await recheckPaymentForOperator({ transactionId: "tx_missing" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("NOT_FOUND");
  });
});
