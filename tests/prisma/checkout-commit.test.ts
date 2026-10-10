/**
 * commitOrderOnce against real Prisma + PostgreSQL: the idempotency record, the stock compare-and-set and the order
 * are one transaction. Runs only when PRISMA_TEST_DATABASE_URL is set.
 */
import { afterAll, describe, expect, it } from "vitest";
import { commitOrderOnce } from "@/lib/checkout-transaction";
import { makeRealPrisma, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";

const SCOPE = "storefront.checkout";

describe.skipIf(!realPrismaConfigured)("real Prisma: checkout commit transaction", () => {
  const p = realPrismaConfigured ? sharedPrisma() : (null as any);
  const extra: any[] = [];
  afterAll(async () => { for (const c of extra) await c.$disconnect(); if (p) await p.$disconnect(); });

  async function order(businessId: string, productId: string, quantity: number, ref: string, client = p) {
    return commitOrderOnce({
      businessId, scope: SCOPE, idempotencyKey: null, requestHash: "unused", client,
      stockLines: [{ productId, quantity, name: "Chicken" }],
      create: async (tx: any) => {
        const o = await tx.order.create({
          data: {
            orderReference: ref, businessId, customerName: "C", customerPhone: "0700", status: "PENDING_PAYMENT", paymentStatus: "UNPAID",
            subtotalKES: 1000, deliveryFeeKES: 0, discountKES: 0, totalKES: 1000, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT",
          },
          select: { id: true },
        });
        return { id: o.id, paymentId: null };
      },
    });
  }

  it("concurrent requests with the same key create one order and decrement stock once", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { quantity: 10, stockStatus: "IN_STOCK" });
    const key = `same-${uid()}`;
    const attempt = () => commitOrderOnce({
      businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "H", client: p,
      stockLines: [{ productId: product.id, quantity: 2, name: "Chicken" }],
      create: async (tx: any) => {
        const o = await tx.order.create({
          data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 2000, deliveryFeeKES: 0, discountKES: 0, totalKES: 2000, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" },
          select: { id: true },
        });
        return { id: o.id, paymentId: null };
      },
    });
    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.kind === "CREATED")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "REPLAY")).toHaveLength(4);
    const orders = await p.order.count({ where: { businessId: business.id } });
    expect(orders).toBe(1);
    const after = await p.product.findUnique({ where: { id: product.id }, select: { quantity: true } });
    expect(after?.quantity).toBe(8);
  });

  it("the same key with a different request is refused (KEY_REUSED) and writes nothing", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { quantity: 10 });
    const key = `reuse-${uid()}`;
    const first = await commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "A", client: p,
      stockLines: [{ productId: product.id, quantity: 1, name: "x" }],
      create: async (tx: any) => ({ id: (await tx.order.create({ data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" }, select: { id: true } })).id, paymentId: null }) });
    expect(first.kind).toBe("CREATED");
    const second = await commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "B", client: p,
      stockLines: [{ productId: product.id, quantity: 1, name: "x" }],
      create: async (tx: any) => ({ id: (await tx.order.create({ data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" }, select: { id: true } })).id, paymentId: null }) });
    expect(second.kind).toBe("KEY_REUSED");
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(1);
    expect((await p.product.findUnique({ where: { id: product.id }, select: { quantity: true } }))?.quantity).toBe(9);
  });

  it("a stock shortfall on the second line rolls back the first line's decrement and the record", async () => {
    const { business } = await seedBusiness(p);
    const a = await seedProduct(p, business.id, { quantity: 5 });
    const b = await seedProduct(p, business.id, { quantity: 1 });
    const key = `short-${uid()}`;
    await expect(commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "H", client: p,
      stockLines: [{ productId: a.id, quantity: 2, name: "A" }, { productId: b.id, quantity: 3, name: "B" }],
      create: async (tx: any) => ({ id: (await tx.order.create({ data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" }, select: { id: true } })).id, paymentId: null }) }))
      .rejects.toThrow(/Insufficient stock/);
    expect((await p.product.findUnique({ where: { id: a.id }, select: { quantity: true } }))?.quantity).toBe(5);
    expect((await p.product.findUnique({ where: { id: b.id }, select: { quantity: true } }))?.quantity).toBe(1);
    expect(await p.checkoutIdempotencyRecord.count({ where: { businessId: business.id, key } })).toBe(0);
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(0);
  });

  it("a failure after the stock decrement, inside create, leaves no order, record or stock change", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { quantity: 4 });
    const taken = `ORD-TAKEN-${uid()}`;
    await p.order.create({ data: { orderReference: taken, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" } });
    const key = `boom-${uid()}`;
    // The second order reuses an existing orderReference (unique index). The database rejects it AFTER the stock decrement ran.
    const outcome = await commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "H", client: p,
      stockLines: [{ productId: product.id, quantity: 1, name: "x" }],
      create: async (tx: any) => { await tx.order.create({ data: { orderReference: taken, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" } }); return { id: "unreached" }; } })
      .then(() => "resolved", (e: any) => e);
    expect(outcome).toMatchObject({ code: "P2002" });
    expect((await p.product.findUnique({ where: { id: product.id }, select: { quantity: true } }))?.quantity).toBe(4);
    expect(await p.checkoutIdempotencyRecord.count({ where: { businessId: business.id, key } })).toBe(0);
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(1);
  });

  it("the last unit is sold once across concurrent different-key orders; stock never goes negative", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { quantity: 1 });
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: `last-${uid()}-${i}`, requestHash: `H${i}`, client: p,
      stockLines: [{ productId: product.id, quantity: 1, name: "x" }],
      create: async (tx: any) => ({ id: (await tx.order.create({ data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" }, select: { id: true } })).id, paymentId: null }) })
      .catch((e) => ({ kind: "ERROR" as const, message: String(e?.message) }))));
    const created = results.filter((r: any) => r.kind === "CREATED");
    expect(created).toHaveLength(1);
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(1);
    expect((await p.product.findUnique({ where: { id: product.id }, select: { quantity: true, stockStatus: true } }))).toEqual({ quantity: 0, stockStatus: "OUT_OF_STOCK" });
  });

  it("a fresh client (simulated restart) replays a completed key from the database", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { quantity: 3 });
    const key = `restart-${uid()}`;
    const make = (client: any) => commitOrderOnce({ businessId: business.id, scope: SCOPE, idempotencyKey: key, requestHash: "H", client,
      stockLines: [{ productId: product.id, quantity: 1, name: "x" }],
      create: async (tx: any) => ({ id: (await tx.order.create({ data: { orderReference: `ORD-${uid()}`, businessId: business.id, status: "PENDING_PAYMENT", paymentStatus: "UNPAID", subtotalKES: 1, deliveryFeeKES: 0, discountKES: 0, totalKES: 1, currency: "KES", fulfilmentType: "PICKUP", source: "STOREFRONT" }, select: { id: true } })).id, paymentId: null }) });
    const first = await make(p);
    expect(first.kind).toBe("CREATED");
    const fresh = makeRealPrisma();
    extra.push(fresh);
    const second = await make(fresh);
    expect(second.kind).toBe("REPLAY");
    expect(await p.order.count({ where: { businessId: business.id } })).toBe(1);
  });
});
