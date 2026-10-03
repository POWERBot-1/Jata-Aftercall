/**
 * End-to-end journey — JATA AFTERCALL Configurable Business POS, against a REAL database.
 *
 * The offline POS suites drive the same route handlers against an in-memory Prisma double. That
 * proves the contracts but not the database: only a real client can enforce foreign keys, unique
 * receipt numbers, column types, transaction boundaries and — as CI demonstrated — whether a query
 * asks for a relation the schema actually has. This file is the POS equivalent of
 * `tests/e2e/interactive-business-journey.test.ts` and closes that gap.
 *
 * It walks the whole §4/§43 journey with the real Prisma client and the application's own route
 * handlers (no parallel code path):
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/jata npx vitest run tests/e2e/business-pos-journey.test.ts
 *
 * Without DATABASE_URL the file is skipped, so the offline suite is unaffected.
 *
 * Payment settles through the app's existing test-settlement branch (active only when
 * NODE_ENV !== "production" and no PAYSTACK_SECRET_KEY is set) — `activateSubscriptionForPayment`,
 * the same function the Paystack webhook calls — so the state machine, the idempotency guards and
 * `settlePosPayment` are the real ones. Nothing here fakes an entitlement.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const DATABASE_URL = (process.env.DATABASE_URL || process.env.E2E_DATABASE_URL || "").trim();
const enabled = DATABASE_URL.length > 0;

const h = vi.hoisted(() => ({
  session: { current: null as null | { userId: string; role: string } },
}));

// Route handlers that issue a session call next/headers; the store is inert here because the
// journey authenticates by swapping the mocked session payload instead of reading a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSession: async () => h.session.current };
});

import prisma from "@/lib/db";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as businessPost } from "@/app/api/business/route";
import { POST as checkoutPost } from "@/app/api/checkout/route";
import { GET as paymentVerifyGet } from "@/app/api/paystack/verify/route";
import { publiclyListedPlans } from "@/lib/pricing";
import { syncPosEntitlement } from "@/lib/pos/entitlement";

import { GET as workspaceGet } from "@/app/api/pos/[businessId]/route";
import { GET as configGet, POST as configPost } from "@/app/api/pos/[businessId]/configuration/route";
import { GET as previewGet, POST as previewPost } from "@/app/api/pos/[businessId]/configuration/preview/route";
import { POST as publishPost } from "@/app/api/pos/[businessId]/configuration/publish/route";
import { GET as versionsGet, POST as versionsPost } from "@/app/api/pos/[businessId]/configuration/versions/route";
import { GET as cloneGet, POST as clonePost } from "@/app/api/pos/[businessId]/configuration/clone/route";
import { GET as planGet, POST as planPost } from "@/app/api/pos/[businessId]/plan/route";
import { GET as salesGet, POST as salesPost } from "@/app/api/pos/[businessId]/sales/route";
import { GET as saleGet, POST as salePost } from "@/app/api/pos/[businessId]/sales/[saleId]/route";
import { POST as productsPost } from "@/app/api/pos/[businessId]/products/route";
import { POST as customersPost } from "@/app/api/pos/[businessId]/customers/route";
import { GET as customerGet, POST as customerPost } from "@/app/api/pos/[businessId]/customers/[customerId]/route";
import { POST as suppliersPost } from "@/app/api/pos/[businessId]/suppliers/route";
import { POST as supplierPost } from "@/app/api/pos/[businessId]/suppliers/[supplierId]/route";
import { GET as inventoryGet, POST as inventoryPost } from "@/app/api/pos/[businessId]/inventory/route";
import { POST as ordersPost } from "@/app/api/pos/[businessId]/orders/route";
import { POST as orderPost } from "@/app/api/pos/[businessId]/orders/[orderId]/route";
import { GET as expensesGet, POST as expensesPost } from "@/app/api/pos/[businessId]/expenses/route";
import { POST as purchasesPost } from "@/app/api/pos/[businessId]/purchases/route";
import { GET as reportsGet } from "@/app/api/pos/[businessId]/reports/route";
import { GET as auditGet } from "@/app/api/pos/[businessId]/audit/route";
import { POST as staffPost } from "@/app/api/pos/[businessId]/staff/route";

const runId = Date.now().toString(36).slice(-6);
const ctx: Record<string, any> = {
  owner: null as null | { userId: string; email: string; businessId: string; slug: string },
  cashier: null as null | { userId: string; email: string; businessId: string },
  stranger: null as null | { userId: string; email: string; businessId: string },
  secondBusinessId: null as string | null,
};
const created: { userId: string; businessId: string }[] = [];

let ipCounter = 0;
function request(url: string, init: { method?: string; body?: unknown } = {}) {
  ipCounter += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.30.0.${ipCounter}` };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method: init.method || "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

/** Every POS route is `(request, { params })` on Next 15, so the context is built here once. */
type PosHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function callPos(
  handler: PosHandler,
  businessId: string,
  options: { path?: string; query?: Record<string, string | number | undefined>; method?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const url = new URL(`https://jata.test/api/pos/${businessId}${options.path || ""}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await handler(request(url.toString(), { method: options.method || "GET", body: options.body }), {
    params: Promise.resolve({ businessId, ...(options.params || {}) }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, text: () => JSON.stringify(body) };
}

async function callPlatform(
  handler: (req: Request) => Promise<Response>,
  url: string,
  init: { method?: string; body?: unknown } = {},
) {
  const response = await handler(request(url, init));
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A restaurant, answered the way the questionnaire asks (§18). Real ids only — unknown answer
 * ids are pruned, so these come from `lib/pos/questionnaire.ts`. */
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

let personCounter = 0;
async function registerPerson(kind: "owner" | "cashier" | "stranger") {
  personCounter += 1;
  const email = `e2e.pos.${kind}.${runId}.${personCounter}@jata.test`;
  const response = await callPlatform(registerPost, "https://jata.test/api/auth/register", {
    method: "POST",
    body: {
      name: kind === "owner" ? "Amina Owner" : kind === "cashier" ? "Mary Cashier" : "Brian Other",
      email,
      phone: `07${(Date.now() % 10000000).toString().padStart(7, "0")}${personCounter}`,
      password: "Jata#2026E2E",
      businessName: `E2E POS ${kind} ${runId}${personCounter}`,
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const userId = response.body?.user?.id as string;
  expect(userId, "registration returned no user").toBeTruthy();

  const business = await prisma.business.findFirst({ where: { ownerId: userId }, select: { id: true, slug: true } });
  expect(business, "registration created no business").toBeTruthy();
  created.push({ userId, businessId: business!.id });
  return { userId, email, businessId: business!.id, slug: business!.slug };
}

const stockOf = async (businessId: string, productId: string) => {
  const rows = await prisma.posInventoryItem.findMany({ where: { businessId, productId }, select: { quantity: true } });
  return rows.reduce((total, row) => total + Number(row.quantity ?? 0), 0);
};

const countWhere = (model: string, where: Record<string, unknown>) =>
  (prisma as any)[model].count({ where }) as Promise<number>;

async function cleanup(ids: { userId: string; businessId: string }[]) {
  const posTables = [
    "posOrderEvent", "posOrderItem", "posOrder", "posPurchaseItem", "posPurchase", "posCreditEntry",
    "posPayment", "posSaleItem", "posSale", "posInventoryMovement", "posInventoryItem",
    "posCustomerAsset", "posCustomer", "posSupplier", "posExpense", "posProduct", "posStaff",
    "posBranch", "posAuditEvent", "posTemplate", "posConfigurationVersion", "posConfiguration",
    "posEntitlement", "posSubscription",
  ];
  for (const { userId, businessId } of ids) {
    try {
      // Children before parents; every POS table is scoped by businessId (§5).
      for (const table of posTables) {
        await (prisma as any)[table].deleteMany({ where: { businessId } }).catch(() => undefined);
      }
      await prisma.posTemplate.deleteMany({ where: { ownerId: userId } }).catch(() => undefined);
      await prisma.analyticsEvent.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.notification.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.payment.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.payment.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.subscription.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.businessMember.deleteMany({ where: { businessId } }).catch(() => undefined);
      await prisma.businessMember.deleteMany({ where: { userId } }).catch(() => undefined);
      await prisma.business.deleteMany({ where: { ownerId: userId } }).catch(() => undefined);
      await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    } catch {
      // Cleanup is best-effort: never mask a real assertion failure.
    }
  }
}

describe.skipIf(!enabled)("Business POS end-to-end journey (§4, §43, §73, §74, §75)", () => {
  beforeAll(async () => {
    // The plan the journey buys must exist at the price the spec fixes (§45).
    await prisma.planConfig.upsert({
      where: { key: "BUSINESS_POS" },
      update: { priceKES: 499, durationDays: 30, isActive: true },
      create: { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true },
    });
  }, 120_000);

  // Every step starts as the owner. Two steps act as somebody else (13 as a cashier, 21 as another
  // tenant) and say so explicitly; without this reset, a failure part-way through one of them would
  // leak that session into every later step and turn one defect into nineteen.
  beforeEach(() => {
    if (ctx.owner) h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
  });

  afterAll(async () => {
    await cleanup(created);
    await prisma.$disconnect().catch(() => undefined);
  }, 120_000);

  it("1 — a real owner registers and gets a business", async () => {
    const owner = await registerPerson("owner");
    ctx.owner = owner;
    h.session.current = { userId: owner.userId, role: "OWNER" };
    expect(owner.slug).toBeTruthy();
    expect(await countWhere("posSale", { businessId: owner.businessId })).toBe(0);
  }, 120_000);

  it("2 — before any configuration the business still gets the universal fallback POS (§47)", async () => {
    const businessId = ctx.owner.businessId;
    const workspace = await callPos(workspaceGet, businessId);
    expect(workspace.status, workspace.text()).toBe(200);

    const keys = workspace.body.navigation.map((item: any) => item.key);
    for (const expected of ["dashboard", "sell", "products", "customers", "history", "reports", "settings"]) {
      expect(keys, `fallback navigation is missing ${expected}`).toContain(expected);
    }
    // …and no module nobody configured (§23).
    for (const absent of ["menu", "produce", "appointments", "jobs", "projects", "branches", "purchases", "expenses"]) {
      expect(keys, `fallback navigation shows ${absent}`).not.toContain(absent);
    }

    expect(workspace.body.lifecycle).toBe("DRAFT");
    expect(workspace.body.ready).toBe(false);
    expect(workspace.body.entitlement.entitled).toBe(false);
    expect(workspace.body.quickActions[0]).toMatchObject({ key: "new_sale", primary: true });
    expect(workspace.body.navigation.find((item: any) => item.key === "dashboard").action.label).toMatch(/^\+ New /);
    expect(typeof workspace.body.notice).toBe("string");
    expect(workspace.body.noticeHref).toBe(`/dashboard/pos/${businessId}/configure`);
  }, 120_000);

  it("3 — nothing trades before payment, and the refusal is plain language (§44, §38)", async () => {
    const businessId = ctx.owner.businessId;
    await callPos(productsPost, businessId, { method: "POST", body: { name: "Chapati", priceKES: 50 } });
    const product = await prisma.posProduct.findFirst({ where: { businessId, name: "Chapati" }, select: { id: true } });
    expect(product, "setup data is writable before payment (§61)").toBeTruthy();
    ctx.chapatiId = product!.id;

    const refused = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: product!.id, quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(refused.status, refused.text()).toBe(402);
    expect(refused.body.error).not.toMatch(/prisma|sql|stack|secret|undefined/i);
    expect(await countWhere("posSale", { businessId })).toBe(0);
  }, 120_000);

  it("4 — the questionnaire configures the POS in the owner's words, not the engine's (§3, §17, §38, §52)", async () => {
    const businessId = ctx.owner.businessId;
    const saved = await callPos(configPost, businessId, { method: "POST", body: { answers: restaurantAnswers } });
    expect(saved.status, saved.text()).toBe(200);
    expect(saved.body.ok).toBe(true);
    expect(saved.body.draftVersion).toBe(1);

    const config = await callPos(configGet, businessId);
    expect(config.status, config.text()).toBe(200);
    expect(config.body.businessTypeKey).toBe("restaurant");
    expect(config.body.headline.length).toBeGreaterThan(10);
    expect(config.body.summary.length).toBeGreaterThan(0);
    // Terminology is presentation only: the same engine now says "Bill" and "Guest" (§24, §46).
    expect(config.body.terminology.sale).toBe("Bill");
    expect(config.body.terminology.customer).toBe("Guest");
    expect(config.body.capabilities).toContain("menu");
    expect(config.body.capabilities).toContain("kitchen_orders");

    const ownerFacing = JSON.stringify({
      headline: config.body.headline,
      description: config.body.description,
      summary: config.body.summary,
      terminology: config.body.terminology,
      validation: config.body.validation,
    }).toLowerCase();
    for (const forbidden of ["schema", "capabilit", "feature flag", "workflow graph", "registry", "typekey"]) {
      expect(ownerFacing, `owner-facing copy leaked "${forbidden}"`).not.toContain(forbidden);
    }

    // Unknown answers are dropped rather than stored (§22, §56).
    const noisy = await callPos(configPost, businessId, {
      method: "POST",
      body: { answers: { ...restaurantAnswers, isAdmin: true, priceKES: 1, nope: "yes" } },
    });
    expect(noisy.status, noisy.text()).toBe(200);
    const row = await prisma.posConfiguration.findUnique({ where: { businessId } });
    const answers = JSON.parse(row!.answersJson as string);
    expect(answers.isAdmin).toBeUndefined();
    expect(answers.nope).toBeUndefined();
    expect(answers.business_type).toBe("restaurant");
  }, 120_000);

  it("5 — the preview is a sandbox: it shows the configured modules and writes nothing (§23, §42, §44)", async () => {
    const businessId = ctx.owner.businessId;
    const before = {
      sales: await countWhere("posSale", { businessId }),
      products: await countWhere("posProduct", { businessId }),
      orders: await countWhere("posOrder", { businessId }),
    };

    const marked = await callPos(previewPost, businessId, { method: "POST" });
    expect(marked.status, marked.text()).toBe(200);
    expect(marked.body.status).toBe("PREVIEW");

    const preview = await callPos(previewGet, businessId);
    expect(preview.status, preview.text()).toBe(200);
    expect(preview.body.sandbox.isPreview).toBe(true);
    const modules = preview.body.sandbox.navigation.map((item: any) => (typeof item === "string" ? item : item.key));
    for (const expected of ["sell", "orders", "menu", "inventory", "credit", "reports"]) {
      expect(modules, `preview is missing ${expected}`).toContain(expected);
    }
    for (const absent of ["produce", "appointments", "jobs", "projects"]) {
      expect(modules, `preview shows ${absent}`).not.toContain(absent);
    }
    expect(preview.body.sandbox.sales.length).toBeGreaterThan(0);
    expect(preview.body.sandbox.catalogue.every((item: any) => String(item.id).startsWith("preview-"))).toBe(true);

    expect(await countWhere("posSale", { businessId })).toBe(before.sales);
    expect(await countWhere("posProduct", { businessId })).toBe(before.products);
    expect(await countWhere("posOrder", { businessId })).toBe(before.orders);
  }, 120_000);

  it("6 — publishing is refused while the plan is unpaid (§44)", async () => {
    const businessId = ctx.owner.businessId;
    const refused = await callPos(publishPost, businessId, { method: "POST", body: { note: "go live" } });
    expect(refused.status, refused.text()).toBe(400);
    expect(refused.body.code).toBe("PUBLISH_REFUSED");
    expect(await countWhere("posConfigurationVersion", { businessId })).toBe(0);
  }, 120_000);

  it("7 — the plan is quoted from PlanConfig at KES 499 and stays off public surfaces (§45, §67)", async () => {
    const businessId = ctx.owner.businessId;
    const plan = await callPos(planGet, businessId);
    expect(plan.status, plan.text()).toBe(200);
    expect(plan.body.planKey).toBe("BUSINESS_POS");
    expect(plan.body.plan.priceKES).toBe(499);
    expect(plan.body.plan.durationDays).toBe(30);
    expect(plan.body.entitled).toBe(false);
    // A relative URL: checkout is reached inside the authenticated platform, never from a public page.
    expect(plan.body.checkoutUrl).toBe(`/checkout?businessId=${businessId}&planId=${plan.body.plan.id}`);
    expect(plan.body.checkoutUrl).not.toMatch(/^https?:/);

    const chosen = await callPos(planPost, businessId, { method: "POST" });
    expect(chosen.status, chosen.text()).toBe(200);
    expect(chosen.body.status).toBe("AWAITING_PAYMENT");
    expect(chosen.body.priceKES).toBe(499);

    const workspace = await callPos(workspaceGet, businessId);
    expect(workspace.body.lifecycle).toBe("AWAITING_PAYMENT");
    expect(workspace.body.entitlement.entitled).toBe(false);
    expect(await countWhere("posSubscription", { businessId })).toBe(0);

    // The private plan is filtered out of anything a customer could see (§67).
    const plans = await prisma.planConfig.findMany({ select: { key: true, name: true } });
    expect(plans.some((row) => row.key === "BUSINESS_POS")).toBe(true);
    expect(publiclyListedPlans(plans).some((row) => row.key === "BUSINESS_POS")).toBe(false);
  }, 120_000);

  it("8 — checkout prices the POS server-side, in kobo, from PlanConfig (§45, §56)", async () => {
    const businessId = ctx.owner.businessId;
    const plan = await prisma.planConfig.findUnique({ where: { key: "BUSINESS_POS" } });
    expect(plan?.priceKES).toBe(499);

    const response = await callPlatform(checkoutPost, "https://jata.test/api/checkout", {
      method: "POST",
      body: { businessId, planId: plan!.id },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const reference = response.body?.reference as string;
    expect(reference).toBeTruthy();
    ctx.paymentReference = reference;

    const payment = await prisma.payment.findUnique({ where: { reference } });
    expect(payment?.amount).toBe(49900); // KES 499 in kobo — never taken from the browser
    expect(payment?.currency).toBe("KES");
    expect(payment?.status).toBe("PENDING");
    expect(payment?.businessId).toBe(businessId);
    expect(payment?.planId).toBe(plan!.id);
  }, 120_000);

  it("9 — a server-confirmed payment provisions the POS to LIVE (§4, §43, §44, §80)", async () => {
    const businessId = ctx.owner.businessId;
    const response = await callPlatform(
      paymentVerifyGet,
      `https://jata.test/api/paystack/verify?reference=${encodeURIComponent(ctx.paymentReference)}&mock=success`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ status: "PAID", posBusinessId: businessId });

    const payment = await prisma.payment.findUnique({ where: { reference: ctx.paymentReference } });
    expect(payment?.status).toBe("PAID");

    const posSubscription = await prisma.posSubscription.findUnique({ where: { businessId } });
    expect(posSubscription?.status).toBe("ACTIVE");
    expect(posSubscription?.planKey).toBe("BUSINESS_POS");
    expect(posSubscription?.paymentId).toBe(payment?.id);
    expect(posSubscription?.expiresAt!.getTime()).toBeGreaterThan(Date.now());

    // The POS is its own product: paying for it never writes an AFTERCALL subscription (§80).
    expect(await prisma.subscription.findUnique({ where: { businessId } })).toBeNull();

    const entitlement = await syncPosEntitlement(businessId);
    expect(entitlement.status).toBe("ACTIVE");
    expect(entitlement.entitled).toBe(true);
    expect(entitlement.lifecycle).toBe("LIVE");

    const workspace = await callPos(workspaceGet, businessId);
    expect(workspace.status, workspace.text()).toBe(200);
    expect(workspace.body.lifecycle).toBe("LIVE");
    expect(workspace.body.ready).toBe(true);
  }, 120_000);

  it("10 — the first sale is priced by the server, receipted, and moves stock with a reason (§31, §32, §33, §62)", async () => {
    const businessId = ctx.owner.businessId;
    const biryani = await callPos(productsPost, businessId, {
      method: "POST",
      body: { name: "Chicken biryani", priceKES: 850, unitKey: "plate", costKES: 400 },
    });
    expect(biryani.status, biryani.text()).toBe(201);
    ctx.biryaniId = biryani.body.product.id;

    // Opening stock is a recorded movement, not a silent quantity (§33).
    for (const [productId, quantity] of [[ctx.chapatiId, 40], [ctx.biryaniId, 20]] as [string, number][]) {
      const opened = await callPos(inventoryPost, businessId, {
        method: "POST",
        body: { action: "adjust", productId, reason: "OPENING", quantity, note: "Opening stock" },
      });
      expect(opened.status, opened.text()).toBe(200);
    }
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(40);
    expect(await stockOf(businessId, ctx.biryaniId)).toBe(20);

    // A browser-sent price is honoured for a role that may edit prices, and audited (§36).
    const sale = await callPos(salesPost, businessId, {
      method: "POST",
      body: {
        items: [{ productId: ctx.chapatiId, quantity: 2 }],
        payments: [{ method: "cash", amountKES: 100 }],
        channel: "WALK_IN",
      },
    });
    expect(sale.status, sale.text()).toBe(201);
    expect(sale.body.totals).toMatchObject({ subtotalKES: 100, totalKES: 100, paidKES: 100, balanceKES: 0 });
    expect(sale.body.sale.receiptNumber).toMatch(/-[0-9]{6}$/);
    expect(sale.body.receiptText.toUpperCase()).toContain("CHAPATI");
    ctx.saleId = sale.body.sale.id;

    const stored = await prisma.posSale.findUnique({ where: { id: ctx.saleId } });
    expect(stored?.totalKES).toBe(100);
    expect(stored?.receiptNumber).toBe(sale.body.sale.receiptNumber);
    expect(await countWhere("posSaleItem", { saleId: ctx.saleId })).toBe(1);
    expect(await countWhere("posPayment", { saleId: ctx.saleId })).toBe(1);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(38);

    const movement = await prisma.posInventoryMovement.findFirst({
      where: { businessId, productId: ctx.chapatiId, reason: "SALE" },
      orderBy: { createdAt: "desc" },
    });
    expect(movement?.delta).toBe(-2);
    expect(movement?.refType).toBe("SALE");
    expect(movement?.refId).toBe(ctx.saleId);

    // A method the configuration does not allow, and stock it does not have, are both refused (§31, §33).
    const bank = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: ctx.chapatiId, quantity: 1 }], payments: [{ method: "bank", amountKES: 50 }] },
    });
    expect(bank.status, bank.text()).toBe(400);
    expect(bank.body.code).toBe("METHOD_NOT_ALLOWED");

    const short = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: ctx.chapatiId, quantity: 9999 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(short.status, short.text()).toBe(400);
    expect(short.body.code).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(38);

    const list = await callPos(salesGet, businessId);
    expect(list.status, list.text()).toBe(200);
    expect(list.body.totals.count).toBe(1);
    expect(list.body.totals.totalKES).toBe(100);
  }, 120_000);

  it("11 — an itemised refund returns stock and never rewrites the sale (§33, §54)", async () => {
    const businessId = ctx.owner.businessId;
    const detail = await callPos(saleGet, businessId, { path: `/sales/${ctx.saleId}`, params: { saleId: ctx.saleId } });
    expect(detail.status, detail.text()).toBe(200);
    const itemId = detail.body.sale.items[0].id;

    const refunded = await callPos(salePost, businessId, {
      path: `/sales/${ctx.saleId}`,
      params: { saleId: ctx.saleId },
      method: "POST",
      body: { amountKES: 100, method: "cash", reason: "Wrong order", items: [{ saleItemId: itemId, quantity: 2 }] },
    });
    expect(refunded.status, refunded.text()).toBe(200);
    expect(refunded.body.refundedKES).toBe(100);
    expect(refunded.body.returnedToStock).toBe(2);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(40);

    const sale = await prisma.posSale.findUnique({ where: { id: ctx.saleId } });
    expect(sale).toMatchObject({ totalKES: 100, refundedKES: 100, status: "REFUNDED" });
    expect(await prisma.posInventoryMovement.count({ where: { businessId, productId: ctx.chapatiId, reason: "RETURN", delta: 2 } })).toBe(1);

    // Refunding more than was paid is refused and changes nothing (§54).
    const tooMuch = await callPos(salePost, businessId, {
      path: `/sales/${ctx.saleId}`,
      params: { saleId: ctx.saleId },
      method: "POST",
      body: { amountKES: 5000, method: "cash" },
    });
    expect(tooMuch.status, tooMuch.text()).toBe(400);
    expect((await prisma.posSale.findUnique({ where: { id: ctx.saleId } }))?.refundedKES).toBe(100);
  }, 120_000);

  it("12 — credit is decided server-side: within the limit it records a debt, over it, it refuses (§30)", async () => {
    const businessId = ctx.owner.businessId;
    const customer = await callPos(customersPost, businessId, {
      method: "POST",
      body: { name: "John Kamau", phone: "0712222222", creditEnabled: true, creditLimitKES: 2000 },
    });
    expect(customer.status, customer.text()).toBe(201);
    ctx.customerId = customer.body.customer.id;

    const onCredit = await callPos(salesPost, businessId, {
      method: "POST",
      body: {
        items: [{ productId: ctx.chapatiId, quantity: 2 }],
        payments: [{ method: "credit", amountKES: 100 }],
        customerId: ctx.customerId,
      },
    });
    expect(onCredit.status, onCredit.text()).toBe(201);
    expect(onCredit.body.creditKES).toBe(100);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(38);

    const row = await prisma.posCustomer.findUnique({ where: { id: ctx.customerId } });
    expect(row?.balanceKES).toBe(100);
    expect(await countWhere("posCreditEntry", { businessId, partyType: "CUSTOMER", direction: "DEBIT" })).toBe(1);

    const statement = await callPos(customerGet, businessId, {
      path: `/customers/${ctx.customerId}`,
      params: { customerId: ctx.customerId },
    });
    expect(statement.status, statement.text()).toBe(200);
    expect(statement.body.statement.closingBalanceKES).toBe(100);

    // Over the configured limit: refused by the engine, not by the browser (§30, §75).
    const over = await callPos(salesPost, businessId, {
      method: "POST",
      body: {
        items: [{ productId: ctx.biryaniId, quantity: 3 }],
        payments: [{ method: "credit", amountKES: 2550 }],
        customerId: ctx.customerId,
      },
    });
    expect(over.status, over.text()).toBe(400);
    expect(over.body.code).toBe("OVER_LIMIT");
    expect((await prisma.posCustomer.findUnique({ where: { id: ctx.customerId } }))?.balanceKES).toBe(100);
    expect(await stockOf(businessId, ctx.biryaniId)).toBe(20);

    const repayment = await callPos(customerPost, businessId, {
      path: `/customers/${ctx.customerId}`,
      params: { customerId: ctx.customerId },
      method: "POST",
      body: { amountKES: 40, method: "mpesa", reference: "MPESA1" },
    });
    expect(repayment.status, repayment.text()).toBe(200);
    expect(repayment.body.balanceKES).toBe(60);
    expect((await prisma.posCustomer.findUnique({ where: { id: ctx.customerId } }))?.balanceKES).toBe(60);
  }, 120_000);

  it("13 — a cashier can sell but cannot refund, discount, edit the setup or read reports (§36, §75)", async () => {
    const businessId = ctx.owner.businessId;
    const staff = await callPos(staffPost, businessId, { method: "POST", body: { name: "Mary Cashier", roleKey: "CASHIER" } });
    expect(staff.status, staff.text()).toBe(201);

    const cashier = await registerPerson("cashier");
    ctx.cashier = cashier;
    const staffRow = await prisma.posStaff.findFirst({ where: { businessId, name: "Mary Cashier" }, select: { id: true } });
    expect(staffRow, "the staff record was not written").toBeTruthy();
    // Link the platform identity and the business membership: the role is resolved server-side (§5).
    await prisma.posStaff.update({ where: { id: staffRow!.id }, data: { userId: cashier.userId } });
    await prisma.businessMember.create({ data: { businessId, userId: cashier.userId, role: "STAFF" } });
    ctx.staffId = staffRow!.id;

    h.session.current = { userId: cashier.userId, role: "STAFF" };

    // The job they were given works, and is attributed to them (§15).
    const sale = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: ctx.chapatiId, quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(sale.status, sale.text()).toBe(201);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(37);
    ctx.cashierSaleId = sale.body.sale.id;
    expect((await prisma.posSale.findUnique({ where: { id: ctx.cashierSaleId } }))?.staffId).toBe(ctx.staffId);

    // A price sent from the browser is ignored for a role without EDIT_PRICE (§31, §56).
    const priced = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: ctx.chapatiId, quantity: 1, unitPriceKES: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(priced.status, priced.text()).toBe(201);
    expect(priced.body.totals.totalKES).toBe(50);
    expect(priced.body.warnings.length).toBeGreaterThan(0);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(36);

    for (const refused of [
      callPos(salePost, businessId, {
        path: `/sales/${ctx.cashierSaleId}`,
        params: { saleId: ctx.cashierSaleId },
        method: "POST",
        body: { amountKES: 50, method: "cash" },
      }),
      callPos(configPost, businessId, { method: "POST", body: { answers: restaurantAnswers } }),
      callPos(reportsGet, businessId),
      callPos(expensesPost, businessId, { method: "POST", body: { categoryKey: "rent", amountKES: 5000 } }),
      callPos(inventoryPost, businessId, { method: "POST", body: { action: "adjust", productId: ctx.chapatiId, reason: "DAMAGE", quantity: 5 } }),
      callPos(staffPost, businessId, { method: "POST", body: { name: "Friend", roleKey: "MANAGER" } }),
    ]) {
      expect((await refused).status, (await refused).text()).toBe(403);
    }

    // Every refusal left a mark in the audit log, and nothing behind it (§37).
    expect(await countWhere("posExpense", { businessId })).toBe(0);
    expect(await prisma.posAuditEvent.count({ where: { businessId, action: "POS_ACCESS_DENIED" } })).toBeGreaterThan(0);

    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };
  }, 120_000);

  it("14 — the configured order workflow runs, and a move it does not define is refused (§28, §29)", async () => {
    const businessId = ctx.owner.businessId;
    const order = await callPos(ordersPost, businessId, {
      method: "POST",
      body: { customerName: "Table 7", channel: "WALK_IN", items: [{ productId: ctx.biryaniId, quantity: 1 }] },
    });
    expect(order.status, order.text()).toBe(201);
    expect(order.body.order.reference).toMatch(/^[A-Z]{2,3}-\d{4}$/);
    expect(order.body.order.stateKey).toBe("ORDERED");
    expect(order.body.nextStates.map((state: any) => state.key)).toContain("ACCEPTED");
    ctx.orderId = order.body.order.id;

    // The workflow is the one the configuration chose, not the engine's default (§29, §52), and the
    // total was priced from the catalogue, not from the request (§31).
    const storedOrder = await prisma.posOrder.findUnique({ where: { id: ctx.orderId } });
    expect(storedOrder).toMatchObject({ workflowKey: "restaurant", stateKey: "ORDERED", channel: "walk_in", totalKES: 850 });

    const accepted = await callPos(orderPost, businessId, {
      path: `/orders/${ctx.orderId}`,
      params: { orderId: ctx.orderId },
      method: "POST",
      body: { state: "ACCEPTED" },
    });
    expect(accepted.status, accepted.text()).toBe(200);

    const kitchen = await callPos(orderPost, businessId, {
      path: `/orders/${ctx.orderId}`,
      params: { orderId: ctx.orderId },
      method: "POST",
      body: { state: "KITCHEN" },
    });
    expect(kitchen.status, kitchen.text()).toBe(200);

    // Straight back to ORDERED is not a transition this workflow defines (§29).
    const illegal = await callPos(orderPost, businessId, {
      path: `/orders/${ctx.orderId}`,
      params: { orderId: ctx.orderId },
      method: "POST",
      body: { state: "ORDERED" },
    });
    expect(illegal.status, illegal.text()).toBe(400);
    expect((await prisma.posOrder.findUnique({ where: { id: ctx.orderId } }))?.stateKey).toBe("KITCHEN");
    expect(await countWhere("posOrderEvent", { orderId: ctx.orderId })).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it("15 — expenses, purchases and supplier debt stay in their own ledgers (§12, §17, §30)", async () => {
    const businessId = ctx.owner.businessId;
    const known = await callPos(expensesPost, businessId, {
      method: "POST",
      body: { categoryKey: "electricity", amountKES: 1200, label: "November power", method: "mpesa" },
    });
    expect(known.status, known.text()).toBe(201);
    expect(known.body.warnings).toHaveLength(0);

    // An unknown category is folded into Other and the owner is told (§17) — never stored raw.
    const unknown = await callPos(expensesPost, businessId, {
      method: "POST",
      body: { categoryKey: "not_a_category", amountKES: 300 },
    });
    expect(unknown.status, unknown.text()).toBe(201);
    expect(unknown.body.warnings.length).toBeGreaterThan(0);

    const expenses = await callPos(expensesGet, businessId);
    expect(expenses.status, expenses.text()).toBe(200);
    expect(expenses.body.totals.amountKES).toBe(1500);
    expect(expenses.body.expenses).toHaveLength(2);
    expect(expenses.body.categories).toContain("electricity");
    expect(await prisma.posExpense.findMany({ where: { businessId }, select: { categoryKey: true } }))
      .toEqual(expect.arrayContaining([{ categoryKey: "electricity" }, { categoryKey: "other" }]));

    // This restaurant does not use purchase orders, so a purchase goes straight into stock (§12).
    const supplier = await callPos(suppliersPost, businessId, {
      method: "POST",
      body: { name: "Flour Co", creditEnabled: true, termsDays: 30 },
    });
    expect(supplier.status, supplier.text()).toBe(201);
    ctx.supplierId = supplier.body.supplier.id;

    const purchase = await callPos(purchasesPost, businessId, {
      method: "POST",
      body: { supplierId: ctx.supplierId, items: [{ productId: ctx.chapatiId, quantity: 20, unitCostKES: 18 }] },
    });
    expect(purchase.status, purchase.text()).toBe(201);
    const storedPurchase = await prisma.posPurchase.findFirst({
      where: { businessId },
      orderBy: { createdAt: "desc" },
    });
    expect(storedPurchase).toMatchObject({ status: "RECEIVED", totalKES: 360, subtotalKES: 360 });
    expect(storedPurchase!.receivedAt).toBeTruthy();
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(56);
    expect(await countWhere("posInventoryMovement", { businessId, productId: ctx.chapatiId, reason: "PURCHASE" })).toBe(1);

    // Supplier credit is its own ledger: paying a supplier never touches a customer balance (§30).
    const paid = await callPos(supplierPost, businessId, {
      path: `/suppliers/${ctx.supplierId}`,
      params: { supplierId: ctx.supplierId },
      method: "POST",
      body: { amountKES: 200, method: "cash" },
    });
    expect(paid.status, paid.text()).toBe(200);
    expect(await countWhere("posCreditEntry", { businessId, partyType: "SUPPLIER" })).toBeGreaterThan(0);
    expect((await prisma.posCustomer.findUnique({ where: { id: ctx.customerId } }))?.balanceKES).toBe(60);
  }, 120_000);

  it("16 — reports are labelled recorded/calculated/estimate and only offer what the configuration supports (§35)", async () => {
    const businessId = ctx.owner.businessId;
    const catalogue = await callPos(reportsGet, businessId);
    expect(catalogue.status, catalogue.text()).toBe(200);
    const keys = catalogue.body.catalogue.flatMap((group: any) => group.reports.map((report: any) => report.key));
    expect(keys).toContain("daily_sales");
    expect(keys).toContain("payment_breakdown");
    expect(keys).toContain("ingredient_usage"); // this restaurant answered `recipes`
    expect(keys).not.toContain("job_profitability"); // a garage's report, not a kitchen's
    expect(keys).not.toContain("produce");

    const sales = await callPos(reportsGet, businessId, { query: { report: "daily_sales" } });
    expect(sales.status, sales.text()).toBe(200);
    expect(sales.body.report.available).toBe(true);
    expect(sales.body.report.basis).toBe("recorded");
    expect(sales.body.report.rows.length).toBe(await countWhere("posSale", { businessId }));

    const profit = await callPos(reportsGet, businessId, { query: { report: "profitability" } });
    expect(["calculated", "estimate"]).toContain(profit.body.report.basis);

    // A report the configuration cannot support says so instead of returning zeros (§35).
    const unavailable = await callPos(reportsGet, businessId, { query: { report: "job_profitability" } });
    expect(unavailable.body.report.available).toBe(false);
    expect(unavailable.body.report.rows).toHaveLength(0);
    expect(typeof unavailable.body.report.notice).toBe("string");
  }, 120_000);

  it("17 — the audit log records who did what, with before and after values (§37)", async () => {
    const businessId = ctx.owner.businessId;
    const audit = await callPos(auditGet, businessId);
    expect(audit.status, audit.text()).toBe(200);
    const entries = audit.body.entries;
    expect(entries.length).toBeGreaterThan(0);

    for (const action of ["POS_SALE_CREATED", "POS_SALE_REFUNDED"]) {
      expect(entries.some((entry: any) => entry.action === action), `audit is missing ${action}`).toBe(true);
    }
    const sale = entries.find((entry: any) => entry.action === "POS_SALE_CREATED");
    expect(sale.actor).toBeTruthy();
    expect(sale.label.length).toBeGreaterThan(0);

    // Metadata survives the round trip through the database as structured data, not as text (§37).
    const stored = await prisma.posAuditEvent.findFirst({
      where: { businessId, action: "POS_SALE_CREATED" },
      orderBy: { createdAt: "asc" },
    });
    expect(stored, "the audit row was not written").toBeTruthy();
    expect(stored!.actorId).toBe(ctx.owner.userId);
    expect(stored!.targetType).toBeTruthy();
    if (typeof stored!.metadata === "string" && stored!.metadata.length > 0) {
      expect(() => JSON.parse(stored!.metadata as string)).not.toThrow();
    }
  }, 120_000);

  it("18 — a setup is copied to another business the same owner has, and nothing else is (§25, §50)", async () => {
    const businessId = ctx.owner.businessId;
    const second = await callPlatform(businessPost, "https://jata.test/api/business", {
      method: "POST",
      body: { name: `E2E POS Second ${runId}`, category: "Restaurant" },
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    ctx.secondBusinessId = second.body.business.id;
    created.push({ userId: ctx.owner.userId, businessId: ctx.secondBusinessId });

    const offered = await callPos(cloneGet, businessId);
    expect(offered.status, offered.text()).toBe(200);
    expect(offered.body.targetBusinesses.map((row: any) => row.id)).toContain(ctx.secondBusinessId);
    expect(offered.body.builtInTemplates.length).toBeGreaterThanOrEqual(22);
    expect(offered.body.builtInTemplates.some((template: any) => template.key === "RESTAURANT")).toBe(true);

    const copied = await callPos(clonePost, businessId, {
      method: "POST",
      body: { targetBusinessId: ctx.secondBusinessId, scopes: ["capabilities", "terminology", "payments", "workflows"] },
    });
    expect(copied.status, copied.text()).toBe(200);
    expect(copied.body.ok).toBe(true);

    const target = await prisma.posConfiguration.findUnique({ where: { businessId: ctx.secondBusinessId } });
    expect(target, "the copy wrote no configuration").toBeTruthy();
    const draft = JSON.parse(target!.draftJson as string);
    expect(draft.business.typeKey).toBe("restaurant");
    // Identity is stripped: the copy is not the original business (§25).
    expect(draft.receipt.businessName).toBe("");

    // Structure copied, operations did not (§50).
    expect(await countWhere("posSale", { businessId: ctx.secondBusinessId })).toBe(0);
    expect(await countWhere("posPayment", { businessId: ctx.secondBusinessId })).toBe(0);
    expect(await countWhere("posCustomer", { businessId: ctx.secondBusinessId })).toBe(0);
    expect(await countWhere("posCreditEntry", { businessId: ctx.secondBusinessId })).toBe(0);
    expect(await countWhere("posSubscription", { businessId: ctx.secondBusinessId })).toBe(0);
    const targetAudit = await prisma.posAuditEvent.findMany({ where: { businessId: ctx.secondBusinessId }, select: { action: true } });
    expect(targetAudit.map((row) => row.action)).toEqual(["POS_CONFIGURATION_COPIED"]);
  }, 120_000);

  it("19 — a data-carrying scope is refused by name, and another owner's business is refused outright (§50, §75)", async () => {
    const businessId = ctx.owner.businessId;
    const scope = await callPos(clonePost, businessId, {
      method: "POST",
      body: { targetBusinessId: ctx.secondBusinessId, scopes: ["capabilities", "sales", "balances", "secrets"] },
    });
    expect(scope.status, scope.text()).toBe(400);
    expect(scope.body.code).toBe("CLONE_SCOPE_REFUSED");
    expect(scope.body.error).toMatch(/sales/);
    expect(scope.body.error).toMatch(/balances/);
    expect(scope.body.error).not.toMatch(/prisma|sql|stack/i);

    const stranger = await registerPerson("stranger");
    ctx.stranger = stranger;
    const foreign = await callPos(clonePost, businessId, {
      method: "POST",
      body: { targetBusinessId: stranger.businessId, scopes: ["capabilities"] },
    });
    expect(foreign.status, foreign.text()).toBe(403);
    expect(foreign.body.code).toBe("NOT_ALLOWED");
    expect(await countWhere("posConfiguration", { businessId: stranger.businessId })).toBe(0);
  }, 120_000);

  it("20 — versions are appended to and rolled back by adding one; history is never rewritten (§48, §49)", async () => {
    const businessId = ctx.owner.businessId;
    const saleBefore = await prisma.posSale.findUnique({ where: { id: ctx.saleId } });

    const first = await callPos(publishPost, businessId, { method: "POST", body: { note: "opening setup" } });
    expect(first.status, first.text()).toBe(200);
    expect(first.body.publishedVersion).toBeGreaterThanOrEqual(1);

    const changed = await callPos(configPost, businessId, {
      method: "POST",
      body: { answers: { ...restaurantAnswers, credit_terms_days: 45 } },
    });
    expect(changed.status, changed.text()).toBe(200);
    expect(changed.body.changed).toBe(true);

    const second = await callPos(publishPost, businessId, { method: "POST", body: { note: "longer credit terms" } });
    expect(second.status, second.text()).toBe(200);

    const list = await callPos(versionsGet, businessId);
    expect(list.status, list.text()).toBe(200);
    expect(list.body.versions.length).toBeGreaterThanOrEqual(2);
    const oldest = list.body.versions[list.body.versions.length - 1];
    const before = list.body.versions.length;

    const rolled = await callPos(versionsPost, businessId, { method: "POST", body: { versionId: oldest.id } });
    expect(rolled.status, rolled.text()).toBe(200);
    expect(rolled.body.ok).toBe(true);
    expect((await callPos(versionsGet, businessId)).body.versions.length).toBeGreaterThan(before);

    // A configuration change never rewrites a historical transaction (§49, §54).
    const saleAfter = await prisma.posSale.findUnique({ where: { id: ctx.saleId } });
    expect(saleAfter).toMatchObject({ totalKES: saleBefore!.totalKES, refundedKES: saleBefore!.refundedKES, status: saleBefore!.status });

    // A version belonging to another business cannot be rolled back onto this one (§5).
    const strangerVersion = await callPos(versionsPost, businessId, {
      method: "POST",
      body: { versionId: "posversion_does_not_exist" },
    });
    expect(strangerVersion.status, strangerVersion.text()).toBeGreaterThanOrEqual(400);
  }, 120_000);

  it("21 — another tenant sees nothing, and a body-supplied tenant id is refused (§5, §75)", async () => {
    const businessId = ctx.owner.businessId;
    h.session.current = { userId: ctx.stranger.userId, role: "OWNER" };

    const foreign = await callPos(salesGet, businessId);
    expect(foreign.status, foreign.text()).toBe(403);
    expect(foreign.body.sales).toBeUndefined();
    expect(foreign.body.error).not.toMatch(/prisma|sql|stack|secret/i);

    const unknown = await callPos(salesGet, "pos_business_that_does_not_exist");
    expect(unknown.status, unknown.text()).toBe(404);

    // The victim's sale id is not resolvable inside the stranger's own business, and answers exactly
    // like a random id: no existence oracle (§56, §75).
    const theirs = await callPos(saleGet, ctx.stranger.businessId, {
      path: `/sales/${ctx.saleId}`,
      params: { saleId: ctx.saleId },
    });
    const missing = await callPos(saleGet, ctx.stranger.businessId, {
      path: "/sales/pos_sale_nope",
      params: { saleId: "pos_sale_nope" },
    });
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(theirs.body.error).toBe(missing.body.error);

    h.session.current = { userId: ctx.owner.userId, role: "OWNER" };

    // A tenant id that exists only in the request body is refused and audited (§5, §75).
    const denied = await countWhere("posAuditEvent", { businessId, action: "POS_ACCESS_DENIED" });
    const smuggled = await callPos(salesPost, businessId, {
      method: "POST",
      body: {
        businessId: ctx.stranger.businessId,
        items: [{ productId: ctx.chapatiId, quantity: 1 }],
        payments: [{ method: "cash", amountKES: 50 }],
      },
    });
    expect(smuggled.status, smuggled.text()).toBe(403);
    expect(smuggled.body.code).toBe("TENANT_ID_MISMATCH");
    expect(await countWhere("posAuditEvent", { businessId, action: "POS_ACCESS_DENIED" })).toBeGreaterThan(denied);

    const attempt = await prisma.posAuditEvent.findFirst({
      where: { businessId, action: "POS_ACCESS_DENIED" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(attempt!.metadata as string).reason).toBe("TENANT_ID_MISMATCH");
  }, 120_000);

  it("22 — a lapsed plan keeps history readable and refuses new money (§44)", async () => {
    const businessId = ctx.owner.businessId;
    const salesBefore = await countWhere("posSale", { businessId });
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.posSubscription.update({ where: { businessId }, data: { expiresAt: past, graceUntil: past } });

    const workspace = await callPos(workspaceGet, businessId);
    expect(workspace.status, workspace.text()).toBe(200);
    expect(workspace.body.lifecycle).toBe("SUSPENDED");
    expect(workspace.body.entitlement.entitled).toBe(false);
    expect(workspace.body.entitlement.nextAction).toBe("renew");

    // History is still readable — the records belong to the business, not to the subscription (§44).
    for (const read of [
      callPos(salesGet, businessId),
      callPos(reportsGet, businessId, { query: { report: "daily_sales" } }),
      callPos(customerGet, businessId, { path: `/customers/${ctx.customerId}`, params: { customerId: ctx.customerId } }),
      callPos(auditGet, businessId),
      callPos(inventoryGet, businessId),
    ]) {
      expect((await read).status, (await read).text()).toBe(200);
    }

    const refused = await callPos(salesPost, businessId, {
      method: "POST",
      body: { items: [{ productId: ctx.chapatiId, quantity: 1 }], payments: [{ method: "cash", amountKES: 50 }] },
    });
    expect(refused.status, refused.text()).toBe(402);
    expect(await countWhere("posSale", { businessId })).toBe(salesBefore);
    expect(await stockOf(businessId, ctx.chapatiId)).toBe(56);
  }, 120_000);
});
