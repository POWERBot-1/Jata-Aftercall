/**
 * A refunded wallet sale puts the goods back on the shelf — once (§33, §54, §114).
 *
 * A sale the Payment Wallet settled is refunded through the wallet's own flow, and the POS
 * engine refuses to refund it a second time (`REFUND_VIA_PAYMENTS`) so there is only ever one
 * ledger for that money. That left a gap: the wallet's flow settled the money but knew nothing
 * about stock, so a fully-refunded sale had its cash reversed and its goods quietly gone. The
 * ledger said KES 0 out, the shelf said five units short, and nothing in the business could
 * explain the difference.
 *
 * Stock now comes back with the money, inside the same locked transaction that marks the refund
 * COMPLETED. The per-line claim is a compare-and-set, so a repeated refund, a duplicate provider
 * callback or a POS-side return can each win exactly once and never twice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import prisma from "@/lib/db";
import { effectiveConfiguration, loadConfiguration, saveDraft } from "@/lib/pos/provisioning";
import { createSale, refundSale, restoreRefundedSaleStock, type PosActor } from "@/lib/pos/sales";
import { applyRefundedTotals, resolvePendingProviderRefund } from "@/lib/payments/refunds";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

const retailAnswers = {
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash", "mpesa"],
  keeps_stock: true,
  units: ["piece", "plate"],
  keeps_customers: false,
  has_staff: true,
  staff_count: 1,
  staff_roles: ["CASHIER"],
  tracks_expenses: false,
  has_suppliers: false,
};

function actor(): PosActor {
  return {
    actorId: "userA",
    actorName: "Owner A",
    roleKey: "OWNER",
    permissions: ["CREATE_SALE", "REFUND_SALE", "VOID_SALE", "VIEW_SALES"],
    staffId: null,
    branchId: null,
  };
}

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_wallet_1",
    reference: "jata-pos-wallet-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_wallet_1", reference: "jata-pos-wallet-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_wallet_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

/** A sale of `quantity` chapati that the Payment Wallet settled, and the wallet row that proves it. */
async function walletSale(config: any, quantity = 5) {
  const outcome = await createSale({
    businessId: "bizA",
    business,
    configuration: config,
    actor: actor(),
    request: { items: [{ productId: "p_a1", quantity }], payments: [{ method: "mpesa", amountKES: quantity * 50 }] } as any,
  });
  if (!outcome.ok) throw new Error(`sale setup failed: ${outcome.code} ${outcome.message}`);
  const sale = (outcome as any).sale;
  await prisma.paymentTransaction.create({
    data: {
      id: `tx_${sale.id}`,
      businessId: "bizA",
      posSaleId: sale.id,
      provider: "MPESA",
      method: "mpesa",
      status: "CONFIRMED",
      currency: "KES",
      amountMinor: quantity * 50 * 100,
      amountPaidMinor: quantity * 50 * 100,
      amountRefundedMinor: 0,
      jataPaymentId: `jata_${sale.id}`,
    },
  });
  return sale;
}

const stockOf = (productId = "p_a1") => Number(rows("posInventoryItem").find((row) => row.productId === productId)?.quantity ?? 0);
const returnMovements = () => rows("posInventoryMovement").filter((row) => row.reason === "RETURN");

beforeEach(() => {
  fake().reset();
});

describe("the gap this closes (§54, §114)", () => {
  it("the POS engine still refuses to refund a wallet sale, so there is only one ledger", async () => {
    const config = await goLive();
    const sale = await walletSale(config);
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 100, method: "cash" },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("REFUND_VIA_PAYMENTS");
    // Nothing moved in the POS: the money and the goods both belong to the wallet's flow now.
    expect(rows("posSale")[0].refundedKES).toBe(0);
    expect(returnMovements()).toHaveLength(0);
    expect(stockOf()).toBe(35);
  });
});

describe("a fully refunded wallet sale puts the goods back (§33, §54)", () => {
  it("restores exactly the quantity sold, once", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    expect(stockOf()).toBe(35);

    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    // The refund row the wallet flow has just moved to COMPLETED in its own transaction.
    await prisma.refund.create({
      data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 25_000, currency: "KES", status: "COMPLETED", reason: "Customer changed their mind" },
    });

    const applied = await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 25_000, client: prisma as any });
    expect(applied.status).toBe("FULLY_REFUNDED");
    expect(applied.restored.returnedToStock).toBe(5);
    expect(applied.restored.restoredLines).toBe(1);

    // Every unit came back, exactly once.
    expect(stockOf()).toBe(40);
    expect(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty).toBe(5);
    const movements = returnMovements();
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].delta)).toBe(5);
    expect(movements[0].refType).toBe("SALE");

    // …and the money side is unchanged: one refund row out, the sale marked refunded.
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 250, status: "REFUNDED" });
    expect(rows("posPayment").filter((row) => row.direction === "OUT" && row.purpose === "REFUND")).toHaveLength(1);
  });

  it("a partial refund leaves the goods with the customer", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({
      data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 10_000, currency: "KES", status: "COMPLETED", reason: "Goodwill" },
    });

    const applied = await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 10_000, client: prisma as any });
    expect(applied.status).toBe("PARTIALLY_REFUNDED");
    expect(applied.restored.returnedToStock).toBe(0);
    // Part of the money is back; the customer still has the chapati, so nothing returns to stock.
    expect(stockOf()).toBe(35);
    expect(Number(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty ?? 0)).toBe(0);
    expect(returnMovements()).toHaveLength(0);
    expect(rows("posSale")[0].status).toBe("PARTIALLY_REFUNDED");
  });

  it("a second refund that completes the sale restores the goods then, once", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;

    await prisma.refund.create({ data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 10_000, currency: "KES", status: "COMPLETED", reason: "Part one" } });
    const first = await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 10_000, client: prisma as any });
    expect(first.restored.returnedToStock).toBe(0);
    expect(stockOf()).toBe(35);

    const settled = rows("paymentTransaction").find((row) => row.id === transaction.id)!;
    await prisma.refund.create({ data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 15_000, currency: "KES", status: "COMPLETED", reason: "Part two" } });
    const second = await applyRefundedTotals({ businessId: "bizA", transaction: settled, amountMinor: 15_000, client: prisma as any });
    expect(second.restored.returnedToStock).toBe(5);
    expect(stockOf()).toBe(40);
    expect(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty).toBe(5);
    expect(returnMovements()).toHaveLength(1);
  });

  it("a repeated settlement cannot restore the same units twice", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({ data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 25_000, currency: "KES", status: "COMPLETED", reason: "Full" } });

    await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 25_000, client: prisma as any });
    expect(stockOf()).toBe(40);

    // A duplicated settlement — a retried job, a repeated webhook — reaches the same code path.
    const settled = rows("paymentTransaction").find((row) => row.id === transaction.id)!;
    const again = await applyRefundedTotals({ businessId: "bizA", transaction: settled, amountMinor: 25_000, client: prisma as any });
    expect(again.restored.returnedToStock).toBe(0);
    // The claim is the guard: nothing was left to bring back, so nothing was brought back.
    expect(stockOf()).toBe(40);
    expect(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty).toBe(5);
    expect(returnMovements()).toHaveLength(1);
  });

  it("a POS-side return and a wallet refund cannot both claim the same line", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({ data: { businessId: "bizA", transactionId: transaction.id, provider: "MPESA", amountMinor: 25_000, currency: "KES", status: "COMPLETED", reason: "Full" } });

    // The helper is the engine's own claim, so both paths race on the same statement.
    // A POS-side return (a void, or a return at the counter) claims the line first.
    const first = await restoreRefundedSaleStock({ businessId: "bizA", saleId: sale.id, onlyWhenFullyRefunded: false, client: prisma as any });
    const second = await restoreRefundedSaleStock({ businessId: "bizA", saleId: sale.id, onlyWhenFullyRefunded: false, client: prisma as any });
    expect(first.returnedToStock).toBe(5);
    expect(second.returnedToStock).toBe(0);
    expect(stockOf()).toBe(40);
    expect(returnMovements()).toHaveLength(1);

    // The wallet settlement that follows then finds nothing left to restore.
    const applied = await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 25_000, client: prisma as any });
    expect(applied.restored.returnedToStock).toBe(0);
    expect(stockOf()).toBe(40);
  });

  it("a sale with several lines brings back every line that has units outstanding", async () => {
    const config = await goLive();
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: { items: [{ productId: "p_a1", quantity: 5 }, { productId: "p_a2", quantity: 3 }], payments: [{ method: "mpesa", amountKES: 1000 }] } as any,
    });
    if (!outcome.ok) throw new Error(`sale setup failed: ${outcome.code} ${outcome.message}`);
    const sale = (outcome as any).sale;
    expect(stockOf("p_a1")).toBe(35);
    expect(stockOf("p_a2")).toBe(7);

    const transaction = await prisma.paymentTransaction.create({
      data: { id: "tx_multi", businessId: "bizA", posSaleId: sale.id, provider: "MPESA", method: "mpesa", status: "CONFIRMED", currency: "KES", amountMinor: 100_000, amountPaidMinor: 100_000, amountRefundedMinor: 0, jataPaymentId: "jata_multi" },
    });
    await prisma.refund.create({ data: { businessId: "bizA", transactionId: "tx_multi", provider: "MPESA", amountMinor: 100_000, currency: "KES", status: "COMPLETED", reason: "Wrong order" } });

    const applied = await applyRefundedTotals({ businessId: "bizA", transaction, amountMinor: 100_000, client: prisma as any });
    expect(applied.restored.restoredLines).toBe(2);
    expect(applied.restored.returnedToStock).toBe(8);
    expect(stockOf("p_a1")).toBe(40);
    expect(stockOf("p_a2")).toBe(10);
    expect(returnMovements()).toHaveLength(2);
  });
});

describe("a provider result that is not a success moves nothing (§48, §114)", () => {
  it("a failed reversal leaves the goods sold", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({
      data: {
        businessId: "bizA",
        transactionId: transaction.id,
        provider: "MPESA",
        amountMinor: 25_000,
        currency: "KES",
        status: "PENDING_PROVIDER",
        providerReference: "REF-FAIL-1",
        reason: "Customer changed their mind",
      },
    });

    const outcome = await resolvePendingProviderRefund({ provider: "MPESA", providerReference: "REF-FAIL-1", succeeded: false, amountMinor: 25_000, failureReason: "Customer bank declined" });
    expect(outcome).toMatchObject({ matched: true, kind: "failed" });

    // The money never came back, so the goods stayed sold.
    expect(stockOf()).toBe(35);
    expect(returnMovements()).toHaveLength(0);
    expect(rows("posSale")[0].refundedKES).toBe(0);
    expect(rows("refund").find((row) => row.providerReference === "REF-FAIL-1")!.status).toBe("FAILED");
  });

  it("a pending provider result keeps the reservation without restoring stock", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({
      data: {
        businessId: "bizA",
        transactionId: transaction.id,
        provider: "MPESA",
        amountMinor: 25_000,
        currency: "KES",
        status: "PENDING_PROVIDER",
        providerReference: "REF-PENDING-1",
        reason: "Awaiting provider",
      },
    });

    // Nothing has confirmed it, so nothing may move.
    expect(stockOf()).toBe(35);
    expect(returnMovements()).toHaveLength(0);
    expect(rows("posSale")[0].refundedKES).toBe(0);

    // When the provider does confirm, the goods come back once…
    const settled = await resolvePendingProviderRefund({ provider: "MPESA", providerReference: "REF-PENDING-1", succeeded: true, amountMinor: 25_000 });
    expect(settled).toMatchObject({ matched: true, kind: "settled" });
    expect(stockOf()).toBe(40);
    expect(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty).toBe(5);

    // …and a duplicate delivery of the same provider result changes nothing at all.
    const duplicate = await resolvePendingProviderRefund({ provider: "MPESA", providerReference: "REF-PENDING-1", succeeded: true, amountMinor: 25_000 });
    expect(duplicate).toMatchObject({ matched: true, kind: "duplicate" });
    expect(stockOf()).toBe(40);
    expect(returnMovements()).toHaveLength(1);
    expect(rows("posSaleItem").find((row) => row.saleId === sale.id)!.returnedQty).toBe(5);
    expect(rows("refund").filter((row) => row.status === "COMPLETED")).toHaveLength(1);
  });

  it("a provider result that does not match the reservation restores nothing and raises a review", async () => {
    const config = await goLive();
    const sale = await walletSale(config, 5);
    const transaction = rows("paymentTransaction").find((row) => row.posSaleId === sale.id)!;
    await prisma.refund.create({
      data: {
        businessId: "bizA",
        transactionId: transaction.id,
        provider: "MPESA",
        amountMinor: 25_000,
        currency: "KES",
        status: "PENDING_PROVIDER",
        providerReference: "REF-MISMATCH-1",
        reason: "Awaiting provider",
      },
    });

    const outcome = await resolvePendingProviderRefund({ provider: "MPESA", providerReference: "REF-MISMATCH-1", succeeded: true, amountMinor: 1_000 });
    expect(outcome).toMatchObject({ matched: true, kind: "exception", reason: "REFUND_AMOUNT_MISMATCH" });
    expect(stockOf()).toBe(35);
    expect(returnMovements()).toHaveLength(0);
  });

  it("an unknown provider reference is simply not ours", async () => {
    await goLive();
    const outcome = await resolvePendingProviderRefund({ provider: "MPESA", providerReference: "REF-NEVER-SEEN", succeeded: true, amountMinor: 1_000 });
    expect(outcome).toEqual({ matched: false });
  });
});
