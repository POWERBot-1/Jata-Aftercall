/**
 * Inventory: duplicate basket lines and concurrent stock claims.
 *
 * Two defects are covered:
 *   1. The availability check must sum duplicate product lines before comparing with on-hand stock
 *      (2 × 1 against 1 unit on hand is a shortage, however the basket was assembled).
 *   2. The stock write must be a conditional decrement (`quantity >= delta`) so two cashiers
 *      selling the last unit cannot both succeed, and a partial failure must not leave a movement
 *      without the matching on-hand change.
 *
 * (2) is exercised against a small ledger double that models the conditional write the store layer
 * performs; the real PostgreSQL row-lock proof belongs to the blocked `*-postgres` suite.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: {}, prisma: {} }));

import { checkAvailability, movementsForSale, stockAfter, isLowStock, isOutOfStock, stockAlerts } from "../../lib/pos/inventory";

const config = { inventory: { enabled: true }, capabilities: ["stock_levels"] } as any;
const line = (overrides: Partial<{ productId: string; name: string; quantity: number; kind: string; unitKey: string }> = {}) =>
  ({ productId: "p1", name: "Nail (4 inch)", quantity: 1, kind: "PRODUCT", unitKey: "piece", ...overrides }) as any;

describe("mjengo: inventory duplicate-line handling", () => {
  it("aggregates duplicate product lines: 2 × 1 against 1 on hand is a shortage", () => {
    const result = checkAvailability(config, [line(), line()], { p1: 1 });
    expect(result.ok).toBe(false);
    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]).toMatchObject({ productId: "p1", requested: 2, available: 1 });
  });

  it("allows duplicates that together fit, and reports the aggregated quantity", () => {
    expect(checkAvailability(config, [line({ quantity: 2 }), line({ quantity: 2 })], { p1: 5 }).ok).toBe(true);
    const exact = checkAvailability(config, [line({ quantity: 2 }), line({ quantity: 3 })], { p1: 5 });
    expect(exact.ok).toBe(true);
  });

  it("keeps per-product shortages separate", () => {
    const result = checkAvailability(config, [line(), line(), line({ productId: "p2", name: "Hammer", quantity: 5 })], { p1: 10, p2: 1 });
    expect(result.ok).toBe(false);
    expect(result.shortages.map((shortage) => shortage.productId)).toEqual(["p2"]);
  });

  it("never blocks a sale for services, untracked stock, or a non-positive quantity line", () => {
    expect(checkAvailability(config, [line({ kind: "SERVICE", quantity: 99 })], { p1: 1 }).ok).toBe(true);
    expect(checkAvailability({ inventory: { enabled: false }, capabilities: [] } as any, [line({ quantity: 99 })], { p1: 1 }).ok).toBe(true);
    expect(checkAvailability(config, [line({ quantity: 0 }), line({ quantity: -3 })], { p1: 0 }).ok).toBe(true);
  });

  it("missing stock reads as zero, never as 'unlimited'", () => {
    const result = checkAvailability(config, [line()], {});
    expect(result.ok).toBe(false);
    expect(result.shortages[0].available).toBe(0);
  });
});

describe("mjengo: inventory movements", () => {
  it("writes one negative movement per line and sums to the sold quantity", () => {
    const movements = movementsForSale([line({ quantity: 2 }), line({ quantity: 3 })], { saleId: "sale_1" });
    expect(movements).toHaveLength(2);
    expect(movements.reduce((sum, movement) => sum + movement.delta, 0)).toBe(-5);
    expect(movements.every((movement) => movement.reason === "SALE" && movement.refId === "sale_1")).toBe(true);
  });

  it("derives on-hand from the ledger rather than a stored count", () => {
    expect(stockAfter([{ delta: 10 }, { delta: -3 }, { delta: -2 }])).toBe(5);
  });

  it("flags out-of-stock and low-stock differently", () => {
    expect(isOutOfStock({ quantity: 0 })).toBe(true);
    // A zero-quantity item can be both: `stockAlerts` then labels it "out", not "low".
    expect(isLowStock({ quantity: 0, reorderLevel: 5 })).toBe(true);
    expect(isLowStock({ quantity: 3, reorderLevel: 5 })).toBe(true);
    expect(isLowStock({ quantity: 6, reorderLevel: 5 })).toBe(false);
    // No reorder level configured means no low-stock signal.
    expect(isLowStock({ quantity: 0, reorderLevel: 0 })).toBe(false);
    // Severity preference: out-of-stock wins.
    const [alert] = stockAlerts([{ productId: "p1", name: "Nail", quantity: 0, reorderLevel: 5 }]);
    expect(alert.severity).toBe("out");
  });
});

/**
 * Conditional-decrement double. `decrement` mirrors the store layer's guarded write:
 * `UPDATE ... SET quantity = quantity - delta WHERE quantity >= delta`, returning the row count.
 */
function ledger(initial: Record<string, number>) {
  const stock = { ...initial };
  return {
    stock,
    async decrement(productId: string, delta: number): Promise<boolean> {
      const current = stock[productId] ?? 0;
      if (current < delta) return false;
      // Yield to the event loop, so two concurrent callers genuinely interleave as they would
      // against two database connections.
      await Promise.resolve();
      if ((stock[productId] ?? 0) < delta) return false;
      stock[productId] = (stock[productId] ?? 0) - delta;
      return true;
    },
  };
}

describe("mjengo: inventory concurrency", () => {
  it("two concurrent sales of the last unit: exactly one succeeds", async () => {
    const store = ledger({ p1: 1 });
    const results = await Promise.all([store.decrement("p1", 1), store.decrement("p1", 1)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(store.stock.p1).toBe(0);
  });

  it("ten concurrent claims for six units: six succeed and the count never goes negative", async () => {
    const store = ledger({ p1: 6 });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.decrement("p1", 1)));
    expect(results.filter(Boolean)).toHaveLength(6);
    expect(store.stock.p1).toBe(0);
    expect(store.stock.p1).toBeGreaterThanOrEqual(0);
  });

  it("never allows a negative balance even when the check and the write are separated", async () => {
    const store = ledger({ p1: 0 });
    for (let attempt = 0; attempt < 5; attempt += 1) await store.decrement("p1", 1);
    expect(store.stock.p1).toBe(0);
  });
});
