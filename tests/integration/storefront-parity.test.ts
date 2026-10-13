/**
 * Quote-to-checkout parity, sale windows, bulk precedence, provider failure and stock. MOCK-ONLY: the fake database
 * emulates keys and transactions. It is NOT the Prisma runtime and NOT PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  products: [] as any[],
  bulk: [] as any[],
  records: new Map<string, any>(),
  orders: [] as any[],
  paymentRecord: vi.fn(),
  startPayment: vi.fn(),
  notify: vi.fn(),
  recordEvent: vi.fn(),
}));

const SETTINGS = {
  categoryKey: "food",
  themeKey: "food-grill",
  brand: { businessName: "Choma Place" },
  settings: { deliveryFeeKES: 200, minOrderKES: 0, deliveryEnabled: true, pickupEnabled: true },
  sections: [],
};

vi.mock("@/lib/db", () => {
  const db: any = {
    business: { findUnique: async () => ({ id: "business-a", slug: "choma-place", name: "Choma Place", isPublished: true, status: "ACTIVE", whatsapp: "0722000000", phone: "0722000000" }) },
    businessExperience: { findUnique: async () => ({ publishedJson: JSON.stringify(SETTINGS), categoryKey: "food", status: "PUBLISHED" }) },
    product: {
      findMany: async ({ where }: any) => mocks.products.filter((p) => where.id.in.includes(p.id) && p.businessId === where.businessId).map((p) => structuredClone(p)),
      findFirst: async ({ where }: any) => mocks.products.find((p) => p.id === where.id && p.businessId === where.businessId) ?? null,
      updateMany: async ({ where, data }: any) => {
        const p = mocks.products.find((x) => x.id === where.id && x.businessId === where.businessId && x.quantity === where.quantity);
        if (!p) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    productVariant: { findMany: async () => [] },
    order: {
      // No earlier unpaid orders in this mock; the unpaid-attempt rule is covered against real Prisma in tests/prisma.
      findMany: async () => [],
      create: async ({ data }: any) => {
        const row = { id: `ord-${mocks.orders.length + 1}`, ...data, items: data.items?.create ?? [] };
        mocks.orders.push(row);
        return { id: row.id, orderReference: data.orderReference, totalKES: data.totalKES, status: data.status, paymentStatus: data.paymentStatus };
      },
    },
    checkoutIdempotencyRecord: {
      create: async ({ data }: any) => {
        const k = `${data.businessId}|${data.scope}|${data.key}`;
        if (mocks.records.has(k)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: `rec-${mocks.records.size + 1}`, orderId: null, paymentId: null, responseJson: null, ...data };
        mocks.records.set(k, row);
        return { id: row.id };
      },
      findUnique: async ({ where }: any) => {
        const { businessId, scope, key } = where.businessId_scope_key;
        return mocks.records.get(`${businessId}|${scope}|${key}`) ?? null;
      },
      update: async ({ where, data }: any) => {
        const row = [...mocks.records.values()].find((r) => r.id === where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = [...mocks.records.values()].find((r) => r.id === where.id && where.state.in.includes(r.state));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { default: db };
});

vi.mock("@/lib/ai-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-config")>();
  return { ...actual, getExtendedAIConfig: async () => ({ bulkPricing: mocks.bulk }) };
});

vi.mock("@/lib/experience/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/payments")>();
  return { ...actual, createOrderPaymentRecord: mocks.paymentRecord, startOrderPayment: mocks.startPayment, notifyNewOrder: mocks.notify };
});

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, recordEvent: mocks.recordEvent, hashIp: () => "ip", hashSession: () => "session" };
});

import { POST as quote } from "@/app/api/storefront/quote/route";
import { POST as checkout } from "@/app/api/storefront/checkout/route";

let counter = 0;
function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  counter += 1;
  return new Request(`https://jata.test${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.${counter % 250}.1`, ...headers },
  });
}

const T = (iso: string) => new Date(iso);
const product = (over: Record<string, unknown> = {}) => ({
  id: "p1", businessId: "business-a", name: "Chicken", basePriceKES: 1000, variantPriceKES: null, salePriceKES: 800,
  salePriceStartsAt: T("2026-10-01T00:00:00Z"), salePriceEndsAt: T("2026-10-31T00:00:00Z"),
  imageUrl: null, minOrder: 1, maxOrder: 20, stockStatus: "IN_STOCK", preOrderAllowed: false, deliveryEligible: true,
  addOns: null, isActive: true, quantity: null, ...over,
});

const item = (quantity: number, productId = "p1") => ({ productId, quantity });
const pickup = (items: unknown[], extra: Record<string, unknown> = {}) => ({ slug: "choma-place", items, fulfilment: "PICKUP", ...extra });

beforeEach(() => {
  vi.useRealTimers();
  mocks.products = [product()];
  mocks.bulk = [];
  mocks.records.clear();
  mocks.orders.length = 0;
  mocks.paymentRecord.mockReset();
  mocks.startPayment.mockReset();
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.recordEvent.mockReset().mockResolvedValue(undefined);
  mocks.paymentRecord.mockResolvedValue({ kind: "record", paymentId: "pay-1", reference: "JATA-PAY-1", amount: 0, ownerId: "owner" });
  mocks.startPayment.mockResolvedValue({ kind: "ok", reference: "JATA-PAY-1", authorizationUrl: "https://paystack.test/a", mock: false, paymentId: "pay-1" });
});

async function quoteOf(items: unknown[]) {
  const res = await quote(req("/api/storefront/quote", pickup(items)));
  expect(res.status).toBe(200);
  return res.json();
}

describe("quote-to-checkout parity (mock-only)", () => {
  it("the quote total is the total the order is created with, line by line", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const q = await quoteOf([item(2)]);
    expect(q.totalKES).toBe(1600);
    const res = await checkout(req("/api/storefront/checkout", { ...pickup([item(2)]), expectedTotalKES: q.totalKES, customer: { name: "Amina", phone: "0722123456" } }, { "idempotency-key": "parity-1" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.totalKES).toBe(q.totalKES);
    expect(mocks.orders[0].items[0].unitPriceKES).toBe(q.lines[0].unitPriceKES);
  });

  it("a sale price applies inside the window and the base price outside it", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    expect((await quoteOf([item(1)])).totalKES).toBe(800);
    vi.setSystemTime(T("2026-09-30T23:59:00Z")); // before the window
    expect((await quoteOf([item(1)])).totalKES).toBe(1000);
  });

  it("the window end is exclusive: at the exact end instant the base price is charged", async () => {
    vi.setSystemTime(T("2026-10-31T00:00:00Z"));
    expect((await quoteOf([item(1)])).totalKES).toBe(1000);
    vi.setSystemTime(T("2026-10-30T23:59:59Z"));
    expect((await quoteOf([item(1)])).totalKES).toBe(800);
  });

  it("a sale that expires between quote and checkout refuses the old total and creates nothing", async () => {
    vi.setSystemTime(T("2026-10-30T23:00:00Z"));
    const q = await quoteOf([item(2)]);
    expect(q.totalKES).toBe(1600);
    vi.setSystemTime(T("2026-10-31T00:30:00Z")); // sale ended while the customer was reviewing
    const res = await checkout(req("/api/storefront/checkout", { ...pickup([item(2)]), expectedTotalKES: q.totalKES, customer: { name: "Amina", phone: "0722123456" } }, { "idempotency-key": "expire-1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ priceChanged: true, totalKES: 2000 });
    expect(mocks.orders).toHaveLength(0);
    expect(mocks.startPayment).not.toHaveBeenCalled();
  });

  it("a sale that starts between quote and checkout also refuses the old total (the customer must confirm again)", async () => {
    mocks.products = [product({ salePriceStartsAt: T("2026-11-01T00:00:00Z"), salePriceEndsAt: T("2026-11-30T00:00:00Z") })];
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const q = await quoteOf([item(1)]);
    expect(q.totalKES).toBe(1000);
    vi.setSystemTime(T("2026-11-01T00:00:00Z"));
    const res = await checkout(req("/api/storefront/checkout", { ...pickup([item(1)]), expectedTotalKES: q.totalKES, customer: { name: "Amina", phone: "0722123456" } }, { "idempotency-key": "start-1" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ priceChanged: true, totalKES: 800 });
    expect(mocks.orders).toHaveLength(0);
  });

  it("a bulk rule applies when it is lower than the sale price, and never raises it", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    mocks.bulk = [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 750 }];
    expect((await quoteOf([item(10)])).totalKES).toBe(7500); // 10 × 750, the lower rule
    mocks.bulk = [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 900 }];
    expect((await quoteOf([item(10)])).totalKES).toBe(8000); // rule is higher than the 800 sale: sale kept
    mocks.bulk = [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 750 }];
    expect((await quoteOf([item(9)])).totalKES).toBe(7200); // below the quantity threshold: sale price only
  });

  it("the quote and checkout agree on a bulk-priced basket", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    mocks.bulk = [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 750 }];
    const q = await quoteOf([item(12)]);
    const res = await checkout(req("/api/storefront/checkout", { ...pickup([item(12)]), expectedTotalKES: q.totalKES, customer: { name: "Amina", phone: "0722123456" } }, { "idempotency-key": "bulk-1" }));
    expect(res.status).toBe(201);
    expect((await res.json()).totalKES).toBe(q.totalKES);
  });

  it("a provider failure is kept on the order; a same-key retry returns the stored outcome and does not start a second payment", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    mocks.startPayment.mockResolvedValueOnce({ kind: "error", error: "Paystack unavailable", status: 503 });
    const payload = { ...pickup([item(1)]), expectedTotalKES: 800, customer: { name: "Amina", phone: "0722123456" } };
    const first = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": "prov-1" }));
    expect((await first.json()).paymentError).toBe("Paystack unavailable");
    const retry = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": "prov-1" }));
    expect((await retry.json()).paymentError).toBe("Paystack unavailable");
    expect(mocks.orders).toHaveLength(1);
    expect(mocks.startPayment).toHaveBeenCalledTimes(1);
  });

  it("a stock conflict refuses the quote and the checkout, and creates no order", async () => {
    mocks.products = [product({ quantity: 1 })];
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const q = await quoteOf([item(2)]);
    expect(q.unavailable.length).toBeGreaterThan(0);
    const res = await checkout(req("/api/storefront/checkout", { ...pickup([item(2)]), expectedTotalKES: 1600, customer: { name: "Amina", phone: "0722123456" } }, { "idempotency-key": "stock-1" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.orders).toHaveLength(0);
  });

  it("the last unit is sold once: a second order for it is refused and stock is not oversold", async () => {
    mocks.products = [product({ quantity: 1, salePriceKES: null, salePriceStartsAt: null, salePriceEndsAt: null })];
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const body = { ...pickup([item(1)]), expectedTotalKES: 1000, customer: { name: "Amina", phone: "0722123456" } };
    const a = await checkout(req("/api/storefront/checkout", body, { "idempotency-key": "last-a" }));
    const b = await checkout(req("/api/storefront/checkout", body, { "idempotency-key": "last-b" }));
    expect(a.status).toBe(201);
    expect(b.status).toBeGreaterThanOrEqual(400);
    expect(mocks.orders).toHaveLength(1);
    expect(mocks.products[0].quantity).toBe(0);
  });
});
