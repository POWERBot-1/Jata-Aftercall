import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as any,
  guard: { ok: true } as any,
  products: [] as any[],
}));

vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/tenant", () => ({ guardTenantMutation: async () => state.guard }));
vi.mock("@/lib/ai-business-brain", () => ({
  getBusinessBrain: async () => ({
    business: { id: "b1", name: "Choma Place" },
    products: state.products,
    services: [],
    faqs: [],
    aiConfig: null,
    knowledge: [],
  }),
}));

import { GET } from "@/app/api/ai/brain/route";

const product = (over: Record<string, unknown> = {}) => ({
  id: "p1", name: "Chicken", description: null, category: null, basePriceKES: 1000, variantPriceKES: null,
  salePriceKES: 800, salePriceStartsAt: new Date("2026-10-01T00:00:00Z"), salePriceEndsAt: new Date("2026-10-31T00:00:00Z"),
  currency: "KES", stockStatus: "IN_STOCK", preOrderAllowed: false, deliveryEligible: true, ...over,
});

async function brainProduct(now: string, over: Record<string, unknown> = {}) {
  vi.setSystemTime(new Date(now));
  state.products = [product(over)];
  const res = await GET(new Request("https://jata.test/api/ai/brain?businessId=b1"));
  expect(res.status).toBe(200);
  return (await res.json()).products[0];
}

beforeEach(() => {
  vi.useRealTimers();
  state.session = { user: { id: "u1" } };
  state.guard = { ok: true };
});

describe("AI brain route: effective price and sale end (owner-only)", () => {
  it("while a sale is running: effective price, original price and the end time are returned", async () => {
    const p = await brainProduct("2026-10-10T09:00:00Z");
    expect(p).toMatchObject({ priceKES: 800, wasPriceKES: 1000, saleEndsAt: "2026-10-31T00:00:00.000Z" });
  });

  it("before the window and after it: base price, no end time", async () => {
    expect(await brainProduct("2026-09-30T12:00:00Z")).toMatchObject({ priceKES: 1000, wasPriceKES: null, saleEndsAt: null });
    expect(await brainProduct("2026-10-31T00:00:00Z")).toMatchObject({ priceKES: 1000, wasPriceKES: null, saleEndsAt: null });
  });

  it("a sale with no window (legacy) shows no end time and charges the base price", async () => {
    expect(await brainProduct("2026-10-10T09:00:00Z", { salePriceStartsAt: null, salePriceEndsAt: null })).toMatchObject({ priceKES: 1000, saleEndsAt: null });
  });

  it("never returns the raw sale fields", async () => {
    const p = await brainProduct("2026-10-10T09:00:00Z");
    expect(p).not.toHaveProperty("salePriceKES");
    expect(p).not.toHaveProperty("salePriceStartsAt");
    expect(p).not.toHaveProperty("salePriceEndsAt");
  });

  it("refuses unauthenticated and cross-tenant requests", async () => {
    state.session = null;
    expect((await GET(new Request("https://jata.test/api/ai/brain?businessId=b1"))).status).toBe(401);
    state.session = { user: { id: "u1" } };
    state.guard = { ok: false, status: 403, error: "Forbidden" };
    expect((await GET(new Request("https://jata.test/api/ai/brain?businessId=other"))).status).toBe(403);
  });
});
