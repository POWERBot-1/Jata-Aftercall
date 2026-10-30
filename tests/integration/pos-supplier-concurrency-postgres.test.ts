import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The suite uses the production service and real PostgreSQL, with the repository's optional
// Prisma WASM driver-adapter harness when native engine downloads are unavailable.
const holder = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ get default() { return holder.client; } }));
vi.mock("@prisma/client", async (original) => {
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (!harness) return original();
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)(`${harness}/generated/wasm.js`);
});

import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { paySupplier, receivePurchase } from "@/lib/pos/operations";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let db: any;
let ownerId: string;
let businessId: string;

describe.skipIf(!realPrismaConfigured)("supplier concurrent repayments on PostgreSQL", () => {
  beforeAll(async () => {
    db = makeRealPrisma();
    holder.client = db;
    const owner = await db.user.create({ data: { email: `supplier-race-${stamp}@example.test`, name: "Test owner", passwordHash: "not-a-real-login" } });
    ownerId = owner.id;
    const business = await db.business.create({ data: { ownerId, slug: `supplier-race-${stamp}`, name: "Supplier race", category: "retail" } });
    businessId = business.id;
  });

  afterAll(async () => {
    if (businessId) await db.business.delete({ where: { id: businessId } });
    if (ownerId) await db.user.delete({ where: { id: ownerId } });
    if (db) await db.$disconnect();
  });

  it("serializes two payments based on the same observed supplier balance", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Race supplier", balanceKES: 100 } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    const actor = { actorId: ownerId, actorName: "Test owner", roleKey: "OWNER", permissions: ["RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };

    // Both genuine transactions finish their first supplier read before either can proceed. This
    // forces the stale-read interleaving rather than hoping Promise.all happens to produce it.
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const run = () => db.$transaction(async (tx: any) => {
      let firstRead = true;
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === "posSupplier") {
            return new Proxy(target.posSupplier, {
              get(model, key) {
                if (key !== "findFirst") return Reflect.get(model, key, model);
                return async (...args: any[]) => {
                  const result = await model.findFirst(...args);
                  if (firstRead) {
                    firstRead = false;
                    arrivals++;
                    if (arrivals === 2) release();
                    await barrier;
                  }
                  return result;
                };
              },
            });
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return paySupplier({ businessId, configuration: config, actor, supplierId: supplier.id, amountKES: 60, method: "cash", client: wrapped });
    }, { timeout: 15000 });

    const outcomes = await Promise.all([run(), run()]);
    expect(arrivals).toBe(2);
    expect(outcomes.filter((result: any) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result: any) => !result.ok)).toHaveLength(1);
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(40);
    const payments = await db.posPayment.findMany({ where: { businessId, supplierId: supplier.id } });
    const entries = await db.posCreditEntry.findMany({ where: { businessId, partyType: "SUPPLIER", partyId: supplier.id } });
    expect(payments).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ direction: "CREDIT", amountKES: 60, balanceAfterKES: 40, paymentId: payments[0].id });
  }, 30000);

  it("serializes simultaneous receipts against the same outstanding purchase quantity", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Receipt supplier", balanceKES: 100 } });
    const product = await db.posProduct.create({ data: { businessId, name: "Receipt item", trackInventory: true } });
    const purchase = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `race-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, productId: product.id, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    config.suppliers.credit = true;
    const actor = { actorId: ownerId, actorName: "Test owner", roleKey: "OWNER", permissions: ["CREATE_PURCHASE" as const, "RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const run = () => db.$transaction(async (tx: any) => {
      let firstRead = true;
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property === "posPurchase") return new Proxy(target.posPurchase, {
            get(model, key) {
              if (key !== "findFirst") return Reflect.get(model, key, model);
              return async (...args: any[]) => {
                const result = await model.findFirst(...args);
                if (firstRead) { firstRead = false; if (++arrivals === 2) release(); await barrier; }
                return result;
              };
            },
          });
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, payment: { amountKES: 60, method: "cash" }, client: wrapped });
    }, { timeout: 15000 });
    const outcomes = await Promise.all([run(), run()]);
    expect(arrivals).toBe(2);
    expect(outcomes.filter((result: any) => result.ok)).toHaveLength(1);
    expect(outcomes.filter((result: any) => result.code === "NOTHING_TO_RECEIVE")).toHaveLength(1);
    const item = await db.posPurchaseItem.findFirst({ where: { businessId, purchaseId: purchase.id } });
    expect(item.receivedQty).toBe(1);
    expect((await db.posInventoryItem.findFirst({ where: { businessId, productId: product.id } })).quantity).toBe(1);
    expect(await db.posInventoryMovement.count({ where: { businessId, productId: product.id, refId: purchase.id } })).toBe(1);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(1);
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(40);
    expect((await db.posPurchase.findUnique({ where: { id: purchase.id } })).paidKES).toBe(60);
    const receiptPayment = await db.posPayment.findFirst({ where: { businessId, supplierId: supplier.id } });
    expect((await db.posCreditEntry.findFirst({ where: { businessId, partyId: supplier.id, paymentId: receiptPayment.id } })).amountKES).toBe(60);
  }, 30000);

  it("refuses a receipt payment exceeding the current payable after a separate supplier payment", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Cross-path supplier", balanceKES: 100 } });
    const purchase = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `cross-path-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    config.suppliers.credit = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["CREATE_PURCHASE" as const, "RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    expect((await paySupplier({ businessId, configuration: config, actor, supplierId: supplier.id, amountKES: 60, client: db })).ok).toBe(true);
    const result = await receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, payment: { amountKES: 60 }, client: db });
    expect(result).toMatchObject({ ok: false, code: "PAYMENT_INVALID" });
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(40);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(1);
    expect((await db.posPurchase.findUnique({ where: { id: purchase.id } })).status).toBe("ORDERED");
    expect((await db.posPurchaseItem.findFirst({ where: { businessId, purchaseId: purchase.id } })).receivedQty).toBe(0);
  });

  it("serializes a direct supplier payment against a receipt payment", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Concurrent cross-path supplier", balanceKES: 100 } });
    const purchase = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `cross-race-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const config = baselineConfiguration(); config.suppliers.enabled = true; config.suppliers.credit = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["CREATE_PURCHASE" as const, "RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const run = (type: "direct" | "receipt") => db.$transaction(async (tx: any) => {
      let first = true;
      const wrapped = new Proxy(tx, { get(target, property) {
        if (property === (type === "direct" ? "posSupplier" : "posPurchase")) return new Proxy(target[property], { get(model, key) {
          if (key !== "findFirst") return Reflect.get(model, key, model);
          return async (...args: any[]) => {
            const value = await model.findFirst(...args);
            if (first) { first = false; if (++arrivals === 2) release(); await barrier; }
            return value;
          };
        } });
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      return type === "direct"
        ? paySupplier({ businessId, configuration: config, actor, supplierId: supplier.id, amountKES: 60, client: wrapped })
        : receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, payment: { amountKES: 60 }, client: wrapped });
    }, { timeout: 15000 });
    const results = await Promise.all([run("direct"), run("receipt")]);
    expect(arrivals).toBe(2);
    expect(results.filter((result: any) => result.ok)).toHaveLength(1);
    expect(results.filter((result: any) => result.code === "PAYMENT_INVALID")).toHaveLength(1);
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(40);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(1);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: supplier.id } })).toBe(1);
  }, 30000);

  it("records a cash purchase payment without inventing supplier credit", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Cash-only supplier", balanceKES: 0 } });
    const purchase = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `cash-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const config = baselineConfiguration(); config.suppliers.enabled = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["CREATE_PURCHASE" as const, "RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    const result = await receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, payment: { amountKES: 100 }, client: db });
    expect(result.ok).toBe(true);
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(0);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(1);
    expect(await db.posCreditEntry.count({ where: { businessId, partyId: supplier.id } })).toBe(0);
    await db.posSupplier.update({ where: { id: supplier.id }, data: { balanceKES: 50 } });
    const ambiguous = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `legacy-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    expect((await receivePurchase({ businessId, configuration: config, actor, purchaseId: ambiguous.id, payment: { amountKES: 100 }, client: db })).code).toBe("PAYMENT_INVALID");
    expect((await db.posPurchase.findUnique({ where: { id: ambiguous.id } })).status).toBe("ORDERED");
  });

  it("refuses an unlinked payment or one exceeding the order total without receiving stock", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Limited supplier", balanceKES: 300 } });
    const makePurchase = (reference: string, supplierId?: string) => db.posPurchase.create({ data: { businessId, supplierId, reference, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const withoutSupplier = await makePurchase(`no-supplier-${stamp}`);
    const overpaid = await makePurchase(`overpaid-${stamp}`, supplier.id);
    const config = baselineConfiguration(); config.suppliers.enabled = true; config.suppliers.credit = true;
    const actor = { actorId: ownerId, actorName: "Owner", roleKey: "OWNER", permissions: ["CREATE_PURCHASE" as const, "RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    expect((await receivePurchase({ businessId, configuration: config, actor, purchaseId: withoutSupplier.id, payment: { amountKES: 50 }, client: db })).code).toBe("SUPPLIER_REQUIRED");
    expect((await receivePurchase({ businessId, configuration: config, actor, purchaseId: overpaid.id, payment: { amountKES: 101 }, client: db })).code).toBe("PAYMENT_INVALID");
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(0);
    expect((await db.posPurchase.findUnique({ where: { id: overpaid.id } })).status).toBe("ORDERED");
  });

  it("does not let a stock receiver record supplier payments without payment permission", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Restricted supplier", balanceKES: 100 } });
    const purchase = await db.posPurchase.create({ data: { businessId, supplierId: supplier.id, reference: `restricted-${stamp}`, status: "ORDERED", totalKES: 100, items: { create: [{ businessId, name: "Item", quantity: 1, unitCostKES: 100, totalKES: 100 }] } } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    const actor = { actorId: ownerId, actorName: "Stock receiver", roleKey: "STAFF", permissions: ["CREATE_PURCHASE" as const], staffId: null, branchId: null };
    const result = await receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, payment: { amountKES: 60 }, client: db });
    expect(result).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(0);
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(100);
    expect((await db.posPurchase.findUnique({ where: { id: purchase.id } })).status).toBe("ORDERED");
    expect((await db.posPurchaseItem.findFirst({ where: { businessId, purchaseId: purchase.id } })).receivedQty).toBe(0);
    const receiptOnly = await receivePurchase({ businessId, configuration: config, actor, purchaseId: purchase.id, client: db });
    expect(receiptOnly.ok).toBe(true);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(0);
  });

  it("rolls back payment and credit entry when the surrounding transaction fails", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Rollback supplier", balanceKES: 100 } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    const actor = { actorId: ownerId, actorName: "Test owner", roleKey: "OWNER", permissions: ["RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    await expect(db.$transaction(async (tx: any) => {
      const result = await paySupplier({ businessId, configuration: config, actor, supplierId: supplier.id, amountKES: 60, client: tx });
      expect(result.ok).toBe(true);
      throw new Error("forced rollback");
    })).rejects.toThrow("forced rollback");
    expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(100);
    expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(0);
    expect(await db.posCreditEntry.count({ where: { businessId, partyType: "SUPPLIER", partyId: supplier.id } })).toBe(0);
  });

  it("refuses a cross-tenant supplier and an actor without permission", async () => {
    const supplier = await db.posSupplier.create({ data: { businessId, name: "Isolated supplier", balanceKES: 100 } });
    const config = baselineConfiguration();
    config.suppliers.enabled = true;
    const actor = { actorId: ownerId, actorName: "Test owner", roleKey: "OWNER", permissions: ["RECORD_SUPPLIER_PAYMENT" as const], staffId: null, branchId: null };
    const other = await db.business.create({ data: { ownerId, slug: `supplier-other-${stamp}`, name: "Other tenant", category: "retail" } });
    try {
      expect((await paySupplier({ businessId: other.id, configuration: config, actor, supplierId: supplier.id, amountKES: 60, client: db })).code).toBe("SUPPLIER_NOT_FOUND");
      expect((await paySupplier({ businessId, configuration: config, actor: { ...actor, permissions: [] }, supplierId: supplier.id, amountKES: 60, client: db })).code).toBe("NOT_ALLOWED");
      expect((await db.posSupplier.findUnique({ where: { id: supplier.id } })).balanceKES).toBe(100);
      expect(await db.posPayment.count({ where: { businessId, supplierId: supplier.id } })).toBe(0);
    } finally {
      await db.business.delete({ where: { id: other.id } });
    }
  });
});
