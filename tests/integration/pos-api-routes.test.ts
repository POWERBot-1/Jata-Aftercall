/**
 * The POS API boundary, driven over HTTP (§4, §23, §27, §36, §43, §44, §73, §75)
 *
 * Every other POS suite calls the engine or a domain service directly. This one calls the route
 * handlers — the code a browser actually reaches — against the in-memory database, so the whole
 * request pipeline is proven rather than assumed: session → tenant derivation → role and
 * permission resolution → entitlement gate → body parsing → tenant-id comparison → domain call →
 * JSON contract → audit trail.
 *
 * The point of the file is the failures. A refusal must come back as a plain-language HTTP status
 * with nothing written behind it (§5, §38, §56, §75).
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

import { GET as workspaceGet } from "@/app/api/pos/[businessId]/route";
import { GET as configGet, POST as configPost } from "@/app/api/pos/[businessId]/configuration/route";
import { GET as previewGet, POST as previewPost } from "@/app/api/pos/[businessId]/configuration/preview/route";
import { POST as publishPost } from "@/app/api/pos/[businessId]/configuration/publish/route";
import { GET as versionsGet, POST as versionsPost } from "@/app/api/pos/[businessId]/configuration/versions/route";
import { GET as cloneGet, POST as clonePost } from "@/app/api/pos/[businessId]/configuration/clone/route";
import { GET as planGet, POST as planPost } from "@/app/api/pos/[businessId]/plan/route";
import { GET as salesGet, POST as salesPost } from "@/app/api/pos/[businessId]/sales/route";
import { GET as saleGet, POST as salePost } from "@/app/api/pos/[businessId]/sales/[saleId]/route";
import { GET as productsGet, POST as productsPost } from "@/app/api/pos/[businessId]/products/route";
import { PATCH as productPatch } from "@/app/api/pos/[businessId]/products/[productId]/route";
import { GET as customersGet, POST as customersPost } from "@/app/api/pos/[businessId]/customers/route";
import { GET as customerGet, POST as customerPost } from "@/app/api/pos/[businessId]/customers/[customerId]/route";
import { GET as suppliersGet, POST as suppliersPost } from "@/app/api/pos/[businessId]/suppliers/route";
import { POST as supplierPost } from "@/app/api/pos/[businessId]/suppliers/[supplierId]/route";
import { GET as inventoryGet, POST as inventoryPost } from "@/app/api/pos/[businessId]/inventory/route";
import { GET as ordersGet, POST as ordersPost } from "@/app/api/pos/[businessId]/orders/route";
import { POST as orderPost } from "@/app/api/pos/[businessId]/orders/[orderId]/route";
import { GET as expensesGet, POST as expensesPost } from "@/app/api/pos/[businessId]/expenses/route";
import { GET as purchasesGet, POST as purchasesPost } from "@/app/api/pos/[businessId]/purchases/route";
import { POST as purchaseReceivePost } from "@/app/api/pos/[businessId]/purchases/[purchaseId]/receive/route";
import { GET as reportsGet } from "@/app/api/pos/[businessId]/reports/route";
import { GET as auditGet } from "@/app/api/pos/[businessId]/audit/route";
import { GET as staffGet, POST as staffPost } from "@/app/api/pos/[businessId]/staff/route";
import { GET as branchesGet, POST as branchesPost } from "@/app/api/pos/[businessId]/branches/route";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const stock = (productId: string) => rows("posInventoryItem").find((row) => row.productId === productId)?.quantity;

const OWNER = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const CASHIER = { userId: "cashierA", email: "mary@example.com", role: "CUSTOMER", name: "Mary Cashier" };
const STRANGER = { userId: "userB", email: "b@example.com", role: "CUSTOMER", name: "Owner B" };

const BASE = "https://jata.test/api/pos";

// ── Request helpers ───────────────────────────────────────────────────────────

function url(businessId: string, path = "", query: Record<string, string | number | undefined> = {}) {
  const target = new URL(`${BASE}/${businessId}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) target.searchParams.set(key, String(value));
  }
  return target.toString();
}

/** Next 15 route context. Typed loosely: one helper serves every dynamic segment. */
function context(businessId: string, extra: Record<string, string> = {}): { params: Promise<any> } {
  return { params: Promise.resolve({ businessId, ...extra }) };
}

function get(businessId: string, path = "", query: Record<string, string | number | undefined> = {}) {
  return new Request(url(businessId, path, query));
}

function send(method: string, businessId: string, path = "", body: unknown = {}) {
  return new Request(url(businessId, path), {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const post = (businessId: string, path = "", body: unknown = {}) => send("POST", businessId, path, body);
const patch = (businessId: string, path = "", body: unknown = {}) => send("PATCH", businessId, path, body);

const body = (response: Response): Promise<any> => response.json();
const call = async (response: Response) => ({ status: response.status, body: await body(response) });

const asOwner = () => { mocks.session = OWNER; };
const asCashier = () => { mocks.session = CASHIER; };
const asStranger = () => { mocks.session = STRANGER; };
const signedOut = () => { mocks.session = null; };

const saleOf = (items: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) =>
  post("bizA", "", { items, payments, ...extra });

const twoChapati = { items: [{ productId: "p_a1", quantity: 2 }], payments: [{ method: "cash", amountKES: 100 }] };

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

const hardwareAnswers = {
  business_type: "hardware",
  sells: ["products"],
  payment_methods: ["cash", "mpesa", "credit"],
  credit_frequency: "often",
  credit_limit: 20000,
  credit_terms_days: 30,
  keeps_stock: true,
  keeps_customers: true,
  has_staff: true,
  staff_count: 6,
  staff_roles: ["CASHIER", "SALESPERSON"],
  tracks_expenses: true,
  has_suppliers: true,
  supplier_payment_methods: ["cash", "credit"],
  supplier_credit: true,
  multi_branch: true,
  branch_count: 2,
  barcode: true,
  unit_conversions: true,
  stock_counts: true,
  purchase_orders: true,
};

/** Configure over HTTP, exactly as the configure screen does. */
async function configure(businessId: string, answers: Record<string, unknown>) {
  return call(await configPost(post(businessId, "", { answers }), context(businessId)));
}

/**
 * Pay over the production settlement path: a PENDING payment plus the same function the Paystack
 * webhook calls. Nothing here fakes an entitlement (§43, §44).
 */
async function payForPos(businessId: string, reference = "jata-pos-http") {
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

async function liveRestaurant(businessId = "bizA") {
  asOwner();
  await configure(businessId, restaurantAnswers);
  await payForPos(businessId);
}

beforeEach(() => {
  fake().reset();
  mocks.session = OWNER;
});

// ── 1. The generated workspace ────────────────────────────────────────────────

describe("GET /api/pos/[businessId] — the workspace is generated, never hand-built (§23, §24, §34, §47)", () => {
  it("gives an unconfigured business the universal fallback POS and nothing more", async () => {
    const { status, body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);

    expect(workspace.business.name).toBe("Nyumbani Kitchen");
    expect(workspace.basePath).toBe("/dashboard/pos/bizA");
    expect(workspace.lifecycle).toBe("DRAFT");
    expect(workspace.ready).toBe(false);
    expect(workspace.entitlement.entitled).toBe(false);

    // §47: the baseline every business gets before any configuration exists — a till, a
    // catalogue, customers, sales history, reports and settings.
    const keys = workspace.navigation.map((item: any) => item.key);
    for (const expected of ["sell", "products", "customers", "history", "reports", "settings"]) {
      expect(keys, `fallback navigation is missing ${expected}`).toContain(expected);
    }
    // …and no module the configuration did not ask for.
    for (const absent of ["menu", "produce", "appointments", "jobs", "projects", "branches", "purchases", "expenses"]) {
      expect(keys).not.toContain(absent);
    }

    // The obvious primary action, in the words the spec asks for (§38, §62).
    const home = workspace.navigation.find((item: any) => item.key === "dashboard");
    expect(home.action.label).toBe("+ New Sale");
    expect(home.action.href).toBe("/dashboard/pos/bizA/sell");
    expect(workspace.navigation.some((item: any) => item.key === "sell")).toBe(true);
    expect(workspace.quickActions[0]).toMatchObject({ key: "new_sale", primary: true, href: "/dashboard/pos/bizA/sell" });
    expect(workspace.quickActions[0].label).toMatch(/New Sale/i);
    // The checklist knows what this business has already done and points at what is left (§61).
    const done = workspace.steps.filter((step: any) => step.done).map((step: any) => step.key);
    const todo = workspace.steps.filter((step: any) => !step.done).map((step: any) => step.key);
    expect(done).toEqual(expect.arrayContaining(["products", "customers"]));
    expect(todo).toContain("first_sale");
    expect(workspace.steps.every((step: any) => step.href.startsWith("/dashboard/pos/bizA/"))).toBe(true);

    // Every screen teaches the next action in the owner's own words, never in engine words (§38, §60).
    expect(workspace.notice).toMatch(/configured/i);
    expect(workspace.noticeHref).toBe("/dashboard/pos/bizA/configure");
    expect(workspace.notice).not.toMatch(/schema|capability|feature flag|workflow graph|configuration engine/i);
    expect(workspace.paymentMethods.map((method: any) => method.key)).toContain("cash");
  });

  it("serves two businesses two substantially different workspaces from one engine (§81)", async () => {
    asOwner();
    await configure("bizA", restaurantAnswers);
    asStranger();
    await configure("bizB", hardwareAnswers);

    asOwner();
    const { body: restaurant } = await call(await workspaceGet(get("bizA"), context("bizA")));
    asStranger();
    const { body: hardware } = await call(await workspaceGet(get("bizB"), context("bizB")));

    const navA = restaurant.navigation.map((item: any) => item.key);
    const navB = hardware.navigation.map((item: any) => item.key);
    expect(navA).toContain("menu");
    expect(navA).not.toContain("branches");
    expect(navB).toContain("branches");
    expect(navB).toContain("purchases");
    expect(navB).not.toContain("menu");
    expect(navA.join(",")).not.toBe(navB.join(","));

    expect(restaurant.terminology.customer).toBe("Guest");
    expect(hardware.terminology.customer).toBe("Customer");
    expect(restaurant.dashboardCards).toContain("kitchen_queue");
    expect(hardware.dashboardCards).not.toContain("kitchen_queue");
    expect(hardware.dashboardCards).toContain("supplier_debt");
  });

  it("marks the setup checklist done as the business fills it in (§61)", async () => {
    await liveRestaurant();
    await productsPost(post("bizA", "", { name: "Madafu", priceKES: 80 }), context("bizA"));
    await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA"));

    const { body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    const done = workspace.steps.filter((step: any) => step.done).map((step: any) => step.key);
    expect(done).toContain("products");
    expect(done).toContain("first_sale");
    expect(workspace.ready).toBe(true);
    expect(workspace.today.count).toBe(1);
    expect(workspace.today.totalKES).toBe(50);
  });
});

// ── 2. Questionnaire → configuration over HTTP ────────────────────────────────

describe("/configuration — answers become a Business Operating Profile (§4, §20, §22, §43)", () => {
  it("autosaves answers into a draft that cannot trade", async () => {
    const { status, body: saved } = await configure("bizA", restaurantAnswers);
    expect(status).toBe(200);
    expect(saved.ok).toBe(true);
    expect(saved.changed).toBe(true);
    expect(saved.draftVersion).toBe(1);
    expect(["DRAFT", "CONFIGURED"]).toContain(saved.status);
    expect(rows("posConfiguration")).toHaveLength(1);
    expect(rows("posConfiguration")[0].businessId).toBe("bizA");
  });

  it("says 'we've configured your POS' in plain language and never in engine language (§3, §22, §38, §43)", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: config } = await call(await configGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);

    expect(config.businessTypeKey).toBe("restaurant");
    expect(config.businessTypeLabel.length).toBeGreaterThan(2);
    expect(config.headline.length).toBeGreaterThan(10);
    expect(config.summary.length).toBeGreaterThan(0);
    expect(config.description.length).toBeGreaterThan(0);
    expect(config.view.questions.length).toBeGreaterThan(0);

    const ownerFacing = JSON.stringify({
      headline: config.headline,
      description: config.description,
      summary: config.summary,
      terminology: config.terminology,
      validation: config.validation,
    }).toLowerCase();
    for (const forbidden of ["schema", "capabilit", "feature flag", "workflow graph", "registry", "suppliercreditmanagement", "typekey"]) {
      expect(ownerFacing, `owner-facing copy leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("does not bump the version when nothing changed (§48)", async () => {
    const first = await configure("bizA", restaurantAnswers);
    const second = await configure("bizA", restaurantAnswers);
    expect(first.body.draftVersion).toBe(1);
    expect(second.body.changed).toBe(false);
    expect(second.body.draftVersion).toBe(1);

    const changed = await configure("bizA", { ...restaurantAnswers, keeps_stock: false });
    expect(changed.body.changed).toBe(true);
    expect(changed.body.draftVersion).toBe(2);
  });

  it("drops answers it does not recognise instead of storing them (§22, §56)", async () => {
    const { status } = await configure("bizA", { ...restaurantAnswers, isAdmin: true, priceKES: 1, nope: "yes" });
    expect(status).toBe(200);
    const answers = JSON.parse(rows("posConfiguration")[0].answersJson);
    expect(answers.isAdmin).toBeUndefined();
    expect(answers.nope).toBeUndefined();
    expect(answers.priceKES).toBeUndefined();
    expect(answers.business_type).toBe("restaurant");
  });

  it("fills in what the questionnaire was already showing when a question is skipped (§17, §41)", async () => {
    const { expense_categories: _skipped, ...withoutCategories } = restaurantAnswers;
    void _skipped;
    await configure("bizA", withoutCategories);
    const { body: config } = await call(await configGet(get("bizA"), context("bizA")));
    expect(config.answers.expense_categories).toEqual(["rent", "electricity", "transport", "salaries"]);

    const { body: expenses } = await call(await expensesGet(get("bizA"), context("bizA")));
    expect(expenses.categories.length).toBeGreaterThan(0);
  });

  it("renames the words on screen without renaming the records underneath (§24, §46)", async () => {
    await configure("bizA", restaurantAnswers);
    const saved = await configPost(
      post("bizA", "", { answers: restaurantAnswers, terminology: { customer: "Diner", customers: "Diners", sale: "Bill" } }),
      context("bizA"),
    );
    expect((await body(saved)).ok).toBe(true);

    const { body: config } = await call(await configGet(get("bizA"), context("bizA")));
    expect(config.terminology.customer).toBe("Diner");

    const { body: customers } = await call(await customersGet(get("bizA"), context("bizA")));
    expect(customers.word).toBe("Diner");
    // The record shape is untouched: the same table, the same fields.
    expect(customers.customers[0]).toMatchObject({ id: "c_a1", name: "Jane Wanjiku" });
  });

  it("refuses a business the caller does not belong to, and saves nothing (§5, §75)", async () => {
    asStranger();
    const { status } = await configure("bizA", restaurantAnswers);
    expect(status).toBe(403);
    expect(rows("posConfiguration")).toHaveLength(0);
  });
});

// ── 3. Preview ────────────────────────────────────────────────────────────────

describe("/configuration/preview — a sandbox, not production (§23, §42, §44)", () => {
  it("renders only the modules this business configured and writes no business data", async () => {
    await configure("bizA", restaurantAnswers);
    const before = { sales: rows("posSale").length, products: rows("posProduct").length, orders: rows("posOrder").length };

    const { status, body: preview } = await call(await previewGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(preview.sandbox.isPreview).toBe(true);
    const modules = preview.sandbox.navigation.map((entry: any) => (typeof entry === "string" ? entry : entry.key));

    // The restaurant's own modules…
    for (const expected of ["sell", "orders", "menu", "inventory", "credit", "reports"]) {
      expect(modules, `preview is missing ${expected}`).toContain(expected);
    }
    // …and none of another trade's.
    for (const absent of ["produce", "appointments", "jobs", "projects", "branches"]) {
      expect(modules, `preview shows ${absent}`).not.toContain(absent);
    }
    expect(preview.headline.length).toBeGreaterThan(10);
    // The sandbox shows invented numbers, labelled as such, and never this business's own rows.
    expect(preview.sandbox.sales.length).toBeGreaterThan(0);
    expect(preview.sandbox.catalogue.every((item: any) => String(item.id).startsWith("preview-"))).toBe(true);

    expect(rows("posSale")).toHaveLength(before.sales);
    expect(rows("posProduct")).toHaveLength(before.products);
    expect(rows("posOrder")).toHaveLength(before.orders);
  });

  it("moves the lifecycle to PREVIEW and still refuses to sell (§4, §44)", async () => {
    await configure("bizA", restaurantAnswers);
    const { body: marked } = await call(await previewPost(post("bizA"), context("bizA")));
    expect(marked.status).toBe("PREVIEW");

    const { body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    expect(workspace.lifecycle).toBe("PREVIEW");
    expect(workspace.entitlement.entitled).toBe(false);

    const sale = await salesPost(saleOf(twoChapati.items, twoChapati.payments), context("bizA"));
    expect(sale.status).toBe(402);
    expect(rows("posSale")).toHaveLength(0);
  });
});

// ── 4. Plan, payment, provisioning ────────────────────────────────────────────

describe("/plan — the price is the server's, and payment initiation is not success (§43, §44, §45, §67)", () => {
  it("quotes KES 499 / 30 days from PlanConfig and points at the authenticated checkout", async () => {
    const { status, body: plan } = await call(await planGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(plan.planKey).toBe("BUSINESS_POS");
    expect(plan.plan.priceKES).toBe(499);
    expect(plan.plan.durationDays).toBe(30);
    expect(plan.entitled).toBe(false);
    expect(plan.checkoutUrl).toBe("/checkout?businessId=bizA&planId=plan_pos");
    expect(plan.checkoutUrl).not.toMatch(/^https?:/);
  });

  it("marks the business AWAITING_PAYMENT without making anything live", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: chosen } = await call(await planPost(post("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(chosen.status).toBe("AWAITING_PAYMENT");
    expect(chosen.priceKES).toBe(499);

    const { body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    expect(workspace.lifecycle).toBe("AWAITING_PAYMENT");
    expect(workspace.entitlement.entitled).toBe(false);
    expect(rows("posSubscription")).toHaveLength(0);
  });

  it("refuses to publish a configuration before payment, then publishes after it (§44)", async () => {
    await configure("bizA", restaurantAnswers);
    const refused = await call(await publishPost(post("bizA", "", { note: "go" }), context("bizA")));
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("PUBLISH_REFUSED");
    expect(rows("posConfigurationVersion")).toHaveLength(0);

    await payForPos("bizA");
    const published = await call(await publishPost(post("bizA", "", { note: "go" }), context("bizA")));
    expect(published.body.ok).toBe(true);
    expect(published.body.publishedVersion).toBeGreaterThanOrEqual(1);
  });

  it("provisions to LIVE on a server-confirmed payment and starts trading (§4, §43)", async () => {
    await configure("bizA", restaurantAnswers);
    const settled = await payForPos("bizA");
    expect(settled.alreadySettled).toBe(false);

    const { body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    expect(workspace.lifecycle).toBe("LIVE");
    expect(workspace.entitlement.entitled).toBe(true);
    expect(workspace.entitlement.status).toBe("ACTIVE");
    expect(workspace.configuration.publishedVersion).toBeGreaterThanOrEqual(1);
    expect(rows("posSubscription")[0]).toMatchObject({ businessId: "bizA", planKey: "BUSINESS_POS", status: "ACTIVE" });
    // The POS subscription never lands in the AFTERCALL subscription row (§80).
    expect(rows("subscription")).toHaveLength(0);

    const sale = await salesPost(saleOf(twoChapati.items, twoChapati.payments), context("bizA"));
    expect(sale.status).toBe(201);
  });

  it("cannot be activated twice by a replayed payment event (§75)", async () => {
    await configure("bizA", restaurantAnswers);
    await payForPos("bizA", "jata-pos-replay");
    const versions = rows("posConfigurationVersion").length;
    const replay = await activateSubscriptionForPayment("pay_bizA", "evt_jata-pos-replay", { paystackId: "ps_jata-pos-replay" });
    expect(replay.alreadySettled).toBe(true);
    expect(rows("posSubscription")).toHaveLength(1);
    expect(rows("posConfigurationVersion")).toHaveLength(versions);
  });
});

// ── 5. Selling ────────────────────────────────────────────────────────────────

describe("/sales — selling over HTTP (§27, §31, §32, §33, §54, §62)", () => {
  beforeEach(async () => {
    await liveRestaurant();
  });

  it("records the first sale in one call, prices it server-side and prints a receipt (§62)", async () => {
    const { status, body: sale } = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 2 }], [{ method: "cash", amountKES: 100 }], { channel: "WALK_IN" }),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(sale.ok).toBe(true);
    expect(sale.totals.totalKES).toBe(100);
    expect(sale.totals.paidKES).toBe(100);
    expect(sale.sale.receiptNumber).toMatch(/^[A-Z]{2,4}-\d{6}$/);
    expect(sale.receiptText.toUpperCase()).toContain("NYUMBANI KITCHEN");
    expect(sale.receiptText).toContain("100");

    expect(rows("posSale")).toHaveLength(1);
    expect(rows("posSaleItem")).toHaveLength(1);
    expect(rows("posPayment")[0]).toMatchObject({ method: "cash", amountKES: 100 });
    expect(rows("posSale")[0].channel).toBe("walk_in");

    // Stock moved, and the movement says why (§33).
    expect(stock("p_a1")).toBe(38);
    expect(rows("posInventoryMovement")[0]).toMatchObject({ reason: "SALE", delta: -2, productId: "p_a1" });
    expect(rows("posAuditEvent").some((row) => row.action === "POS_SALE_CREATED")).toBe(true);
  });

  it("lets the owner change a price, and says so in the audit log (§36)", async () => {
    const { status, body: sale } = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 2, unitPriceKES: 40 }], [{ method: "cash", amountKES: 80 }]),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(sale.totals.totalKES).toBe(80);
  });

  it("ignores a price a cashier sends from the browser (§31, §36, §56)", async () => {
    asCashier();
    const { status, body: sale } = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 2, unitPriceKES: 1 }], [{ method: "cash", amountKES: 100 }]),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(sale.totals.totalKES).toBe(100);
    expect(sale.warnings.length).toBeGreaterThan(0);
  });

  it("records a balance only when the business is configured to take part payments (§30, §31)", async () => {
    // This restaurant takes credit, so part payments are part of how it trades: the unpaid 240 is
    // written down as a balance on the sale, not invented as debt on a customer nobody named.
    const { status, body: sale } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "cash", amountKES: 10 }]),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(sale.totals).toMatchObject({ totalKES: 250, paidKES: 10, balanceKES: 240 });
    expect(sale.creditKES).toBe(0);
    expect(rows("posPayment")).toHaveLength(1);
    expect(rows("posPayment")[0]).toMatchObject({ amountKES: 10, method: "cash", status: "SETTLED" });
    expect(rows("posCreditEntry")).toHaveLength(0);
    expect(stock("p_a2")).toBe(9);
  });

  it("refuses a short payment when the business does not take part payments (§30, §31, §49)", async () => {
    // Same engine, same business, a configuration that says cash and M-Pesa in full: now the
    // short payment is refused in plain language and nothing at all is written (§54).
    await configure("bizA", {
      ...restaurantAnswers,
      payment_methods: ["cash", "mpesa"],
      credit_frequency: "never",
      deposits: false,
    });
    expect((await publishPost(post("bizA", "", { note: "no part payments" }), context("bizA"))).status).toBe(200);

    const { status, body: refused } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "cash", amountKES: 10 }]),
      context("bizA"),
    ));
    expect(status).toBe(400);
    expect(refused.code).toBe("SHORT_PAYMENT");
    expect(refused.error).toMatch(/240/);
    expect(rows("posSale")).toHaveLength(0);
    expect(rows("posPayment")).toHaveLength(0);
    expect(rows("posCreditEntry")).toHaveLength(0);
    expect(stock("p_a2")).toBe(10);
  });

  it("refuses to sell stock it does not have, and names the shortage (§33)", async () => {
    const { status, body: refused } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 999 }], [{ method: "cash", amountKES: 100 }]),
      context("bizA"),
    ));
    expect(status).toBe(400);
    expect(refused.code).toBe("INSUFFICIENT_STOCK");
    expect(refused.shortages.length).toBeGreaterThan(0);
    expect(rows("posSale")).toHaveLength(0);
    expect(stock("p_a2")).toBe(10);
  });

  it("refuses an empty sale and a method the configuration does not allow (§31)", async () => {
    const empty = await call(await salesPost(saleOf([], []), context("bizA")));
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("EMPTY_SALE");

    const bank = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "bank", amountKES: 50, reference: "X" }]),
      context("bizA"),
    ));
    expect(bank.status).toBe(400);
    expect(bank.body.code).toBe("METHOD_NOT_ALLOWED");
    expect(rows("posSale")).toHaveLength(0);
  });

  it("lists the sales made moments ago, and only this business's (§5, §47)", async () => {
    await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA"));
    const { status, body: list } = await call(await salesGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(list.sales).toHaveLength(1);
    expect(list.totals.count).toBe(1);
    expect(list.totals.totalKES).toBe(50);
    expect(list.nextReceiptNumber).toMatch(/-[0-9]{6}$/);
    expect(list.paymentMix.some((entry: any) => entry.method === "cash")).toBe(true);
    expect(list.topItems.length).toBeGreaterThan(0);
  });

  it("returns one sale with its receipt, and the same answer for a foreign and a missing id (§75)", async () => {
    const created = await body(await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA")));
    const saleId = created.sale.id;

    const found = await call(await saleGet(get("bizA", `/sales/${saleId}`), context("bizA", { saleId })));
    expect(found.status).toBe(200);
    expect(found.body.receiptText.toUpperCase()).toContain("NYUMBANI KITCHEN");
    expect(found.body.sale.items).toHaveLength(1);

    rows("posSale").push({
      id: "sale_b1", businessId: "bizB", receiptNumber: "MW-000001", totalKES: 900, paidKES: 900,
      balanceKES: 0, refundedKES: 0, status: "COMPLETED", kind: "SALE", channel: "walk_in", createdAt: new Date(),
    });
    const foreign = await call(await saleGet(get("bizA", "/sales/sale_b1"), context("bizA", { saleId: "sale_b1" })));
    const missing = await call(await saleGet(get("bizA", "/sales/nope"), context("bizA", { saleId: "nope" })));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error).toBe(missing.body.error);
  });

  it("corrects a sale with an itemised refund, putting the stock back and never rewriting the sale (§54)", async () => {
    const created = await body(await salesPost(saleOf(twoChapati.items, twoChapati.payments), context("bizA")));
    const saleId = created.sale.id;
    expect(stock("p_a1")).toBe(38);

    const detail = await body(await saleGet(get("bizA", `/sales/${saleId}`), context("bizA", { saleId })));
    const itemId = detail.sale.items[0].id;

    const { status, body: refunded } = await call(await salePost(
      post("bizA", `/sales/${saleId}`, { amountKES: 100, method: "cash", reason: "Wrong order", items: [{ saleItemId: itemId, quantity: 2 }] }),
      context("bizA", { saleId }),
    ));
    expect(status).toBe(200);
    expect(refunded.refundedKES).toBe(100);
    expect(refunded.returnedToStock).toBe(2);

    expect(stock("p_a1")).toBe(40);
    expect(rows("posInventoryMovement").some((row) => row.reason === "RETURN" && row.delta === 2)).toBe(true);
    // The original sale row keeps its own totals; only refundedKES and status move forward.
    expect(rows("posSale")[0]).toMatchObject({ totalKES: 100, refundedKES: 100, status: "REFUNDED" });
    expect(rows("posPayment").length).toBe(2);
    expect(rows("posAuditEvent").some((row) => row.action === "POS_SALE_REFUNDED")).toBe(true);
  });

  it("refunds money alone without touching stock when no items come back (§33, §54)", async () => {
    const created = await body(await salesPost(saleOf(twoChapati.items, twoChapati.payments), context("bizA")));
    const { body: refunded } = await call(await salePost(
      post("bizA", `/sales/${created.sale.id}`, { amountKES: 50, method: "cash", reason: "Goodwill" }),
      context("bizA", { saleId: created.sale.id }),
    ));
    expect(refunded.refundedKES).toBe(50);
    expect(refunded.returnedToStock).toBe(0);
    expect(stock("p_a1")).toBe(38);
    expect(rows("posSale")[0].status).toBe("PARTIALLY_REFUNDED");
  });

  it("refuses to refund more than was paid", async () => {
    const created = await body(await salesPost(saleOf(twoChapati.items, twoChapati.payments), context("bizA")));
    const { status } = await call(await salePost(
      post("bizA", `/sales/${created.sale.id}`, { amountKES: 5000, method: "cash" }),
      context("bizA", { saleId: created.sale.id }),
    ));
    expect(status).toBe(400);
    expect(rows("posSale")[0].refundedKES).toBe(0);
  });

  it("sells on credit within the limit, then takes a repayment (§30)", async () => {
    const { status, body: sale } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 2 }], [{ method: "credit", amountKES: 500 }], { customerId: "c_a1" }),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(sale.creditKES).toBe(500);
    expect(sale.totals.paidKES).toBe(500);
    expect(rows("posCustomer").find((row) => row.id === "c_a1")?.balanceKES).toBe(500);
    expect(rows("posCreditEntry").some((row) => row.partyType === "CUSTOMER" && row.direction === "DEBIT")).toBe(true);

    const { body: customer } = await call(await customerGet(get("bizA", "/customers/c_a1"), context("bizA", { customerId: "c_a1" })));
    expect(customer.statement.closingBalanceKES).toBe(500);
    expect(customer.statement.lines.length).toBeGreaterThan(0);

    const repayment = await call(await customerPost(
      post("bizA", "/customers/c_a1", { amountKES: 200, method: "mpesa", reference: "MPESA1" }),
      context("bizA", { customerId: "c_a1" }),
    ));
    expect(repayment.status).toBe(200);
    expect(repayment.body.balanceKES).toBe(300);
    expect(rows("posCustomer").find((row) => row.id === "c_a1")?.balanceKES).toBe(300);
  });

  it("refuses credit over the configured limit rather than asking the browser (§30)", async () => {
    const { status, body: refused } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 12 }], [{ method: "credit", amountKES: 3000 }], { customerId: "c_a1" }),
      context("bizA"),
    ));
    expect(status).toBe(400);
    expect(refused.code).toBe("OVER_LIMIT");
    expect(rows("posCustomer").find((row) => row.id === "c_a1")?.balanceKES).toBe(0);
    expect(rows("posSale")).toHaveLength(0);
    expect(rows("posAuditEvent").some((row) => row.action === "POS_CREDIT_DECLINED")).toBe(true);
  });

  it("refuses a credit sale with nobody to owe it (§30)", async () => {
    const { status, body: refused } = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "credit", amountKES: 250 }]),
      context("bizA"),
    ));
    expect(status).toBe(400);
    expect(refused.code).toBe("CUSTOMER_REQUIRED");
    expect(rows("posCreditEntry")).toHaveLength(0);
  });
});

// ── 6. Catalogue, people, stock, orders, money out ────────────────────────────

describe("the operating screens over HTTP (§12–§17, §28, §29, §33)", () => {
  beforeEach(async () => {
    await liveRestaurant();
  });

  it("adds a product before payment and lists it after (§61)", async () => {
    const { status, body: created } = await call(await productsPost(
      post("bizA", "", { name: "Madafu", priceKES: 80, unitKey: "piece", trackInventory: true, reorderLevel: 4 }),
      context("bizA"),
    ));
    expect(status).toBe(201);
    expect(created.product.name).toBe("Madafu");
    expect(created.product.businessId).toBe("bizA");

    const { body: list } = await call(await productsGet(get("bizA"), context("bizA")));
    expect(list.products.some((row: any) => row.name === "Madafu")).toBe(true);
    expect(list.tracksStock).toBe(true);
    expect(list.units.length).toBeGreaterThan(0);
    expect(list.canEdit).toBe(true);
    // Another tenant's catalogue is invisible here (§5).
    expect(list.products.some((row: any) => row.id === "p_b1")).toBe(false);
  });

  it("refuses a product with no name", async () => {
    const { status } = await call(await productsPost(post("bizA", "", { priceKES: 80 }), context("bizA")));
    expect(status).toBe(400);
    expect(rows("posProduct")).toHaveLength(4);
  });

  it("edits a product, and answers a foreign id exactly like a missing one (§75)", async () => {
    const edited = await call(await productPatch(patch("bizA", "/products/p_a1", { name: "Chapati (large)", priceKES: 60 }), context("bizA", { productId: "p_a1" })));
    expect(edited.status).toBe(200);
    expect(rows("posProduct").find((row) => row.id === "p_a1")).toMatchObject({ name: "Chapati (large)", priceKES: 60 });

    const foreign = await call(await productPatch(patch("bizA", "/products/p_b1", { priceKES: 1 }), context("bizA", { productId: "p_b1" })));
    const missing = await call(await productPatch(patch("bizA", "/products/nope", { priceKES: 1 }), context("bizA", { productId: "nope" })));
    expect(foreign.status).toBe(missing.status);
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(rows("posProduct").find((row) => row.id === "p_b1")?.priceKES).toBe(900);
  });

  it("creates and lists customers in the configured words (§14, §46)", async () => {
    const created = await call(await customersPost(post("bizA", "", { name: "John Kamau", phone: "0712222222" }), context("bizA")));
    expect(created.status).toBe(201);
    const { body: list } = await call(await customersGet(get("bizA"), context("bizA")));
    expect(list.word).toBe("Guest");
    expect(list.customers.some((row: any) => row.name === "John Kamau")).toBe(true);
    expect(list.customers.some((row: any) => row.id === "c_b1")).toBe(false);
  });

  it("keeps customer credit and supplier credit in separate ledgers (§30)", async () => {
    await customersPost(post("bizA", "", { name: "Credit Guest", creditEnabled: true, creditLimitKES: 1000 }), context("bizA"));
    const guest = rows("posCustomer").find((row) => row.name === "Credit Guest");

    await salesPost(saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "credit", amountKES: 250 }], { customerId: guest.id }), context("bizA"));
    await suppliersPost(post("bizA", "", { name: "Flour Co", creditEnabled: true, termsDays: 30 }), context("bizA"));
    const supplier = rows("posSupplier").find((row) => row.name === "Flour Co");
    await supplierPost(post("bizA", `/suppliers/${supplier.id}`, { amountKES: 500, method: "cash" }), context("bizA", { supplierId: supplier.id }));

    const entries = rows("posCreditEntry");
    const receivable = entries.filter((row) => row.partyType === "CUSTOMER");
    const payable = entries.filter((row) => row.partyType === "SUPPLIER");
    expect(receivable.length).toBeGreaterThan(0);
    expect(receivable.every((row) => row.partyId === guest.id)).toBe(true);
    expect(payable.every((row) => row.partyId === supplier.id)).toBe(true);
    expect(guest.balanceKES).toBe(250);
  });

  it("records every stock change with a reason and never mutates stock silently (§33)", async () => {
    const { status, body: adjusted } = await call(await inventoryPost(
      post("bizA", "", { action: "adjust", productId: "p_a1", reason: "DAMAGE", quantity: 3, note: "Spilt" }),
      context("bizA"),
    ));
    expect(status).toBe(200);
    expect(adjusted.quantity).toBe(37);
    expect(stock("p_a1")).toBe(37);
    expect(rows("posInventoryMovement").some((row) => row.reason === "DAMAGE" && row.delta === -3)).toBe(true);

    const counted = await body(await inventoryPost(post("bizA", "", { action: "count", productId: "p_a1", counted: 40, note: "Evening count" }), context("bizA")));
    expect(counted.difference).toBe(3);
    expect(rows("posInventoryMovement").some((row) => row.reason === "COUNT")).toBe(true);

    const { body: board } = await call(await inventoryGet(get("bizA"), context("bizA")));
    expect(board.stock.length).toBeGreaterThan(0);
    expect(board.movements.length).toBeGreaterThan(0);
    expect(board.movements.every((row: any) => row.reason)).toBe(true);
  });

  it("refuses a stock adjustment with no reason", async () => {
    const { status } = await call(await inventoryPost(post("bizA", "", { action: "adjust", productId: "p_a1", quantity: 3 }), context("bizA")));
    expect(status).toBe(400);
    expect(stock("p_a1")).toBe(40);
    expect(rows("posInventoryMovement")).toHaveLength(0);
  });

  it("runs the configured order workflow and refuses a move it does not define (§28, §29)", async () => {
    const created = await call(await ordersPost(post("bizA", "", {
      customerName: "Table 4", channel: "WALK_IN", items: [{ productId: "p_a2", quantity: 1 }],
    }), context("bizA")));
    expect(created.status).toBe(201);
    const order = created.body.order;
    expect(order.stateKey).toBe("ORDERED");
    expect(order.channel).toBe("walk_in");
    expect(order.totalKES).toBe(250);
    expect(created.body.nextStates.map((state: any) => state.key)).toContain("ACCEPTED");

    const { body: board } = await call(await ordersGet(get("bizA"), context("bizA")));
    expect(board.orders).toHaveLength(1);
    expect(board.states.map((state: any) => state.key)).toEqual(["ORDERED", "ACCEPTED", "KITCHEN", "READY", "SERVED", "CANCELLED"]);

    const accepted = await call(await orderPost(post("bizA", `/orders/${order.id}`, { state: "ACCEPTED" }), context("bizA", { orderId: order.id })));
    expect(accepted.status).toBe(200);
    expect(accepted.body.order.stateKey).toBe("ACCEPTED");

    const toKitchen = await call(await orderPost(post("bizA", `/orders/${order.id}`, { state: "KITCHEN" }), context("bizA", { orderId: order.id })));
    expect(toKitchen.status).toBe(200);
    expect(rows("posOrderEvent").length).toBeGreaterThanOrEqual(3);

    // Backwards is not a move this workflow defines.
    const illegal = await call(await orderPost(post("bizA", `/orders/${order.id}`, { state: "ORDERED" }), context("bizA", { orderId: order.id })));
    expect(illegal.status).toBe(400);
    expect(rows("posOrder").find((row) => row.id === order.id)?.stateKey).toBe("KITCHEN");
  });

  it("records expenses in the configured categories and folds an unknown one into Other (§17)", async () => {
    const known = await call(await expensesPost(post("bizA", "", { categoryKey: "electricity", amountKES: 1200, label: "November power" }), context("bizA")));
    expect(known.status).toBe(201);
    expect(known.body.expense.categoryKey).toBe("electricity");
    expect(known.body.warnings).toHaveLength(0);

    const unknown = await call(await expensesPost(post("bizA", "", { categoryKey: "not_a_category", amountKES: 300 }), context("bizA")));
    expect(unknown.status).toBe(201);
    expect(unknown.body.expense.categoryKey).toBe("other");
    expect(unknown.body.warnings.length).toBeGreaterThan(0);

    const { body: list } = await call(await expensesGet(get("bizA"), context("bizA")));
    expect(list.expenses).toHaveLength(2);
    expect(list.totals.amountKES).toBe(1500);
    expect(list.categories).toContain("electricity");
  });

  it("puts a purchase straight into stock for a business that does not use purchase orders (§12, §33)", async () => {
    const { status, body: created } = await call(await purchasesPost(post("bizA", "", {
      supplierId: "s_a1", items: [{ productId: "p_a1", quantity: 20, unitCostKES: 18 }], reference: "PO-1",
    }), context("bizA")));
    expect(status).toBe(201);
    expect(created.purchase.status).toBe("RECEIVED");
    expect(stock("p_a1")).toBe(60);
    expect(rows("posInventoryMovement").some((row) => row.reason === "PURCHASE" && row.delta === 20)).toBe(true);

    const { body: list } = await call(await purchasesGet(get("bizA"), context("bizA")));
    expect(list.purchases).toHaveLength(1);
    expect(list.purchaseOrders).toBe(false);
  });

  it("keeps a purchase order on order until it is received, and never claims stock it did not get (§12, §33)", async () => {
    const { body: created } = await call(await purchasesPost(post("bizA", "", {
      supplierId: "s_a1", items: [{ productId: "p_a1", quantity: 20, unitCostKES: 18 }], receiveNow: false,
    }), context("bizA")));
    expect(created.purchase.status).toBe("ORDERED");
    expect(created.purchase.receivedAt).toBeNull();
    expect(stock("p_a1")).toBe(40);

    const itemId = rows("posPurchaseItem")[0].id;
    const received = await call(await purchaseReceivePost(
      post("bizA", `/purchases/${created.purchase.id}/receive`, { items: [{ purchaseItemId: itemId, quantity: 20 }], payment: { amountKES: 360, method: "cash" } }),
      context("bizA", { purchaseId: created.purchase.id }),
    ));
    expect(received.body).toMatchObject({ ok: true, received: 20 });
    expect(received.status).toBe(200);
    expect(received.body.purchase).toMatchObject({ status: "RECEIVED", paidKES: 360 });
    expect(received.body.purchase.receivedAt).toBeTruthy();
    expect(stock("p_a1")).toBe(60);
    expect(rows("posInventoryMovement").some((row) => row.reason === "PURCHASE")).toBe(true);
  });

  it("adds staff and refuses a second location for a single-location business (§16)", async () => {
    const staff = await call(await staffPost(post("bizA", "", { name: "Peter Waiter", roleKey: "WAITER" }), context("bizA")));
    expect(staff.status).toBe(201);
    const { body: staffList } = await call(await staffGet(get("bizA"), context("bizA")));
    expect(staffList.staff.some((row: any) => row.name === "Peter Waiter")).toBe(true);
    expect(staffList.roles.length).toBeGreaterThan(0);

    const { body: branches } = await call(await branchesGet(get("bizA"), context("bizA")));
    expect(branches.branches.length).toBeGreaterThanOrEqual(1);
    expect(branches.multiLocation).toBe(false);

    const refused = await call(await branchesPost(post("bizA", "", { name: "Westlands" }), context("bizA")));
    expect(refused.status).toBe(400);
    expect(rows("posBranch").filter((row) => row.businessId === "bizA")).toHaveLength(1);
  });
});

// ── 7. Reports and audit ──────────────────────────────────────────────────────

describe("/reports and /audit (§35, §37)", () => {
  beforeEach(async () => {
    await liveRestaurant();
    await salesPost(saleOf([{ productId: "p_a1", quantity: 2 }], [{ method: "cash", amountKES: 100 }]), context("bizA"));
    await salesPost(saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "mpesa", amountKES: 250, reference: "MP1" }]), context("bizA"));
  });

  it("offers the catalogue this business is configured for, and only that", async () => {
    const { status, body: payload } = await call(await reportsGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    const keys = payload.catalogue.flatMap((group: any) => group.reports.map((report: any) => report.key));
    expect(keys).toContain("daily_sales");
    expect(keys).toContain("payment_breakdown");
    expect(keys).toContain("ingredient_usage");
    expect(keys).not.toContain("job_profitability");
    expect(keys).not.toContain("produce");
  });

  it("labels every number as recorded, calculated or estimate (§35)", async () => {
    const { body: sales } = await call(await reportsGet(get("bizA", "", { report: "daily_sales" }), context("bizA")));
    expect(sales.report.available).toBe(true);
    expect(sales.report.basis).toBe("recorded");
    expect(sales.report.summary.length).toBeGreaterThan(0);
    expect(sales.report.rows.length).toBe(2);

    const { body: profit } = await call(await reportsGet(get("bizA", "", { report: "profitability" }), context("bizA")));
    expect(["calculated", "estimate"]).toContain(profit.report.basis);
  });

  it("is honest about a report the configuration cannot support", async () => {
    const { body: payload } = await call(await reportsGet(get("bizA", "", { report: "job_profitability" }), context("bizA")));
    expect(payload.report.available).toBe(false);
    expect(typeof payload.report.notice).toBe("string");
    expect(payload.report.notice.length).toBeGreaterThan(0);
    expect(payload.report.rows).toHaveLength(0);
  });

  it("honours a date range and never widens it to another tenant (§5, §35)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { body: payload } = await call(await reportsGet(get("bizA", "", { report: "daily_sales", from: today, to: today }), context("bizA")));
    expect(payload.report.rows.length).toBe(2);

    const lastYear = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const { body: bounded } = await call(await reportsGet(get("bizA", "", { report: "daily_sales", from: lastYear, to: today }), context("bizA")));
    expect(bounded.report.rows.length).toBe(2);
  });

  it("records who did what, with before and after values (§37)", async () => {
    await productPatch(patch("bizA", "/products/p_a1", { name: "Chapati", priceKES: 70 }), context("bizA", { productId: "p_a1" }));
    const { status, body: payload } = await call(await auditGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    const entries = payload.entries;

    expect(entries.some((entry: any) => entry.action === "POS_SALE_CREATED")).toBe(true);
    const priced = entries.find((entry: any) => entry.action === "POS_PRICE_CHANGED");
    expect(priced).toBeTruthy();
    expect(priced.actor).toBeTruthy();
    expect(priced.label.length).toBeGreaterThan(0);
    expect(priced.metadata.before.priceKES).toBe(50);
    expect(priced.metadata.after.priceKES).toBe(70);
    expect(entries.every((entry: any) => !/password|pin|token|apikey/i.test(JSON.stringify(entry.metadata ?? {})))).toBe(true);
  });
});

// ── 8. Copying a configuration ───────────────────────────────────────────────

describe("/configuration/clone — copy the setup, never the business (§25, §26, §50)", () => {
  it("lists the scopes, the template library and only businesses the caller belongs to", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: payload } = await call(await cloneGet(get("bizA"), context("bizA")));
    expect(status).toBe(200);
    expect(payload.scopes.length).toBeGreaterThan(0);
    expect(payload.builtInTemplates.some((template: any) => template.key === "RESTAURANT")).toBe(true);
    expect(payload.builtInTemplates.length).toBeGreaterThanOrEqual(22);
    expect(payload.targetBusinesses.map((row: any) => row.id)).toEqual(["bizA2"]);
  });

  it("copies a configuration into another owned business without copying data", async () => {
    await liveRestaurant();
    await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA"));

    const { status, body: copied } = await call(await clonePost(
      post("bizA", "", { targetBusinessId: "bizA2", scopes: ["capabilities", "terminology", "payments"] }),
      context("bizA"),
    ));
    expect(status).toBe(200);
    expect(copied.ok).toBe(true);

    const target = rows("posConfiguration").find((row) => row.businessId === "bizA2");
    expect(target).toBeTruthy();
    expect(JSON.parse(target.draftJson).business.typeKey).toBe("restaurant");
    // Identity is stripped: the copy is not the original business (§25).
    expect(JSON.parse(target.draftJson).receipt.businessName).toBe("");
    // Structure copied, operations did not (§50).
    expect(rows("posSale").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(rows("posPayment").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(rows("posCreditEntry").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(rows("posCustomer").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    expect(rows("posSubscription").filter((row) => row.businessId === "bizA2")).toHaveLength(0);
    // The only thing written in the target's audit log is the copy itself.
    const targetAudit = rows("posAuditEvent").filter((row) => row.businessId === "bizA2");
    expect(targetAudit.map((row) => row.action)).toEqual(["POS_CONFIGURATION_COPIED"]);
  });

  it("refuses to copy into a business the session does not own (§5, §75)", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: refused } = await call(await clonePost(
      post("bizA", "", { targetBusinessId: "bizB", scopes: ["capabilities"] }),
      context("bizA"),
    ));
    expect(status).toBe(403);
    expect(refused.code).toBe("NOT_ALLOWED");
    expect(refused.error).not.toMatch(/prisma|sql|stack/i);
    expect(rows("posConfiguration").some((row) => row.businessId === "bizB")).toBe(false);
  });

  it("refuses a scope that would carry operational data instead of quietly ignoring it (§50)", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: refused } = await call(await clonePost(
      post("bizA", "", { targetBusinessId: "bizA2", scopes: ["capabilities", "sales", "balances", "secrets"] }),
      context("bizA"),
    ));
    expect(status).toBe(400);
    expect(refused.code).toBe("CLONE_SCOPE_REFUSED");
    // It names what it refused instead of quietly ignoring it (§50).
    expect(refused.error).toMatch(/sales/);
    expect(refused.error).toMatch(/balances/);
    expect(refused.error.toLowerCase()).toMatch(/never copied|only the setup/);
    expect(refused.error).not.toMatch(/prisma|sql|stack/i);
    expect(rows("posConfiguration").some((row) => row.businessId === "bizA2")).toBe(false);
  });

  it("saves the setup as the owner's own template (§26, §51)", async () => {
    await configure("bizA", restaurantAnswers);
    const { status, body: saved } = await call(await clonePost(post("bizA", "", { save: true, name: "Kitchen setup" }), context("bizA")));
    expect(status).toBe(201);
    expect(saved.id).toBeTruthy();
    expect(rows("posTemplate")[0]).toMatchObject({ ownerId: "userA", name: "Kitchen setup" });
  });
});

// ── 9. Versions ───────────────────────────────────────────────────────────────

describe("/configuration/versions — history is appended to, never rewritten (§48, §49)", () => {
  it("lists immutable versions and rolls back by adding one", async () => {
    await liveRestaurant();
    await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA"));
    await publishPost(post("bizA", "", { note: "first" }), context("bizA"));
    await configure("bizA", { ...restaurantAnswers, keeps_stock: false });
    await publishPost(post("bizA", "", { note: "second" }), context("bizA"));

    const { body: list } = await call(await versionsGet(get("bizA"), context("bizA")));
    expect(list.versions.length).toBeGreaterThanOrEqual(2);
    const oldest = list.versions[list.versions.length - 1];

    const rolled = await call(await versionsPost(post("bizA", "", { versionId: oldest.id }), context("bizA")));
    expect(rolled.status).toBe(200);
    expect(rolled.body.ok).toBe(true);

    const { body: after } = await call(await versionsGet(get("bizA"), context("bizA")));
    expect(after.versions.length).toBeGreaterThan(list.versions.length);
    // The sale recorded under the earlier configuration is untouched (§49, §54).
    expect(rows("posSale")).toHaveLength(1);
    expect(rows("posSale")[0].totalKES).toBe(50);
  });

  it("refuses to roll back to a version belonging to another business (§5)", async () => {
    await liveRestaurant();
    await publishPost(post("bizA", "", { note: "first" }), context("bizA"));
    const version = rows("posConfigurationVersion")[0];
    version.businessId = "bizB";

    const { status } = await call(await versionsPost(post("bizA", "", { versionId: version.id }), context("bizA")));
    expect(status).toBe(400);
  });
});

// ── 10. The security matrix at the HTTP boundary ──────────────────────────────

describe("the security matrix, over HTTP (§5, §36, §44, §56, §75)", () => {
  it("refuses every POS endpoint without a session", async () => {
    signedOut();
    const responses = await Promise.all([
      workspaceGet(get("bizA"), context("bizA")),
      configGet(get("bizA"), context("bizA")),
      salesGet(get("bizA"), context("bizA")),
      productsGet(get("bizA"), context("bizA")),
      customersGet(get("bizA"), context("bizA")),
      reportsGet(get("bizA"), context("bizA")),
      auditGet(get("bizA"), context("bizA")),
      planGet(get("bizA"), context("bizA")),
      salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA")),
    ]);
    for (const response of responses) expect(response.status).toBe(401);
    expect(rows("posSale")).toHaveLength(0);
  });

  it("answers a foreign business and an unknown business without leaking data", async () => {
    await liveRestaurant();
    asStranger();
    const foreign = await call(await salesGet(get("bizA"), context("bizA")));
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).not.toMatch(/prisma|sql|stack|secret/i);
    expect(foreign.body.sales).toBeUndefined();

    const unknown = await call(await salesGet(get("bizZ"), context("bizZ")));
    expect(unknown.status).toBe(404);

    // Neither attempt returned data, and both were written to the audit log (§37).
    expect(rows("posAuditEvent").some((row) => row.action === "POS_ACCESS_DENIED")).toBe(true);
  });

  it("refuses a business id that only exists in the request body, and audits the attempt (§75)", async () => {
    await liveRestaurant();
    const before = rows("posAuditEvent").length;
    const { status, body: refused } = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }], { businessId: "bizB" }),
      context("bizA"),
    ));
    expect(status).toBe(403);
    expect(refused.code).toBe("TENANT_ID_MISMATCH");
    expect(rows("posSale")).toHaveLength(0);

    const denial = rows("posAuditEvent").slice(before).find((row) => row.action === "POS_ACCESS_DENIED");
    expect(denial).toBeTruthy();
    expect(denial.businessId).toBe("bizA");
    expect(JSON.parse(denial.metadata).reason).toBe("TENANT_ID_MISMATCH");
  });

  it("accepts a body that names the same business as the URL", async () => {
    await liveRestaurant();
    const { status } = await call(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }], { businessId: "bizA" }),
      context("bizA"),
    ));
    expect(status).toBe(201);
  });

  it("refuses another tenant's record ids on every screen, and never returns the record (§75)", async () => {
    await liveRestaurant();
    asStranger();
    await configure("bizB", hardwareAnswers);
    await payForPos("bizB", "jata-pos-b");
    asOwner();

    const customer = await call(await customerGet(get("bizA", "/customers/c_b1"), context("bizA", { customerId: "c_b1" })));
    expect(customer.status).toBe(404);

    const { body: suppliers } = await call(await suppliersGet(get("bizA"), context("bizA")));
    expect(suppliers.suppliers.some((row: any) => row.businessId === "bizB")).toBe(false);

    const sale = await call(await salesPost(
      saleOf([{ productId: "p_b1", quantity: 1 }], [{ method: "cash", amountKES: 900 }]),
      context("bizA"),
    ));
    expect(sale.status).toBe(400);
    expect(rows("posSale")).toHaveLength(0);
    // The other tenant's product is untouched and was never revealed.
    expect(rows("posProduct").find((row) => row.id === "p_b1")).toBeTruthy();
    expect(sale.body.error).not.toContain("Cement");
  });

  it("stops a cashier refunding, discounting, approving credit, editing the setup or reading reports (§36, §75)", async () => {
    await liveRestaurant();
    const created = await body(await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA")));
    expect(stock("p_a1")).toBe(39);

    asCashier();
    const refund = await call(await salePost(
      post("bizA", `/sales/${created.sale.id}`, { amountKES: 50 }),
      context("bizA", { saleId: created.sale.id }),
    ));
    expect(refund.status).toBe(403);
    expect(rows("posSale")[0].refundedKES).toBe(0);

    const discounted = await body(await salesPost(
      saleOf([{ productId: "p_a1", quantity: 1, discountKES: 40 }], [{ method: "cash", amountKES: 50 }]),
      context("bizA"),
    ));
    expect(discounted.totals.totalKES).toBe(50);
    expect(discounted.warnings.length).toBeGreaterThan(0);
    // The sale itself is real, so the stock really moved: 39 -> 38.
    expect(stock("p_a1")).toBe(38);

    const credit = await call(await salesPost(
      saleOf([{ productId: "p_a2", quantity: 1 }], [{ method: "credit", amountKES: 250 }], { customerId: "c_a1" }),
      context("bizA"),
    ));
    expect(credit.status).toBe(400);

    expect((await configPost(post("bizA", "", { answers: hardwareAnswers }), context("bizA"))).status).toBe(403);
    expect((await reportsGet(get("bizA"), context("bizA"))).status).toBe(403);
    expect((await expensesPost(post("bizA", "", { categoryKey: "rent", amountKES: 5000 }), context("bizA"))).status).toBe(403);
    expect((await inventoryPost(post("bizA", "", { action: "adjust", productId: "p_a1", reason: "DAMAGE", quantity: 5 }), context("bizA"))).status).toBe(403);
    expect((await staffPost(post("bizA", "", { name: "Friend", roleKey: "MANAGER" }), context("bizA"))).status).toBe(403);
    // Nothing the cashier was refused left a mark: not money, not stock, not a new staff member.
    expect(stock("p_a1")).toBe(38);
    expect(rows("posStaff").filter((row) => row.businessId === "bizA")).toHaveLength(1);
    expect(rows("posExpense")).toHaveLength(0);
    expect(rows("posSale")).toHaveLength(2);

    // A cashier can still do the job they were given (§36).
    const sale = await call(await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA")));
    expect(sale.status).toBe(201);
    expect(rows("posSale").at(-1)?.staffId).toBe("st_a1");
    expect(stock("p_a1")).toBe(37);
  });

  it("fails closed for a staff role the configuration does not define (§36, §75)", async () => {
    await liveRestaurant();
    rows("posStaff").find((row) => row.id === "st_a1")!.roleKey = "GHOST";
    asCashier();
    const { status } = await call(await salesGet(get("bizA"), context("bizA")));
    expect(status).toBe(403);
    expect(rows("posAuditEvent").some((row) => row.action === "POS_ACCESS_DENIED")).toBe(true);
  });

  it("keeps reading history when the subscription lapses but refuses new money (§44)", async () => {
    await liveRestaurant();
    await salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA"));

    const subscription = rows("posSubscription").find((row) => row.businessId === "bizA")!;
    subscription.expiresAt = new Date(Date.now() - 86_400_000);
    subscription.graceUntil = new Date(Date.now() - 86_400_000);

    const reads = await Promise.all([
      salesGet(get("bizA"), context("bizA")),
      workspaceGet(get("bizA"), context("bizA")),
      reportsGet(get("bizA", "", { report: "daily_sales" }), context("bizA")),
      customerGet(get("bizA", "/customers/c_a1"), context("bizA", { customerId: "c_a1" })),
      auditGet(get("bizA"), context("bizA")),
    ]);
    for (const response of reads) expect(response.status).toBe(200);

    const { body: workspace } = await call(await workspaceGet(get("bizA"), context("bizA")));
    expect(workspace.lifecycle).toBe("SUSPENDED");
    expect(workspace.entitlement.nextAction).toBe("renew");
    expect(workspace.today.count).toBe(1);

    const writes = await Promise.all([
      salesPost(saleOf([{ productId: "p_a1", quantity: 1 }], [{ method: "cash", amountKES: 50 }]), context("bizA")),
      expensesPost(post("bizA", "", { categoryKey: "rent", amountKES: 1000 }), context("bizA")),
      ordersPost(post("bizA", "", { customerName: "Guest", items: [{ productId: "p_a1", quantity: 1 }] }), context("bizA")),
      inventoryPost(post("bizA", "", { action: "adjust", productId: "p_a1", reason: "DAMAGE", quantity: 1 }), context("bizA")),
      purchasesPost(post("bizA", "", { supplierId: "s_a1", items: [{ productId: "p_a1", quantity: 1 }] }), context("bizA")),
    ]);
    for (const response of writes) expect(response.status).toBe(402);
    expect(rows("posSale")).toHaveLength(1);
    expect(stock("p_a1")).toBe(39);
  });

  it("ignores an oversized or unparseable body instead of guessing (§56)", async () => {
    await liveRestaurant();
    const huge = await call(await salesPost(send("POST", "bizA", "", `{"notes":"${"x".repeat(300_000)}"}`), context("bizA")));
    expect(huge.status).toBe(400);
    expect(rows("posSale")).toHaveLength(0);

    const broken = await call(await salesPost(send("POST", "bizA", "", "{not json"), context("bizA")));
    expect(broken.status).toBe(400);

    const array = await call(await salesPost(send("POST", "bizA", "", "[1,2,3]"), context("bizA")));
    expect(array.status).toBe(400);
    expect(rows("posSale")).toHaveLength(0);
  });

  it("never answers with a stack trace, a query or a credential (§38, §56)", async () => {
    await liveRestaurant();
    const responses = await Promise.all([
      salesPost(saleOf([{ productId: "p_a1", quantity: 99999 }], []), context("bizA")),
      productPatch(patch("bizA", "/products/nope", { priceKES: 1 }), context("bizA", { productId: "nope" })),
      orderPost(post("bizA", "/orders/nope", { state: "SERVED" }), context("bizA", { orderId: "nope" })),
      customerPost(post("bizA", "/customers/nope", { amountKES: 10 }), context("bizA", { customerId: "nope" })),
    ]);
    for (const response of responses) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      const text = await response.clone().text();
      expect(text).not.toMatch(/prisma|SELECT|INSERT|passwordHash|DATABASE_URL|PAYSTACK_SECRET|at Object\.|node_modules/i);
    }
  });
});
