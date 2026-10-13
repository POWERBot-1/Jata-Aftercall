/**
 * Real-PostgreSQL constraint checks through Prisma. Runs only when PRISMA_TEST_DATABASE_URL is set.
 * Engine actually used is reported by `prismaEngineLabel`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";

describe.skipIf(!realPrismaConfigured)("real Prisma: schema constraints and foreign keys", () => {
  const p = realPrismaConfigured ? sharedPrisma() : (null as any);
  afterAll(async () => { if (p) await p.$disconnect(); });

  it("Prisma reads and writes a row (round trip)", async () => {
    const { business } = await seedBusiness(p);
    const found = await p.business.findUnique({ where: { id: business.id }, select: { id: true, slug: true } });
    expect(found?.slug).toBe(business.slug);
  });

  it("a sale window that ends before it starts is rejected by the database CHECK", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id);
    await expect(p.product.update({
      where: { id: product.id },
      data: { salePriceKES: 800, salePriceStartsAt: new Date("2026-10-31T00:00:00Z"), salePriceEndsAt: new Date("2026-10-01T00:00:00Z") },
    })).rejects.toThrow();
    const unchanged = await p.product.findUnique({ where: { id: product.id }, select: { salePriceKES: true } });
    expect(unchanged?.salePriceKES).toBeNull();
  });

  it("a sale price with no window is accepted (legacy shape) and stays without a window", async () => {
    const { business } = await seedBusiness(p);
    const product = await seedProduct(p, business.id, { salePriceKES: 800 });
    const read = await p.product.findUnique({ where: { id: product.id }, select: { salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true } });
    expect(read).toEqual({ salePriceKES: 800, salePriceStartsAt: null, salePriceEndsAt: null });
  });

  it("checkout idempotency keys are unique per business and scope (DB unique index)", async () => {
    const { business } = await seedBusiness(p);
    const key = `k-${uid()}`;
    await p.checkoutIdempotencyRecord.create({ data: { businessId: business.id, scope: "storefront.checkout", key, requestHash: "h1", state: "STARTED" } });
    await expect(p.checkoutIdempotencyRecord.create({ data: { businessId: business.id, scope: "storefront.checkout", key, requestHash: "h2", state: "STARTED" } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("an idempotency record cannot point at a business that does not exist (foreign key)", async () => {
    await expect(p.checkoutIdempotencyRecord.create({
      data: { businessId: `missing-${uid()}`, scope: "storefront.checkout", key: `k-${uid()}`, requestHash: "h", state: "STARTED" },
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("payment references are unique (DB unique index)", async () => {
    const { owner, business } = await seedBusiness(p);
    const reference = `JATA-PAY-${uid()}`;
    const data = { reference, businessId: business.id, userId: owner.id, amount: 800, currency: "KES", status: "PENDING", purpose: "ORDER" };
    await p.payment.create({ data });
    await expect(p.payment.create({ data })).rejects.toMatchObject({ code: "P2002" });
  });
});
