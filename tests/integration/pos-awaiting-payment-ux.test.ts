/**
 * What an owner sees while the Business POS is awaiting payment (§38, §43, §44, §60, §61).
 *
 * Production report (2026-10-03): on `/dashboard/pos/<id>/plan` — the screen that says
 * "Step 5 of 5", "KES 499/month" and "Your plan is chosen. Complete the payment to switch your POS
 * on." — the banner's `Continue` control pointed at the page already open, so pressing it did
 * nothing. The business also had a PENDING Paystack transaction, which is *not* what disabled
 * anything: the control was a Next `<Link>` to the current route, whose click is intercepted and
 * pushed back to the same URL.
 *
 * These tests render the real POS shell and pages against the in-memory database in exactly that
 * state — configuration `AWAITING_PAYMENT` plus a pending payment for the POS plan — and prove:
 *
 * 1. `/plan` keeps its own working pay button and no longer renders a self-referential Continue;
 * 2. every other POS screen still offers the banner's Continue link to `/plan`;
 * 3. the state itself is untouched: the API still reports `AWAITING_PAYMENT` and the same href, no
 *    subscription exists, and nothing became live because a payment was merely started (§44).
 */

import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ session: null as any, pathname: "/dashboard/pos/bizA" }));

vi.mock("@/lib/db", async () => {
  const { createFakeDb, standardSeed } = await import("@/tests/helpers/posFakeDb");
  const seed = standardSeed();
  seed.business[0] = { ...seed.business[0], name: "Karis Farm", category: "Restaurant" };
  const fake = createFakeDb(seed);
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

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

import type { FakeDb } from "@/tests/helpers/posFakeDb";
import { POST as configPost } from "@/app/api/pos/[businessId]/configuration/route";
import { POST as planPost } from "@/app/api/pos/[businessId]/plan/route";
import { GET as workspaceGet } from "@/app/api/pos/[businessId]/route";
import PosLayout from "@/app/dashboard/pos/[businessId]/layout";
import PosDashboardPage from "@/app/dashboard/pos/[businessId]/page";
import PosPlanPage from "@/app/dashboard/pos/[businessId]/plan/page";

const fake = () => (globalThis as any).__posFake as FakeDb;
const rows = (name: string) => fake().rows(name);
const OWNER = { userId: "userA", email: "a@example.com", role: "CUSTOMER", name: "Owner A" };
const BUSINESS_ID = "bizA";
const BASE = `/dashboard/pos/${BUSINESS_ID}`;
const params = Promise.resolve({ businessId: BUSINESS_ID });
const context = { params };

/** The questionnaire answers a restaurant gives, as the configure screen posts them. */
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

const post = (body: unknown = {}) =>
  new Request(`https://jata.test/api/pos/${BUSINESS_ID}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

/** Render a POS screen the way Next does — shell plus page — and return the HTML. */
async function renderScreen(page: (props: any) => Promise<React.ReactElement>, pathname: string) {
  mocks.pathname = pathname;
  const element = await PosLayout({ children: await page({ params }), params });
  return renderToStaticMarkup(element);
}

/** Configure the business, choose the plan, and leave the Paystack attempt PENDING, as production was. */
async function awaitingPaymentWithPendingTransaction() {
  const configured = await configPost(post({ answers: restaurantAnswers }), context);
  expect(configured.status).toBe(200);

  const chosen = await planPost(post(), context);
  const chosenBody = await chosen.json();
  expect(chosen.status).toBe(200);
  expect(chosenBody.status).toBe("AWAITING_PAYMENT");

  // Payment *initiation*: the same PENDING row the checkout route writes before Paystack opens.
  rows("payment").push({
    id: "pay_pending_1",
    reference: "jata-3fe5ba30-c6f3-4e36-a8bb-e7e568f99221",
    businessId: BUSINESS_ID,
    userId: "userA",
    planId: "plan_pos",
    amount: 49900,
    currency: "KES",
    status: "PENDING",
    createdAt: new Date(),
  });
}

describe("the POS awaiting payment, with a payment already started (§43, §44, §60)", () => {
  beforeEach(() => {
    fake().reset();
    mocks.session = OWNER;
    mocks.pathname = BASE;
  });

  it("does not render a Continue link back to the page the owner is already on (§60)", async () => {
    await awaitingPaymentWithPendingTransaction();

    const html = await renderScreen(PosPlanPage, `${BASE}/plan`);

    // The screen still explains the state, in the same words, with the same price.
    expect(html).toContain("Step 5 of 5");
    expect(html).toContain("KES 499");
    expect(html).toContain("Your plan is chosen. Complete the payment to switch your POS on.");
    expect(html).toContain("Awaiting payment");

    // The dead control is gone: no anchor to this same route, so nothing can swallow a click.
    expect(html).not.toContain(`href="${BASE}/plan"`);
    expect(html).not.toContain(">Continue</a>");
  });

  it("keeps the plan screen's own pay button present and enabled (§43)", async () => {
    await awaitingPaymentWithPendingTransaction();

    const html = await renderScreen(PosPlanPage, `${BASE}/plan`);

    expect(html).toContain("Choose plan and pay KES 499");
    expect(html).toMatch(/<button[^>]*class="jata-btn jata-btn-primary"[^>]*>Choose plan and pay KES 499<\/button>/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled/);
    // The plan screen is still reachable from the screen that leads to it.
    expect(html).toContain(`href="${BASE}/preview"`);
  });

  it("still offers the banner's Continue on every other POS screen", async () => {
    await awaitingPaymentWithPendingTransaction();

    for (const [page, pathname] of [[PosDashboardPage, BASE]] as const) {
      const html = await renderScreen(page, pathname);
      expect(html).toContain(`href="${BASE}/plan"`);
      expect(html).toContain(">Continue</a>");
      expect(html).toContain("Your plan is chosen. Complete the payment to switch your POS on.");
    }
  });

  it("changes nothing about the state: same lifecycle, same href, still not live (§44)", async () => {
    await awaitingPaymentWithPendingTransaction();

    const response = await workspaceGet(new Request(`https://jata.test/api/pos/${BUSINESS_ID}`), context);
    const workspace = await response.json();

    // The data contract the other suites pin is untouched by the presentation fix.
    expect(workspace.lifecycle).toBe("AWAITING_PAYMENT");
    expect(workspace.noticeHref).toBe(`${BASE}/plan`);
    expect(workspace.noticeTone).toBe("warn");
    expect(workspace.entitlement.entitled).toBe(false);
    expect(["NONE", "PENDING"]).toContain(workspace.entitlement.status);

    // A started payment is not a confirmed one: no subscription, nothing live, and trading is refused.
    expect(rows("posSubscription")).toHaveLength(0);
    expect(rows("posConfiguration")[0].status).toBe("AWAITING_PAYMENT");
    const workspacePage = await renderScreen(PosDashboardPage, BASE);
    expect(workspacePage).not.toContain("Live</span>");
  });

  it("keeps linking away from the dashboard for a business that is still configuring", async () => {
    // A business that has not configured anything yet: the banner explains the first step and the
    // link leads to the configure screen — the guard against hiding a link that *does* go somewhere.
    const html = await renderScreen(PosDashboardPage, BASE);
    expect(html).toContain("Not configured yet");
    expect(html).toContain(`href="${BASE}/configure"`);
    expect(html).toContain(">Open</a>");
  });
});
