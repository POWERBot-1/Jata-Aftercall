/**
 * Pre-order price integrity.
 *
 * A pre-order is a stored commitment to a price. The price must come from the business's own catalogue
 * (the same rule checkout uses), never from the request body. Client values may only choose the quantity,
 * an optional deposit term that cannot exceed the server total, and free-text notes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-a", role: "OWNER" } as null | { id: string; role: string },
  products: [] as any[],
  bulkPricing: [] as any[],
  created: [] as any[],
  notifications: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/tenant", () => ({
  canAccessBusiness: vi.fn(async (userId: string, businessId: string) => userId === "user-a" && businessId === "business-a"),
}));
vi.mock("@/lib/ai-config", () => ({
  getExtendedAIConfig: vi.fn(async () => ({ bulkPricing: mocks.bulkPricing })),
}));
vi.mock("@/lib/notification", () => ({
  createNotification: vi.fn(async (input: unknown) => {
    mocks.notifications.push(input);
    return {};
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    product: {
      // A product is found only inside the business it belongs to.
      findFirst: vi.fn(async ({ where }: any) =>
        mocks.products.find((p) => p.id === where.id && p.businessId === where.businessId) ?? null,
      ),
    },
    preOrder: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => {
        mocks.created.push(data);
        return { id: "pre_1", ...data };
      }),
    },
  },
}));

import { POST } from "@/app/api/preorders/route";

const CHICKEN = {
  id: "prod-chicken", businessId: "business-a", name: "Chicken", basePriceKES: 900, variantPriceKES: null,
  salePriceKES: null, stockStatus: "OUT_OF_STOCK", quantity: 0, preOrderAllowed: true, minOrder: 1, maxOrder: 10, isActive: true,
};

function request(body: unknown) {
  return new Request("https://jata.test/api/preorders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const base = { businessId: "business-a", productId: "prod-chicken", productName: "Chicken", quantity: 2, customerName: "Wanjiru" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "user-a", role: "OWNER" };
  mocks.products = [{ ...CHICKEN }];
  mocks.bulkPricing = [];
  mocks.created = [];
  mocks.notifications = [];
});

describe("pre-order price comes from the catalogue", () => {
  it("ignores a tampered fullPriceKES and stores the catalogue price", async () => {
    const res = await POST(request({ ...base, fullPriceKES: 1 }));
    expect(res.status).toBe(200);
    expect(mocks.created).toHaveLength(1);
    expect(mocks.created[0].fullPriceKES).toBe(900);
    const body = await res.json();
    expect(body.totalKES).toBe(1800);
  });

  it("recomputes the total when the quantity changes, using the server price", async () => {
    const res = await POST(request({ ...base, quantity: 3, fullPriceKES: 5 }));
    expect(res.status).toBe(200);
    expect(mocks.created[0].quantity).toBe(3);
    expect(mocks.created[0].fullPriceKES).toBe(900);
    expect((await res.json()).totalKES).toBe(2700);
  });

  it("uses the catalogue name, not a client-supplied name", async () => {
    await POST(request({ ...base, productName: "Free Chicken" }));
    expect(mocks.created[0].productName).toBe("Chicken");
  });

  it("charges the sale price when one is set, the same unit price the storefront charges", async () => {
    mocks.products[0] = { ...CHICKEN, salePriceKES: 700 };
    const res = await POST(request({ ...base, quantity: 1 }));
    expect(res.status).toBe(200);
    expect(mocks.created[0].fullPriceKES).toBe(700);
  });

  it("applies a configured bulk price for the quantity (a legitimate discount rule)", async () => {
    mocks.bulkPricing = [{ productName: "Chicken", minQuantity: 5, unitPriceKES: 800 }];
    const res = await POST(request({ ...base, quantity: 5 }));
    expect(res.status).toBe(200);
    expect(mocks.created[0].fullPriceKES).toBe(800);
    expect((await res.json()).totalKES).toBe(4000);
  });

  it("previews with the same server price (no tampering in preview either)", async () => {
    const res = await POST(request({ ...base, preview: true, fullPriceKES: 1 }));
    expect(res.status).toBe(200);
    expect((await res.json()).preOrder.fullPriceKES).toBe(900);
    expect(mocks.created).toHaveLength(0);
  });
});

describe("pre-orders are refused for products that cannot be pre-ordered", () => {
  it("refuses an item that is not in the catalogue (no client-priced preorders)", async () => {
    const res = await POST(request({ businessId: "business-a", productName: "Mystery item", quantity: 1, fullPriceKES: 1 }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a product that is discontinued or inactive", async () => {
    mocks.products[0] = { ...CHICKEN, isActive: false };
    const res = await POST(request(base));
    expect(res.status).toBe(409);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses an out-of-stock product that does not allow pre-orders", async () => {
    mocks.products[0] = { ...CHICKEN, preOrderAllowed: false };
    const res = await POST(request(base));
    expect(res.status).toBe(409);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a quantity below the minimum or above the maximum order", async () => {
    expect((await POST(request({ ...base, quantity: 11 }))).status).toBe(400);
    mocks.products[0] = { ...CHICKEN, minOrder: 3 };
    expect((await POST(request({ ...base, quantity: 2 }))).status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a product that has no price set rather than inventing one", async () => {
    mocks.products[0] = { ...CHICKEN, basePriceKES: null, variantPriceKES: null };
    const res = await POST(request(base));
    expect(res.status).toBe(409);
    expect(mocks.created).toHaveLength(0);
  });

  it("accepts a legitimate pre-order for an out-of-stock product that allows them", async () => {
    const res = await POST(request(base));
    expect(res.status).toBe(200);
    expect(mocks.created[0].productId).toBe("prod-chicken");
  });
});

describe("tenant boundary", () => {
  it("cannot pre-order another business's product, even with a valid product id", async () => {
    mocks.products.push({ ...CHICKEN, id: "prod-other", businessId: "business-b", basePriceKES: 1 });
    const res = await POST(request({ ...base, productId: "prod-other" }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("cannot pre-order for a business the caller does not belong to (403)", async () => {
    const res = await POST(request({ ...base, businessId: "business-b" }));
    expect(res.status).toBe(403);
    expect(mocks.created).toHaveLength(0);
  });
});

describe("deposit is a term, not a price", () => {
  it("accepts a deposit within the server total", async () => {
    const res = await POST(request({ ...base, depositRequiredKES: 500 }));
    expect(res.status).toBe(200);
    expect(mocks.created[0].depositRequiredKES).toBe(500);
  });

  it("refuses a deposit larger than the server total", async () => {
    const res = await POST(request({ ...base, depositRequiredKES: 5000 }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a negative or non-integer deposit", async () => {
    expect((await POST(request({ ...base, depositRequiredKES: -1 }))).status).toBe(400);
    expect((await POST(request({ ...base, depositRequiredKES: 10.5 }))).status).toBe(400);
  });
});

describe("AI front desk create_preorder uses the same price rule", () => {
  // The tool gets a catalogue snapshot (the brain). The customer's arguments must not set the price.
  const brain = {
    products: [
      { id: "prod-chicken", name: "Chicken", basePriceKES: 900, variantPriceKES: null, stockStatus: "OUT_OF_STOCK", quantity: 0, preOrderAllowed: true, minOrder: 1, maxOrder: 10, isActive: true },
    ],
    extendedConfig: { preordersAllowed: true, bulkPricing: [] },
  } as any;
  const context = { businessId: "business-a", preview: false, conversationId: "c1", brain } as any;

  it("prices a catalogue item from the catalogue, ignoring a customer-supplied price", async () => {
    const { executeBusinessTool } = await import("@/lib/ai-tools");
    const result: any = await executeBusinessTool("create_preorder", { productName: "Chicken", quantity: 2, fullPriceKES: 1 } as any, context);
    expect(result.ok).toBe(true);
    expect(result.data.fullPriceKES).toBe(900);
    expect(result.data.totalKES).toBe(1800);
  });

  it("refuses an item that is not in the catalogue instead of pricing it from the request", async () => {
    const { executeBusinessTool } = await import("@/lib/ai-tools");
    const result: any = await executeBusinessTool("create_preorder", { productName: "Free Chicken", quantity: 1, fullPriceKES: 1 } as any, context);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in this business catalogue/);
  });

  it("drops a deposit larger than the server total", async () => {
    const { executeBusinessTool } = await import("@/lib/ai-tools");
    const result: any = await executeBusinessTool("create_preorder", { productName: "Chicken", quantity: 1, depositRequiredKES: 5000 } as any, context);
    expect(result.ok).toBe(true);
    expect(result.data.depositRequiredKES).toBeNull();
  });
});
