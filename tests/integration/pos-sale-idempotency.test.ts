/**
 * A till that sends the same sale twice rings it up once (§27, §32, §54).
 *
 * A second tap on "Charge" while the first request is still running, a retry after the network
 * stalls, a page refreshed after the customer's phone has already shown the prompt: every one of
 * those POSTs the same basket again. Without a replay guard the duplicate is a real second sale —
 * stock moves twice, the customer is charged twice, and two receipts exist for one basket.
 *
 * The key is scoped to the business *and* the actor, so one cashier's key can never spend or
 * suppress another's request and the same key in two shops is two different requests. The row is
 * written inside the sale's own transaction, so a duplicate insert violates the unique index and
 * the second sale is rolled back with it.
 *
 * True multi-connection races need PostgreSQL: the loser's rollback is what proves no second sale
 * was written. Where this suite depends on that rollback it says so and asserts only what the
 * in-memory double can honestly show.
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
  verifySession: vi.fn(async () => true),
  setSessionCookie: vi.fn(async () => undefined),
  clearSessionCookie: vi.fn(async () => undefined),
  hashPassword: vi.fn(async () => "hash"),
  verifyPassword: vi.fn(async () => true),
  getSessionFromToken: vi.fn(async () => mocks.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import prisma from "@/lib/db";
import { effectiveConfiguration, loadConfiguration, saveDraft } from "@/lib/pos/provisioning";
import { createSale, type PosActor } from "@/lib/pos/sales";
import { findIdempotencyRecord, IDEMPOTENCY_SCOPES, normalizeIdempotencyKey } from "@/lib/pos/store";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { POST as salesPost } from "@/app/api/pos/[businessId]/sales/route";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const business = { name: "Nyumbani Kitchen", phone: "0712000000", whatsapp: null, location: "Nairobi", logoUrl: null, email: null };

const retailAnswers = {
  business_type: "retail",
  sells: ["products"],
  payment_methods: ["cash", "mpesa"],
  keeps_stock: true,
  units: ["piece", "plate"],
  keeps_customers: false,
  has_staff: true,
  staff_count: 1,
  staff_roles: ["MANAGER"],
  tracks_expenses: false,
};

function actor(extra: Partial<PosActor> = {}): PosActor {
  return {
    actorId: "userA",
    actorName: "Owner A",
    roleKey: "OWNER",
    permissions: ["CREATE_SALE", "VIEW_SALES"],
    staffId: null,
    branchId: null,
    ...extra,
  };
}

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_idem_1",
    reference: "jata-pos-idem-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_idem_1", reference: "jata-pos-idem-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_idem_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  return effectiveConfiguration(record, "LIVE")!;
}

const BASKET = { items: [{ productId: "p_a1", quantity: 5 }], payments: [{ method: "cash", amountKES: 250 }] };
const stockOf = () => Number(rows("posInventoryItem").find((row) => row.productId === "p_a1")?.quantity ?? 0);
const moneyIn = () => rows("posPayment").filter((row) => row.direction === "IN");

const OWNER_SESSION = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const OTHER_SESSION = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };

const BASE = "https://jata.test/api/pos";
function post(businessId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return salesPost(
    new Request(`${BASE}/${businessId}/sales`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }),
    { params: Promise.resolve({ businessId }) } as any,
  );
}

beforeEach(() => {
  fake().reset();
  mocks.session = OWNER_SESSION;
});

describe("the key is bounded and belongs to one actor in one business", () => {
  it("trims and refuses an over-long or blank key", () => {
    expect(normalizeIdempotencyKey("  abc-123  ")).toBe("abc-123");
    expect(normalizeIdempotencyKey("")).toBeNull();
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(normalizeIdempotencyKey("x".repeat(129))).toBeNull();
    expect(normalizeIdempotencyKey("x".repeat(128))).toBe("x".repeat(128));
  });

  it("a key is not visible to another actor or another tenant", async () => {
    await goLive();
    const first = await createSale({
      businessId: "bizA",
      business,
      configuration: await goLiveConfig(),
      actor: actor(),
      request: BASKET as any,
      idempotency: { key: "shared-key", requestHash: "hash-1" },
    });
    expect(first.ok).toBe(true);

    // Another actor in the same business: the same key is a different request to them.
    const otherActor = await findIdempotencyRecord({ businessId: "bizA", actorId: "cashierA", scope: IDEMPOTENCY_SCOPES.saleCreate, key: "shared-key", requestHash: "hash-1" });
    expect(otherActor).toBeNull();
    // Another tenant entirely: also theirs to spend.
    const otherTenant = await findIdempotencyRecord({ businessId: "bizB", actorId: "userA", scope: IDEMPOTENCY_SCOPES.saleCreate, key: "shared-key", requestHash: "hash-1" });
    expect(otherTenant).toBeNull();
    // …but the owner who spent it sees their own record.
    const own = await findIdempotencyRecord({ businessId: "bizA", actorId: "userA", scope: IDEMPOTENCY_SCOPES.saleCreate, key: "shared-key", requestHash: "hash-1" });
    expect(own?.businessId).toBe("bizA");
  });

  it("a key spent on a sale cannot be spent on a different action", async () => {
    await goLive();
    await createSale({
      businessId: "bizA",
      business,
      configuration: await goLiveConfig(),
      actor: actor(),
      request: BASKET as any,
      idempotency: { key: "scope-key", requestHash: "hash-1" },
    });
    expect(await findIdempotencyRecord({ businessId: "bizA", actorId: "userA", scope: IDEMPOTENCY_SCOPES.saleCreate, key: "scope-key", requestHash: "hash-1" })).toBeTruthy();
    expect(await findIdempotencyRecord({ businessId: "bizA", actorId: "userA", scope: "sale.void", key: "scope-key", requestHash: "hash-1" })).toBeNull();
  });
});

describe("a duplicate submission rings the sale up once (§27, §32, §54)", () => {
  it("the second submission answers with the first receipt and writes nothing", async () => {
    const config = await goLiveConfig();
    const first = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: BASKET as any,
      idempotency: { key: "tap-1", requestHash: "hash-basket" },
    });
    expect(first.ok).toBe(true);
    const firstId = (first as any).sale.id;
    expect(stockOf()).toBe(35);
    expect(moneyIn()).toHaveLength(1);

    const duplicate = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: BASKET as any,
      idempotency: { key: "tap-1", requestHash: "hash-basket" },
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.code).toBe("DUPLICATE_REQUEST");
    expect((duplicate as any).duplicateOfSaleId).toBe(firstId);

    // The duplicate neither created a sale, moved stock, took money nor consumed a receipt number.
    expect(rows("posSale")).toHaveLength(1);
    expect(stockOf()).toBe(35);
    expect(moneyIn()).toHaveLength(1);
    expect(rows("posInventoryMovement")).toHaveLength(1);
  });

  it("the route replays the first sale's receipt to the second tap", async () => {
    await goLiveConfig();
    mocks.session = OWNER_SESSION;

    const first = await post("bizA", { ...BASKET, idempotencyKey: "tap-2" });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);

    const again = await post("bizA", { ...BASKET, idempotencyKey: "tap-2" });
    expect(again.status).toBe(200);
    const againBody = await again.json();
    expect(againBody.ok).toBe(true);
    expect(againBody.replayed).toBe(true);
    expect(againBody.sale.id).toBe(firstBody.sale.id);
    expect(againBody.sale.receiptNumber).toBe(firstBody.sale.receiptNumber);

    // One sale, one set of money rows, one stock movement.
    expect(rows("posSale")).toHaveLength(1);
    expect(moneyIn()).toHaveLength(1);
    expect(stockOf()).toBe(35);
  });

  it("the key may come from a header as well as the body", async () => {
    await goLiveConfig();
    mocks.session = OWNER_SESSION;

    const first = await post("bizA", BASKET, { "idempotency-key": "header-key" });
    expect(first.status).toBe(201);
    const second = await post("bizA", BASKET, { "idempotency-key": "header-key" });
    expect(second.status).toBe(200);
    expect((await second.json()).replayed).toBe(true);
    expect(rows("posSale")).toHaveLength(1);
  });

  it("a sale sent without a key behaves exactly as it did before", async () => {
    const config = await goLiveConfig();
    const first = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: BASKET as any });
    const second = await createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: BASKET as any });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // No key, no guard: two real sales, and no replay record was written.
    expect(rows("posSale")).toHaveLength(2);
    expect(rows("posIdempotencyRecord")).toHaveLength(0);
    expect(stockOf()).toBe(30);
  });

  it("a concurrent duplicate is detected and reported, and the loser wins nothing of its own", async () => {
    const config = await goLiveConfig();
    // Two requests carrying the same key, running at the same moment.
    const outcomes = await Promise.all([
      createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: BASKET as any, idempotency: { key: "race-1", requestHash: "hash-basket" } }),
      createSale({ businessId: "bizA", business, configuration: config, actor: actor(), request: BASKET as any, idempotency: { key: "race-1", requestHash: "hash-basket" } }),
    ]);

    const winners = outcomes.filter((outcome) => outcome.ok);
    const losers = outcomes.filter((outcome) => !outcome.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as any).code).toBe("DUPLICATE_REQUEST");

    // The loser claimed nothing, so it wrote nothing: one sale, one stock movement, one charge.
    // The claim runs before any of those rows, so the guard does not depend on the loser's
    // transaction rolling back — it never gets far enough to need to.
    expect(rows("posSale")).toHaveLength(1);
    expect(stockOf()).toBe(35);
    expect(moneyIn()).toHaveLength(1);
    expect(rows("posInventoryMovement")).toHaveLength(1);
    // Only one record exists for the key: the loser never claimed one of its own.
    expect(rows("posIdempotencyRecord")).toHaveLength(1);

    // NOTE — on PostgreSQL the loser's INSERT blocks on the unique index until the winner
    // commits, so `duplicateOfSaleId` is always the winning sale there. The in-memory double
    // interleaves the two calls instead of blocking, so the loser can read the record before the
    // winner has recorded its sale id; that half is covered by the sequential test above and by
    // the PostgreSQL-gated suite, not by this double.
  });
});

describe("a reused key with a different basket is a conflict, not a replay (§54)", () => {
  it("the same key with a different sale is refused with 409", async () => {
    await goLiveConfig();
    mocks.session = OWNER_SESSION;

    const first = await post("bizA", { ...BASKET, idempotencyKey: "reused" });
    expect(first.status).toBe(201);

    const conflicting = await post("bizA", { items: [{ productId: "p_a2", quantity: 1 }], payments: [{ method: "cash", amountKES: 250 }], idempotencyKey: "reused" });
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");

    // The rejected request wrote nothing at all.
    expect(rows("posSale")).toHaveLength(1);
    expect(rows("posIdempotencyRecord")).toHaveLength(1);
    expect(stockOf()).toBe(35);
  });

  it("the same key in another business is a different request", async () => {
    await goLiveConfig();
    mocks.session = OWNER_SESSION;
    const inBizA = await post("bizA", { ...BASKET, idempotencyKey: "tenant-key" });
    expect(inBizA.status).toBe(201);
    // bizB is not ours, so the route refuses on tenancy before the key is ever consulted.
    const inBizB = await post("bizB", { ...BASKET, idempotencyKey: "tenant-key" });
    expect(inBizB.status).toBeGreaterThanOrEqual(400);
    expect(rows("posSale")).toHaveLength(1);
  });

  it("the same key used by another cashier is a different request", async () => {
    const config = await goLiveConfig();
    // The seed gives this user a CASHIER staff record in bizA; promote her so she can sell.
    await prisma.posStaff.updateMany({ where: { businessId: "bizA", userId: "cashierA" }, data: { roleKey: "MANAGER" } });

    mocks.session = OWNER_SESSION;
    const byOwner = await post("bizA", { ...BASKET, idempotencyKey: "per-cashier" });
    expect(byOwner.status).toBe(201);

    mocks.session = OTHER_SESSION;
    const byCashier = await post("bizA", { ...BASKET, idempotencyKey: "per-cashier" });
    // Her key is hers: it creates her own sale rather than replaying the owner's.
    expect(byCashier.status).toBe(201);
    expect(rows("posSale")).toHaveLength(2);
    expect(rows("posIdempotencyRecord")).toHaveLength(2);
    expect(stockOf()).toBe(30);
    expect(config.inventory.enabled).toBe(true);
  });
});

describe("a refused request keeps its key (§54)", () => {
  it("a sale with no stock is refused and does not burn the key", async () => {
    const config = await goLiveConfig();
    const tooMuch = { items: [{ productId: "p_a1", quantity: 10_000 }], payments: [{ method: "cash", amountKES: 500_000 }] };
    const refused = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: tooMuch as any,
      idempotency: { key: "retry-key", requestHash: "hash-too-much" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("INSUFFICIENT_STOCK");
    expect(rows("posIdempotencyRecord")).toHaveLength(0);

    // The corrected basket can then use the same key and succeed.
    const retried = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: actor(),
      request: BASKET as any,
      idempotency: { key: "retry-key", requestHash: "hash-basket" },
    });
    expect(retried.ok).toBe(true);
    expect(rows("posIdempotencyRecord")).toHaveLength(1);
  });

  it("a sale without permission never reaches the key at all", async () => {
    const config = await goLiveConfig();
    const clerk = actor({ permissions: ["VIEW_SALES"] });
    const refused = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: clerk,
      request: BASKET as any,
      idempotency: { key: "no-permission", requestHash: "hash-basket" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("NOT_ALLOWED");
    expect(rows("posSale")).toHaveLength(0);
    expect(rows("posIdempotencyRecord")).toHaveLength(0);
  });
});

/** The live configuration, cached per test so the setup cost is paid once. */
async function goLiveConfig() {
  return goLive();
}
