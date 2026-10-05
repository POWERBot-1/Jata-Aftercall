/**
 * POS sale refund integrity (§30, §33, §54, §56, §112) — the regression the old engine had.
 *
 * The old refund read the sale once, trusted `paidKES`, capped a per-line return against a stale
 * quantity and let a credit-funded sale come back out of the till as cash. This suite drives the
 * real engine against the in-memory database and proves the corrected rules:
 *
 * - money only comes back where it went in: the cash part is capped by what the till collected
 *   and the credit part is capped by the sale's own balance — a credit refund never produces cash;
 * - a line can only ever be returned up to the quantity sold, enforced atomically per line;
 * - a refund asking for more than is left is refused, and a second refund sees the first;
 * - a sale the payment wallet settled is refused here — its refund runs through the wallet;
 * - a refund built on a stale snapshot is refused by the compare-and-set, not double-paid;
 * - tenant scoping and the REFUND_SALE / VOID_SALE permissions hold on the engine itself.
 *
 * True multi-connection races (two transactions, real row locks) need PostgreSQL; the
 * compare-and-set they protect is exercised here by interleaved commits on the shared rows.
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
import { createSale, refundSale, type PosActor } from "@/lib/pos/sales";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

const retailAnswers = {
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "sometimes",
  credit_limit: 2000,
  credit_terms_days: 30,
  keeps_stock: true,
  units: ["piece", "plate"],
  keeps_customers: true,
  repeat_customers: true,
  has_staff: true,
  staff_count: 1,
  staff_roles: ["CASHIER"],
  tracks_expenses: true,
  expense_categories: ["supplies"],
  has_suppliers: true,
  supplier_payment_methods: ["cash", "mpesa"],
};

function actor(extra: Partial<PosActor> = {}): PosActor {
  return {
    actorId: "userA",
    actorName: "Owner A",
    roleKey: "OWNER",
    permissions: ["CREATE_SALE", "REFUND_SALE", "VOID_SALE", "VIEW_SALES"],
    staffId: null,
    branchId: null,
    ...extra,
  };
}

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_refund_1",
    reference: "jata-pos-refund-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_refund_1", reference: "jata-pos-refund-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_refund_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

async function makeSale(config: any, request: Record<string, unknown>) {
  const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: request as any });
  if (!outcome.ok) throw new Error(`sale setup failed: ${outcome.code} ${outcome.message}`);
  return outcome.sale as any;
}

const cashSale = (config: any, totalKES: number) =>
  makeSale(config, {
    items: [{ productId: "p_a1", quantity: totalKES / 50 }],
    payments: [{ method: "cash", amountKES: totalKES }],
  });

beforeEach(() => {
  fake().reset();
});

describe("refund accounting follows where the money came from (§30, §54)", () => {
  it("refunds a cash sale out of the till, and only as much as was collected", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);

    const first = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 60, method: "cash" },
    });
    expect(first.ok).toBe(true);
    expect(first.refundedKES).toBe(60);
    expect(rows("posPayment").filter((row) => row.direction === "OUT" && row.purpose === "REFUND")).toHaveLength(1);
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 60, creditRefundedKES: 0, status: "PARTIALLY_REFUNDED" });

    // The second refund sees the first: only 40 is left, so 40 goes out and the sale is done.
    const second = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 40, method: "cash" },
    });
    expect(second.ok).toBe(true);
    expect(second.refundedKES).toBe(40);
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 100, status: "REFUNDED" });

    // A third asks for money that is all back already: refused, nothing moves.
    const third = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 1, method: "cash" },
    });
    expect(third.ok).toBe(false);
    expect(third.code).toBe("REFUND_INVALID");
    expect(rows("posSale")[0].refundedKES).toBe(100);
  });

  it("never refunds more than was collected, whatever the browser asks", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    const over = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 5000, method: "cash" },
    });
    expect(over.ok).toBe(false);
    expect(over.code).toBe("REFUND_INVALID");
    expect(rows("posSale")[0].refundedKES).toBe(0);
    expect(rows("posPayment").filter((row) => row.direction === "OUT")).toHaveLength(0);
  });

  it("refunds a credit-funded sale to the customer's account, never to the till (§30)", async () => {
    const config = await goLive();
    const sale = await makeSale(config, {
      items: [{ productId: "p_a2", quantity: 2 }], // 500 KES
      payments: [{ method: "credit", amountKES: 500 }],
      customerId: "c_a1",
    });
    // Credit counts as "paid" on the sale row; what the customer owes is on the receivable.
    expect(rows("posSale")[0].paidKES).toBe(500);
    expect(rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(500);
    // No IN payment row: the money was never collected.
    expect(rows("posPayment").filter((row) => row.direction === "IN")).toHaveLength(0);

    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "cash", reason: "Order cancelled" },
    });
    expect(result.ok).toBe(true);
    expect(result.refundedKES).toBe(500);

    // The whole refund went to the credit ledger — the till paid out nothing, because it
    // collected nothing.
    const stored = rows("posSale")[0];
    expect(stored).toMatchObject({ refundedKES: 500, creditRefundedKES: 500, status: "REFUNDED" });
    expect(rows("posPayment").filter((row) => row.direction === "OUT" && row.purpose === "REFUND")).toHaveLength(0);
    expect(rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(0);
    const creditEntry = rows("posCreditEntry").find((row) => row.direction === "CREDIT" && row.saleId === sale.id);
    expect(creditEntry).toBeTruthy();
    expect(Number(creditEntry!.amountKES)).toBe(500);
  });

  it("splits a mixed sale: cash back to the till, the credit part to the account", async () => {
    const config = await goLive();
    const sale = await makeSale(config, {
      items: [{ productId: "p_a2", quantity: 2 }], // 500 KES
      payments: [{ method: "cash", amountKES: 300 }, { method: "credit", amountKES: 200 }],
      customerId: "c_a1",
    });
    // 300 came in cash, 200 went onto the customer's account.
    expect(rows("posSale")[0]).toMatchObject({ paidKES: 500 });
    expect(rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(200);

    // Ask for the whole 500 back. Only 300 may leave the till.
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "cash" },
    });
    expect(result.ok).toBe(true);
    expect(result.refundedKES).toBe(500);

    const out = rows("posPayment").filter((row) => row.direction === "OUT" && row.purpose === "REFUND");
    expect(out).toHaveLength(1);
    expect(Number(out[0].amountKES)).toBe(300);
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 500, creditRefundedKES: 200, status: "REFUNDED" });
    expect(rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(0);
  });

  it("refuses to refund a sale the payment wallet settled (§112)", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    // A wallet transaction that settled this sale — the wallet's refund flow owns this money.
    rows("paymentTransaction").push({
      id: "wallet_tx_1",
      businessId: "bizA",
      posSaleId: sale.id,
      status: "CONFIRMED",
      amountMinor: 10_000,
      amountPaidMinor: 10_000,
      amountRefundedMinor: 0,
    });
    const refused = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50, method: "cash" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("REFUND_VIA_PAYMENTS");
    expect(rows("posSale")[0].refundedKES).toBe(0);
  });
});

describe("per-line returns stop at the quantity sold (§54)", () => {
  it("lets a line come back in two refunds, but never past what was sold", async () => {
    const config = await goLive();
    const sale = await makeSale(config, {
      items: [{ productId: "p_a1", quantity: 5 }], // 250 KES
      payments: [{ method: "cash", amountKES: 250 }],
    });
    const item = rows("posSaleItem")[0];

    const first = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 150, method: "cash", items: [{ saleItemId: item.id, quantity: 3 }] },
    });
    expect(first.ok).toBe(true);
    expect(first.returnedToStock).toBe(3);
    expect(rows("posSaleItem")[0].returnedQty).toBe(3);

    // Three are gone, two remain. Asking for four more still gets exactly two.
    const second = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50, method: "cash", items: [{ saleItemId: item.id, quantity: 4 }] },
    });
    expect(second.ok).toBe(true);
    expect(second.returnedToStock).toBe(2);
    expect(second.warnings.join(" ")).toContain("left to return");
    expect(rows("posSaleItem")[0].returnedQty).toBe(5);

    // Nothing is left to return, with or without an amount.
    const third = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 0, method: "cash", items: [{ saleItemId: item.id, quantity: 1 }] },
    });
    expect(third.ok).toBe(false);
    expect(third.code).toBe("NOTHING_TO_REFUND");
    expect(rows("posSaleItem")[0].returnedQty).toBe(5);
    // Stock: 40 − 5 sold + 3 + 2 returned = 40. Every unit came back exactly once, no more.
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(40);
  });

  it("ignores an item id the sale does not have", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 0, method: "cash", items: [{ saleItemId: "not_on_this_sale", quantity: 2 }] },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOTHING_TO_REFUND");
  });
});

describe("refunds cannot both spend the same money (§54)", () => {
  it("the second refund sees the first: the ledger cap, not the request, decides", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);

    const first = await refundSale({ businessId: "bizA", configuration: config, actor: actor(), request: { saleId: sale.id, amountKES: 60, method: "cash" } });
    expect(first.ok).toBe(true);

    // Built on the belief that 100 was still refundable, but the current ledger says 40 — the
    // over-ask is refused and the till has already paid out 60 exactly once, never 120.
    const second = await refundSale({ businessId: "bizA", configuration: config, actor: actor(), request: { saleId: sale.id, amountKES: 60, method: "cash" } });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("REFUND_INVALID");
    expect(rows("posSale")[0].refundedKES).toBe(60);
    expect(rows("posPayment").filter((row) => row.direction === "OUT" && row.purpose === "REFUND")).toHaveLength(1);
  });

  it("re-reads the sale under the lock: a void that lands mid-refund is seen, not overwritten", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    // Simulate a void that committed before this refund's re-read: the engine must answer
    // against the current row, not the one it cached.
    rows("posSale")[0].status = "VOIDED";
    const refused = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50, method: "cash" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("ALREADY_VOIDED");
  });
});

describe("a void reverses the whole sale, once", () => {
  it("takes back every remaining unit and every left unit of money", async () => {
    const config = await goLive();
    const sale = await makeSale(config, {
      items: [{ productId: "p_a1", quantity: 4 }], // 200 KES
      payments: [{ method: "cash", amountKES: 200 }],
    });
    await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50, method: "cash", items: [{ saleItemId: rows("posSaleItem")[0].id, quantity: 1 }] },
    });

    const voided = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 0, method: "cash" },
      action: "POS_SALE_VOIDED",
    });
    expect(voided.ok).toBe(true);
    expect(voided.returnedToStock).toBe(3);
    expect(rows("posSale")[0]).toMatchObject({ status: "VOIDED", refundedKES: 200 });
    expect(rows("posSaleItem")[0].returnedQty).toBe(4);

    const again = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 0, method: "cash" },
      action: "POS_SALE_VOIDED",
    });
    expect(again.ok).toBe(false);
    expect(again.code).toBe("ALREADY_VOIDED");
  });
});

describe("the refund engine is the tenant's and the role's (§5, §36, §56)", () => {
  it("refuses a refund another tenant's sale would touch, with the same answer as a missing one", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    const foreign = await refundSale({
      businessId: "bizB",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50, method: "cash" },
    });
    const missing = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: "nope", amountKES: 50, method: "cash" },
    });
    expect(foreign.ok).toBe(false);
    expect(foreign.code).toBe("SALE_NOT_FOUND");
    expect(missing.code).toBe("SALE_NOT_FOUND");
    expect(foreign.message).toBe(missing.message);
  });

  it("refuses a role without REFUND_SALE, and a void without VOID_SALE", async () => {
    const config = await goLive();
    const sale = await cashSale(config, 100);
    const cashier = actor({ actorId: "cashierA", actorName: "Mary Cashier", roleKey: "CASHIER", permissions: ["CREATE_SALE", "VIEW_SALES"], branchId: null });
    const refused = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: cashier,
      request: { saleId: sale.id, amountKES: 50, method: "cash" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("NOT_ALLOWED");
    expect(rows("posSale")[0].refundedKES).toBe(0);

    const noVoid = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor({ permissions: ["CREATE_SALE", "VIEW_SALES", "REFUND_SALE"] }),
      request: { saleId: sale.id, amountKES: 0, method: "cash" },
      action: "POS_SALE_VOIDED",
    });
    expect(noVoid.ok).toBe(false);
    expect(noVoid.code).toBe("NOT_ALLOWED");
  });
});

/**
 * The same-moment race against real PostgreSQL, where the two refunds run in separate database
 * transactions and the sale's row lock is what serialises them. Skipped wherever
 * DATABASE_URL is absent — it cannot be faked honestly on the in-memory double.
 */
const postgresEnabled = Boolean(process.env.DATABASE_URL?.trim());
const pgStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!postgresEnabled)("POS refund race with real PostgreSQL", () => {
  it("two full refunds in the same moment: one commits, the other is refused, the till pays once", async () => {
    const { baselineConfiguration } = await import("@/lib/pos/configuration");
    const config = baselineConfiguration();

    const user = await prisma.user.create({
      data: { email: `refund-race-${pgStamp}@example.test`, name: "Race Owner", passwordHash: "not-a-real-login" },
    });
    const business = await prisma.business.create({
      data: { ownerId: user.id, slug: `refund-race-${pgStamp}`, name: "Refund Race", category: "retail" },
    });
    const productId = (
      await prisma.posProduct.create({
        data: { businessId: business.id, name: "Chapati", kind: "PRODUCT", priceKES: 50, costKES: 20, unitKey: "piece", trackInventory: true, isActive: true },
      })
    ).id;
    await prisma.posInventoryItem.create({
      data: { businessId: business.id, productId, branchId: "", quantity: 100 },
    });
    await prisma.posCustomer.create({
      data: { businessId: business.id, name: "Jane Wanjiku", phone: `+2547${pgStamp.slice(0, 8)}`, balanceKES: 0, creditEnabled: false, creditLimitKES: 0 },
    });

    const raceActor: PosActor = {
      actorId: user.id,
      actorName: "Race Owner",
      roleKey: "OWNER",
      permissions: ["CREATE_SALE", "REFUND_SALE", "VOID_SALE", "VIEW_SALES"],
      staffId: null,
      branchId: null,
    };
    const saleOutcome = await createSale({
      businessId: business.id,
      business: { name: "Refund Race", phone: null, whatsapp: null, location: null, logoUrl: null, email: null },
      configuration: config,
      actor: raceActor,
      request: { items: [{ productId, quantity: 2 }], payments: [{ method: "cash", amountKES: 100 }] },
    });
    if (!saleOutcome.ok) throw new Error(`PG sale setup failed: ${saleOutcome.code}`);
    const saleId = (saleOutcome.sale as any).id;

    const [first, second] = await Promise.all([
      refundSale({ businessId: business.id, configuration: config, actor: raceActor, request: { saleId, amountKES: 100, method: "cash" } }),
      refundSale({ businessId: business.id, configuration: config, actor: raceActor, request: { saleId, amountKES: 100, method: "cash" } }),
    ]);
    const accepted = [first, second].filter((result) => result.ok);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.refundedKES).toBe(100);

    // The ledger paid out exactly once: one refund row, the sale fully refunded, stock back once.
    const saleRow = await prisma.posSale.findUnique({ where: { id: saleId } });
    expect(Number(saleRow?.refundedKES ?? 0)).toBe(100);
    expect(await prisma.posPayment.count({ where: { businessId: business.id, saleId, direction: "OUT", purpose: "REFUND" } })).toBe(1);
    const movements = await prisma.posInventoryMovement.findMany({ where: { businessId: business.id, refType: "SALE", reason: "RETURN" } });
    expect(movements.reduce((total, row) => total + Number(row.delta ?? 0), 0)).toBe(2);

    await prisma.business.delete({ where: { id: business.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});
