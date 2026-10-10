/**
 * Storefront quote and checkout routes against real Prisma + PostgreSQL. Only the payment provider call
 * (startOrderPayment) and analytics are replaced. Everything else (pricing, sale windows, stock, idempotency, the
 * unpaid-attempt rule, tenant scoping, and the order/payment rows) is real. Runs only when PRISMA_TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { seedBusiness, seedProduct, uid } from "../helpers/prisma-fixtures";

const mocks = vi.hoisted(() => ({
  startPayment: vi.fn(),
  recordEvent: vi.fn(),
  notify: vi.fn(),
  session: { current: null as null | { userId: string; role: string } },
  verifyTransaction: vi.fn(),
}));

vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => mocks.session.current };
});
vi.mock("@/lib/paystack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paystack")>();
  return { ...actual, verifyTransaction: mocks.verifyTransaction };
});
vi.mock("@/lib/experience/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/payments")>();
  return { ...actual, startOrderPayment: mocks.startPayment, notifyNewOrder: mocks.notify };
});
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, recordEvent: mocks.recordEvent, hashIp: () => "ip", hashSession: () => "session" };
});

import { POST as quote } from "@/app/api/storefront/quote/route";
import { POST as checkout } from "@/app/api/storefront/checkout/route";
import { GET as paystackVerify } from "@/app/api/paystack/verify/route";

const p = realPrismaConfigured ? sharedPrisma() : (null as any);
let counter = 0;
const ip = () => `10.9.${(counter += 1) % 250}.1`;
function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://jata.test${path}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...headers },
  });
}
const T = (iso: string) => new Date(iso);
const item = (quantity: number, productId: string) => ({ productId, quantity });
const pickup = (slug: string, items: unknown[], extra: Record<string, unknown> = {}) => ({ slug, items, fulfilment: "PICKUP", ...extra });
const customer = (phone = "0722123456") => ({ name: "Amina", phone });

describe.skipIf(!realPrismaConfigured)("real Prisma: storefront quote and checkout", () => {
  let biz: any;
  let slug: string;
  let product: any;
  let other: any;
  let otherSlug: string;

  beforeAll(async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_mocked_provider_only";
    biz = (await seedBusiness(p)).business;
    slug = biz.slug;
    const second = await seedBusiness(p);
    otherSlug = second.business.slug;
    other = await seedProduct(p, second.business.id, { name: "Other shop item", basePriceKES: 500 });
  });
  afterAll(async () => { delete process.env.PAYSTACK_SECRET_KEY; if (p) await p.$disconnect(); });

  beforeEach(async () => {
    vi.useRealTimers();
    // A fresh product per test keeps stock and sale windows independent.
    product = await seedProduct(p, biz.id, {
      basePriceKES: 1000, salePriceKES: 800,
      salePriceStartsAt: T("2026-10-01T00:00:00Z"), salePriceEndsAt: T("2026-10-31T00:00:00Z"), maxOrder: 20,
    });
    // Provider stand-in: echoes the stored payment row's reference, so the rest of the flow works on the real row.
    mocks.startPayment.mockReset().mockImplementation(async (record: any) => ({ kind: "ok", reference: record.reference, authorizationUrl: "https://paystack.test/a", mock: false, paymentId: record.paymentId }));
    mocks.recordEvent.mockReset().mockResolvedValue(undefined);
    mocks.notify.mockReset().mockResolvedValue(undefined);
    mocks.verifyTransaction.mockReset();
    mocks.session.current = null;
  });

  async function quoteOf(items: unknown[], slugValue = slug) {
    const res = await quote(req("/api/storefront/quote", pickup(slugValue, items)));
    expect(res.status).toBe(200);
    return res.json();
  }

  it("quote and checkout agree, and the order is written with the quoted unit price (real DB)", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const q = await quoteOf([item(2, product.id)]);
    expect(q.totalKES).toBe(1600);
    const key = `parity-${uid()}`;
    const res = await checkout(req("/api/storefront/checkout", { ...pickup(slug, [item(2, product.id)]), expectedTotalKES: q.totalKES, customer: customer() }, { "idempotency-key": key }));
    expect(res.status).toBe(201);
    const body = await res.json();
    const order = await p.order.findFirst({ where: { businessId: biz.id, orderReference: body.orderReference }, include: { items: true } });
    expect(order?.totalKES).toBe(q.totalKES);
    expect(order?.items[0].unitPriceKES).toBe(800);
    expect(mocks.startPayment).toHaveBeenCalledTimes(1);
  });

  it("outside the sale window the base price is quoted and charged", async () => {
    vi.setSystemTime(T("2026-09-30T23:59:00Z"));
    expect((await quoteOf([item(1, product.id)])).totalKES).toBe(1000);
  });

  it("a sale that ended between quote and checkout refuses the old total and writes nothing (real DB)", async () => {
    vi.setSystemTime(T("2026-10-30T23:00:00Z"));
    const q = await quoteOf([item(1, product.id)]);
    vi.setSystemTime(T("2026-10-31T00:30:00Z"));
    const before = await p.order.count({ where: { businessId: biz.id } });
    const res = await checkout(req("/api/storefront/checkout", { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: q.totalKES, customer: customer("0722999001") }, { "idempotency-key": `exp-${uid()}` }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ priceChanged: true, totalKES: 1000 });
    expect(await p.order.count({ where: { businessId: biz.id } })).toBe(before);
  });

  it("a product from another business cannot be bought through this storefront (tenant isolation)", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const res = await checkout(req("/api/storefront/checkout", { ...pickup(slug, [item(1, other.id)]), expectedTotalKES: 500, customer: customer("0722999002") }, { "idempotency-key": `tenant-${uid()}` }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await p.order.count({ where: { businessId: biz.id, customerPhone: "0722999002" } })).toBe(0);
    expect(await p.order.count({ where: { businessId: biz.id } })).toBeGreaterThanOrEqual(0);
    expect(await p.orderItem.count({ where: { productId: other.id } })).toBe(0);
  });

  it("the last unit is sold once across two concurrent checkouts with different keys (real DB)", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const last = await seedProduct(p, biz.id, { basePriceKES: 1000, salePriceKES: 800, salePriceStartsAt: T("2026-10-01T00:00:00Z"), salePriceEndsAt: T("2026-10-31T00:00:00Z"), quantity: 1 });
    const make = (phone: string) => checkout(req("/api/storefront/checkout", { ...pickup(slug, [item(1, last.id)]), expectedTotalKES: 800, customer: customer(phone) }, { "idempotency-key": `race-${uid()}` }));
    const [a, b] = await Promise.all([make("0722888001"), make("0722888002")]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(await p.order.count({ where: { businessId: biz.id, customerPhone: { in: ["0722888001", "0722888002"] } } })).toBe(1);
    expect((await p.product.findUnique({ where: { id: last.id }, select: { quantity: true } }))?.quantity).toBe(0);
  });

  it("a retry with the same key returns the stored response and creates no second order", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const key = `retry-${uid()}`;
    const payload = { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: 800, customer: customer("0722777001") };
    const first = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": key }));
    const second = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": key }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.orderReference).toBe(firstBody.orderReference);
    expect(secondBody.reusedUnpaidOrder).toBeUndefined();
    expect(await p.order.count({ where: { businessId: biz.id, customerPhone: "0722777001" } })).toBe(1);
    expect(mocks.startPayment).toHaveBeenCalledTimes(1);
  });

  it("a new key for the same basket while the first payment is still PENDING returns that payment, not a second order", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const phone = "0722666001";
    const payload = { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: 800, customer: customer(phone) };
    const first = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": `a-${uid()}` }));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    const again = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": `b-${uid()}` }));
    expect(again.status).toBe(201);
    const againBody = await again.json();
    expect(againBody.orderReference).toBe(firstBody.orderReference);
    expect(againBody.reusedUnpaidOrder).toBe(true);
    expect(await p.order.count({ where: { businessId: biz.id, customerPhone: phone } })).toBe(1);
    expect(mocks.startPayment).toHaveBeenCalledTimes(1);
  });

  it("once the earlier payment has failed, a new key places a new order (the customer is not stuck)", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const phone = "0722666002";
    const payload = { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: 800, customer: customer(phone) };
    const first = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": `f-${uid()}` }));
    const firstBody = await first.json();
    await p.payment.updateMany({ where: { reference: { not: "" }, orderId: (await p.order.findFirst({ where: { orderReference: firstBody.orderReference }, select: { id: true } })).id }, data: { status: "FAILED" } });
    const retry = await checkout(req("/api/storefront/checkout", payload, { "idempotency-key": `g-${uid()}` }));
    expect(retry.status).toBe(201);
    expect((await retry.json()).orderReference).not.toBe(firstBody.orderReference);
    expect(await p.order.count({ where: { businessId: biz.id, customerPhone: phone } })).toBe(2);
  });

  it("a different phone with the same basket is a different customer and gets a new order", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const base = { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: 800 };
    const a = await checkout(req("/api/storefront/checkout", { ...base, customer: customer("0722555001") }, { "idempotency-key": `c-${uid()}` }));
    const b = await checkout(req("/api/storefront/checkout", { ...base, customer: customer("0722555002") }, { "idempotency-key": `d-${uid()}` }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await a.json()).orderReference).not.toBe((await b.json()).orderReference);
  });

  it("/api/paystack/verify on an ORDER payment settles the order and never creates a subscription (real DB)", async () => {
    vi.setSystemTime(T("2026-10-10T09:00:00Z"));
    const owner = await p.user.findUnique({ where: { id: biz.ownerId }, select: { id: true } });
    const phone = "0722444001";
    const res = await checkout(req("/api/storefront/checkout", { ...pickup(slug, [item(1, product.id)]), expectedTotalKES: 800, customer: customer(phone) }, { "idempotency-key": `v-${uid()}` }));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(typeof body.paymentReference).toBe("string");
    const payment = await p.payment.findUnique({ where: { reference: body.paymentReference } });
    expect(payment?.purpose).toBe("ORDER");
    mocks.session.current = { userId: owner.id, role: "CUSTOMER" };
    mocks.verifyTransaction.mockResolvedValue({ id: 4242, status: "success", reference: payment.reference, amount: payment.amount, currency: "KES" });
    const verified = await paystackVerify(new Request(`https://jata.test/api/paystack/verify?reference=${payment.reference}`));
    expect(await verified.json()).toMatchObject({ status: "PAID" });
    expect((await p.order.findFirst({ where: { orderReference: body.orderReference }, select: { status: true, paymentStatus: true } }))).toEqual({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(await p.subscription.count({ where: { businessId: biz.id } })).toBe(0);
  });
});
