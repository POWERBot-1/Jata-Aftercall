/**
 * Cart creation: who may create a cart, and where its prices come from.
 *
 * Guest shopping is supported by the storefront checkout (published businesses only, server-priced).
 * Nothing in the app creates or reads guest carts, so the cart API is for the business's own staff.
 * A cart may only hold catalogue items at catalogue prices; a delivery fee comes only from configured zones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  products: [] as any[],
  created: [] as any[],
  deliveryZones: {} as Record<string, number>,
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/tenant", () => ({
  canAccessBusiness: vi.fn(async (userId: string, businessId: string) => userId === "user-a" && businessId === "business-a"),
}));
vi.mock("@/lib/ai-config", () => ({
  getExtendedAIConfig: vi.fn(async () => ({
    delivery: { zones: Object.entries(mocks.deliveryZones).map(([name, feeKES]) => ({ name, feeKES, minOrderKES: 0, enabled: true })) },
  })),
  resolveDeliveryZoneFee: vi.fn((delivery: any, zone: string) => {
    const hit = delivery.zones.find((z: any) => z.name === zone);
    return hit ? { allowed: true, feeKES: hit.feeKES, reason: "" } : { allowed: false, feeKES: 0, reason: "We do not deliver there." };
  }),
}));
vi.mock("@/lib/db", () => ({
  default: {
    product: {
      findFirst: vi.fn(async ({ where }: any) =>
        mocks.products.find((p) => p.id === where.id && p.businessId === where.businessId) ?? null,
      ),
      findMany: vi.fn(async ({ where }: any) => mocks.products.filter((p) => p.businessId === where.businessId)),
    },
    aIConfiguration: { findUnique: vi.fn(async () => null) },
    cart: {
      create: vi.fn(async ({ data }: any) => {
        mocks.created.push(data);
        return { id: "cart_1", businessId: data.businessId, status: data.status, items: data.items.create.map((i: any, n: number) => ({ id: `ci_${n}`, ...i })) };
      }),
    },
  },
}));

import { POST } from "@/app/api/cart/route";

const CHICKEN = {
  id: "prod-chicken", businessId: "business-a", name: "Chicken", basePriceKES: 900, variantPriceKES: null,
  salePriceKES: null, stockStatus: "IN_STOCK", quantity: 20, preOrderAllowed: false, minOrder: 1, maxOrder: 10, isActive: true,
};

function request(body: unknown) {
  return new Request("https://jata.test/api/cart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: "user-a", role: "OWNER" };
  mocks.products = [{ ...CHICKEN }];
  mocks.created = [];
  mocks.deliveryZones = { Kilimani: 200 };
});

describe("who may create a cart", () => {
  it("refuses an anonymous cart (guest shopping goes through storefront checkout)", async () => {
    mocks.user = null;
    const res = await POST(request({ businessId: "business-a", items: [{ productId: "prod-chicken", quantity: 1 }] }));
    expect(res.status).toBe(401);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a member of another business", async () => {
    const res = await POST(request({ businessId: "business-b", items: [{ productId: "prod-chicken", quantity: 1 }] }));
    expect(res.status).toBe(403);
    expect(mocks.created).toHaveLength(0);
  });
});

describe("cart lines are catalogue lines at catalogue prices", () => {
  it("refuses a line for an item that is not in the catalogue, even with a client price", async () => {
    const res = await POST(request({ businessId: "business-a", items: [{ name: "Free burger", unitPriceKES: 1, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("refuses a product id that belongs to another business (no fallback to the client price)", async () => {
    mocks.products.push({ ...CHICKEN, id: "prod-other", businessId: "business-b", basePriceKES: 1 });
    const res = await POST(request({ businessId: "business-a", items: [{ productId: "prod-other", unitPriceKES: 1, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });

  it("stores the catalogue price, not a tampered unitPriceKES", async () => {
    const res = await POST(request({ businessId: "business-a", items: [{ productId: "prod-chicken", unitPriceKES: 1, quantity: 2 }] }));
    expect(res.status).toBe(200);
    expect(mocks.created[0].items.create[0].unitPriceKES).toBe(900);
  });

  it("refuses service lines: services are booked, not priced from a cart request", async () => {
    const res = await POST(request({ businessId: "business-a", items: [{ serviceId: "svc-1", name: "Haircut", unitPriceKES: 1, quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(mocks.created).toHaveLength(0);
  });
});

describe("delivery fee comes only from configured zones", () => {
  it("ignores a client-supplied delivery fee when no zone is named", async () => {
    const res = await POST(request({ businessId: "business-a", items: [{ productId: "prod-chicken", quantity: 1 }], deliveryFeeKES: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.calculation.deliveryFeeKES).toBe(0);
  });

  it("uses the configured zone fee when a zone is named, whatever the client sends", async () => {
    const res = await POST(request({ businessId: "business-a", items: [{ productId: "prod-chicken", quantity: 1 }], deliveryZone: "Kilimani", deliveryFeeKES: 0 }));
    const body = await res.json();
    expect(body.calculation.deliveryFeeKES).toBe(200);
  });
});
