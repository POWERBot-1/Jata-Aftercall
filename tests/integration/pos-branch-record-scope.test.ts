/**
 * Branch scope on an existing record, and on every server-rendered POS screen (§16, §75).
 *
 * `resolveBranch` decides where a *new* row may be written. These tests cover the other half: an
 * existing record opened by id. A browser supplies that id directly and nothing else in the
 * request mentions a branch, so the only scope that can be applied is the one the staff row
 * binds the actor to. Without it a cashier bound to one location can read, refund or void
 * another location's sale by guessing its id.
 *
 * The second half is the server-rendered screens. The API routes already scope their reads; a
 * page that reads the store without the same scope shows a cashier the whole business the
 * moment they type the URL. The store's filters are proven behaviourally here, and each screen
 * is then proven to pass the actor's scope into them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
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
import { createSale, refundSale, type PosActor } from "@/lib/pos/sales";
import { branchOutOfScopeMessage, branchRecordInScope, listBranches, listMovements, listOrders, listSales, salesTotals, stockWithProducts } from "@/lib/pos/store";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { GET as saleDetailGet, POST as saleDetailPost } from "@/app/api/pos/[businessId]/sales/[saleId]/route";
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
  staff_count: 2,
  staff_roles: ["CASHIER", "MANAGER"],
  multi_branch: true,
  branch_count: 3,
  stock_by_branch: true,
  tracks_expenses: false,
};

const ALL: string[] = ["CREATE_SALE", "VIEW_SALES", "REFUND_SALE", "VOID_SALE", "VIEW_ORDERS", "VIEW_INVENTORY", "VIEW_CUSTOMERS"];

function owner(): PosActor {
  return { actorId: "userA", actorName: "Owner A", roleKey: "OWNER", permissions: ALL as any, staffId: null, branchId: null };
}
function staffAt(branchId: string | null): PosActor {
  return { actorId: "cashierA", actorName: "Mary Cashier", roleKey: "CASHIER", permissions: ALL as any, staffId: "st_a1", branchId };
}

const OWNER_SESSION = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CASHIER_SESSION = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
// A manager holds REFUND_SALE, so the HTTP refund path reaches the branch check rather than
// stopping at the permission check first.
const MANAGER_SESSION = { userId: "managerA", email: "ali@example.com", role: "CUSTOMER", name: "Ali Manager" };

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: business.name } });
  fake().rows("payment").push({
    id: "pay_scope_1",
    reference: "jata-pos-scope-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_scope_1", reference: "jata-pos-scope-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_scope_1",
    }),
  );
  await prisma.posBranch.create({ data: { businessId: "bizA", name: "Kilimani Shop", isPrimary: false, isActive: true } });
  await prisma.posBranch.create({ data: { businessId: "bizA", name: "Westlands Shop", isPrimary: false, isActive: true } });
  const branches = rows("posBranch");
  const [br1, br2, br3] = [branches[0].id, branches[1].id, branches[2].id];
  for (const branchId of [br2, br3]) {
    await prisma.posInventoryItem.create({ data: { businessId: "bizA", productId: "p_a1", branchId, quantity: 8, reorderLevel: 0 } });
  }
  // The seeded staff row is a real business member (cashierA): binding it to a location is what
  // gives the HTTP session a branch scope at all.
  await prisma.posStaff.update({ where: { id: "st_a1" }, data: { branchId: br2 } });
  await prisma.user.create({ data: { id: "managerA", name: "Ali Manager", email: "ali@example.com" } });
  await prisma.businessMember.create({ data: { id: "mem_manager", businessId: "bizA", userId: "managerA", role: "STAFF" } });
  await prisma.posStaff.create({
    data: { businessId: "bizA", userId: "managerA", name: "Ali Manager", roleKey: "MANAGER", isActive: true, branchId: br2, commissionPercent: 0 },
  });
  const record = await loadConfiguration("bizA");
  return { config: effectiveConfiguration(record, "LIVE")!, br1, br2, br3 };
}

async function sell(config: any, actor: PosActor, branchId?: string | null) {
  const outcome = await createSale({
    businessId: "bizA",
    business,
    configuration: config,
    actor,
    request: { items: [{ productId: "p_a1", quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }], ...(branchId ? { branchId } : {}) } as any,
  });
  if (!outcome.ok) throw new Error(`sale setup failed: ${outcome.code} ${outcome.message}`);
  return (outcome as any).sale;
}

const BASE = "https://jata.test/api/pos";
const ctx = (businessId: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ businessId, ...extra }) });

beforeEach(() => {
  fake().reset();
  mocks.session = null;
});

describe("the scope predicate itself (§16, §75)", () => {
  it("lets an unbound actor reach every record, and a bound one only their own", () => {
    // Unbound: owner, admin, or staff created before the branch feature.
    expect(branchRecordInScope({ branchId: null }, "br_1")).toBe(true);
    expect(branchRecordInScope({ branchId: null }, null)).toBe(true);
    expect(branchRecordInScope(null, "br_1")).toBe(true);

    // Bound to br_1: their own location yes, another no, and a record with no location no —
    // a record that cannot appear in their scoped list cannot be opened by id either.
    expect(branchRecordInScope({ branchId: "br_1" }, "br_1")).toBe(true);
    expect(branchRecordInScope({ branchId: "br_1" }, "br_2")).toBe(false);
    expect(branchRecordInScope({ branchId: "br_1" }, null)).toBe(false);
    expect(branchRecordInScope({ branchId: "br_1" }, "")).toBe(false);

    expect(branchOutOfScopeMessage().length).toBeGreaterThan(0);
  });
});

describe("a sale opened by id is in the actor's branch or not found (§16, §75)", () => {
  it("a branch-bound cashier cannot refund or void another branch's sale", async () => {
    const { config, br2, br3 } = await goLive();
    const ownSale = await sell(config, staffAt(br2));
    const otherSale = await sell(config, owner(), br3);

    const crossRefund = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      request: { saleId: otherSale.id, amountKES: 50, method: "cash" },
    });
    expect(crossRefund.ok).toBe(false);
    expect(crossRefund.code).toBe("BRANCH_OUT_OF_SCOPE");
    // Not a hint that the record exists, and not a single row written against it.
    expect(rows("posSale").find((row) => row.id === otherSale.id)!.refundedKES).toBe(0);
    expect(rows("posPayment").filter((row) => row.direction === "OUT")).toHaveLength(0);

    const crossVoid = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      action: "POS_SALE_VOIDED",
      request: { saleId: otherSale.id },
    });
    expect(crossVoid.ok).toBe(false);
    expect(crossVoid.code).toBe("BRANCH_OUT_OF_SCOPE");
    expect(rows("posSale").find((row) => row.id === otherSale.id)!.status).toBe("COMPLETED");

    // Their own sale is still theirs to refund.
    const own = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      request: { saleId: ownSale.id, amountKES: 50, method: "cash" },
    });
    expect(own.ok).toBe(true);
  });

  it("a group-level sale is headquarters' business, not the branch's", async () => {
    const { config, br2 } = await goLive();
    const groupSale = await sell(config, owner());
    expect(groupSale.branchId ?? null).toBe(null);

    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: staffAt(br2),
      request: { saleId: groupSale.id, amountKES: 50, method: "cash" },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("BRANCH_OUT_OF_SCOPE");

    // The owner, unbound, can.
    const byOwner = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: owner(),
      request: { saleId: groupSale.id, amountKES: 50, method: "cash" },
    });
    expect(byOwner.ok).toBe(true);
  });

  it("a refund still needs the permission even inside the actor's own branch", async () => {
    const { config, br2 } = await goLive();
    const sale = await sell(config, staffAt(br2));
    const clerk = { ...staffAt(br2), permissions: ["CREATE_SALE", "VIEW_SALES"] as any };
    const result = await refundSale({
      businessId: "bizA",
      configuration: config,
      actor: clerk,
      request: { saleId: sale.id, amountKES: 50, method: "cash" },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NOT_ALLOWED");
  });

  it("another tenant's sale id is not found, never out-of-scope", async () => {
    const { config, br2 } = await goLive();
    const result = await refundSale({
      businessId: "bizB",
      configuration: config,
      actor: staffAt(br2),
      request: { saleId: "sale_from_another_business", amountKES: 50, method: "cash" },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("SALE_NOT_FOUND");
  });
});

describe("the sale routes answer the same way over HTTP (§16, §75)", () => {
  it("GET a cross-branch receipt id is a 404 that says nothing about the sale", async () => {
    const { config, br2, br3 } = await goLive();
    const otherSale = await sell(config, owner(), br3);
    const ownSale = await sell(config, staffAt(br2));

    // The cashier at br2 opens br3's receipt by id.
    mocks.session = CASHIER_SESSION;
    const cross = await saleDetailGet(new Request(`${BASE}/bizAales/${otherSale.id}`), ctx("bizA", { saleId: otherSale.id }) as any);
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual({ error: "That sale was not found." });

    // Their own receipt opens.
    const own = await saleDetailGet(new Request(`${BASE}/bizAales/${ownSale.id}`), ctx("bizA", { saleId: ownSale.id }) as any);
    expect(own.status).toBe(200);

    // The owner, unbound, reaches both.
    mocks.session = OWNER_SESSION;
    const forOwner = await saleDetailGet(new Request(`${BASE}/bizAales/${otherSale.id}`), ctx("bizA", { saleId: otherSale.id }) as any);
    expect(forOwner.status).toBe(200);
  });

  it("GET refuses a sale belonging to another tenant, and a signed-out caller", async () => {
    const { config, br2 } = await goLive();
    const sale = await sell(config, staffAt(br2));

    mocks.session = CASHIER_SESSION;
    const foreign = await saleDetailGet(new Request(`${BASE}/bizBales/${sale.id}`), ctx("bizB", { saleId: sale.id }) as any);
    expect(foreign.status).toBeGreaterThanOrEqual(400);

    mocks.session = null;
    const anon = await saleDetailGet(new Request(`${BASE}/bizAales/${sale.id}`), ctx("bizA", { saleId: sale.id }) as any);
    expect(anon.status).toBe(401);
  });

  it("POST a cross-branch refund is a 403, and a body cannot move the target", async () => {
    const { config, br2, br3 } = await goLive();
    const otherSale = await sell(config, owner(), br3);

    mocks.session = MANAGER_SESSION;
    const post = (saleId: string, body: Record<string, unknown>) =>
      saleDetailPost(
        new Request(`${BASE}/bizAales/${saleId}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        ctx("bizA", { saleId }) as any,
      );

    // A body that repeats — or forges — the sale id changes nothing: the path is authoritative.
    const forged = await post(otherSale.id, { saleId: "some_other_id", amountKES: 50, method: "cash" });
    expect(forged.status).toBe(403);
    expect((await forged.json()).code).toBe("BRANCH_OUT_OF_SCOPE");

    expect(rows("posSale").find((row) => row.id === otherSale.id)!.status).toBe("COMPLETED");
    expect(rows("posSale").find((row) => row.id === otherSale.id)!.refundedKES).toBe(0);
    expect(rows("posPayment").filter((row) => row.direction === "OUT")).toHaveLength(0);
  });

  it("POST inside the actor's own branch still refunds", async () => {
    const { config, br2 } = await goLive();
    const ownSale = await sell(config, staffAt(br2));

    mocks.session = MANAGER_SESSION;
    const response = await saleDetailPost(
      new Request(`${BASE}/bizAales/${ownSale.id}`, { method: "POST", body: JSON.stringify({ amountKES: 50, method: "cash" }), headers: { "content-type": "application/json" } }),
      ctx("bizA", { saleId: ownSale.id }) as any,
    );
    expect(response.status).toBe(200);
    expect(rows("posSale").find((row) => row.id === ownSale.id)!.refundedKES).toBe(50);
  });
});

describe("the server-rendered screens read through the same scope (§16, §75)", () => {
  it("every scoped store read honours a branch, and an absent scope means the whole business", async () => {
    const { config, br1, br2, br3 } = await goLive();
    await sell(config, owner(), br2);
    await sell(config, owner(), br3);
    await sell(config, owner());
    expect(rows("posSale")).toHaveLength(3);

    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    expect((await listSales("bizA", { range })).length).toBe(3);
    expect((await listSales("bizA", { range, branchId: br2 })).length).toBe(1);
    expect((await listSales("bizA", { range, branchId: br3 })).length).toBe(1);
    // The third sale belongs to no location (an unbound actor recorded it), so it is found only
    // when no scope is applied — which is exactly how an unbound actor reads.
    expect((await listSales("bizA", { range })).filter((sale: any) => (sale.branchId ?? null) == null)).toHaveLength(1);

    expect((await salesTotals("bizA", range)).count).toBe(3);
    expect((await salesTotals("bizA", range, undefined, { branchId: br2 })).count).toBe(1);
    expect((await salesTotals("bizA", range, undefined, { branchId: br3 })).count).toBe(1);

    // Movements and stock follow the same rule.
    expect((await listMovements("bizA", {})).length).toBe(3);
    expect((await listMovements("bizA", { branchId: br2 })).length).toBe(1);
    expect((await stockWithProducts("bizA")).length).toBeGreaterThan(2);
    expect((await stockWithProducts("bizA", undefined, { branchId: br3 })).length).toBe(1);

    // Locations: a bound actor sees their own name only.
    expect((await listBranches("bizA")).length).toBe(3);
    const scoped = await listBranches("bizA", undefined, { only: br2 });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].id).toBe(br2);

    // Orders are scoped the same way.
    await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-9001", stateKey: "NEW", workflowKey: "generic", branchId: br2, totalKES: 0 } });
    await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-9002", stateKey: "NEW", workflowKey: "generic", branchId: br3, totalKES: 0 } });
    expect((await listOrders("bizA", {})).length).toBe(2);
    expect((await listOrders("bizA", { branchId: br2 })).length).toBe(1);
  });

  it("a scoped read never crosses tenants, whatever branch is named", async () => {
    const { config, br2 } = await goLive();
    await sell(config, owner(), br2);
    // bizB's branch id used against bizA: the tenant filter is applied first and wins.
    const foreign = await listSales("bizA", { branchId: "br_b1" });
    expect(foreign).toHaveLength(0);
    expect((await salesTotals("bizA", {}, undefined, { branchId: "br_b1" })).count).toBe(0);
    expect((await listMovements("bizA", { branchId: "br_b1" })).length).toBe(0);
    expect((await listBranches("bizA", undefined, { only: "br_b1" })).length).toBe(0);
  });
});

describe("every POS screen passes the actor's branch into its reads (§16, §56)", () => {
  const root = path.resolve(__dirname, "../..");
  const page = (relative: string) => readFileSync(path.join(root, "app/dashboard/pos", relative), "utf8");

  // Each screen, and the store reads it must scope. A screen added later that forgets the scope
  // fails here rather than quietly showing a cashier the whole business.
  const screens: { file: string; scoped: RegExp[] }[] = [
    {
      file: "[businessId]/sales/page.tsx",
      scoped: [/listSales\([\s\S]{0,240}?branchId/, /salesTotals\([\s\S]{0,200}?\{\s*branchId\s*\}/],
    },
    {
      file: "[businessId]/inventory/page.tsx",
      scoped: [
        /stockWithProducts\(\s*businessId,\s*undefined,\s*\{\s*branchId\s*\}/,
        /listMovements\([\s\S]{0,200}?branchId/,
        /listBranches\([\s\S]{0,200}?only:\s*branchId/,
      ],
    },
    {
      file: "[businessId]/orders/OrderScreen.tsx",
      scoped: [/listOrders\([\s\S]{0,300}?branchId:\s*workspace\.branchId/],
    },
    {
      file: "[businessId]/produce/page.tsx",
      scoped: [
        /listSales\(\s*businessId,\s*\{\s*branchId/,
        /listMovements\([\s\S]{0,200}?branchId/,
        /stockWithProducts\(\s*businessId,\s*undefined,\s*\{\s*branchId\s*\}/,
      ],
    },
    {
      file: "[businessId]/customers/[customerId]/page.tsx",
      scoped: [/listSales\([\s\S]{0,300}?branchId:\s*workspace\.branchId/],
    },
    {
      file: "[businessId]/branches/page.tsx",
      scoped: [
        /listBranches\([\s\S]{0,300}?only:\s*workspace\.branchId/,
        /salesTotals\([\s\S]{0,300}?branchId:\s*workspace\.branchId/,
      ],
    },
    {
      file: "[businessId]/sales/[saleId]/page.tsx",
      scoped: [/branchRecordInScope\(\s*workspace,\s*sale\.branchId\s*\)/],
    },
  ];

  it("scopes every read that can be scoped", () => {
    for (const screen of screens) {
      const source = page(screen.file);
      for (const pattern of screen.scoped) {
        expect(pattern.test(source), `${screen.file} must scope ${pattern}`).toBe(true);
      }
    }
  });

  it("the sale-detail API route applies the same scope on the path parameter", () => {
    const source = readFileSync(path.join(root, "app/api/pos/[businessId]/sales/[saleId]/route.ts"), "utf8");
    expect(source).toContain("branchRecordInScope");
    // A branch refusal is an authorization answer, not a bad request.
    expect(source).toContain('code === "BRANCH_OUT_OF_SCOPE"');
  });
});
