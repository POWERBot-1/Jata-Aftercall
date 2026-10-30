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
import { paySupplier } from "@/lib/pos/operations";

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
