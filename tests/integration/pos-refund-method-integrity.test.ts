/**
 * A refund's payment method is a financial fact, not a request field (§35, §54, §57).
 *
 * The drawer figure is read from these rows: `dailyClosing` counts `posPayment` rows whose
 * `method` is "cash" — money in minus money out. A client-supplied method is therefore a way to
 * forge the drawer: take KES 5,000 out of the till, file the refund as "mpesa", and the close
 * reports a drawer that is KES 5,000 over with nothing to show for it. The mirror image is just
 * as bad — refunding a credit sale as "cash" takes money out of a till that never took it in.
 *
 * The engine now derives the method from the tenders the sale was actually funded by, less what
 * has already been refunded out of each. The browser's value is only an expression of intent and
 * is honoured only while that method still has capacity.
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
import { allocateRefundMethods, createSale, refundSale, type PosActor } from "@/lib/pos/sales";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { dailyClosing } from "@/lib/pos/reports";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

const retailAnswers = {
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "sometimes",
  credit_limit: 5000,
  credit_terms_days: 30,
  keeps_stock: true,
  units: ["piece", "plate"],
  keeps_customers: true,
  repeat_customers: true,
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
    id: "pay_method_1",
    reference: "jata-pos-method-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_method_1", reference: "jata-pos-method-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_method_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

async function sell(config: any, request: Record<string, unknown>) {
  const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: request as any });
  if (!outcome.ok) throw new Error(`sale setup failed: ${outcome.code} ${outcome.message}`);
  return (outcome as any).sale;
}

const refunds = () => rows("posPayment").filter((row) => row.direction === "OUT" && String(row.purpose ?? "") === "REFUND");
const byMethod = (rowsList: any[]) => rowsList.map((row) => `${String(row.method).toLowerCase()}:${Number(row.amountKES)}`);

beforeEach(() => {
  fake().reset();
});

describe("allocateRefundMethods derives the split from the ledger (§35, §57)", () => {
  it("never pays out through a method that did not fund the sale", () => {
    const tenders = [{ method: "cash", amountKES: 500 }];
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: "mpesa", amountKES: 500 }))).toEqual(["cash:500"]);
    // A request for a method with no capacity falls through to the real tenders, it is not refused.
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: "bank", amountKES: 100 }))).toEqual(["cash:100"]);
    // An empty request is not a veto either.
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: null, amountKES: 100 }))).toEqual(["cash:100"]);
  });

  it("caps each method at what it funded and has not already given back", () => {
    const tenders = [
      { method: "cash", amountKES: 300 },
      { method: "mpesa", amountKES: 200 },
    ];
    // 200 has already left through mpesa, so only 300 of capacity is left and it is all cash.
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [{ method: "mpesa", amountKES: 200 }], amountKES: 400 }))).toEqual(["cash:300"]);
    // Nothing has been refunded: the requested method leads, the rest follow in tender order.
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: "mpesa", amountKES: 400 }))).toEqual(["mpesa:200", "cash:200"]);
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: null, amountKES: 400 }))).toEqual(["cash:300", "mpesa:100"]);
    // Asking for more than was tendered still cannot invent money.
    expect(byMethod(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: "cash", amountKES: 10_000 }))).toEqual(["cash:300", "mpesa:200"]);
  });

  it("a sale with no money tendered at all has no method to refund through", () => {
    expect(allocateRefundMethods({ tenders: [], alreadyRefunded: [], requestedMethod: "cash", amountKES: 500 })).toEqual([]);
    expect(allocateRefundMethods({ tenders: [{ method: "cash", amountKES: 0 }], alreadyRefunded: [], amountKES: 500 })).toEqual([]);
  });

  it("keeps the spelling the sale recorded, so the refund row matches the tender row", () => {
    const tenders = [{ method: "M-Pesa", amountKES: 200 }];
    expect(allocateRefundMethods({ tenders, alreadyRefunded: [], requestedMethod: "m-pesa", amountKES: 200 })).toEqual([{ method: "M-Pesa", amountKES: 200 }]);
  });
});

describe("a forged method cannot move the drawer (§35, §54, §57)", () => {
  it("a cash sale refunded as mpesa still comes out of the till", async () => {
    const config = await goLive();
    const sale = await sell(config, { items: [{ productId: "p_a1", quantity: 10 }], payments: [{ method: "cash", amountKES: 500 }] });

    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "mpesa" },
    });
    expect(result.ok).toBe(true);
    expect(byMethod(refunds())).toEqual(["cash:500"]);
    // The forged label is recorded as an intent in the audit trail, never as the method used.
    const audit = rows("posAuditEvent").filter((row) => row.action === "POS_SALE_REFUNDED");
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit[audit.length - 1].metadata)).toContain("mpesa");
  });

  it("a credit-funded sale refunded as cash pays nothing out of the till", async () => {
    const config = await goLive();
    const sale = await sell(config, {
      items: [{ productId: "p_a2", quantity: 2 }],
      payments: [{ method: "credit", amountKES: 500 }],
      customerId: "c_a1",
    });

    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "cash" },
    });
    expect(result.ok).toBe(true);
    // No money row at all: the till never took this money in, so it cannot pay it out.
    expect(refunds()).toHaveLength(0);
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 500, creditRefundedKES: 500 });
    expect(rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(0);
  });

  it("a mixed sale splits across the tenders, in the order the money arrived", async () => {
    const config = await goLive();
    const sale = await sell(config, {
      items: [{ productId: "p_a1", quantity: 20 }], // 1000 KES
      payments: [{ method: "cash", amountKES: 400 }, { method: "mpesa", amountKES: 600 }],
    });

    // Ask for the whole thing back as cash: only the cash tender can pay cash.
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 1000, method: "cash" },
    });
    expect(result.ok).toBe(true);
    expect(byMethod(refunds())).toEqual(["cash:400", "mpesa:600"]);
    expect(rows("posSale")[0].refundedKES).toBe(1000);
  });

  it("a partial refund against a mixed sale leaves the rest refundable through the right method", async () => {
    const config = await goLive();
    const sale = await sell(config, {
      items: [{ productId: "p_a1", quantity: 20 }],
      payments: [{ method: "cash", amountKES: 400 }, { method: "mpesa", amountKES: 600 }],
    });

    // 300 back, requested as mpesa — that tender has room, so it leads.
    const first = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 300, method: "mpesa" },
    });
    expect(first.ok).toBe(true);
    expect(byMethod(refunds())).toEqual(["mpesa:300"]);

    // 500 more: mpesa has 300 of capacity left, the rest must come from cash.
    const second = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "mpesa" },
    });
    expect(second.ok).toBe(true);
    expect(byMethod(refunds())).toEqual(["mpesa:300", "mpesa:300", "cash:200"]);

    // 200 left, all of it cash now.
    const third = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 200, method: "mpesa" },
    });
    expect(third.ok).toBe(true);
    expect(byMethod(refunds())).toEqual(["mpesa:300", "mpesa:300", "cash:200", "cash:200"]);
    expect(rows("posSale")[0]).toMatchObject({ refundedKES: 1000, status: "REFUNDED" });

    // A fourth asks for money that is all back: refused, and no row is written.
    const fourth = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 1, method: "cash" },
    });
    expect(fourth.ok).toBe(false);
    expect(fourth.code).toBe("REFUND_INVALID");
    expect(refunds()).toHaveLength(4);
  });

  it("a manipulated amount can never exceed what the tenders funded", async () => {
    const config = await goLive();
    const sale = await sell(config, { items: [{ productId: "p_a1", quantity: 10 }], payments: [{ method: "cash", amountKES: 500 }] });

    const over = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 50_000, method: "cash" },
    });
    expect(over.ok).toBe(false);
    expect(over.code).toBe("REFUND_INVALID");
    expect(refunds()).toHaveLength(0);
    expect(rows("posSale")[0].refundedKES).toBe(0);
  });
});

describe("the drawer still adds up after a refund (§35)", () => {
  it("cash in minus cash out is exactly what the till should hold", async () => {
    const config = await goLive();
    const sale = await sell(config, {
      items: [{ productId: "p_a1", quantity: 20 }],
      payments: [{ method: "cash", amountKES: 400 }, { method: "mpesa", amountKES: 600 }],
    });

    const closingBefore = dailyClosing(rows("posSale") as any, [], rows("posPayment") as any, new Date());
    // 400 came into the drawer, 600 went to M-Pesa.
    expect(closingBefore.cashInKES).toBe(400);
    expect(closingBefore.cashOutKES).toBe(0);
    expect(closingBefore.expectedCashKES).toBe(400);

    // Refund the whole sale, insisting every shilling of it went out as mpesa.
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 1000, method: "mpesa" },
    });
    expect(result.ok).toBe(true);

    const closingAfter = dailyClosing(rows("posSale") as any, [], rows("posPayment") as any, new Date());
    // The forged label changed nothing: 400 out of the drawer, not 1000, and not zero.
    expect(closingAfter.cashInKES).toBe(400);
    expect(closingAfter.cashOutKES).toBe(400);
    expect(closingAfter.expectedCashKES).toBe(0);
  });

  it("a refund of a credit sale leaves the drawer exactly as it was", async () => {
    const config = await goLive();
    const sale = await sell(config, {
      items: [{ productId: "p_a2", quantity: 2 }],
      payments: [{ method: "credit", amountKES: 500 }],
      customerId: "c_a1",
    });

    const before = dailyClosing(rows("posSale") as any, [], rows("posPayment") as any, new Date());
    expect(before.cashInKES).toBe(0);

    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      request: { saleId: sale.id, amountKES: 500, method: "cash" },
    });
    expect(result.ok).toBe(true);

    const after = dailyClosing(rows("posSale") as any, [], rows("posPayment") as any, new Date());
    expect(after.cashInKES).toBe(0);
    expect(after.cashOutKES).toBe(0);
    expect(after.expectedCashKES).toBe(0);
  });

  it("a void puts a sold item back on the shelf without touching a method the sale never used", async () => {
    const config = await goLive();
    const sale = await sell(config, { items: [{ productId: "p_a1", quantity: 4 }], payments: [{ method: "mpesa", amountKES: 200 }] });
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(36);

    const voided = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: actor(),
      action: "POS_SALE_VOIDED",
      request: { saleId: sale.id, method: "cash" },
    });
    expect(voided.ok).toBe(true);
    // The refund row follows the tender — mpesa, not the cash the browser asked for.
    expect(byMethod(refunds())).toEqual(["mpesa:200"]);
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(40);
    const closing = dailyClosing(rows("posSale") as any, [], rows("posPayment") as any, new Date());
    expect(closing.cashOutKES).toBe(0);
  });
});
