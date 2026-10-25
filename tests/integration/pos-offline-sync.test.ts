/**
 * Offline-first POS — server synchronization (§6, §25, §27, §56, §75).
 *
 * Drives the `/api/pos/[businessId]/sync` route over HTTP against the in-memory database, so the
 * whole pipeline is proven: session → tenant/role/permission → entitlement → batch replay through
 * the real sale engine → idempotency → stock movement → audit trail → JSON contract.
 *
 * The load-bearing claims under test:
 *   - a cash offline sale is recorded and stock moves exactly once;
 *   - replaying the same basket (same actor or a different one after a shift handover) is a no-op;
 *   - an unconfirmed offline payment never marks the sale paid — it lands PARTIALLY_PAID;
 *   - a foreign business's record cannot be synced into this tenant.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as any }));

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const fake = createFakeDb(standardSeed());
  (globalThis as any).__posFake = fake;
  return { default: fake.db };
});

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => mocks.session),
  requireSession: vi.fn(async () => mocks.session),
  createSession: vi.fn(async () => "token"),
  verifySession: vi.fn(async () => mocks.session),
  setSessionCookie: vi.fn(async () => undefined),
  clearSessionCookie: vi.fn(async () => undefined),
  hashPassword: vi.fn(async () => "hash"),
  verifyPassword: vi.fn(async () => true),
  getSessionFromToken: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import { activateSubscriptionForPayment } from "@/lib/paystack";
import type { FakeDb } from "@/tests/helpers/posFakeDb";
import {
  GET as syncGet,
  POST as syncPost,
  OFFLINE_SYNC_ACTOR_ID,
} from "@/app/api/pos/[businessId]/sync/route";
import { POST as configPost } from "@/app/api/pos/[businessId]/configuration/route";
import type { OfflineSaleRecord } from "@/lib/pos/offline/types";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const stock = (productId: string) =>
  rows("posInventoryItem").find((row) => row.productId === productId)?.quantity;

const OWNER = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CASHIER = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
const STRANGER = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" };
const BASE = "https://jata.test/api/pos";

const context = (businessId: string): { params: Promise<any> } =>
  ({ params: Promise.resolve({ businessId }) });

function url(businessId: string, path = ""): string {
  return `${BASE}/${businessId}${path}`;
}
function send(method: string, businessId: string, path = "", body: unknown = {}) {
  return new Request(url(businessId, path), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const post = (businessId: string, path = "", body: unknown = {}) => send("POST", businessId, path, body);
const get = (businessId: string, path = "") => new Request(url(businessId, path));
const body = (response: Response) => response.json();
const call = async (response: Response) => ({ status: response.status, body: await body(response) });

const restaurantAnswers = {
  business_type: "restaurant",
  sells: ["products", "services"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "sometimes",
  credit_limit: 2000,
  credit_terms_days: 30,
  keeps_stock: true,
  keeps_customers: true,
  orders: true,
  order_channels: ["walk_in", "whatsapp"],
  has_staff: true,
  staff_count: 4,
  staff_roles: ["WAITER", "CASHIER"],
  tracks_expenses: true,
  expense_categories: ["rent", "electricity", "transport", "salaries"],
  has_suppliers: true,
  supplier_payment_methods: ["cash", "credit"],
  supplier_credit: true,
  discounts: true,
  restaurant_kitchen: true,
  restaurant_tables: true,
  menu_modifiers: true,
  recipes: true,
};

async function configure(businessId: string, answers: Record<string, unknown>) {
  return call(await configPost(post(businessId, "", { answers }), context(businessId)));
}
async function payForPos(businessId: string, reference = "jata-offline-sync") {
  rows("payment").push({
    id: `pay_${businessId}`,
    reference,
    businessId,
    userId: businessId === "bizB" ? "userB" : "userA",
    planId: "plan_pos",
    amount: 49900,
    currency: "KES",
    status: "PENDING",
    createdAt: new Date(),
  });
  return activateSubscriptionForPayment(`pay_${businessId}`, `evt_${reference}`, { paystackId: `ps_${reference}` });
}

function offlineRecord(overrides: Partial<OfflineSaleRecord> = {}): OfflineSaleRecord {
  const offlineId = overrides.offlineId ?? "off_test_1";
  return {
    offlineId,
    idempotencyKey: `offline:${offlineId}`,
    request: {
      items: [{ productId: "p_a1", quantity: 2 }],
      payments: [{ method: "cash", amountKES: 100 }],
    },
    branchId: null,
    recordedAt: new Date().toISOString(),
    paymentKind: "cash",
    paymentReference: null,
    attempts: 0,
    status: "queued",
    lastError: null,
    syncedAt: null,
    syncedSaleId: null,
    syncedReceiptNumber: null,
    ...overrides,
  };
}

beforeEach(() => {
  fake().reset();
  mocks.session = OWNER;
});

describe("POST /api/pos/[businessId]/sync — offline replay (§6, §27)", () => {
  it("records a cash offline sale, moves stock once and assigns a receipt", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");

    const { status, body: payload } = await call(
      await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")),
    );
    expect(status).toBe(200);
    expect(payload.summary).toMatchObject({ total: 1, synced: 1, rejected: 0 });
    expect(payload.results[0]).toMatchObject({ offlineId: "off_test_1", status: "synced" });
    expect(payload.results[0].receiptNumber).toMatch(/^NK-/);
    expect(stock("p_a1")).toBe(38); // 40 seeded − 2

    const sale = rows("posSale")[0];
    expect(sale.status).toBe("COMPLETED");
    expect(sale.paidKES).toBe(100);
  });

  it("replaying the same basket is a no-op (idempotency, §27)", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");

    const first = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(first.body.results[0].status).toBe("synced");
    expect(stock("p_a1")).toBe(38);

    const replay = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(replay.body.summary.duplicate).toBe(1);
    expect(replay.body.results[0].status).toBe("duplicate");
    expect(replay.body.results[0].saleId).toBe(first.body.results[0].saleId);
    expect(stock("p_a1")).toBe(38); // not double-decremented
    expect(rows("posSale").length).toBe(1);
  });

  it("a different actor replaying the basket after a shift handover is still a duplicate", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");

    const asOwner = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(asOwner.body.results[0].status).toBe("synced");

    // The same device/queue is now synced by the cashier (a different session).
    mocks.session = CASHIER;
    const asCashier = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(asCashier.body.summary.duplicate).toBe(1);
    expect(asCashier.body.results[0].status).toBe("duplicate");
    expect(rows("posSale").length).toBe(1);
    expect(stock("p_a1")).toBe(38);
  });

  it("an unconfirmed offline payment never marks the sale paid (§6, §10)", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");

    const record = offlineRecord({
      offlineId: "off_pending_1",
      paymentKind: "pending",
      paymentReference: "MPX123456",
      request: {
        items: [{ productId: "p_a1", quantity: 2 }],
        payments: [{ method: "mpesa", amountKES: 100, reference: "MPX123456" }],
      },
    });
    const { status, body: payload } = await call(await syncPost(post("bizA", "", { records: [record] }), context("bizA")));
    expect(status).toBe(200);
    expect(payload.results[0]).toMatchObject({ offlineId: "off_pending_1", status: "synced", unconfirmedPayment: true });

    const sale = rows("posSale")[0];
    expect(sale.status).toBe("PARTIALLY_PAID");
    expect(sale.paidKES).toBe(0);
    expect(sale.balanceKES).toBe(100);
    // The manual reference survives in the offline-provenance marker on the notes.
    expect(String(sale.notes)).toContain("off_pending_1");
    expect(String(sale.notes)).toContain("MPX123456");
  });

  it("refuses a foreign business's offline record (tenant isolation, §75)", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");

    // bizB's product in a bizA sync is not on bizA's price list → rejected, nothing written.
    const { status, body: payload } = await call(
      await syncPost(post("bizA", "", { records: [offlineRecord({ request: { items: [{ productId: "p_b1", quantity: 1 }], payments: [] } })] }), context("bizA")),
    );
    expect(status).toBe(200);
    expect(payload.results[0].status).toBe("rejected");
    expect(rows("posSale").length).toBe(0);
  });

  it("rejects an unauthenticated sync", async () => {
    mocks.session = null;
    const { status } = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(status).toBe(401);
  });

  it("refuses a stranger who is not a member of the business", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");
    mocks.session = STRANGER;
    const { status } = await call(await syncPost(post("bizA", "", { records: [offlineRecord()] }), context("bizA")));
    expect(status).toBe(403);
  });
});

describe("GET /api/pos/[businessId]/sync — reconciliation status (§6)", () => {
  it("reports which offline sales this business has already recorded", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA");
    await call(await syncPost(post("bizA", "", { records: [offlineRecord({ offlineId: "off_status_1" })] }), context("bizA")));

    const { status, body: payload } = await call(await syncGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(payload.syncedOfflineIds).toContain("off_status_1");
  });
});

describe("OFFLINE_SYNC_ACTOR_ID — cross-actor replay guard", () => {
  it("is a stable, non-user identifier scoped to offline replays", () => {
    expect(OFFLINE_SYNC_ACTOR_ID).toBe("offline-sync");
    expect(OFFLINE_SYNC_ACTOR_ID).not.toMatch(/^user_/);
  });
});
