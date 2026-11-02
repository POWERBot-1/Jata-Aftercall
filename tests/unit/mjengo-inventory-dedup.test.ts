import { describe, it, expect } from "vitest";
import { checkAvailability } from "../../lib/pos/inventory";

describe("mjengo: inventory duplicate line fix", () => {
  const config = { inventory: { enabled: true }, capabilities: ["stock_levels"] } as any;
  it("aggregates duplicate product lines against stock", () => {
    const stock = { "p1": 1 };
    const lines = [
      { productId: "p1", name: "Nail", quantity: 1, kind: "PRODUCT" },
      { productId: "p1", name: "Nail", quantity: 1, kind: "PRODUCT" },
    ] as any;
    const result = checkAvailability(config, lines, stock);
    expect(result.ok).toBe(false);
    expect(result.shortages[0].requested).toBe(2);
    expect(result.shortages[0].available).toBe(1);
  });
  it("allows same product within available", () => {
    const stock = { "p1": 5 };
    const lines = [
      { productId: "p1", name: "Nail", quantity: 2, kind: "PRODUCT" },
      { productId: "p1", name: "Nail", quantity: 2, kind: "PRODUCT" },
    ] as any;
    expect(checkAvailability(config, lines, stock).ok).toBe(true);
  });
});
