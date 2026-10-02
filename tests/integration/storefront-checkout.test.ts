/**
 * Storefront checkout (§25, §26, §27)
 *
 * The most important money path in the product: a guest can order, but the server decides
 * every amount, and an unpaid order still reaches the owner instead of disappearing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  business: { id: "business-a", slug: "choma-place", name: "Choma Place", isPublished: true, status: "ACTIVE", whatsapp: "0722000000", phone: "0722000000" },
  experience: {
    publishedJson: JSON.stringify({
      categoryKey: "food",
      themeKey: "food-grill",
      brand: { businessName: "Choma Place" },
      settings: { deliveryFeeKES: 200, minOrderKES: 0, deliveryEnabled: true, pickupEnabled: true },
      sections: [],
    }),
    categoryKey: "food",
    status: "PUBLISHED",
  },
  products: [
    { id: "p1", name: "Chicken", basePriceKES: 900, salePriceKES: null, imageUrl: null, minOrder: 1, maxOrder: 10, stockStatus: "IN_STOCK", preOrderAllowed: false, deliveryEligible: true, addOns: null, isActive: true },
  ],
  variants: [] as Array<Record<string, any>>,
  orderCreate: vi.fn(),
  initialize: vi.fn(),
  notify: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business) },
    businessExperience: { findUnique: vi.fn(async () => mocks.experience) },
    product: { findMany: vi.fn(async ({ where }: any) => mocks.products.filter((row) => where.id.in.includes(row.id))) },
    productVariant: { findMany: vi.fn(async ({ where }: any) => mocks.variants.filter((row) => where.id.in.includes(row.id))) },
    order: { create: mocks.orderCreate },
  },
}));

vi.mock("@/lib/experience/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/payments")>();
  return {
    ...actual,
    initializeOrderPayment: mocks.initialize,
    notifyNewOrder: mocks.notify,
  };
});

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, recordEvent: mocks.recordEvent, hashIp: () => "ip-hash", hashSession: () => "session-hash" };
});

import { POST } from "@/app/api/storefront/checkout/route";

let requestCounter = 0;
function request(body: unknown, headers: Record<string, string> = {}) {
  requestCounter += 1;
  return new Request("https://jata.test/api/storefront/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    // A distinct IP per call keeps the in-memory throttle from tripping across tests.
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${requestCounter % 250}` , ...headers },
  });
}

const order = {
  slug: "choma-place",
  items: [{ productId: "p1", quantity: 2 }],
  fulfilment: "DELIVERY",
  customer: { name: "Amina", phone: "0722123456" },
  location: "Kilimani",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.products = [
    { id: "p1", name: "Chicken", basePriceKES: 900, salePriceKES: null, imageUrl: null, minOrder: 1, maxOrder: 10, stockStatus: "IN_STOCK", preOrderAllowed: false, deliveryEligible: true, addOns: null, isActive: true },
  ];
  mocks.business.isPublished = true;
  mocks.business.status = "ACTIVE";
  mocks.experience.status = "PUBLISHED";
  mocks.experience.publishedJson = JSON.stringify({
    categoryKey: "food",
    themeKey: "food-grill",
    brand: { businessName: "Choma Place" },
    settings: { deliveryFeeKES: 200, minOrderKES: 0, deliveryEnabled: true, pickupEnabled: true },
    sections: [],
  });
  mocks.orderCreate.mockImplementation(async ({ data }: any) => ({ id: "order-1", ...data, items: data.items.create }));
  mocks.initialize.mockResolvedValue({ kind: "ok", reference: "JATA-ORD-1", authorizationUrl: "https://paystack.test/authorize", mock: false, paymentId: "pay-1" });
  mocks.notify.mockResolvedValue(undefined);
  mocks.recordEvent.mockResolvedValue(undefined);
});

describe("POST /api/storefront/checkout", () => {
  it("creates the order from server-side prices and starts a payment", async () => {
    const response = await POST(request({ ...order, totalKES: 1, deliveryFeeKES: 0 }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.totalKES).toBe(2000); // 2 × 900 delivery-order subtotal, fee applied by the server
    expect(body.subtotalKES).toBe(1800);
    expect(body.deliveryFeeKES).toBe(200);
    expect(body.authorizationUrl).toContain("paystack.test");
    expect(mocks.orderCreate).toHaveBeenCalledOnce();
    const created = mocks.orderCreate.mock.calls[0][0].data;
    expect(created.items.create[0].unitPriceKES).toBe(900);
    expect(created.businessId).toBe("business-a");
  });

  it("keeps an unpaid order visible when the payment gateway cannot start", async () => {
    mocks.initialize.mockResolvedValue({ kind: "error", error: "Paystack unavailable", status: 503 });
    const response = await POST(request(order));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.paymentError).toBe("Paystack unavailable");
    // The order exists, so the owner can still see and fulfil it (§27).
    expect(mocks.orderCreate).toHaveBeenCalledOnce();
  });

  it("refuses orders for an unpublished or suspended business", async () => {
    mocks.business.isPublished = false;
    expect((await POST(request(order))).status).toBe(404);
    mocks.business.isPublished = true;
    mocks.business.status = "SUSPENDED";
    expect((await POST(request(order))).status).toBe(404);
    mocks.business.status = "ACTIVE";
    mocks.experience.status = "DRAFT";
    expect((await POST(request(order))).status).toBe(404);
  });

  it("ignores items that are not in this tenant's catalogue", async () => {
    const response = await POST(request({ ...order, items: [{ productId: "another-business-product", quantity: 1 }] }));
    expect(response.status).toBe(409);
    await response.json();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it("validates the customer details before charging anything", async () => {
    expect((await POST(request({ ...order, customer: { name: "A", phone: "0722123456" } }))).status).toBe(400);
    expect((await POST(request({ ...order, customer: { name: "Amina", phone: "123" } }))).status).toBe(400);
    expect((await POST(request({ ...order, customer: { name: "Amina", phone: "0722123456", email: "not-an-email" } }))).status).toBe(400);
    expect((await POST(request({ ...order, items: [] }))).status).toBe(400);
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it("respects the business's delivery and pickup rules", async () => {
    mocks.experience.publishedJson = JSON.stringify({
      categoryKey: "food",
      brand: {},
      settings: { deliveryEnabled: false, pickupEnabled: true },
      sections: [],
    });
    expect((await POST(request({ ...order, fulfilment: "DELIVERY" }))).status).toBe(400);
    mocks.experience.publishedJson = JSON.stringify({
      categoryKey: "food",
      brand: {},
      settings: { deliveryEnabled: true, pickupEnabled: true, deliveryFeeKES: 200, minOrderKES: 0 },
      sections: [],
    });
  });

  it("enforces a minimum order value", async () => {
    mocks.experience.publishedJson = JSON.stringify({
      categoryKey: "food",
      brand: {},
      settings: { deliveryEnabled: true, pickupEnabled: true, minOrderKES: 5000 },
      sections: [],
    });
    const response = await POST(request({ ...order, fulfilment: "PICKUP" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/minimum order/i) });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it("records the commerce funnel for the business", async () => {
    await POST(request(order));
    const events = mocks.recordEvent.mock.calls.map(([params]: any) => params.eventType);
    expect(events).toContain("CHECKOUT_STARTED");
    expect(events).toContain("ORDER_CREATED");
  });
});
