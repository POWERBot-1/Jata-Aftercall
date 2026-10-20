import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const orders = new Map<string, any>();
  const paymentRows: any[] = [];
  const db = {
    businessFindUnique: vi.fn(async ({ where }: any) => businesses.get(where.id) ?? null),
    orderFindFirst: vi.fn(async ({ where }: any) => {
      const order = orders.get(where.id);
      return order?.businessId === where.businessId ? order : null;
    }),
    paymentCreate: vi.fn(async ({ data }: any) => {
      paymentRows.push(data);
      return { id: `payment-${paymentRows.length}`, reference: data.reference, amount: data.amount };
    }),
    paymentUpdate: vi.fn(async () => ({})),
    paymentUpdateMany: vi.fn(async () => ({ count: 1 })),
    transaction: vi.fn(async () => { throw new Error("Settlement must not run in this test."); }),
  };
  return { businesses, orders, paymentRows, db };
});

const paystack = vi.hoisted(() => ({
  initializeTransaction: vi.fn(async (params: any) => ({
    authorization_url: "https://checkout.paystack.com/test-only",
    reference: params.reference,
    access_code: "not-a-real-provider-call",
  })),
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: fixtures.db.businessFindUnique },
    order: { findFirst: fixtures.db.orderFindFirst },
    payment: {
      create: fixtures.db.paymentCreate,
      update: fixtures.db.paymentUpdate,
      updateMany: fixtures.db.paymentUpdateMany,
    },
    $transaction: fixtures.db.transaction,
  },
}));

vi.mock("@/lib/paystack", () => ({
  initializeTransaction: paystack.initializeTransaction,
  toKobo: (amountKES: number) => Math.round(amountKES * 100),
  verifyTransaction: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));

import { executeBusinessTool } from "@/lib/ai-tools";

const businessId = "business-a";
const brain = {
  business: { slug: "shop-a" },
  extendedConfig: { operationalStatus: "ACTIVE", pauseAllOrdering: false, orderingAllowed: true },
} as any;

function invokePaymentTool(args: Record<string, unknown>) {
  return executeBusinessTool("create_payment_request", args, { businessId, brain });
}

describe("AI create_payment_request authoritative payment boundary", () => {
  beforeEach(() => {
    fixtures.businesses.clear();
    fixtures.orders.clear();
    fixtures.paymentRows.length = 0;
    vi.clearAllMocks();
    fixtures.businesses.set(businessId, { id: businessId, ownerId: "owner-a", slug: "shop-a" });
    vi.stubEnv("PAYSTACK_SECRET_KEY", "local-test-only-not-a-provider-credential");
    vi.stubEnv("PUBLIC_BASE_URL", "https://shop.example.test");
    vi.stubEnv("VERCEL_ENV", "development");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("refuses a user-supplied order ID from another business before creating a payment or calling Paystack", async () => {
    fixtures.orders.set("order-b", {
      id: "order-b",
      businessId: "business-b",
      status: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      totalKES: 12_000,
      customerEmail: "customer-b@example.test",
    });

    const result = await invokePaymentTool({
      orderId: "order-b",
      amountKES: 1,
      email: "attacker@example.test",
    });

    expect(fixtures.db.orderFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-b", businessId },
    }));
    expect(result).toMatchObject({ ok: false, data: { kind: "error", status: 404 } });
    expect(fixtures.db.paymentCreate).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
    expect(fixtures.db.transaction).not.toHaveBeenCalled();
  });

  it("uses the scoped order total and stored payer email for persistence and provider initialization", async () => {
    fixtures.orders.set("order-a", {
      id: "order-a",
      businessId,
      status: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      totalKES: 4_200,
      customerEmail: "buyer@example.test",
    });

    const result = await invokePaymentTool({
      orderId: "order-a",
      amountKES: 1,
      email: "attacker@example.test",
    });

    expect(result).toMatchObject({ ok: true, data: { kind: "ok" } });
    expect(fixtures.db.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId,
        orderId: "order-a",
        amount: 420_000,
        customerEmail: "buyer@example.test",
      }),
    }));
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      email: "buyer@example.test",
      amount: 420_000,
      currency: "KES",
      metadata: expect.objectContaining({ businessId, orderId: "order-a" }),
    }));
    expect(fixtures.paymentRows).toHaveLength(1);
    expect(fixtures.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "CONFIRMED", paymentStatus: "UNPAID" }, "order is not pending payment"],
    [{ status: "PENDING_PAYMENT", paymentStatus: "PAID" }, "order is already paid"],
    [{ status: "PENDING_PAYMENT", paymentStatus: "PROCESSING" }, "order payment is already processing"],
    [{ status: "CANCELLED", paymentStatus: "UNPAID" }, "cancelled order"],
  ])("refuses $1 status: $2 before creating or initializing a payment", async (state) => {
    fixtures.orders.set("order-a", {
      id: "order-a",
      businessId,
      totalKES: 4_200,
      customerEmail: "buyer@example.test",
      ...state,
    });

    const result = await invokePaymentTool({ orderId: "order-a", amountKES: 1, email: "buyer@example.test" });

    expect(result).toMatchObject({ ok: false, data: { kind: "error", status: 409 } });
    expect(fixtures.db.paymentCreate).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it("uses a validated caller-email fallback only when the order has no valid stored email", async () => {
    fixtures.orders.set("order-a", {
      id: "order-a",
      businessId,
      status: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      totalKES: 500,
      customerEmail: "legacy invalid address",
    });

    const result = await invokePaymentTool({
      orderId: "order-a",
      amountKES: 1,
      email: "fallback@example.test",
    });

    expect(result).toMatchObject({ ok: true, data: { kind: "ok" } });
    expect(fixtures.db.paymentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: 50_000, customerEmail: "fallback@example.test" }),
    }));
    expect(paystack.initializeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: 50_000,
      email: "fallback@example.test",
    }));
  });

  it("requires an order ID and never accepts an invalid free-form payer email", async () => {
    const missingOrder = await invokePaymentTool({ amountKES: 500, email: "buyer@example.test" });
    expect(missingOrder).toMatchObject({ ok: false, data: { kind: "error" } });
    expect(fixtures.db.paymentCreate).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();

    fixtures.orders.set("order-a", {
      id: "order-a",
      businessId,
      status: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      totalKES: 500,
      customerEmail: null,
    });
    const invalidEmail = await invokePaymentTool({ orderId: "order-a", amountKES: 500, email: "not-an-email" });
    expect(invalidEmail).toMatchObject({ ok: false, data: { kind: "error", status: 400 } });
    expect(fixtures.db.paymentCreate).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });
});
