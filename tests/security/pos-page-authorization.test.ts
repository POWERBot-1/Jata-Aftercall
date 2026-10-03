/**
 * POS page-layer authorization (§11, §36, §56, §75)
 *
 * The documented gap: the screen-level APIs check a module permission for every read and write,
 * but three server-rendered POS pages read the store behind `loadPosWorkspaceCached`, which checks
 * tenant membership and lifecycle only. A cashier who typed `/credit`, `/expenses` or `/staff`
 * saw data the equivalent API call refuses.
 *
 * These tests call the *page components themselves* — the code Next renders — against the
 * in-memory database, for the owner, for the cashier the leak was reported for, for other staff
 * roles and for a stranger. They prove:
 *
 * 1. a role without the module's read permission renders the "not for you" state and the page's
 *    data loaders are never called — nothing protected is read, let alone rendered (§56);
 * 2. an owner, and a non-owner whose role holds the permission, keeps the screen (§36);
 * 3. the page and the API agree, actor for actor, so the two layers cannot drift apart again;
 * 4. the refusals are audited and cross-tenant access still fails (§5, §37, §75);
 * 5. the lifecycle/payment gates are exactly as they were (§44).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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

// The three pages' data loaders are spied on: "refused" must also mean "never read".
vi.mock("@/lib/pos/store", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    partiesWithBalances: vi.fn(actual.partiesWithBalances),
    listExpenses: vi.fn(actual.listExpenses),
    expenseTotals: vi.fn(actual.expenseTotals),
    listStaff: vi.fn(actual.listStaff),
    listBranches: vi.fn(actual.listBranches),
  };
});

import { activateSubscriptionForPayment } from "@/lib/paystack";
import { PosAccessError, requirePosAccess } from "@/lib/pos/guard";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { effectivePermissions } from "@/lib/pos/permissions";
import { partiesWithBalances, listExpenses, listStaff } from "@/lib/pos/store";
import type { FakeDb } from "@/tests/helpers/posFakeDb";

import PosCreditPage from "@/app/dashboard/pos/[businessId]/credit/page";
import PosExpensesPage from "@/app/dashboard/pos/[businessId]/expenses/page";
import PosStaffPage from "@/app/dashboard/pos/[businessId]/staff/page";
import { GET as expensesGet, POST as expensesPost } from "@/app/api/pos/[businessId]/expenses/route";
import { GET as staffGet, POST as staffPost } from "@/app/api/pos/[businessId]/staff/route";
import { POST as configPost } from "@/app/api/pos/[businessId]/configuration/route";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);

// ── Sessions ──────────────────────────────────────────────────────────────────

const OWNER = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CASHIER = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
const SALESPERSON = { userId: "salesA", email: "sam@example.com", role: "CUSTOMER", name: "Sam Salesperson" };
const ACCOUNTANT = { userId: "acctA", email: "alice@example.com", role: "CUSTOMER", name: "Alice Accountant" };
const MANAGER = { userId: "mgrA", email: "moses@example.com", role: "CUSTOMER", name: "Moses Manager" };
const STRANGER = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" };

const as = (session: any) => { mocks.session = session; };

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  staff_count: 6,
  staff_roles: ["CASHIER", "SALESPERSON", "ACCOUNTANT", "MANAGER", "WAITER"],
  tracks_expenses: true,
  expense_categories: ["rent", "electricity", "transport", "salaries"],
  has_suppliers: true,
  supplier_payment_methods: ["cash", "credit"],
  supplier_credit: true,
  discounts: true,
  restaurant_kitchen: true,
};

/** $1,500 owed by a named customer, an expense, and a team with four distinct roles. */
function seedShopData() {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
  rows("posCustomer").find((row) => row.id === "c_a1")!.balanceKES = 1500;
  rows("posCreditEntry").push({
    id: "ce_a1",
    businessId: "bizA",
    partyType: "CUSTOMER",
    partyId: "c_a1",
    direction: "DEBIT",
    amountKES: 1500,
    createdAt: daysAgo(40),
  });
  rows("posExpense").push({
    id: "ex_a1",
    businessId: "bizA",
    categoryKey: "rent",
    label: "October rent",
    amountKES: 30000,
    method: "cash",
    occurredAt: new Date(),
    createdById: "userA",
  });
  rows("posStaff").push(
    { id: "st_sales", businessId: "bizA", userId: "salesA", name: "Sam Salesperson", roleKey: "SALESPERSON", isActive: true, branchId: null, commissionPercent: 0 },
    { id: "st_acct", businessId: "bizA", userId: "acctA", name: "Alice Accountant", roleKey: "ACCOUNTANT", isActive: true, branchId: null, commissionPercent: 0 },
    { id: "st_mgr", businessId: "bizA", userId: "mgrA", name: "Moses Manager", roleKey: "MANAGER", isActive: true, branchId: null, commissionPercent: 0 },
  );
  rows("businessMember").push(
    { id: "mem_sales", businessId: "bizA", userId: "salesA", role: "STAFF" },
    { id: "mem_acct", businessId: "bizA", userId: "acctA", role: "STAFF" },
    { id: "mem_mgr", businessId: "bizA", userId: "mgrA", role: "STAFF" },
  );
}

/** Configure over HTTP as the owner, exactly as the configure screen does (§4, §43). */
async function configure(businessId = "bizA") {
  const response = await configPost(
    new Request(`https://jata.test/api/pos/${businessId}`, {
      method: "POST",
      body: JSON.stringify({ answers: restaurantAnswers }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ businessId }) },
  );
  expect(response.status).toBe(200);
}

/** Pay over the production settlement path — the same function the Paystack webhook calls (§44). */
async function payForPos(businessId = "bizA", reference = "jata-pos-page") {
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
  await activateSubscriptionForPayment(`pay_${businessId}`, `evt_${reference}`, { paystackId: `ps_${reference}` });
}

/** A live restaurant with credit, expenses and a team. */
async function liveShop() {
  as(OWNER);
  await configure();
  await payForPos();
}

// ── Page rendering ────────────────────────────────────────────────────────────

type Page = (props: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;

/** Render a POS page the way Next does, and return the HTML a browser would receive. */
async function render(page: Page, businessId = "bizA", query: Record<string, string> = {}) {
  const element = await page({ params: Promise.resolve({ businessId }), searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element);
}

const REFUSAL = "This screen is not for your role";

// ── API calls, for the "the two layers agree" proof ───────────────────────────

const apiContext = (businessId: string) => ({ params: Promise.resolve({ businessId }) });

const getJson = async (handler: any, businessId = "bizA") => {
  const response = await handler(new Request(`https://jata.test/api/pos/${businessId}`), apiContext(businessId));
  return { status: response.status, body: await response.json().catch(() => null) };
};

const postJson = async (handler: any, body: unknown = {}, businessId = "bizA") => {
  const response = await handler(
    new Request(`https://jata.test/api/pos/${businessId}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    apiContext(businessId),
  );
  return { status: response.status, body: await response.json().catch(() => null) };
};

beforeEach(() => {
  fake().reset();
  seedShopData();
  as(OWNER);
  vi.mocked(partiesWithBalances).mockClear();
  vi.mocked(listExpenses).mockClear();
  vi.mocked(listStaff).mockClear();
});

// ── 1. The refusal ────────────────────────────────────────────────────────────

describe("a POS page refuses what its API refuses (§11, §36, §56)", () => {
  beforeEach(async () => {
    await liveShop();
    as(CASHIER);
  });

  it("refuses /credit to a cashier, and reads no ledger", async () => {
    const html = await render(PosCreditPage as unknown as Page);

    expect(html).toContain(REFUSAL);
    expect(html).toContain("Cashier cannot see credit balances.");
    expect(html).not.toContain("Jane Wanjiku");
    expect(html).not.toContain("Owed to you");
    expect(partiesWithBalances).not.toHaveBeenCalled();
  });

  it("refuses /expenses to a cashier, and reads no expense", async () => {
    const html = await render(PosExpensesPage as unknown as Page);

    expect(html).toContain(REFUSAL);
    expect(html).toContain("Cashier cannot see expenses.");
    expect(html).not.toContain("October rent");
    expect(html).not.toContain("30,000");
    expect(listExpenses).not.toHaveBeenCalled();
  });

  it("refuses /staff to a cashier, and reads no team", async () => {
    const html = await render(PosStaffPage as unknown as Page);

    expect(html).toContain(REFUSAL);
    expect(html).toContain("Cashier cannot see staff.");
    expect(html).not.toContain("Moses Manager");
    expect(html).not.toContain("Mary Cashier");
    expect(listStaff).not.toHaveBeenCalled();
  });

  it("audits the page-layer refusal exactly like an API refusal (§37, §75)", async () => {
    await render(PosStaffPage as unknown as Page);

    const denied = rows("posAuditEvent").filter((row) => row.action === "POS_ACCESS_DENIED");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ businessId: "bizA", actorId: "cashierA", targetType: "PERMISSION", targetId: "VIEW_STAFF" });
  });
});

// ── 2. Legitimate access is preserved ─────────────────────────────────────────

describe("the screens open for every role that holds the permission (§36)", () => {
  beforeEach(async () => {
    await liveShop();
  });

  it("shows the owner the credit ledger, the expenses and the team", async () => {
    as(OWNER);

    const credit = await render(PosCreditPage as unknown as Page);
    expect(credit).not.toContain(REFUSAL);
    expect(credit).toContain("Jane Wanjiku");
    expect(credit).toContain("Owed to you");

    const expenses = await render(PosExpensesPage as unknown as Page);
    expect(expenses).not.toContain(REFUSAL);
    expect(expenses).toContain("October rent");

    const staff = await render(PosStaffPage as unknown as Page);
    expect(staff).not.toContain(REFUSAL);
    expect(staff).toContain("Mary Cashier");
    expect(staff).toContain("Moses Manager");
  });

  it("keeps the credit screen for a salesperson, who holds VIEW_CREDIT but not VIEW_EXPENSES (§30)", async () => {
    as(SALESPERSON);

    const credit = await render(PosCreditPage as unknown as Page);
    expect(credit).not.toContain(REFUSAL);
    expect(credit).toContain("Jane Wanjiku");

    // The same person is still refused where they hold nothing — per module, not per person.
    expect(await render(PosExpensesPage as unknown as Page)).toContain(REFUSAL);
    expect(await render(PosStaffPage as unknown as Page)).toContain(REFUSAL);
  });

  it("keeps the money screens for an accountant, and still refuses the staff screen (§15, §36)", async () => {
    as(ACCOUNTANT);

    expect(await render(PosCreditPage as unknown as Page)).not.toContain(REFUSAL);
    expect(await render(PosExpensesPage as unknown as Page)).not.toContain(REFUSAL);
    expect(await render(PosStaffPage as unknown as Page)).toContain(REFUSAL);
  });

  it("keeps all three screens for a manager", async () => {
    as(MANAGER);

    expect(await render(PosCreditPage as unknown as Page)).not.toContain(REFUSAL);
    expect(await render(PosExpensesPage as unknown as Page)).not.toContain(REFUSAL);
    expect(await render(PosStaffPage as unknown as Page)).not.toContain(REFUSAL);
  });

  it("still lets the owner add an expense and a team member through the write APIs (§17, §15)", async () => {
    as(OWNER);

    const expense = await postJson(expensesPost, { categoryKey: "rent", label: "November rent", amountKES: 30000 });
    expect(expense.status).toBe(201);

    const member = await postJson(staffPost, { name: "New Waiter", roleKey: "WAITER" });
    expect(member.status).toBe(201);
  });
});

// ── 3. The page and the API answer the same way ───────────────────────────────

describe("the page layer and the API layer answer the same way (§11)", () => {
  beforeEach(async () => {
    await liveShop();
  });

  const cases: { page: Page; path: string; permission: "VIEW_CREDIT" | "VIEW_EXPENSES" | "VIEW_STAFF"; api?: any }[] = [
    { page: PosCreditPage as unknown as Page, path: "credit", permission: "VIEW_CREDIT" },
    { page: PosExpensesPage as unknown as Page, path: "expenses", permission: "VIEW_EXPENSES", api: expensesGet },
    { page: PosStaffPage as unknown as Page, path: "staff", permission: "VIEW_STAFF", api: staffGet },
  ];

  it.each(cases)("$path: every role gets the same answer from the page and the API", async ({ page, permission, api }) => {
    for (const actor of [OWNER, CASHIER, SALESPERSON, ACCOUNTANT, MANAGER]) {
      as(actor);
      const html = await render(page);
      const pageAllowed = !html.includes(REFUSAL);

      // The permission engine is the single authority: the page must agree with it.
      const context = await requirePosAccess("bizA", actor, { permission, fast: true }).catch(() => null);
      expect(pageAllowed, `${actor.name} → ${permission}`).toBe(Boolean(context));

      // Where a screen has an API read, it must agree too — same actor, same tenant, same answer.
      if (api) {
        const response = await getJson(api);
        expect(response.status === 200, `${actor.name} → GET ${permission}`).toBe(pageAllowed);
      }
    }
  });

  it("refuses the write APIs for a cashier exactly as before (§36, §56)", async () => {
    as(CASHIER);

    const expense = await postJson(expensesPost, { categoryKey: "rent", amountKES: 100 });
    expect(expense.status).toBe(403);
    expect(expense.body.code).toBe("PERMISSION");

    const member = await postJson(staffPost, { name: "New Waiter", roleKey: "WAITER" });
    expect(member.status).toBe(403);
    expect(member.body.code).toBe("PERMISSION");

    // Nothing was written behind the refusals.
    expect(rows("posExpense").some((row) => row.amountKES === 100)).toBe(false);
    expect(rows("posStaff").some((row) => row.name === "New Waiter")).toBe(false);
  });

  it("names the module-read permission it enforces, so the gate cannot be pointed elsewhere silently", async () => {
    as(CASHIER);

    for (const [permission, api] of [
      ["VIEW_CREDIT", null],
      ["VIEW_EXPENSES", expensesGet],
      ["VIEW_STAFF", staffGet],
    ] as const) {
      const gate = await loadPosPageWorkspace("bizA", permission as any);
      expect(gate.permission).toBe(permission);
      expect(gate.basePath).toBe("/dashboard/pos/bizA");
      expect(gate.workspace).toBeUndefined();
      expect(gate.refusal).toContain("Cashier cannot");
      if (api) expect((await getJson(api)).status).toBe(403);
    }
  });

  it("keeps the module permissions themselves unchanged (§36, §52)", async () => {
    const context = await requirePosAccess("bizA", OWNER, {});
    const cashier = effectivePermissions(context.configuration, "CASHIER");
    expect(cashier).not.toContain("VIEW_CREDIT");
    expect(cashier).not.toContain("VIEW_EXPENSES");
    expect(cashier).not.toContain("VIEW_STAFF");
    // …and the pages did not become a second permission system: the owner still holds everything.
    for (const permission of ["VIEW_CREDIT", "VIEW_EXPENSES", "VIEW_STAFF"] as const) {
      expect(effectivePermissions(context.configuration, "OWNER")).toContain(permission);
    }
  });
});

// ── 4. Tenant isolation ───────────────────────────────────────────────────────

describe("cross-tenant access is still refused before anything renders (§5, §75)", () => {
  beforeEach(async () => {
    await liveShop();
  });

  it("refuses a stranger every page, at every permission level", async () => {
    as(STRANGER);

    for (const [page, permission] of [
      [PosCreditPage, "VIEW_CREDIT"],
      [PosExpensesPage, "VIEW_EXPENSES"],
      [PosStaffPage, "VIEW_STAFF"],
    ] as const) {
      const error = await render(page as unknown as Page).catch((thrown) => thrown);
      expect(error, permission).toBeInstanceOf(PosAccessError);
      expect(error.status).toBe(403);
      expect(error.code).toBe("TENANT_ISOLATION");
    }

    expect(partiesWithBalances).not.toHaveBeenCalled();
    expect(listExpenses).not.toHaveBeenCalled();
    expect(listStaff).not.toHaveBeenCalled();
  });

  it("refuses a signed-out visitor, and a business that does not exist", async () => {
    as(null);
    const signedOut = await render(PosExpensesPage as unknown as Page).catch((thrown) => thrown);
    expect(signedOut.status).toBe(401);

    as(OWNER);
    const missing = await render(PosExpensesPage as unknown as Page, "biz_does_not_exist").catch((thrown) => thrown);
    expect(missing.status).toBe(404);
  });

  it("does not let the stranger's session read the other tenant's ledger (§75)", async () => {
    as(OWNER);
    const ownerHtml = await render(PosCreditPage as unknown as Page, "bizA");
    expect(ownerHtml).toContain("Jane Wanjiku");

    as(STRANGER);
    const refused = await render(PosCreditPage as unknown as Page, "bizA").catch((thrown) => thrown);
    expect(refused).toBeInstanceOf(PosAccessError);
    expect(JSON.stringify(refused.message)).not.toContain("Jane Wanjiku");
  });
});

// ── 5. Lifecycle and payment gates ────────────────────────────────────────────

describe("the lifecycle and payment gates are exactly as they were (§44)", () => {
  it("still serves the screens before payment — reads were never locked (§44, §61)", async () => {
    as(OWNER);
    await configure();

    const workspace = await requirePosAccess("bizA", OWNER, { fast: true });
    expect(["DRAFT", "CONFIGURED", "PREVIEW", "AWAITING_PAYMENT"]).toContain(workspace.lifecycle);
    expect(workspace.entitlement.entitled).toBe(false);

    // Owner-level screens still render; the payment gate is on trading, not on setup.
    expect(await render(PosExpensesPage as unknown as Page)).not.toContain(REFUSAL);
    expect(await render(PosStaffPage as unknown as Page)).not.toContain(REFUSAL);
  });

  it("still refuses to record anything against an unpaid POS, with the payment reason (§44)", async () => {
    as(OWNER);
    await configure();

    const expense = await postJson(expensesPost, { categoryKey: "rent", amountKES: 30000 });
    expect(expense.status).toBe(402);
    expect(rows("posExpense")).toHaveLength(1); // the fixture row only — nothing recorded
  });

  it("keeps a suspended POS readable and its lifecycle label intact (§44)", async () => {
    await liveShop();
    as(OWNER);

    rows("posSubscription")[0].status = "ACTIVE";
    rows("posSubscription")[0].expiresAt = new Date(Date.now() - 2 * 86400000);
    rows("posSubscription")[0].graceUntil = new Date(Date.now() - 86400000);

    const workspace = await requirePosAccess("bizA", OWNER, { fast: true });
    expect(workspace.lifecycle).toBe("SUSPENDED");
    // Reads still work for a role that holds the permission…
    expect(await render(PosCreditPage as unknown as Page)).toContain("Jane Wanjiku");
    // …the cashier is still refused, and now for the role, not the money.
    as(CASHIER);
    const html = await render(PosCreditPage as unknown as Page);
    expect(html).toContain(REFUSAL);
    expect(html).toContain("Cashier cannot see credit balances.");
  });
});
