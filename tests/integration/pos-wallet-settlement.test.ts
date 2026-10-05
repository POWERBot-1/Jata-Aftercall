/**
 * Wallet POS settlement (§30, §112) — the regression the till used to fail.
 *
 * The cashier picks a wallet destination, JATA asks the provider, and when the provider
 * confirmation arrives the sale, the stock and the receipt must commit — with the sale paying
 * with "wallet", the method the customer actually paid with. Before the settlement path existed,
 * the provider-confirmed amount could not be booked: "wallet" is not a till payment method, so
 * the confirmed money arrived with no sale, no stock movement and no receipt.
 *
 * The deliberate rule under test: "wallet" is admitted as a tender only when the payment engine
 * settles a provider-confirmed transaction. The till's own routes must still refuse it — a
 * browser can never declare a sale paid by wallet.
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
import { isOk } from "@/lib/payments/result";
import { createSale, type PosActor } from "@/lib/pos/sales";
import { applyTemplate, getTemplate } from "@/lib/pos/templates";
import { loadConfiguration, markAwaitingPayment, saveDraft } from "@/lib/pos/provisioning";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { effectiveConfiguration } from "@/lib/pos/provisioning";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };
const ownerActor: PosActor = {
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

/** The confirmation a provider would deliver for a wallet payment JATA requested. */
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

/** Exactly what the wallet panel does: a counter sale, paid into the merchant's own wallet. */
function requestWalletSale(requestKey = "wallet-tap-1") {
  return createPaymentRequest({
    businessId: "bizA",
    requestKey,
    method: "wallet",
    destinationId: "dest_a1",
    sale: {
      // 2 × Chapati (50) + 1 × Pilau (250) = 350, priced by the server.
      request: { items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }], payments: [] },
      business,
      configurationVersion: 1,
      configurationFingerprint: null,
    },
    actor: ownerActor,
    client: prisma,
    skipFanout: true,
  } as never);
}

async function liveConfiguration() {
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

beforeEach(async () => {
  fake().reset();
  await provisionLiveBusiness();
});

describe("a provider-confirmed wallet payment settles the sale (§112)", () => {
  it("creates the sale, moves stock and books the payment as wallet", async () => {
    const created = await requestWalletSale();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.status).toBe("PAYMENT_REQUESTED");
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === created.transactionId)!;
    // The row carries the initiation method (a manual till), but the captured POS context keeps
    // the method the till asked for — that is what the settlement must book.
    const posContext = typeof row.paymentContext === "string" ? JSON.parse(row.paymentContext) : row.paymentContext;
    expect(posContext.pos.method).toBe("wallet");

    const result = await applyConfirmation({
      provider: "MPESA",
      event: confirmationFor(row),
      client: prisma,
      skipFanout: true,
    });

    expect(result.kind).toBe("settled");
    if (result.kind !== "settled") return;
    expect(result.status).toBe("PAID");
    expect(result.saleId).toBeTruthy();

    const sale = fake().rows("posSale").find((entry) => entry.id === result.saleId)!;
    expect(sale.businessId).toBe("bizA");
    expect(sale.totalKES).toBe(350);
    expect(sale.paidKES).toBe(350);
    expect(sale.status).toBe("COMPLETED");

    // The money row records what actually happened: wallet money in, settled, one row.
    const payment = fake().rows("posPayment").find((entry) => entry.saleId === sale.id)!;
    expect(payment.direction).toBe("IN");
    expect(payment.purpose).toBe("SALE");
    expect(payment.method).toBe("wallet");
    expect(payment.amountKES).toBe(350);
    expect(payment.status).toBe("SETTLED");

    // Stock left with the sale.
    const movements = fake().rows("posInventoryMovement").filter((entry) => entry.refType === "SALE");
    expect(movements.length).toBe(2);
    expect(movements.map((entry) => entry.delta).reduce((a, b) => a + b, 0)).toBe(-3);

    // The provider row and the sale point at each other.
    const txRow = fake().rows("paymentTransaction").find((entry) => entry.id === row.id)!;
    expect(txRow.status).toBe("PAID");
    expect(txRow.posSaleId).toBe(sale.id);
  });

  it("refuses a second confirmation of the same money — no second sale, no second stock movement", async () => {
    const created = await requestWalletSale();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === created.transactionId)!;

    const first = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma, skipFanout: true });
    expect(first.kind).toBe("settled");
    const saleCount = fake().rows("posSale").length;

    const second = await applyConfirmation({ provider: "MPESA", event: confirmationFor(row), client: prisma, skipFanout: true });
    expect(second.kind).toBe("duplicate");
    expect(fake().rows("posSale").length).toBe(saleCount);
    const saleId = first.kind === "settled" ? first.saleId : null;
    expect(fake().rows("posPayment").filter((entry) => entry.saleId === saleId).length).toBe(1);
    expect(
      fake().rows("posInventoryMovement").filter((entry) => entry.refType === "SALE").map((entry) => entry.delta).reduce((a, b) => a + b, 0),
    ).toBe(-3);
  });

  it("does not book the sale when the confirmed amount differs from the request", async () => {
    const created = await requestWalletSale();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === created.transactionId)!;

    const result = await applyConfirmation({
      provider: "MPESA",
      event: confirmationFor(row, { amountMinor: row.amountMinor + 100 }),
      client: prisma,
      skipFanout: true,
    });
    expect(result.kind).toBe("amount_mismatch");
    expect(fake().rows("posSale").length).toBe(0);
    expect(fake().rows("posInventoryMovement").length).toBe(0);
  });
});

describe("the till can never declare a sale paid by wallet (§112)", () => {
  it("refuses a wallet tender on a direct sale", async () => {
    const configuration = await liveConfiguration();
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration,
      actor: ownerActor,
      request: {
        items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }],
        payments: [{ method: "wallet", amountKES: 350 }],
      },
      client: prisma,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("METHOD_NOT_ALLOWED");
    expect(fake().rows("posSale").length).toBe(0);
    expect(fake().rows("posInventoryMovement").length).toBe(0);
  });

  it("does not treat a zero-amount wallet line as payment", async () => {
    const configuration = await liveConfiguration();
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration,
      actor: ownerActor,
      request: {
        items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }],
        payments: [{ method: "wallet", amountKES: 0 }],
      },
      client: prisma,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("SHORT_PAYMENT");
    expect(fake().rows("posSale").length).toBe(0);
  });

  it("refuses a wallet tender carrying a forged settlement reference", async () => {
    // The settlement flag names a provider-confirmed transaction; a caller that names a
    // transaction that does not exist (or belongs to no confirmation) must be refused before any
    // row is written — the flag is not a back door into "wallet" payments (§112).
    const configuration = await liveConfiguration();
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration,
      actor: ownerActor,
      request: {
        items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }],
        payments: [{ method: "wallet", amountKES: 350, reference: "forged" }],
      },
      client: prisma,
      options: { walletSettlement: { transactionId: "does-not-exist" } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("WALLET_SETTLEMENT_UNCONFIRMED");
    expect(fake().rows("posSale").length).toBe(0);
    expect(fake().rows("posInventoryMovement").length).toBe(0);
  });

  it("refuses a wallet settlement against a transaction of another tenant", async () => {
    // A confirmed transaction of business B can never settle a sale of business A (§56, §112).
    const configuration = await liveConfiguration();
    const created = await requestWalletSale("wallet-other-tenant");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = fake().rows("paymentTransaction").find((entry) => entry.id === created.transactionId)!;

    const otherTenantTx = {
      id: "tx_b9",
      jataPaymentId: "JTP-B9",
      businessId: "bizB",
      status: "CONFIRMED",
      amountMinor: row.amountMinor,
      posSaleId: null,
      method: "wallet",
      providerReference: "JTP-B9-REF",
    };
    fake().rows("paymentTransaction").push(otherTenantTx as never);

    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration,
      actor: ownerActor,
      request: {
        items: [{ productId: "p_a1", quantity: 2 }, { productId: "p_a2", quantity: 1 }],
        payments: [{ method: "wallet", amountKES: 350, reference: "tx_b9" }],
      },
      client: prisma,
      options: { walletSettlement: { transactionId: "tx_b9" } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("WALLET_SETTLEMENT_UNCONFIRMED");
    expect(fake().rows("posSale").length).toBe(0);
  });
});
