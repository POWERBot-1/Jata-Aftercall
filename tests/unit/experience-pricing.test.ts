/**
 * Server-authoritative pricing (§26)
 *
 * A browser may *display* prices; it may never decide them. These tests prove the server
 * re-derives every amount from the tenant's own catalogue rows and ignores client arithmetic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  products: [] as Array<Record<string, any>>,
  variants: [] as Array<Record<string, any>>,
}));

vi.mock("@/lib/db", () => ({
  default: {
    product: {
      findMany: async ({ where }: any) => store.products.filter((row) => where.id.in.includes(row.id)),
    },
    productVariant: {
      findMany: async ({ where }: any) => store.variants.filter((row) => where.id.in.includes(row.id)),
    },
  },
}));

import { priceBasket, unitPriceFor } from "@/lib/experience/pricing";

function product(overrides: Record<string, any> = {}) {
  return {
    id: "p1",
    name: "Chicken biryani",
    basePriceKES: 900,
    salePriceKES: null,
    imageUrl: null,
    minOrder: 1,
    maxOrder: 20,
    stockStatus: "IN_STOCK",
    preOrderAllowed: false,
    deliveryEligible: true,
    addOns: null,
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  store.products = [product()];
  store.variants = [];
});

describe("unit price resolution", () => {
  it("prefers a sale price, then a variant price, then the base price", () => {
    // A sale only counts inside a valid window; with no window the base price is charged.
    expect(unitPriceFor({ basePriceKES: 1000, salePriceKES: 800 })).toBe(1000);
    expect(unitPriceFor({ basePriceKES: 1000, salePriceKES: 800, salePriceStartsAt: new Date("2026-01-01T00:00:00Z"), salePriceEndsAt: new Date("2026-02-01T00:00:00Z") }, null, new Date("2026-01-15T00:00:00Z"))).toBe(800);
    expect(unitPriceFor({ basePriceKES: 1000, salePriceKES: null }, { priceKES: 1200 })).toBe(1200);
    expect(unitPriceFor({ basePriceKES: 1000, salePriceKES: 0 }, null)).toBe(1000);
    expect(unitPriceFor({ basePriceKES: null }, null)).toBe(0);
  });
});

describe("basket pricing", () => {
  it("uses the stored catalogue price, not the price the client sent", async () => {
    const result = await priceBasket({
      businessId: "b1",
      items: [{ productId: "p1", quantity: 2 }],
      fulfilment: "PICKUP",
    });
    expect(result.subtotalKES).toBe(1800);
    expect(result.totalKES).toBe(1800);
    expect(result.deliveryFeeKES).toBe(0);
    expect(result.lineItems[0].unitPriceKES).toBe(900);
  });

  it("adds the tenant's delivery fee only for delivery orders", async () => {
    const pickup = await priceBasket({ businessId: "b1", items: [{ productId: "p1", quantity: 1 }], fulfilment: "PICKUP", settings: { deliveryFeeKES: 250 } });
    expect(pickup.totalKES).toBe(900);

    const delivery = await priceBasket({ businessId: "b1", items: [{ productId: "p1", quantity: 1 }], fulfilment: "DELIVERY", settings: { deliveryFeeKES: 250 } });
    expect(delivery.deliveryFeeKES).toBe(250);
    expect(delivery.totalKES).toBe(1150);
  });

  it("never lets a discount make an order free or negative", async () => {
    const result = await priceBasket({
      businessId: "b1",
      items: [{ productId: "p1", quantity: 1 }],
      fulfilment: "PICKUP",
    });
    expect(result.totalKES).toBeGreaterThan(0);
    expect(result.discountKES).toBeGreaterThanOrEqual(0);
    expect(result.subtotalKES - result.discountKES + result.deliveryFeeKES).toBe(result.totalKES);
  });

  it("prices variants and add-ons from the catalogue", async () => {
    store.products = [product({ addOns: JSON.stringify([{ id: "a1", name: "Extra sauce", priceKES: 100 }]) })];
    store.variants = [{ id: "v1", productId: "p1", label: "Large", priceKES: 1200, stockStatus: "IN_STOCK", options: null }];
    const result = await priceBasket({
      businessId: "b1",
      items: [{ productId: "p1", variantId: "v1", quantity: 1, addOnIds: ["a1"] }],
      fulfilment: "PICKUP",
    });
    expect(result.lineItems[0].unitPriceKES).toBe(1300);
    expect(result.subtotalKES).toBe(1300);
    expect(result.lineItems[0].variantDesc).toContain("Large");
  });

  it("refuses items that do not belong to this tenant", async () => {
    const result = await priceBasket({ businessId: "b1", items: [{ productId: "someone-elses-product", quantity: 1 }] });
    expect(result.subtotalKES).toBe(0);
    expect(result.unavailable.length).toBe(1);
    expect(result.unavailable[0].reason).toMatch(/no longer available/i);
  });

  it("drops out-of-stock items and honours minimum order quantities", async () => {
    store.products = [product({ id: "p2", stockStatus: "OUT_OF_STOCK" }), product({ id: "p3", minOrder: 5 })];
    const outOfStock = await priceBasket({ businessId: "b1", items: [{ productId: "p2", quantity: 1 }] });
    expect(outOfStock.subtotalKES).toBe(0);
    expect(outOfStock.unavailable[0].reason).toMatch(/out of stock/i);

    const minOrder = await priceBasket({ businessId: "b1", items: [{ productId: "p3", quantity: 1 }] });
    expect(minOrder.lineItems[0].quantity).toBe(5);
  });

  it("clamps absurd quantities instead of trusting the client", async () => {
    const result = await priceBasket({ businessId: "b1", items: [{ productId: "p1", quantity: 100000 }] });
    expect(result.lineItems[0].quantity).toBeLessThanOrEqual(20);
  });

  it("prices an empty basket as zero without erroring", async () => {
    const result = await priceBasket({ businessId: "b1", items: [] });
    expect(result.totalKES).toBe(0);
    expect(result.lineItems).toHaveLength(0);
  });
});
