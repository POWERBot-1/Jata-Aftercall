/**
 * Branch isolation (§16, §75) — staff see and write only their own location.
 *
 * A staff row's `branchId` is the scope: it is resolved server-side from the staff record, a
 * branch named by an unbound actor must exist in the business, and reads are scoped to the
 * actor's own location. The owner and other unbound staff keep business-wide access. Every rule
 * here is proven against the engine and the HTTP routes, because a UI that hides the control is
 * not an authorization (§5, §56).
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

import prisma from "@/lib/db";
import { saveDraft } from "@/lib/pos/provisioning";
import { effectiveConfiguration, loadConfiguration } from "@/lib/pos/provisioning";
import { createSale, refundSale } from "@/lib/pos/sales";
import { adjustStock, transferStock } from "@/lib/pos/operations";
import { readBranchId } from "@/lib/pos/store";
import { GET as salesGet, POST as salesPost } from "@/app/api/pos/[businessId]/sales/route";
import { GET as ordersGet } from "@/app/api/pos/[businessId]/orders/route";
import { GET as branchesGet } from "@/app/api/pos/[businessId]/branches/route";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import type { PosActor } from "@/lib/pos/sales";
import type { PermissionKey } from "@/lib/pos/permissions";
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
  orders: true,
  order_channels: ["walk_in"],
  has_staff: true,
  staff_count: 2,
  staff_roles: ["CASHIER"],
  multi_branch: true,
  branch_count: 3,
  stock_by_branch: true,
  tracks_expenses: true,
};

const ALL: PermissionKey[] = ["CREATE_SALE", "VIEW_SALES", "VIEW_INVENTORY", "ADJUST_STOCK", "TRANSFER_STOCK", "VIEW_ORDERS", "VIEW_PAYMENTS", "VIEW_SUPPLIERS", "VIEW_CUSTOMERS"];

function owner(): PosActor {
  return { actorId: "userA", actorName: "Owner A", roleKey: "OWNER", permissions: ALL, staffId: null, branchId: null };
}
function staffAt(branchId: string): PosActor {
  return { actorId: "staff_1", actorName: "Branch Staff", roleKey: "CASHIER", permissions: ALL, staffId: "st_branch", branchId };
}

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_branch_1",
    reference: "jata-pos-branch-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_branch_1", reference: "jata-pos-branch-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_branch_1",
    }),
  );
  const record = await loadConfiguration("bizA");
  const config = effectiveConfiguration(record, "LIVE")!;
  // Two more locations (the seed already has the primary) and stock in each, so a sale's
  // stock question has a real answer per place.
  await prisma.posBranch.create({ data: { businessId: "bizA", name: "Kilimani Shop", isPrimary: false, isActive: true } });
  const createdThird = await prisma.posBranch.create({ data: { businessId: "bizA", name: "Westlands Shop", isPrimary: false, isActive: true } });
  const branches = rows("posBranch");
  const [br1, br2] = [branches[0].id, branches[1].id];
  const br3 = createdThird.id;
  for (const branchId of [br2, br3]) {
    await prisma.posInventoryItem.create({ data: { businessId: "bizA", productId: "p_a1", branchId, quantity: 8, reorderLevel: 0 } });
  }
  // The seeded staff row is a real business member (cashierA) — binding it to a location is
  // what makes the branch scope exist for the HTTP session tests.
  await prisma.posStaff.update({ where: { id: "st_a1" }, data: { branchId: br2 } });
  return { config, br1, br2, br3 };
}

/** The branch a read should be scoped to, exactly as the routes resolve it. */
function readBranch(ctxBranchId: string | null, requested: string | null | undefined) {
  return readBranchId("bizA", ctxBranchId, requested, prisma);
}

const BASE = "https://jata.test/api/pos";
function url(businessId: string, path = "", query: Record<string, string | number | undefined> = {}) {
  const target = new URL(`${BASE}/${businessId}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  return target.toString();
}
function context(businessId: string, extra: Record<string, string> = {}): { params: Promise<any> } {
  return { params: Promise.resolve({ businessId, ...extra }) };
}
const OWNER_SESSION = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };

beforeEach(() => {
  fake().reset();
});

describe("writes land where the actor's scope says they may", () => {
  it("a branch-bound cashier records into their branch, whatever the request names", async () => {
    const { config, br1, br2, br3 } = await goLive();

    // The browser insists on a different location: the server records at the staff's own.
    const cross = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: staffAt(br2),
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }], branchId: br3 },
    });
    expect(cross.ok).toBe(false);
    expect(cross.code).toBe("BRANCH_OUT_OF_SCOPE");
    expect(rows("posSale")).toHaveLength(0);

    // No branch named: it goes to the staff's own location, and only that location's stock
    // is decremented.
    const own = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: staffAt(br2),
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(own.ok).toBe(true);
    const sale = rows("posSale")[0];
    expect(sale.branchId).toBe(br2);
    expect(rows("posInventoryItem").find((row) => row.branchId === br2)?.quantity).toBe(7);
    expect(rows("posInventoryItem").find((row) => row.branchId === br3)?.quantity).toBe(8);
    expect(rows("posInventoryItem").find((row) => row.branchId === "")?.quantity).toBe(40);
  });

  it("stock at another branch is not spendable by a branch-bound cashier", async () => {
    const { config, br1, br2 } = await goLive();
    // br2 holds 8; asking for 50 must fail against br2's own stock, not the business's.
    const refused = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: staffAt(br2),
      request: { items: [{ productId: "p_a1", quantity: 50 }], payments: [{ method: "cash", amountKES: 2500 }] },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("INSUFFICIENT_STOCK");
    expect(rows("posSale")).toHaveLength(0);
    expect(rows("posInventoryItem").find((row) => row.branchId === "")?.quantity).toBe(40);
  });

  it("an unbound actor may name a real branch — and is refused a guessed one", async () => {
    const { config, br3 } = await goLive();
    const valid = await readBranch(null, br3);
    expect(valid).toEqual({ branchId: br3 });
    const guessed = await readBranch(null, "br_does_not_exist");
    expect(guessed.error).toMatchObject({ code: "BRANCH_NOT_FOUND" });

    const sale = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner(),
      request: { items: [{ productId: "p_a1", quantity: 2 }], payments: [{ method: "cash", amountKES: 100 }], branchId: br3 },
    });
    expect(sale.ok).toBe(true);
    expect(rows("posSale")[0].branchId).toBe(br3);
    expect(rows("posInventoryItem").find((row) => row.branchId === br3)?.quantity).toBe(6);

    const bogus = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner(),
      request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }], branchId: "br_does_not_exist" },
    });
    expect(bogus.ok).toBe(false);
    expect(bogus.code).toBe("BRANCH_NOT_FOUND");
  });

  it("keeps an unbound owner's no-branch sales in the stock room, as before", async () => {
    const { config, br1 } = await goLive();
    const sale = await createSale({
      businessId: "bizA",
      business,
      configuration: config,
      actor: owner(),
      request: { items: [{ productId: "p_a1", quantity: 2 }], payments: [{ method: "cash", amountKES: 100 }] },
    });
    expect(sale.ok).toBe(true);
    expect(rows("posSale")[0].branchId ?? null).toBe(null);
    expect(rows("posInventoryItem").find((row) => row.productId === "p_a1" && (row.branchId === br1 || row.branchId === ""))?.quantity).toBe(38);
  });

  it("refuses stock adjustments and counts into another branch, and transfers to a foreign one", async () => {
    const { config, br1, br2, br3 } = await goLive();

    const crossAdjust = await adjustStock({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      input: { productId: "p_a1", quantity: 10, reason: "PURCHASE", branchId: br3 },
    });
    expect(crossAdjust.ok).toBe(false);
    expect(crossAdjust.code).toBe("BRANCH_OUT_OF_SCOPE");

    const ownAdjust = await adjustStock({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      input: { productId: "p_a1", quantity: 10, reason: "PURCHASE" },
    });
    expect(ownAdjust.ok).toBe(true);
    expect(rows("posInventoryItem").find((row) => row.branchId === br2)?.quantity).toBe(18);

    // Moving stock between locations is cross-scope by definition: a bound staff cannot.
    const boundTransfer = await transferStock({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      productId: "p_a1",
      quantity: 2,
      fromBranchId: br2,
      toBranchId: br3,
    });
    expect(boundTransfer.ok).toBe(false);
    expect(boundTransfer.code).toBe("NOT_ALLOWED");

    // An unbound actor may move stock — but both locations must belong to the business.
    const foreignTransfer = await transferStock({
      businessId: "bizA",
      configuration: config,
      actor: owner(),
      productId: "p_a1",
      quantity: 2,
      fromBranchId: br2,
      toBranchId: "br_does_not_exist",
    });
    expect(foreignTransfer.ok).toBe(false);
    expect(foreignTransfer.code).toBe("BRANCH_NOT_FOUND");

    const okTransfer = await transferStock({
      businessId: "bizA",
      configuration: config,
      actor: owner(),
      productId: "p_a1",
      quantity: 2,
      fromBranchId: br2,
      toBranchId: br3,
    });
    expect(okTransfer.ok).toBe(true);
    expect(rows("posInventoryItem").find((row) => row.branchId === br2)?.quantity).toBe(16);
    expect(rows("posInventoryItem").find((row) => row.branchId === br3)?.quantity).toBe(10);
  });
});

describe("reads are scoped to the actor's own location over HTTP", () => {
  it("a branch-bound cashier's sales list is their branch's, and the branch param is not trusted", async () => {
    const { config, br1, br2, br3 } = await goLive();
    // One sale in each place: the stock room, the cashier's own location, and a third.
    const places = [
      { branchId: null, actor: owner() },
      { branchId: br2, actor: staffAt(br2) },
      { branchId: br3, actor: owner() },
    ];
    const saleIds: string[] = [];
    for (const place of places) {
      const sale = await createSale({
        businessId: "bizA",
        business,
        configuration: config,
        actor: place.actor,
        request: {
          items: [{ productId: "p_a1", quantity: 1 }],
          payments: [{ method: "cash", amountKES: 50 }],
          ...(place.branchId ? { branchId: place.branchId } : {}),
        },
      });
      expect(sale.ok).toBe(true);
      saleIds.push((sale as { ok: true; sale: { id: string } }).sale.id);
    }
    expect(rows("posSale")).toHaveLength(3);

    const staffSession = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
    const call = async (session: any, query: Record<string, string | undefined> = {}) => {
      mocks.session = session;
      const response = await salesGet(new Request(url("bizA", "/sales", query)), context("bizA"));
      return response.json();
    };

    // The browser asks for br3's sales: the server answers br2 — only the cashier's own sale,
    // never the stock-room sale or the third location's.
    const scoped = await call(staffSession, { branch: br3 });
    expect(scoped.sales).toHaveLength(1);
    expect(scoped.sales[0].id).toBe(saleIds[1]);
    expect(scoped.totals.count).toBe(1);

    // The owner, unbound, sees all three — and may narrow to a real branch.
    const all = await call(OWNER_SESSION);
    expect(all.sales).toHaveLength(3);
    mocks.session = OWNER_SESSION;
    const narrowed = await salesGet(new Request(url("bizA", "/sales", { branch: br3 })), context("bizA")).then((r) => r.json());
    expect(narrowed.sales).toHaveLength(1);

    // A guessed branch id from an unbound actor is a 400, not an empty list.
    const guessed = await salesGet(new Request(url("bizA", "/sales", { branch: "br_does_not_exist" })), context("bizA")).then((r) => r.json());
    expect(guessed.code).toBe("BRANCH_NOT_FOUND");
  });

  it("a bound cashier sees only their location in the locations list", async () => {
    const { br2 } = await goLive();
    const staffSession = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };

    mocks.session = staffSession;
    const scoped = await branchesGet(new Request(url("bizA", "/branches")), context("bizA")).then((r) => r.json());
    expect(scoped.branches).toHaveLength(1);
    expect(scoped.branches[0].id).toBe(br2);

    mocks.session = OWNER_SESSION;
    const all = await branchesGet(new Request(url("bizA", "/branches")), context("bizA")).then((r) => r.json());
    expect(all.branches).toHaveLength(3);
  });

  it("the order board reads through the same scope", async () => {
    await goLive();
    // No orders exist: the board is empty for everyone, and the route resolves the scope
    // without error for a bound staff member (the staff row makes the session real).
    const staffSession = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
    mocks.session = staffSession;
    const response = await ordersGet(new Request(url("bizA", "/orders")), context("bizA"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.orders).toEqual([]);
  });
});
