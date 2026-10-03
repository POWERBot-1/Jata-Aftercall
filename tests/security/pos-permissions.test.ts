/**
 * POS authorization (§36, §44, §54, §56, §75)
 *
 * Every refusal here is a *behavioural* test against the in-memory database: the assertion is not
 * only that the call was refused, but that nothing was written — no sale, no movement, no ledger
 * entry, no configuration change.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

import { buildConfiguration, finalize } from "@/lib/pos/configuration";
import { pruneAnswers } from "@/lib/pos/questionnaire";
import { effectivePermissions } from "@/lib/pos/permissions";
import { requirePosAccess, PosAccessError } from "@/lib/pos/guard";
import { createSale, recordRepayment, refundSale, type PosActor } from "@/lib/pos/sales";
import { adjustStock, moveOrder, paySupplier, recordExpense, recordStockCount, transferStock } from "@/lib/pos/operations";
import { publishConfiguration, saveDraft } from "@/lib/pos/provisioning";
import { initialState, nextStates, resolveStates } from "@/lib/pos/workflow";
import type { PosConfiguration, QuestionnaireAnswers } from "@/lib/pos/types";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;

const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

function restaurantConfig(overrides: QuestionnaireAnswers = {}): PosConfiguration {
  return finalize(
    buildConfiguration(
      pruneAnswers({
        business_type: "restaurant",
        sells: ["products", "services"],
        payment_methods: ["cash", "mpesa", "credit"],
        credit_frequency: "sometimes",
        credit_limit: 2000,
        credit_terms_days: 30,
        keeps_stock: true,
        keeps_customers: true,
        orders: true,
        order_channels: ["walk_in", "whatsapp"],
        has_staff: true,
        staff_count: 4,
        staff_roles: ["WAITER", "CASHIER"],
        tracks_expenses: true,
        has_suppliers: true,
        supplier_credit: true,
        discounts: true,
        restaurant_kitchen: true,
        ...overrides,
      }),
      { businessName: business.name },
    ),
  );
}

function actorFor(config: PosConfiguration, roleKey: string, extra: Partial<PosActor> = {}): PosActor {
  return {
    actorId: roleKey === "OWNER" ? "userA" : "cashierA",
    actorName: roleKey === "OWNER" ? "Owner A" : "Mary Cashier",
    roleKey,
    permissions: effectivePermissions(config, roleKey),
    staffId: roleKey === "OWNER" ? null : "st_a1",
    branchId: null,
    ...extra,
  };
}

const saleRequest = {
  items: [{ productId: "p_a1", quantity: 2 }],
  payments: [{ method: "cash", amountKES: 100 }],
};

beforeEach(() => {
  fake().reset();
});

describe("a sale is priced by the server, not the browser (§56, §62)", () => {
  const config = restaurantConfig();

  it("records a sale, moves stock and writes the audit entry in one step", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({ businessId: "bizA", business, configuration: config, actor: owner, request: saleRequest });

    expect(outcome.ok).toBe(true);
    expect(outcome.totals?.totalKES).toBe(100);
    expect(outcome.sale?.receiptNumber).toMatch(/^[A-Z]{2,6}-\d{6}$/);
    expect(fake().rows("posSale")).toHaveLength(1);
    expect(fake().rows("posSaleItem")).toHaveLength(1);
    expect(fake().rows("posPayment")).toHaveLength(1);
    expect(fake().rows("posInventoryMovement")[0]).toMatchObject({ reason: "SALE", delta: -2 });
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(38);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_SALE_CREATED")).toBe(true);
    expect(outcome.receiptText).toContain("Chapati");
  });

  it("ignores a client-supplied price and discount when the role may not change them", async () => {
    const waiter = actorFor(config, "WAITER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: waiter,
      request: {
        items: [{ productId: "p_a2", quantity: 1, unitPriceKES: 1, discountKES: 0 }],
        payments: [{ method: "cash", amountKES: 250 }],
      },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.totals?.totalKES).toBe(250); // the catalogue price, not KES 1
    expect(outcome.warnings.join(" ")).toMatch(/list price|permission/i);
  });

  it("refuses a payment method the business does not take", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "crypto", amountKES: 50 }] },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("METHOD_NOT_ALLOWED");
    expect(fake().rows("posSale")).toHaveLength(0);
  });

  it("refuses to sell stock the business does not have", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a2", quantity: 50 }], payments: [{ method: "cash", amountKES: 12500 }] },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("INSUFFICIENT_STOCK");
    expect(outcome.shortages?.[0]).toMatchObject({ requested: 50, available: 10 });
    expect(fake().rows("posSale")).toHaveLength(0);
    expect(fake().rows("posInventoryMovement")).toHaveLength(0);
  });

  it("refuses to sell another tenant's product id", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_b1", quantity: 1 }], payments: [{ method: "cash", amountKES: 900 }] },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("PRODUCT_NOT_FOUND");
    expect(fake().rows("posSale")).toHaveLength(0);
  });

  it("refuses a sale from a role that may not sell", async () => {
    const config2 = restaurantConfig();
    const actor = { ...actorFor(config2, "DELIVERY"), permissions: ["VIEW_SALES"] as any };
    const outcome = await createSale({ businessId: "bizA", business, configuration: config2, actor, request: saleRequest });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("NOT_ALLOWED");
    expect(fake().rows("posSale")).toHaveLength(0);
  });
});

describe("credit is approved by the configuration and the role (§30, §36, §75)", () => {
  it("lets a customer buy within their limit and writes the receivable ledger", async () => {
    const config = restaurantConfig();
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a2", quantity: 2 }], payments: [{ method: "credit", amountKES: 500 }], customerId: "c_a1" },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.creditKES).toBe(500);
    expect(fake().rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(500);
    expect(fake().rows("posCreditEntry")).toHaveLength(1);
    expect(fake().rows("posCreditEntry")[0]).toMatchObject({ partyType: "CUSTOMER", direction: "DEBIT", amountKES: 500 });
    expect(fake().rows("posPayment")).toHaveLength(0); // credit is not a payment
  });

  it("refuses credit above the customer's limit and records the refusal", async () => {
    const config = restaurantConfig();
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a2", quantity: 20 }], payments: [{ method: "credit", amountKES: 5000 }], customerId: "c_a1" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("OVER_LIMIT");
    expect(outcome.message).toMatch(/limit/i);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_CREDIT_DECLINED")).toBe(true);
    expect(fake().rows("posCreditEntry")).toHaveLength(0);
  });

  it("refuses credit for another tenant's customer", async () => {
    const config = restaurantConfig();
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "credit", amountKES: 50 }], customerId: "c_b1" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("needs a manager when staff may not approve credit", async () => {
    const config = restaurantConfig({ credit_staff_approve: false });
    const cashier = actorFor(config, "CASHIER");
    expect(cashier.permissions).not.toContain("APPROVE_CREDIT");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: cashier,
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "credit", amountKES: 50 }], customerId: "c_a1" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("CREDIT_APPROVAL_REQUIRED");
    expect(fake().rows("posCreditEntry")).toHaveLength(0);
    expect(fake().rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES).toBe(0);
  });

  it("collects a repayment and never more than the balance", async () => {
    const config = restaurantConfig();
    const owner = actorFor(config, "OWNER");
    await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a2", quantity: 2 }], payments: [{ method: "credit", amountKES: 500 }], customerId: "c_a1" },
    });

    const over = await recordRepayment({ businessId: "bizA", configuration: config, actor: owner, customerId: "c_a1", amountKES: 900 });
    expect(over.ok).toBe(false);
    expect(fake().rows("posPayment")).toHaveLength(0);

    const part = await recordRepayment({ businessId: "bizA", configuration: config, actor: owner, customerId: "c_a1", amountKES: 200, method: "mpesa" });
    expect(part.ok).toBe(true);
    expect(part.balanceKES).toBe(300);
    expect(fake().rows("posPayment")[0]).toMatchObject({ direction: "IN", purpose: "CREDIT_REPAYMENT", amountKES: 200 });
    expect(fake().rows("posCreditEntry")).toHaveLength(2);
  });

  it("refuses a repayment from a role that may not collect money", async () => {
    const config = restaurantConfig();
    const waiter = actorFor(config, "WAITER");
    expect(waiter.permissions).not.toContain("RECORD_REPAYMENT");
    const outcome = await recordRepayment({ businessId: "bizA", configuration: config, actor: waiter, customerId: "c_a1", amountKES: 100 });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("NOT_ALLOWED");
  });
});

describe("refunds and voids correct without rewriting history (§54, §75)", () => {
  const config = restaurantConfig();

  async function sellOnce() {
    const owner = actorFor(config, "OWNER");
    const outcome = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner,
      request: { items: [{ productId: "p_a1", quantity: 4 }], payments: [{ method: "cash", amountKES: 200 }] },
    });
    expect(outcome.ok).toBe(true);
    return outcome.sale as any;
  }

  it("refuses a refund from a role without the permission", async () => {
    const sale = await sellOnce();
    const cashier = actorFor(config, "CASHIER");
    expect(cashier.permissions).not.toContain("REFUND_SALE");
    const outcome = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: cashier,
      request: { saleId: sale.id, amountKES: 200 },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("NOT_ALLOWED");
    expect(fake().rows("posSale")[0].refundedKES).toBe(0);
    expect(fake().rows("posPayment")).toHaveLength(1); // the original payment only
  });

  it("refuses to refund more than was paid", async () => {
    const sale = await sellOnce();
    const owner = actorFor(config, "OWNER");
    const outcome = await refundSale({ businessId: "bizA", configuration: config, actor: owner, request: { saleId: sale.id, amountKES: 5000 } });
    expect(outcome.ok).toBe(false);
    expect(fake().rows("posSale")[0].refundedKES).toBe(0);
  });

  it("refunds money and returns stock, keeping the original sale row intact", async () => {
    const sale = await sellOnce();
    const owner = actorFor(config, "OWNER");
    const line = fake().rows("posSaleItem")[0];
    const outcome = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: owner,
      request: { saleId: sale.id, amountKES: 100, method: "cash", reason: "Two were cold", items: [{ saleItemId: line.id, quantity: 2 }] },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.refundedKES).toBe(100);

    const stored = fake().rows("posSale")[0];
    expect(stored.refundedKES).toBe(100);
    expect(stored.status).toBe("PARTIALLY_REFUNDED");
    // The original totals are never rewritten (§54).
    expect(stored.totalKES).toBe(200);
    expect(stored.paidKES).toBe(200);

    const movements = fake().rows("posInventoryMovement");
    expect(movements.map((row) => row.reason)).toEqual(["SALE", "RETURN"]);
    expect(movements[1].delta).toBe(2);
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(38);
    expect(fake().rows("posPayment").map((row) => [row.direction, row.purpose])).toEqual([["IN", "SALE"], ["OUT", "REFUND"]]);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_SALE_REFUNDED")).toBe(true);
  });

  it("refuses to touch another tenant's sale, with the same answer as 'does not exist'", async () => {
    const sale = await sellOnce();
    const owner = actorFor(config, "OWNER");
    const outcome = await refundSale({ businessId: "bizB", configuration: config, actor: owner, request: { saleId: sale.id, amountKES: 100 } });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("SALE_NOT_FOUND");
    expect(fake().rows("posSale")[0].refundedKES).toBe(0);
  });

  it("voids a sale by reversing it, not by deleting it", async () => {
    const sale = await sellOnce();
    const owner = actorFor(config, "OWNER");
    const outcome = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: owner,
      action: "POS_SALE_VOIDED",
      request: { saleId: sale.id, reason: "Rung up twice" },
    });
    expect(outcome.ok).toBe(true);
    expect(fake().rows("posSale")[0].status).toBe("VOIDED");
    expect(fake().rows("posSale")).toHaveLength(1);
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(40);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_SALE_VOIDED")).toBe(true);
  });
});

describe("stock changes need the right permission and always carry a reason (§33, §36)", () => {
  const config = restaurantConfig();

  it("refuses an adjustment from a role that may not adjust stock", async () => {
    const waiter = actorFor(config, "WAITER");
    const outcome = await adjustStock({
      businessId: "bizA",
      configuration: config,
      actor: waiter,
      input: { productId: "p_a1", reason: "DAMAGE", quantity: 5, note: "Dropped" },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("NOT_ALLOWED");
    expect(fake().rows("posInventoryMovement")).toHaveLength(0);
  });

  it("refuses an adjustment with no reason, and one that needs a note without one", async () => {
    const owner = actorFor(config, "OWNER");
    expect((await adjustStock({ businessId: "bizA", configuration: config, actor: owner, input: { productId: "p_a1", quantity: 5 } })).ok).toBe(false);
    expect((await adjustStock({ businessId: "bizA", configuration: config, actor: owner, input: { productId: "p_a1", reason: "DAMAGE", quantity: 5 } })).ok).toBe(false);
    expect(fake().rows("posInventoryMovement")).toHaveLength(0);
  });

  it("writes a signed movement and the audit entry when it is allowed", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await adjustStock({
      businessId: "bizA",
      configuration: config,
      actor: owner,
      input: { productId: "p_a1", reason: "DAMAGE", quantity: 5, note: "Dropped a tray" },
    });
    expect(outcome.ok).toBe(true);
    expect(fake().rows("posInventoryMovement")[0]).toMatchObject({ reason: "DAMAGE", delta: -5 });
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(35);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_STOCK_ADJUSTED")).toBe(true);
  });

  it("records a count as the difference", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await recordStockCount({ businessId: "bizA", configuration: config, actor: owner, productId: "p_a1", counted: 37 });
    expect(outcome.ok).toBe(true);
    expect(outcome.difference).toBe(-3);
    expect(fake().rows("posInventoryItem").find((row) => row.productId === "p_a1")!.quantity).toBe(37);
  });

  it("refuses a transfer for a business without multiple locations", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await transferStock({
      businessId: "bizA",
      configuration: config,
      actor: owner,
      productId: "p_a1",
      quantity: 2,
      fromBranchId: "br_a1",
      toBranchId: "br_a2",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("TRANSFERS_OFF");
    expect(fake().rows("posInventoryMovement")).toHaveLength(0);
  });
});

describe("money out needs its own permission (§36, §75)", () => {
  const config = restaurantConfig();

  it("refuses an expense from a role that may not record one", async () => {
    const waiter = actorFor(config, "WAITER");
    const outcome = await recordExpense({
      businessId: "bizA",
      configuration: config,
      actor: waiter,
      input: { categoryKey: "rent", amountKES: 20000 },
    });
    expect(outcome.ok).toBe(false);
    expect(fake().rows("posExpense")).toHaveLength(0);
  });

  it("saves an unknown expense category as Other rather than inventing one", async () => {
    const owner = actorFor(config, "OWNER");
    const outcome = await recordExpense({
      businessId: "bizA",
      configuration: config,
      actor: owner,
      input: { categoryKey: "bribes", amountKES: 500 },
    });
    expect(outcome.ok).toBe(true);
    expect(fake().rows("posExpense")[0].categoryKey).toBe("other");
    expect(outcome.warnings.join(" ")).toMatch(/Other/i);
  });

  it("refuses a supplier payment above what is owed", async () => {
    const owner = actorFor(config, "OWNER");
    fake().rows("posSupplier")[0].balanceKES = 1000;
    const outcome = await paySupplier({ businessId: "bizA", configuration: config, actor: owner, supplierId: "s_a1", amountKES: 5000 });
    expect(outcome.ok).toBe(false);
    expect(fake().rows("posPayment")).toHaveLength(0);
    expect(fake().rows("posSupplier")[0].balanceKES).toBe(1000);
  });

  it("refuses to pay another tenant's supplier", async () => {
    const owner = actorFor(config, "OWNER");
    fake().rows("posSupplier").push({ id: "s_b1", businessId: "bizB", name: "Cement Co", balanceKES: 5000, termsDays: 14 });
    const outcome = await paySupplier({ businessId: "bizA", configuration: config, actor: owner, supplierId: "s_b1", amountKES: 100 });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("SUPPLIER_NOT_FOUND");
    expect(fake().rows("posPayment")).toHaveLength(0);
  });
});

describe("orders move only where the workflow allows (§29)", () => {
  const config = restaurantConfig();

  it("refuses a jump the state machine does not define", async () => {
    const owner = actorFor(config, "OWNER");
    const first = initialState(config.orders.workflowKey);
    const last = resolveStates(config).filter((state) => state.key !== "CANCELLED").pop()!.key;
    fake().rows("posOrder").push({
      id: "ord_1",
      businessId: "bizA",
      reference: "ORD-0001",
      stateKey: first,
      workflowKey: config.orders.workflowKey,
      channel: "walk_in",
      totalKES: 500,
      createdAt: new Date(),
    });
    // A real state, but not one this workflow allows from where the order stands.
    const outcome = await moveOrder({ businessId: "bizA", configuration: config, actor: owner, orderId: "ord_1", toState: last });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("INVALID_TRANSITION");
    expect(outcome.message).toBeTruthy();
    expect(fake().rows("posOrder")[0].stateKey).toBe(first);
    expect(fake().rows("posOrderEvent")).toHaveLength(0);
  });

  it("refuses an invented state name", async () => {
    const owner = actorFor(config, "OWNER");
    fake().rows("posOrder").push({ id: "ord_2", businessId: "bizA", reference: "ORD-0002", stateKey: initialState(config.orders.workflowKey), workflowKey: config.orders.workflowKey, totalKES: 100, createdAt: new Date() });
    const outcome = await moveOrder({ businessId: "bizA", configuration: config, actor: owner, orderId: "ord_2", toState: "MOON" });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("UNKNOWN_STATE");
  });

  it("records an allowed move with its history", async () => {
    const owner = actorFor(config, "OWNER");
    const first = initialState(config.orders.workflowKey);
    fake().rows("posOrder").push({ id: "ord_3", businessId: "bizA", reference: "ORD-0003", stateKey: first, workflowKey: config.orders.workflowKey, totalKES: 100, createdAt: new Date() });
    const allowed = nextStates(config.orders.workflowKey, first)[0];
    const outcome = await moveOrder({ businessId: "bizA", configuration: config, actor: owner, orderId: "ord_3", toState: allowed.key });
    expect(outcome.ok).toBe(true);
    expect(fake().rows("posOrder").find((row: any) => row.id === "ord_3")!.stateKey).toBe(allowed.key);
    expect(fake().rows("posOrderEvent")).toHaveLength(1);
    expect(fake().rows("posAuditEvent").some((row) => row.action === "POS_ORDER_STATE_CHANGED")).toBe(true);
  });
});

describe("the configuration and publishing are owner-only and payment-gated (§43, §44, §75)", () => {
  const sessionA = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" } as any;
  const cashierSession = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" } as any;

  it("refuses a configuration change from staff", async () => {
    await saveDraft({ businessId: "bizA", answers: { business_type: "restaurant" }, actorId: "userA" });
    await expect(requirePosAccess("bizA", cashierSession, { permission: "EDIT_CONFIGURATION" })).rejects.toThrow(PosAccessError);
    const denied = fake().rows("posAuditEvent").filter((row) => row.action === "POS_ACCESS_DENIED");
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0].businessId).toBe("bizA");
  });

  it("refuses to publish before payment is confirmed (§44)", async () => {
    await saveDraft({
      businessId: "bizA",
      answers: { business_type: "restaurant", sells: ["products"], payment_methods: ["cash"], keeps_stock: true },
      actorId: "userA",
      context: { businessName: business.name },
    });
    const outcome = await publishConfiguration({ businessId: "bizA", actorId: "userA" });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBeTruthy();
    expect(fake().rows("posConfigurationVersion")).toHaveLength(0);
    expect(fake().rows("posConfiguration")[0].publishedVersion).toBe(0);
  });

  it("refuses to publish another tenant's configuration", async () => {
    await saveDraft({ businessId: "bizA", answers: { business_type: "restaurant", sells: ["products"], payment_methods: ["cash"] }, actorId: "userA" });
    const outcome = await publishConfiguration({ businessId: "bizB", actorId: "userA" });
    expect(outcome.ok).toBe(false);
    expect(fake().rows("posConfiguration")).toHaveLength(1);
    expect(fake().rows("posConfiguration")[0].businessId).toBe("bizA");
  });
});
