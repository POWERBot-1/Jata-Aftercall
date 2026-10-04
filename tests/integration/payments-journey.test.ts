/**
 * The JATA Payment Wallet journey (§21, §25, §33, §43, §67, §98).
 *
 * A till asks for a payment → JATA routes it to the merchant's own destination and hands the
 * customer honest instructions → the provider's confirmation arrives → the POS sale, the stock,
 * the receipt, the reconciliation record and the notifications all commit together → the same
 * confirmation arriving twice changes nothing.
 *
 * The database is the in-memory fake, so the real engine runs: no mocked state machine, no stub
 * settlement, and no place for a browser to declare that money arrived.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { applyConfirmation, applyReversal, expireStalePayments } from "@/lib/payments/engine";
import { isOk } from "@/lib/payments/result";
import { createPaymentRequest } from "@/lib/payments/orchestrator";
import { applyTemplate, getTemplate } from "@/lib/pos/templates";
import { markAwaitingPayment, saveDraft } from "@/lib/pos/provisioning";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };
const ownerActor = {
  actorId: "userA",
  actorName: "Owner A",
  roleKey: "OWNER",
  permissions: ["CREATE_SALE", "VIEW_PAYMENTS", "MANAGE_PAYMENT_DESTINATIONS", "REFUND_PAYMENT"],
  staffId: null,
  branchId: null,
};

const CAPABILITIES = [
  "PAYMENT_INITIATION",
  "REAL_TIME_CONFIRMATION",
  "WEBHOOKS",
  "STATUS_QUERY",
  "REFUNDS",
  "REVERSALS",
  "MOBILE_MONEY",
  "PAYMENT_INSTRUCTIONS",
];

async function provisionLiveBusiness() {
  await saveDraft({
    businessId: "bizA",
    answers: applyTemplate(getTemplate("RETAIL_BASIC")!, {}),
    actorId: "userA",
    context: { businessName: business.name },
  });
  await markAwaitingPayment("bizA", "userA");
  fake().rows("payment").push({
    id: "pay_pos_1",
    reference: "jata-pos-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_pos_1", reference: "jata-pos-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_pos_1",
      verification: { paystackId: "ps_pos_1" },
    }),
  );

  fake().rows("paymentDestination").push({
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
    capabilities: CAPABILITIES,
    status: "CONNECTED",
    verificationSource: "LIVE",
    isPrimary: true,
    isActive: true,
    createdAt: new Date(),
  });
  fake().rows("paymentProviderConnection").push({
    id: "conn_a1",
    businessId: "bizA",
    provider: "MPESA",
    status: "CONNECTED",
    healthy: true,
    detail: "JATA holds this connection for your business.",
    lastEventAt: null,
    createdAt: new Date(),
  });
}

/** The confirmation a provider would deliver for a payment JATA requested. */
function confirmationFor(row: any, overrides: Record<string, unknown> = {}) {
  return {
    kind: "confirmation" as const,
    providerReference: row.providerReference,
    providerTransactionId: "RJ12ABC789",
    amountMinor: row.amountMinor,
    currency: row.currency,
    destination: { kind: "MPESA_TILL" as const, providerDestinationId: "4123456", providerAccountRef: null },
    method: "MPESA_TILL",
    customerName: "Jane Wanjiku",
    customerPhoneMasked: "07•••1111",
    occurredAt: new Date(),
    sanitized: { TransID: "RJ12ABC789" },
    ...overrides,
  };
}

function requestSale(requestKey = "till-tap-1") {
  return createPaymentRequest({
    businessId: "bizA",
    requestKey,
    method: "mpesa",
    sale: {
      request: { items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }], payments: [] },
      business,
      configurationVersion: 1,
      configurationFingerprint: null,
    },
    actor: ownerActor,
    client: prisma,
    skipFanout: true,
  });
}

beforeEach(async () => {
  // The deployment in this test has no live M-PESA connector credentials: JATA must say so plainly
  // and hand out real payment instructions instead of pretending it can watch the till (§16, §120).
  for (const key of ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_STK_CALLBACK_URL", "MPESA_ENV", "MPESA_CALLBACK_TOKEN"]) {
    delete process.env[key];
  }
  fake().reset();
  await provisionLiveBusiness();
});

describe("asking for a payment (§20, §21, §33)", () => {
  it("prices the cart on the server and tells the customer exactly where to pay", async () => {
    const outcome = await requestSale();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 2 × Chapati (50) + 1 × Pilau (250) = 350, priced by the same engine that records the sale.
    expect(outcome.amountKES).toBe(350);
    expect(outcome.status).toBe("PAYMENT_REQUESTED");
    expect(outcome.destinationLabel).toContain("3456");
    expect(outcome.instructions.body.length).toBeGreaterThan(10);
    expect(JSON.stringify(outcome.instructions)).toContain("4123456");

    // No live connector: JATA says confirmation is not automatic rather than implying it is.
    expect(outcome.automaticConfirmation).toBe(false);

    const row = fake().rows("paymentTransaction")[0];
    expect(row.amountMinor).toBe(35_000);
    expect(row.businessId).toBe("bizA");
    expect(row.providerTransactionId).toBeNull();
    expect(row.status).toBe("PAYMENT_REQUESTED");
    expect(fake().rows("paymentAttempt")[0].status).toBe("ACCEPTED");
  });

  it("returns the same payment for a double tap instead of starting a second one (§33)", async () => {
    const first = await requestSale("till-tap-9");
    const second = await requestSale("till-tap-9");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(fake().rows("paymentTransaction")).toHaveLength(1);
  });

  it("refuses to request money when the business has not said where it gets paid", async () => {
    fake().rows("paymentDestination").forEach((row) => {
      row.isActive = false;
      row.status = "DISCONNECTED";
    });
    const outcome = await requestSale("till-tap-none");
    expect(isOk(outcome)).toBe(false);
    if (isOk(outcome)) return;
    expect(outcome.code).toBe("NO_DESTINATION");
    expect(outcome.message).toMatch(/where your customers pay/i);
    expect(fake().rows("paymentTransaction")).toHaveLength(0);
  });
});

describe("a provider confirmation settles the sale exactly once (§25, §33, §43, §98)", () => {
  it("creates the sale, the stock movements, the receipt and the reconciliation in one step", async () => {
    const requested = await requestSale();
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const row = fake().rows("paymentTransaction")[0];
    const result = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma });
    expect(result.kind).toBe("settled");

    const sale = fake().rows("posSale")[0];
    expect(sale.totalKES).toBe(350);
    expect(sale.status).toBe("COMPLETED");
    expect(fake().rows("posPayment").some((payment) => payment.direction === "IN" && Number(payment.amountKES) === 350)).toBe(true);

    const settled = fake().rows("paymentTransaction")[0];
    expect(settled.status).toBe("PAID");
    expect(settled.posSaleId).toBe(sale.id);
    expect(settled.receiptNumber).toBeTruthy();
    expect(settled.receiptToken).toBeTruthy();
    expect(settled.providerTransactionId).toBe("RJ12ABC789");
    expect(settled.paidAt).toBeTruthy();

    // Stock moved because the sale moved: 2 chapatis and 1 pilau left the shelf.
    const movements = fake().rows("posInventoryMovement");
    expect(movements.some((movement) => movement.productId === "p_a1" && Number(movement.delta) === -2)).toBe(true);
    expect(movements.some((movement) => movement.productId === "p_a2" && Number(movement.delta) === -1)).toBe(true);

    // Matched reconciliation, plus notifications queued for the people who need to know.
    expect(fake().rows("paymentReconciliation").some((entry) => entry.result === "MATCHED")).toBe(true);
    expect(fake().rows("paymentNotification").length).toBeGreaterThan(0);
    expect(fake().rows("paymentAuditEvent").map((event) => event.action)).toContain("PAYMENT_SETTLED");
  });

  it("ignores the same confirmation arriving again — one payment, one financial effect", async () => {
    await requestSale();
    const row = fake().rows("paymentTransaction")[0];
    const first = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma });
    const second = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma });
    expect(first.kind).toBe("settled");
    expect(second.kind).toBe("duplicate");
    expect(fake().rows("posSale")).toHaveLength(1);
    expect(fake().rows("posPayment").filter((payment) => payment.direction === "IN")).toHaveLength(1);
  });

  it("prices the sale again at settlement and refuses to book a different amount (§42, §98)", async () => {
    await requestSale();
    const row = fake().rows("paymentTransaction")[0];
    const result = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row, { amountMinor: 40_000 }), client: prisma });
    expect(result.kind).toBe("amount_mismatch");
    expect(fake().rows("posSale")).toHaveLength(0);
    expect(fake().rows("paymentTransaction")[0].status).not.toBe("PAID");
    expect(fake().rows("paymentReconciliation").some((entry) => entry.result === "AMOUNT_MISMATCH")).toBe(true);
  });

  it("still settles a payment JATA had stopped waiting for (§68)", async () => {
    await requestSale();
    const row = fake().rows("paymentTransaction")[0];
    // JATA stops waiting…
    await prisma.paymentTransaction.updateMany({ where: { id: row.id }, data: { status: "PENDING", expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await expireStalePayments({ businessId: "bizA", client: prisma });
    expect(expired.expired).toBe(1);
    expect(fake().rows("paymentTransaction")[0].status).toBe("EXPIRED");

    // …and the customer's money still arrives. Expiry is not a verdict.
    const result = await applyConfirmation({ provider: "MPESA", event: confirmationFor(fake().rows("paymentTransaction")[0]), client: prisma });
    expect(result.kind).toBe("settled");
    expect(fake().rows("paymentTransaction")[0].status).toBe("PAID");
  });

  it("never settles a payment twice across two different sales", async () => {
    await requestSale("till-tap-A");
    const firstRow = fake().rows("paymentTransaction")[0];
    await applyConfirmation({ provider: "MPESA", event: confirmationFor(firstRow), client: prisma });

    await requestSale("till-tap-B");
    const secondRow = fake().rows("paymentTransaction")[1];
    const result = await applyConfirmation({ provider: "MPESA", event: confirmationFor(secondRow), client: prisma });

    expect(result.kind).toBe("settled");
    expect(fake().rows("posSale")).toHaveLength(2);
    // Each sale carries exactly one provider-confirmed payment row, and the two payments are distinct.
    expect(fake().rows("posPayment").filter((payment) => payment.direction === "IN")).toHaveLength(2);
    expect(fake().rows("paymentTransaction")[0].posSaleId).not.toBe(fake().rows("paymentTransaction")[1].posSaleId);
  });
});

describe("money going back is additive (§47, §48, §114)", () => {
  it("records a provider reversal without rewriting what happened", async () => {
    await requestSale();
    const row = fake().rows("paymentTransaction")[0];
    await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma });
    const paidRow = fake().rows("paymentTransaction")[0];
    const saleBefore = { ...fake().rows("posSale")[0] };

    const reversed = await applyReversal({
      provider: "MPESA",
      event: {
        kind: "reversal",
        providerReference: paidRow.providerReference,
        providerTransactionId: paidRow.providerTransactionId,
        amountMinor: paidRow.amountMinor,
        reason: "Customer reversed the transaction with the provider.",
        sanitized: {},
      },
      client: prisma,
    });

    expect(reversed.kind).toBe("settled");
    const after = fake().rows("paymentTransaction")[0];
    expect(after.status).toBe("REVERSED");
    // The original amounts are untouched; the reversal is its own record.
    expect(after.amountMinor).toBe(paidRow.amountMinor);
    expect(after.amountRefundedMinor).toBe(paidRow.amountMinor);
    expect(fake().rows("posSale")[0].totalKES).toBe(saleBefore.totalKES);
    expect(fake().rows("posSale")[0].status).toBe("REVERSED");
    expect(fake().rows("posPayment").some((payment) => payment.direction === "OUT" && payment.purpose === "REFUND")).toBe(true);
    expect(fake().rows("paymentAuditEvent").map((event) => event.action)).toContain("PAYMENT_REVERSED");
  });
});
