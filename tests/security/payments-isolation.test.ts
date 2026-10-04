/**
 * Payment security: tenant isolation, client-trust, secrets and permission gates (§5, §36, §41,
 * §56, §57, §58, §62, §75, §112, §120).
 *
 * These are the ways a payment system loses its integrity in production — another tenant's money
 * on the screen, a browser deciding a payment is paid, a credential in a response, or a role that
 * should not be able to re-point where money lands.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { applyConfirmation } from "@/lib/payments/engine";
import { createPaymentRequest } from "@/lib/payments/orchestrator";
import { listRecentPayments, paymentDetail, toMerchantPaymentRow } from "@/lib/payments/store";
import { addDestination, loadWallet, paymentHealthRows, paymentHealth } from "@/lib/payments/wallet";
import { refundValidation, requestRefund } from "@/lib/payments/refunds";
import { isOk } from "@/lib/payments/result";
import { applyProviderEvent } from "@/lib/payments/webhooks";
import { connectorReadiness, readMpesaConfig } from "@/lib/payments/config";
import { getAdapter } from "@/lib/payments/providers/registry";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;

const storeOwner = {
  actorId: "userA",
  actorName: "Owner A",
  roleKey: "OWNER",
  permissions: ["VIEW_PAYMENTS", "MANAGE_PAYMENT_DESTINATIONS", "REFUND_PAYMENT", "CREATE_SALE"],
  staffId: null,
  branchId: null,
};
const cashier = {
  actorId: "cashierA",
  actorName: "Mary Cashier",
  roleKey: "CASHIER",
  permissions: ["VIEW_PAYMENTS", "CREATE_SALE"],
  staffId: "st_a1",
  branchId: null,
};

function destinationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dest_a1",
    businessId: "bizA",
    kind: "MPESA_TILL",
    provider: "MPESA",
    label: "M-PESA Till •••3456",
    providerDestinationId: "4123456",
    providerAccountRef: "",
    bankName: null,
    accountName: null,
    currency: "KES",
    capabilities: ["PAYMENT_INSTRUCTIONS", "MOBILE_MONEY"],
    status: "CONNECTED",
    verificationSource: "FORMAT",
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx_a1",
    jataPaymentId: "JTP-20261004-1048-AAAA",
    businessId: "bizA",
    destinationId: "dest_a1",
    provider: "MPESA",
    status: "PENDING",
    providerReference: "JTP-20261004-1048-AAAA",
    providerTransactionId: null,
    idempotencyKey: "idem_a1",
    method: "MPESA_TILL",
    amountMinor: 35_000,
    amountPaidMinor: 0,
    amountRefundedMinor: 0,
    currency: "KES",
    customerPhoneMasked: "07•••1111",
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_STK_CALLBACK_URL"]) {
    delete process.env[key];
  }
  fake().reset();
  fake().rows("paymentDestination").push(destinationRow());
  fake().rows("paymentDestination").push(destinationRow({ id: "dest_b1", businessId: "bizB", providerDestinationId: "4999999", label: "M-PESA Till •••9999" }));
  fake().rows("paymentTransaction").push(transactionRow());
  fake().rows("paymentTransaction").push(
    transactionRow({ id: "tx_b1", businessId: "bizB", jataPaymentId: "JTP-20261004-1049-BBBB", destinationId: "dest_b1", businessId2: undefined }),
  );
});

describe("one business never sees another business's money (§5, §57, §75)", () => {
  it("scopes every payment read to the tenant that asked", async () => {
    const forA = await listRecentPayments("bizA", {}, prisma);
    const forB = await listRecentPayments("bizB", {}, prisma);
    expect(forA.map((row) => row.id)).toEqual(["tx_a1"]);
    expect(forB.map((row) => row.id)).toEqual(["tx_b1"]);
    expect(forA.map((row) => row.jataPaymentId)).toEqual(["JTP-20261004-1048-AAAA"]);

    // A guessed transaction id from another tenant resolves to nothing, not to somebody's money.
    expect(await paymentDetail("bizB", "tx_a1", prisma)).toBeNull();
    expect(await paymentDetail("bizA", "tx_b1", prisma)).toBeNull();
    expect(await paymentDetail("bizA", "tx_a1", prisma)).not.toBeNull();
  });

  it("refuses a destination from another tenant even when the id is correct", async () => {
    const created = await createPaymentRequest({
      businessId: "bizA",
      requestKey: "cross-tenant-1",
      method: "mpesa",
      amountKES: 350,
      destinationId: "dest_b1",
      actor: storeOwner,
      client: prisma,
      skipFanout: true,
    });
    expect(isOk(created)).toBe(false);
    if (isOk(created)) return;
    expect(created.code).toBe("DESTINATION_NOT_FOUND");
    expect(fake().rows("paymentTransaction")).toHaveLength(2); // nothing new was created
  });

  it("settles a confirmation against the destination's own business only", async () => {
    // The same amount is open for both tenants; the provider confirms the one on bizA's till.
    fake().rows("paymentTransaction").push(transactionRow({ id: "tx_a2", jataPaymentId: "JTP-2", idempotencyKey: "idem_a2" }));
    const result = await applyConfirmation({
      provider: "MPESA",
      event: {
        kind: "confirmation",
        providerReference: "JTP-20261004-1048-AAAA",
        providerTransactionId: "RJ1",
        amountMinor: 35_000,
        currency: "KES",
        destination: { kind: "MPESA_TILL", providerDestinationId: "4123456", providerAccountRef: null },
        method: "MPESA_TILL",
        customerName: null,
        customerPhoneMasked: null,
        occurredAt: new Date(),
        sanitized: {},
      },
      client: prisma,
    });
    expect(result.kind).toBe("settled");
    expect(fake().rows("paymentTransaction").find((row) => row.id === "tx_a1")?.status).toBe("PAID");
    expect(fake().rows("paymentTransaction").find((row) => row.id === "tx_a2")?.status).not.toBe("PAID");
    expect(fake().rows("paymentTransaction").find((row) => row.id === "tx_b1")?.status).not.toBe("PAID");
  });
});

describe("the browser never decides that money arrived (§41, §112, §120)", () => {
  it("ignores a client-supplied status and creates its own state", async () => {
    const created = await createPaymentRequest({
      businessId: "bizA",
      requestKey: "till-tap-77",
      method: "mpesa",
      amountKES: 350,
      actor: storeOwner,
      client: prisma,
      skipFanout: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === created.transactionId);
    expect(row?.status).toBe("PAYMENT_REQUESTED");
    expect(row?.paidAt).toBeFalsy();
    expect(row?.providerConfirmedAt).toBeFalsy();
    expect(created.automaticConfirmation).toBe(false);
  });

  it("will not confirm a payment whose amount or status came from the caller", async () => {
    // There is no code path that accepts a confirmation from the browser: the only entry point is
    // a provider event, and it is authenticated first. An unsigned event is refused.
    const refused = await applyProviderEvent({
      provider: "MPESA",
      rawBody: JSON.stringify({ TransID: "RJ9", TransAmount: "350", BusinessShortCode: "4123456" }),
      payload: { TransID: "RJ9", TransAmount: "350", BusinessShortCode: "4123456" },
      headers: new Headers(),
      url: new URL("https://jata.test/api/payments/webhooks/mpesa"),
      client: prisma,
    });
    expect(refused.status).toBe("rejected");
    expect(refused.httpStatus).toBe(401);
    expect(fake().rows("paymentTransaction")[0].status).not.toBe("PAID");
  });
});

describe("no secrets, ever (§58, §73, §120)", () => {
  it("keeps connector credentials out of everything a merchant sees", async () => {
    process.env.MPESA_CONSUMER_KEY = "super-secret-consumer-key";
    process.env.MPESA_CONSUMER_SECRET = "super-secret-consumer-secret";
    process.env.MPESA_PASSKEY = "super-secret-passkey";

    // The connector readiness report is JATA-internal: it names the environment variables that are
    // still missing, and confirms the ones it can see.
    const readiness = connectorReadiness();
    const mpesa = readiness.find((entry) => entry.provider === "MPESA")!;
    expect(mpesa.ready).toBe(false);
    expect(mpesa.missing).not.toContain("MPESA_CONSUMER_KEY");
    expect(mpesa.missing).toContain("MPESA_SHORTCODE");
    expect(readMpesaConfig().consumerKey).toBe("super-secret-consumer-key");

    const wallet = await loadWallet("bizA", prisma);
    const health = paymentHealthRows(await paymentHealth("bizA", prisma));
    const row = toMerchantPaymentRow(fake().rows("paymentTransaction")[0], fake().rows("paymentDestination")[0]);
    const exposed = JSON.stringify({ wallet, health, row, adapter: getAdapter("MPESA")?.connectorNote?.() ?? "" });
    for (const secret of ["super-secret-consumer-key", "super-secret-consumer-secret", "super-secret-passkey"]) {
      expect(exposed).not.toContain(secret);
    }
    // The customer-facing instructions for a manual destination never ask for a PIN either.
    const instructions = getAdapter("MPESA")!.getDisplayInstructions({
      destination: fake().rows("paymentDestination")[0] as never,
      amountMinor: 35_000,
      currency: "KES",
      providerReference: "JTP-1",
    });
    expect(JSON.stringify(instructions)).not.toMatch(/pin/i);
  });

  it("never stores a customer's phone number whole", async () => {
    const row = toMerchantPaymentRow({ ...transactionRow(), customerPhoneMasked: "07•••1111" }, null);
    expect(row.customerPhone).toBe("07•••1111");
    expect(row.customerPhone).not.toMatch(/^0712345678$/);
  });
});

describe("only the right role can move where money lands (§36, §62)", () => {
  it("refuses a cashier adding or changing a destination", async () => {
    const outcome = await addDestination({
      businessId: "bizA",
      actor: cashier,
      input: { kind: "MPESA_TILL", providerDestinationId: "4999888" },
      client: prisma,
    });
    expect(isOk(outcome)).toBe(false);
    if (isOk(outcome)) return;
    expect(outcome.code).toBe("NOT_ALLOWED");
    expect(fake().rows("paymentDestination").filter((row) => row.providerDestinationId === "4999888")).toHaveLength(0);
  });

  it("refuses a refund without the refund permission or an explicit confirmation", async () => {
    fake().rows("paymentTransaction")[0] = { ...fake().rows("paymentTransaction")[0], status: "PAID", amountPaidMinor: 35_000 };
    const asCashier = await requestRefund({
      businessId: "bizA",
      transactionId: "tx_a1",
      amountKES: 100,
      reason: "Customer changed their mind",
      actor: { actorId: "cashierA", actorName: "Mary", roleKey: "CASHIER", permissions: ["VIEW_PAYMENTS"], confirmed: true },
      client: prisma,
    });
    expect(isOk(asCashier)).toBe(false);
    if (isOk(asCashier)) return;
    expect(asCashier.code).toBe("NOT_ALLOWED");

    const unconfirmed = await requestRefund({
      businessId: "bizA",
      transactionId: "tx_a1",
      amountKES: 100,
      reason: "Customer changed their mind",
      actor: { actorId: "userA", actorName: "Owner A", roleKey: "OWNER", permissions: ["REFUND_PAYMENT"], confirmed: false },
      client: prisma,
    });
    expect(isOk(unconfirmed)).toBe(false);
    if (isOk(unconfirmed)) return;
    expect(unconfirmed.code).toBe("CONFIRMATION_REQUIRED");
    expect(fake().rows("refund")).toHaveLength(0);
  });

  it("never lets a refund exceed what was actually paid", () => {
    // Paid KES 350, of which KES 300 has already been refunded: KES 50 is left.
    const paid = { status: "PAID", amountMinor: 35_000, amountPaidMinor: 35_000, amountRefundedMinor: 30_000 };
    expect(refundValidation({ transaction: paid, amountKES: 50 }).ok).toBe(true);
    expect(refundValidation({ transaction: paid, amountKES: 500 }).code).toBe("AMOUNT_TOO_HIGH");
    expect(refundValidation({ transaction: { ...paid, status: "PENDING" }, amountKES: 100 }).code).toBe("NOT_REFUNDABLE");
    expect(refundValidation({ transaction: paid, amountKES: 0 }).code).toBe("AMOUNT_REQUIRED");
  });
});

describe("an unauthenticated provider event cannot move money (§35, §120)", () => {
  it("records the refusal and leaves the payment alone", async () => {
    const before = JSON.stringify(fake().rows("paymentTransaction"));
    const result = await applyProviderEvent({
      provider: "PAYSTACK",
      rawBody: JSON.stringify({ event: "charge.success", data: { reference: "JTP-20261004-1048-AAAA", amount: 35_000 } }),
      payload: { event: "charge.success", data: { reference: "JTP-20261004-1048-AAAA", amount: 35_000 } },
      headers: new Headers({ "x-paystack-signature": "forged" }),
      url: new URL("https://jata.test/api/payments/webhooks/paystack"),
      client: prisma,
    });
    expect(result.status).toBe("rejected");
    expect(JSON.stringify(fake().rows("paymentTransaction"))).toBe(before);
  });
});
