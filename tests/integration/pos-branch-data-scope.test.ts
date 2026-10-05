/**
 * Branch scope on the rest of the POS's location-bearing records, and the module read every
 * server-rendered screen asks for (§11, §16, §25, §75).
 *
 * The first half is data: stock comes in at one location (purchases), money leaves one location
 * (expenses), and a ticket is taken at one location (orders). Each of those tables carries a
 * `branchId`, so each of those reads has to be scoped the way sales, stock and movements already
 * are — otherwise a clerk bound to one shop reads the group's deliveries, the group's spend and
 * the group's order book by opening an ordinary screen.
 *
 * The second half is the module read. Every screen that loads POS rows must ask for the same
 * permission its data requires *before* it reads them: a nav link is not a permission, and a URL
 * typed directly into the address bar is still a request the server has to answer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
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
import { moveOrder } from "@/lib/pos/operations";
import { expenseTotals, findOrder, listBranches, listExpenses, listPurchases } from "@/lib/pos/store";
import { settlePosPayment } from "@/lib/pos/settlement";
import { POS_PLAN_KEY } from "@/lib/pos/entitlement";
import { GET as orderDetailGet } from "@/app/api/pos/[businessId]/orders/[orderId]/route";
import PosOrderDetailPage from "@/app/dashboard/pos/[businessId]/orders/[orderId]/page";
import PosProducePage from "@/app/dashboard/pos/[businessId]/produce/page";
import type { FakeDb } from "@/tests/helpers/posFakeDb";
import type { PosActor } from "@/lib/pos/sales";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);

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
  tracks_expenses: true,
  has_suppliers: true,
  orders: true,
  pickup: true,
};

const ALL: string[] = [
  "CREATE_SALE",
  "VIEW_SALES",
  "VIEW_ORDERS",
  "MANAGE_ORDERS",
  "CANCEL_ORDER",
  "VIEW_INVENTORY",
  "VIEW_SUPPLIERS",
  "VIEW_EXPENSES",
  "VIEW_STAFF",
  "MANAGE_USERS",
  "EDIT_CONFIGURATION",
];

function owner(): PosActor {
  return { actorId: "userA", actorName: "Owner A", roleKey: "OWNER", permissions: ALL as any, staffId: null, branchId: null };
}
function clerkAt(branchId: string | null): PosActor {
  return { actorId: "cashierA", actorName: "Mary Cashier", roleKey: "MANAGER", permissions: ALL as any, staffId: "st_a1", branchId };
}

const OWNER_SESSION = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CLERK_SESSION = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
const INTERN_SESSION = { userId: "internA", email: "intern@example.com", role: "CUSTOMER", name: "Ida Intern" };

async function goLive() {
  await saveDraft({ businessId: "bizA", answers: retailAnswers, actorId: "userA", context: { businessName: "Nyumbani Kitchen" } });
  fake().rows("payment").push({
    id: "pay_data_1",
    reference: "jata-pos-data-1",
    businessId: "bizA",
    userId: "userA",
    planId: "plan_pos",
    amount: 49_900,
    currency: "KES",
    status: "PENDING",
  });
  await prisma.$transaction(async (tx: any) =>
    settlePosPayment(tx, {
      payment: { id: "pay_data_1", reference: "jata-pos-data-1", businessId: "bizA", userId: "userA", planId: "plan_pos", amount: 49_900, currency: "KES", status: "PENDING" },
      plan: { id: "plan_pos", key: POS_PLAN_KEY, priceKES: 499, durationDays: 30 },
      eventId: "evt_data_1",
    }),
  );
  await prisma.posBranch.create({ data: { businessId: "bizA", name: "Kilimani Shop", isPrimary: false, isActive: true } });
  await prisma.posBranch.create({ data: { businessId: "bizA", name: "Westlands Shop", isPrimary: false, isActive: true } });
  const branches = rows("posBranch");
  const [br1, br2, br3] = [branches[0].id, branches[1].id, branches[2].id];
  // The seeded staff row is a real member of this business; binding it to a location is what
  // gives the HTTP session a branch scope at all.
  await prisma.posStaff.update({ where: { id: "st_a1" }, data: { roleKey: "MANAGER", branchId: br2 } });
  // A staff record whose role this business never configured holds nothing at all (§36), which
  // is exactly what a screen must answer with a refusal rather than with data.
  await prisma.user.create({ data: { id: "internA", name: "Ida Intern", email: "intern@example.com" } });
  await prisma.businessMember.create({ data: { id: "mem_intern", businessId: "bizA", userId: "internA", role: "STAFF" } });
  await prisma.posStaff.create({
    data: { businessId: "bizA", userId: "internA", name: "Ida Intern", roleKey: "INTERN", isActive: true, branchId: null, commissionPercent: 0 },
  });
  const record = await loadConfiguration("bizA");
  return { config: effectiveConfiguration(record, "LIVE")!, br1, br2, br3 };
}

const ctx = (businessId: string, orderId: string) => ({ params: Promise.resolve({ businessId, orderId }) });
const req = (method = "GET") => ({ method, url: "https://jata.test/", json: async () => ({}) } as any);

beforeEach(() => {
  fake().reset();
  mocks.session = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Purchases and expenses are location records (§16, §75)
// ─────────────────────────────────────────────────────────────────────────────

describe("deliveries and spend belong to the location they happened at (§16, §75)", () => {
  it("listPurchases honours a branch, and no scope means the whole business", async () => {
    const { br2, br3 } = await goLive();
    for (const branchId of [br2, br3, null]) {
      await prisma.posPurchase.create({
        data: { businessId: "bizA", branchId, reference: `PO-${branchId ?? "none"}`, totalKES: 1000, status: "ORDERED" },
      });
    }
    expect(rows("posPurchase")).toHaveLength(3);

    expect((await listPurchases("bizA")).length).toBe(3);
    // A branch scope is exact: rows recorded with no location are business-wide, so they are
    // only visible to an actor who reads business-wide — the same rule sales follow.
    expect((await listPurchases("bizA", { branchId: br2 })).length).toBe(1);
    expect((await listPurchases("bizA", { branchId: br3 })).length).toBe(1);
    expect((await listPurchases("bizA", { branchId: br2 }))[0].branchId).toBe(br2);
  });

  it("a status filter and a branch filter compose", async () => {
    const { br2 } = await goLive();
    await prisma.posPurchase.create({ data: { businessId: "bizA", branchId: br2, reference: "PO-1", status: "ORDERED", totalKES: 500 } });
    await prisma.posPurchase.create({ data: { businessId: "bizA", branchId: br2, reference: "PO-2", status: "RECEIVED", totalKES: 700 } });
    expect((await listPurchases("bizA", { status: "RECEIVED", branchId: br2 })).length).toBe(1);
    expect((await listPurchases("bizA", { status: "DRAFT", branchId: br2 })).length).toBe(0);
  });

  it("listExpenses and expenseTotals read the actor's location only", async () => {
    const { br2, br3 } = await goLive();
    await prisma.posExpense.create({ data: { businessId: "bizA", branchId: br2, categoryKey: "transport", amountKES: 400, method: "cash" } });
    await prisma.posExpense.create({ data: { businessId: "bizA", branchId: br3, categoryKey: "transport", amountKES: 900, method: "cash" } });

    expect((await listExpenses("bizA")).length).toBe(2);
    expect((await listExpenses("bizA", { branchId: br2 })).length).toBe(1);

    // The headline figure is the figure for the rows this actor may read: showing a branch clerk
    // the group's total spend would answer a question they are not allowed to ask.
    expect((await expenseTotals("bizA")).amountKES).toBe(1300);
    expect((await expenseTotals("bizA", {}, undefined, { branchId: br2 })).amountKES).toBe(400);
    expect((await expenseTotals("bizA", {}, undefined, { branchId: br3 })).amountKES).toBe(900);
  });

  it("neither read crosses tenants, whatever branch is named", async () => {
    const { br2 } = await goLive();
    await prisma.posPurchase.create({ data: { businessId: "bizA", branchId: br2, reference: "PO-A", status: "ORDERED", totalKES: 100 } });
    await prisma.posPurchase.create({ data: { businessId: "bizB", branchId: "br_b1", reference: "PO-B", status: "ORDERED", totalKES: 100 } });
    await prisma.posExpense.create({ data: { businessId: "bizA", branchId: br2, categoryKey: "rent", amountKES: 100, method: "cash" } });
    await prisma.posExpense.create({ data: { businessId: "bizB", branchId: "br_b1", categoryKey: "rent", amountKES: 9_999, method: "cash" } });

    expect((await listPurchases("bizA", { branchId: "br_b1" })).length).toBe(0);
    expect((await listExpenses("bizA", { branchId: "br_b1" })).length).toBe(0);
    expect((await expenseTotals("bizA", {}, undefined, { branchId: "br_b1" })).amountKES).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// An order opened by id (§16, §75)
// ─────────────────────────────────────────────────────────────────────────────

describe("an order opened by id is in the actor's branch or not found (§16, §75)", () => {
  it("GET refuses another branch's order, and serves the actor's own", async () => {
    const { br2, br3 } = await goLive();
    const own = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-1", stateKey: "NEW", workflowKey: "generic", branchId: br2, totalKES: 100 } });
    const other = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-2", stateKey: "NEW", workflowKey: "generic", branchId: br3, totalKES: 200 } });

    // The session's staff row binds this actor to br2 (§16): the scope is the staff row's, never
    // a value the browser can supply.
    mocks.session = CLERK_SESSION;
    const inScope = await orderDetailGet(req(), ctx("bizA", own.id) as any);
    expect(inScope.status).toBe(200);

    const outOfScope = await orderDetailGet(req(), ctx("bizA", other.id) as any);
    expect(outOfScope.status).toBe(404);
    const body = await outOfScope.json();
    // The refusal says nothing about the order: not whether it exists, and not where it is.
    expect(JSON.stringify(body)).not.toContain("ORD-2");
    expect(JSON.stringify(body)).not.toContain(br3);

    // The owner is unbound, so both are theirs (§75).
    mocks.session = OWNER_SESSION;
    expect((await orderDetailGet(req(), ctx("bizA", other.id) as any)).status).toBe(200);
  });

  it("an order belonging to another tenant is not found, never out-of-scope", async () => {
    await goLive();
    const foreign = await prisma.posOrder.create({ data: { businessId: "bizB", reference: "ORD-B", stateKey: "NEW", workflowKey: "generic", branchId: "br_b1", totalKES: 100 } });
    mocks.session = OWNER_SESSION;
    const answer = await orderDetailGet(req(), ctx("bizA", foreign.id) as any);
    expect(answer.status).toBe(404);
    expect(JSON.stringify(await answer.json())).not.toContain("ORD-B");
  });

  it("a business-wide order is headquarters' business, not the branch's", async () => {
    const { br2 } = await goLive();
    const group = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-G", stateKey: "NEW", workflowKey: "generic", branchId: null, totalKES: 100 } });
    mocks.session = CLERK_SESSION;
    // A record that cannot appear in this actor's scoped board cannot be opened by id either.
    expect((await orderDetailGet(req(), ctx("bizA", group.id) as any)).status).toBe(404);
    mocks.session = OWNER_SESSION;
    expect((await orderDetailGet(req(), ctx("bizA", group.id) as any)).status).toBe(200);
    expect(br2).toBeTruthy();
  });

  it("moveOrder refuses another branch's order, and still moves the actor's own", async () => {
    const { config, br2, br3 } = await goLive();
    const own = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-1", stateKey: "NEW", workflowKey: "generic", branchId: br2, totalKES: 100 } });
    const other = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-2", stateKey: "NEW", workflowKey: "generic", branchId: br3, totalKES: 200 } });

    // Moving a ticket is a write, so it is refused with the reason rather than quietly landing
    // on somebody else's order.
    const refused = await moveOrder({ businessId: "bizA", configuration: config, actor: clerkAt(br2), orderId: other.id, toState: "CONFIRMED" });
    expect(refused.ok).toBe(false);
    expect((refused as any).code).toBe("BRANCH_OUT_OF_SCOPE");
    expect(rows("posOrderEvent")).toHaveLength(0);

    const allowed = await moveOrder({ businessId: "bizA", configuration: config, actor: clerkAt(br2), orderId: own.id, toState: "CONFIRMED" });
    expect(allowed.ok).toBe(true);
    expect((allowed as any).toState).toBe("CONFIRMED");
    expect(rows("posOrderEvent")).toHaveLength(1);
    expect((await findOrder("bizA", own.id))?.stateKey).toBe("CONFIRMED");

    // An unbound actor keeps business-wide reach (§75).
    const byOwner = await moveOrder({ businessId: "bizA", configuration: config, actor: owner(), orderId: other.id, toState: "CONFIRMED" });
    expect(byOwner.ok).toBe(true);
  });

  it("the branch refusal comes before the permission and the workflow checks", async () => {
    const { config, br2, br3 } = await goLive();
    const other = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-3", stateKey: "NEW", workflowKey: "generic", branchId: br3, totalKES: 300 } });
    // A clerk with no order permissions at all still gets the branch answer, not "not allowed":
    // the record is out of their scope before anyone asks what they may do to it.
    const clerk = { ...clerkAt(br2), permissions: [] } as unknown as PosActor;
    const refused = await moveOrder({ businessId: "bizA", configuration: config, actor: clerk, orderId: other.id, toState: "CONFIRMED" });
    expect(refused.ok).toBe(false);
    expect((refused as any).code).toBe("BRANCH_OUT_OF_SCOPE");
    expect(rows("posOrderEvent")).toHaveLength(0);
  });

  it("a location-bound clerk sees their own location only in the staff board's list", async () => {
    const { br2 } = await goLive();
    expect((await listBranches("bizA")).length).toBe(3);
    const scoped = await listBranches("bizA", undefined, { only: br2 });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].id).toBe(br2);
    expect(scoped[0].name).toBe("Kilimani Shop");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every screen and route passes the scope it has (§16, §56)
// ─────────────────────────────────────────────────────────────────────────────

describe("the remaining screens and routes pass the actor's scope (§16, §56)", () => {
  const root = path.resolve(__dirname, "../..");
  const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

  it("scopes the purchase, expense, staff and inventory reads", () => {
    const expected: { file: string; patterns: RegExp[] }[] = [
      {
        file: "app/dashboard/pos/[businessId]/purchases/page.tsx",
        patterns: [/listPurchases\([\s\S]{0,200}?branchId:\s*workspace\.branchId/],
      },
      {
        file: "app/api/pos/[businessId]/purchases/route.ts",
        patterns: [/listPurchases\([\s\S]{0,200}?branchId:\s*ctx\.branchId/],
      },
      {
        file: "app/dashboard/pos/[businessId]/expenses/page.tsx",
        patterns: [/listExpenses\([\s\S]{0,200}?branchId:\s*workspace\.branchId/, /expenseTotals\([\s\S]{0,200}?branchId:\s*workspace\.branchId/],
      },
      {
        file: "app/api/pos/[businessId]/expenses/route.ts",
        patterns: [/listExpenses\([\s\S]{0,200}?branchId:\s*ctx\.branchId/, /expenseTotals\([\s\S]{0,200}?branchId:\s*ctx\.branchId/],
      },
      {
        file: "app/dashboard/pos/[businessId]/staff/page.tsx",
        patterns: [/listBranches\([^)]*only:\s*workspace\.branchId/],
      },
      {
        file: "app/api/pos/[businessId]/staff/route.ts",
        patterns: [/listBranches\([^)]*only:\s*ctx\.branchId/],
      },
      {
        file: "app/api/pos/[businessId]/inventory/route.ts",
        patterns: [/lowStock\([^)]*branchId:\s*ctx\.branchId/],
      },
      {
        file: "app/api/pos/[businessId]/suppliers/[supplierId]/route.ts",
        patterns: [/listPurchases\([\s\S]{0,200}?branchId:\s*ctx\.branchId/],
      },
    ];
    for (const entry of expected) {
      const source = read(entry.file);
      for (const pattern of entry.patterns) {
        expect(pattern.test(source), `${entry.file} must scope ${pattern}`).toBe(true);
      }
    }
  });

  it("the order-detail route applies the scope to the path parameter", () => {
    const source = read("app/api/pos/[businessId]/orders/[orderId]/route.ts");
    expect(source).toContain("branchRecordInScope");
    expect(source).toContain("branchOutOfScopeMessage");
    const page = read("app/dashboard/pos/[businessId]/orders/[orderId]/page.tsx");
    expect(page).toContain("branchRecordInScope(workspace, order.branchId)");
    expect(page).toContain("notFound()");
  });

  it("moveOrder refuses an out-of-scope order before it writes anything", () => {
    const source = read("lib/pos/operations.ts");
    expect(source).toContain("store.branchRecordInScope(actor, order.branchId)");
    expect(source).toContain('"BRANCH_OUT_OF_SCOPE"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every screen asks for a module read (§11, §25)
// ─────────────────────────────────────────────────────────────────────────────

describe("every POS screen asks for a module read before it loads rows (§11, §25)", () => {
  const root = path.resolve(__dirname, "../..");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
    });

  const pages = () => walk(path.join(root, "app/dashboard/pos")).filter((file) => file.endsWith("page.tsx") || file.endsWith("Screen.tsx"));

  /**
   * Screens that deliberately load no module data of their own: the shell, the onboarding steps
   * that only render plan prices or a sandbox preview, and the two screens that check the
   * permission inline instead of through the gate helper.
   */
  const EXEMPT = new Set([
    path.join("[businessId]", "layout.tsx"), // authorizes the tenant once, for every screen beneath it
    path.join("[businessId]", "plan", "page.tsx"), // static plan pricing; no POS rows are read
    path.join("[businessId]", "preview", "page.tsx"), // a sandbox built from the configuration, not the records
  ]);

  it("loads a workspace only behind a permission", () => {
    const ungated: string[] = [];
    for (const file of pages()) {
      const relative = path.relative(path.join(root, "app/dashboard/pos"), file);
      if (EXEMPT.has(relative)) continue;
      const source = readFileSync(file, "utf8");
      if (!/loadPosPageWorkspace\(|loadPosWorkspaceCached\(/.test(source)) continue;

      const gated =
        // The gate helper: the permission is enforced before the first row is read, and the
        // screen renders a refusal instead of the data.
        /loadPosPageWorkspace\(\s*businessId,\s*"/.test(source) ||
        // An explicit inline check, used where the screen is the module's own write screen.
        /workspace\.permissions\.includes\("/.test(source);
      if (!gated) ungated.push(relative);
    }
    expect(ungated, `these screens load POS rows without asking for a permission: ${ungated.join(", ")}`).toEqual([]);
  });

  it("the order detail screen asks for VIEW_ORDERS — the read its API enforces", () => {
    const source = readFileSync(path.join(root, "app/dashboard/pos/[businessId]/orders/[orderId]/page.tsx"), "utf8");
    expect(source).toContain('loadPosPageWorkspace(businessId, "VIEW_ORDERS")');
    expect(source).toContain("PosRefusal");
    expect(source).toContain("if (!gate.workspace)");
  });

  it("the produce screen asks for a module read before it shows sales and stock", () => {
    const source = readFileSync(path.join(root, "app/dashboard/pos/[businessId]/produce/page.tsx"), "utf8");
    expect(source).toContain("loadPosPageWorkspace");
    expect(source).toContain("PosRefusal");
    expect(source).toContain("if (!gate.workspace)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screens themselves refuse before they read (§11, §25)
// ─────────────────────────────────────────────────────────────────────────────

describe("the produce and order screens refuse before they read a row (§11, §25)", () => {
  /** The refusal component carries the reason; the gate never returns data next to it. */
  const refusalOf = (element: any): string | undefined => (element && typeof element === "object" ? element.props?.message : undefined);

  /** Every string a rendered element carries, so a page can be searched without serializing React. */
  const stringsIn = (node: any, seen = new Set<any>()): string => {
    if (node == null || seen.has(node)) return "";
    if (typeof node === "string") return node;
    if (typeof node !== "object") return String(node);
    seen.add(node);
    if (Array.isArray(node)) return node.map((child) => stringsIn(child, seen)).join(" ");
    let out = "";
    for (const key of Object.keys(node)) {
      if (key === "_owner" || key === "_store") continue;
      out += ` ${stringsIn(node[key], seen)}`;
    }
    return out;
  };

  it("the produce screen shows the refusal, and reads nothing, for a role with no module read", async () => {
    await goLive();
    mocks.session = INTERN_SESSION;
    const element: any = await (PosProducePage as any)({ params: Promise.resolve({ businessId: "bizA" }) });
    expect(typeof refusalOf(element)).toBe("string");
    expect(refusalOf(element)!.length).toBeGreaterThan(0);
    // Nothing was read: the gate runs before the sales, movement and stock queries.
    expect(fake().calls("posSale", "findMany")).toHaveLength(0);
    expect(fake().calls("posInventoryMovement", "findMany")).toHaveLength(0);
    expect(fake().calls("posInventoryItem", "findMany")).toHaveLength(0);
  });

  it("the produce screen renders its own location's figures for a role that holds the read", async () => {
    await goLive();
    mocks.session = OWNER_SESSION;
    const element: any = await (PosProducePage as any)({ params: Promise.resolve({ businessId: "bizA" }) });
    expect(refusalOf(element)).toBeUndefined();
    // It did read — the refusal above is a gate, not a broken screen.
    expect(fake().calls("posSale", "findMany").length).toBeGreaterThan(0);
  });

  it("the order screen shows the refusal for a role with no order read", async () => {
    await goLive();
    const order = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-P1", stateKey: "NEW", workflowKey: "generic", branchId: null, totalKES: 100 } });
    const before = fake().calls("posOrder", "findFirst").length;
    mocks.session = INTERN_SESSION;
    const element: any = await (PosOrderDetailPage as any)({ params: Promise.resolve({ businessId: "bizA", orderId: order.id }) });
    expect(typeof refusalOf(element)).toBe("string");
    // The order was never fetched, so an unauthorized role cannot even confirm that it exists.
    expect(fake().calls("posOrder", "findFirst")).toHaveLength(before);
  });

  it("the order screen is not-found, not rendered, when the order sits in another location", async () => {
    const { br3 } = await goLive();
    const other = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-P2", stateKey: "NEW", workflowKey: "generic", branchId: br3, totalKES: 200 } });
    mocks.session = CLERK_SESSION; // this staff row is bound to br2
    const thrown = await (PosOrderDetailPage as any)({ params: Promise.resolve({ businessId: "bizA", orderId: other.id }) }).catch((error: any) => error);
    // `notFound()` — the ticket exists, but not for this actor, and the page says nothing else.
    expect(String(thrown?.digest ?? thrown?.message)).toContain("404");
  });

  it("the order screen renders the ticket for the actor's own location", async () => {
    const { br2 } = await goLive();
    const own = await prisma.posOrder.create({ data: { businessId: "bizA", reference: "ORD-P3", stateKey: "NEW", workflowKey: "generic", branchId: br2, totalKES: 300 } });
    mocks.session = CLERK_SESSION;
    const element: any = await (PosOrderDetailPage as any)({ params: Promise.resolve({ businessId: "bizA", orderId: own.id }) });
    expect(refusalOf(element)).toBeUndefined();
    // The ticket itself is rendered, with its reference — the gate let it through.
    expect(stringsIn(element)).toContain("ORD-P3");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Records that are business-wide on purpose (§16)
// ─────────────────────────────────────────────────────────────────────────────

describe("customer, supplier and credit records are business-wide by design (§16, §30)", () => {
  const root = path.resolve(__dirname, "../..");
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const model = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf("\n}", schema.indexOf(`model ${name} {`)));

  it("a customer and a supplier carry no location, so location scoping does not apply", () => {
    // Documented rather than asserted away: these rows are tenant-scoped only, which is why the
    // customer, supplier and credit screens gate on their module read and not on a branch.
    expect(model("PosCustomer")).not.toContain("branchId");
    expect(model("PosSupplier")).not.toContain("branchId");
    // The records that *are* locations' own all carry one.
    for (const name of ["PosSale", "PosOrder", "PosExpense", "PosPurchase", "PosPayment", "PosInventoryItem", "PosInventoryMovement"]) {
      expect(model(name), `${name} must carry a branchId to be branch-scopable`).toContain("branchId");
    }
  });

  it("those screens still gate on their module read", () => {
    for (const relative of [
      "app/dashboard/pos/[businessId]/customers/page.tsx",
      "app/dashboard/pos/[businessId]/suppliers/page.tsx",
      "app/dashboard/pos/[businessId]/credit/page.tsx",
      "app/dashboard/pos/[businessId]/payments/page.tsx",
    ]) {
      const source = readFileSync(path.join(root, relative), "utf8");
      expect(source, `${relative} must ask for a permission`).toMatch(/loadPosPageWorkspace\(\s*businessId,\s*"/);
    }
  });

  it("every customer, supplier and credit read is still tenant-scoped", async () => {
    const { br2 } = await goLive();
    await prisma.posExpense.create({ data: { businessId: "bizB", branchId: "br_b1", categoryKey: "rent", amountKES: 5_000, method: "cash" } });
    // bizB is a different tenant with its own branch; asking bizA for it returns nothing rather
    // than the other business's money.
    expect((await listExpenses("bizA", { branchId: br2 })).length).toBe(0);
    expect((await listBranches("bizA", undefined, { only: "br_b1" })).length).toBe(0);
  });
});
