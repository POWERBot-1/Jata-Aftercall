/**
 * JATA BOS PRO (`ERP_PRO`) in the public catalogue — homepage, /pricing and the shared helpers.
 *
 * The 2026-10-29 mobile-first owner order puts seven offers in one grid:
 *   1. JATA Monthly — KES 149        5. Business POS — KES 499/month
 *   2. JATA Annual — KES 999         6. JATA BOS PRO — KES 3,000 per 30 days
 *   3. AI Business Front Desk        7. JATA Autopilot — KES 2,499/month
 *   4. Website Studio — KES 999
 *
 * These tests pin that order (which is also the mobile reading order, since the grid is a single
 * column on phones), that BOS PRO appears exactly once per view, that its card links to
 * `/products/erp-pro`, that stored `PlanConfig` prices win over the documented fallback, and that
 * showing the product never makes `ERP_PRO` a payable choice or weakens any payment or
 * entitlement control.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  plans: null as null | Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findMany: vi.fn(async () => {
        if (state.fail) throw new Error("offline");
        return state.plans ?? [];
      }),
    },
    business: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => null),
  requireSession: vi.fn(async () => null),
  SESSION_COOKIE_NAME: "jata_session",
}));

import HomePage from "@/app/page";
import PricingPage from "@/app/pricing/page";
import {
  ERP_PRO_FALLBACK_CARD,
  HOMEPAGE_PLAN_ORDER,
  homepagePlanCards,
  planDisplayName,
  publiclyListedPlans,
} from "@/lib/pricing";
import { ERP_PRO_PLAN_CARD, PLAN_BADGES, PLAN_INCLUDES, PLAN_ICONS } from "@/lib/landing";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** The seven offers in the required order, as the homepage must render them. */
const REQUIRED_ORDER = [
  "MONTHLY",
  "ANNUAL",
  "AI_BUSINESS_FRONT_DESK",
  "INTERACTIVE_BUSINESS",
  "BUSINESS_POS",
  "ERP_PRO",
  "JATA_AUTOPILOT",
];

const REQUIRED_NAMES = [
  "Monthly — KES 149/month",
  "Annual — KES 999/year",
  "AI Business Front Desk — KES 499/month",
  "Website Studio — KES 999/month",
  "JATA AFTERCALL — Business POS",
  "JATA BOS PRO",
  "JATA Autopilot — KES 2,499/month",
];

/** Full active catalogue as stored — the production-shape rows plus the ERP_PRO row. */
const STORED_ROWS = [
  { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  { id: "p5", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p6", key: "ERP_PRO", name: "POS / ERP - PRO", priceKES: 3000, durationDays: 30, isActive: true },
  { id: "p7", key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
];

const planCards = (html: string) =>
  [...html.matchAll(/<article class="lp-plan"[^>]*data-plan="([A-Z_]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => ({
    key: match[1],
    inner: match[2],
  }));

const renderHome = async () => renderToStaticMarkup(await HomePage());
const renderPricing = async () => renderToStaticMarkup(await PricingPage());

describe("homepage: the seven offers in the exact mobile-first order", () => {
  it("renders exactly seven cards in the required order, one grid, no extra sections", async () => {
    state.fail = false;
    state.plans = STORED_ROWS;
    const html = await renderHome();
    const cards = planCards(html);

    expect(cards.map((card) => card.key)).toEqual(REQUIRED_ORDER);
    expect(html.match(/class="lp-plans"/g)).toHaveLength(1);
    expect(html).toContain('data-plan-count="7"');
    // Names appear in the required order (first occurrence in the grid).
    const positions = REQUIRED_NAMES.map((name) => html.indexOf(name));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps the same order when the database is unavailable (fallback fill)", async () => {
    state.fail = true;
    try {
      const html = await renderHome();
      expect(planCards(html).map((card) => card.key)).toEqual(REQUIRED_ORDER);
    } finally {
      state.fail = false;
    }
  });

  it("is the mobile reading order: one column by default, DOM order = visual order, no CSS reordering", () => {
    const styles = read("app/globals.css");
    const gridBlock = styles.slice(styles.indexOf(".lp-pricing .lp-plans {"), styles.indexOf(".lp-plan {"));
    // Below 620px (i.e. 320/360/390/430) the grid is exactly one column.
    expect(gridBlock).toContain("grid-template-columns: minmax(0, 1fr)");
    // Two columns only from 620px, three-across only from 1080px — never below.
    expect(styles).toContain("@media (min-width: 620px) { .lp-pricing .lp-plans { grid-template-columns: repeat(2, minmax(0, 1fr)); } }");
    expect(styles).toContain("@media (min-width: 1080px) {");
    // No `order:` rule may reshuffle cards away from DOM order.
    expect(styles).not.toMatch(/\.lp-plan[^{]*\{\s*[^}]*\border\s*:/);
  });
});

describe("homepage: JATA BOS PRO card", () => {
  it("appears exactly once, with its own ledger icon, name and subtitle", async () => {
    state.fail = false;
    state.plans = STORED_ROWS;
    const html = await renderHome();
    const cards = planCards(html);
    const erpCards = cards.filter((card) => card.key === "ERP_PRO");
    expect(erpCards).toHaveLength(1);
    const erp = erpCards[0].inner;

    expect(erp).toContain("JATA BOS PRO");
    expect(erp).toContain(ERP_PRO_PLAN_CARD.subtitle);
    expect(erp).toContain("lp-plan__icon");
    expect(erp).toMatch(/lp-plan__icon"[^>]*>\s*<svg/);
    // Exactly one card is BOS PRO in the whole page.
    expect(html.match(/data-plan="ERP_PRO"/g)).toHaveLength(1);
  });

  it("links to /products/erp-pro and never to the business-page checkout", async () => {
    const html = await renderHome();
    const erp = planCards(html).find((card) => card.key === "ERP_PRO")!.inner;
    const hrefs = [...erp.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/products/erp-pro"]);
    expect(erp).toContain("Explore JATA BOS PRO");
    expect(erp).not.toContain("/checkout");
    expect(erp).not.toContain("/register");
  });

  it("shows the stored price and billing period — KES 3,000 per 30 days — and states the exclusions", async () => {
    const html = await renderHome();
    const erp = planCards(html).find((card) => card.key === "ERP_PRO")!.inner;
    expect(erp).toContain(">KES 3,000<");
    expect(erp).toContain("per 30 days");
    expect(erp).toContain("SMS and WhatsApp usage charges");
    expect(erp).toMatch(/eTIMS submission is not claimed as certified/i);
  });

  it("renames the customer-facing product even when the stored name is the legacy one", () => {
    expect(planDisplayName({ key: "ERP_PRO", name: "POS / ERP - PRO" })).toBe("JATA BOS PRO");
    expect(planDisplayName({ key: "ERP_PRO", name: "JATA BOS PRO — Business Operating System Pro" })).toBe("JATA BOS PRO");
  });
});

describe("stored catalogue pricing beats the fallback", () => {
  it("uses the stored price/duration when the ERP_PRO row exists — never the hardcoded fallback", () => {
    const stored = { key: "ERP_PRO", name: "JATA BOS PRO", priceKES: 2500, durationDays: 30 };
    const cards = homepagePlanCards([...STORED_ROWS.filter((row) => row.key !== "ERP_PRO"), stored]);
    const erp = cards.find((card) => card.key === "ERP_PRO")!;
    expect(erp.priceKES).toBe(2500);
    expect(erp).not.toMatchObject({ priceKES: ERP_PRO_FALLBACK_CARD.priceKES });
  });

  it("uses the documented KES 3,000 / 30 days fallback only when the stored row is unavailable or inactive", () => {
    // Unavailable: no ERP_PRO row in the list the pages read.
    const withoutRow = homepagePlanCards(STORED_ROWS.filter((row) => row.key !== "ERP_PRO"));
    expect(withoutRow.find((card) => card.key === "ERP_PRO")).toMatchObject({ key: "ERP_PRO", priceKES: 3000, durationDays: 30 });
    // Inactive rows are excluded by the pages' `where: { isActive: true }` read, so the list the
    // helper receives has no ERP_PRO row — the same fallback path.
    const activeOnly = STORED_ROWS.filter((row) => row.key !== "ERP_PRO");
    expect(homepagePlanCards(activeOnly).find((card) => card.key === "ERP_PRO")!.priceKES).toBe(3000);
    // BOS PRO appears exactly once whether filled from storage or from the fallback.
    expect(withoutRow.filter((card) => card.key === "ERP_PRO")).toHaveLength(1);
  });

  it("renders the stored price on the homepage when it differs from the canonical term", async () => {
    state.plans = STORED_ROWS.map((row) => (row.key === "ERP_PRO" ? { ...row, priceKES: 2750 } : row));
    const html = await renderHome();
    const erp = planCards(html).find((card) => card.key === "ERP_PRO")!.inner;
    expect(erp).toContain(">KES 2,750<");
    expect(erp).not.toContain(">KES 3,000<");
    state.plans = STORED_ROWS;
  });
});

describe("public /pricing shows every offer", () => {
  it("lists all seven offers in the marketing order, each with price, period and a details link", async () => {
    state.fail = false;
    state.plans = STORED_ROWS;
    const html = await renderPricing();

    for (const name of REQUIRED_NAMES) {
      expect(html, name).toContain(name);
    }
    // Exactly one BOS PRO card, and it points at its product page.
    expect(html.match(/data-plan="ERP_PRO"/g)).toHaveLength(1);
    expect(html).toContain('href="/products/erp-pro"');
    expect(html).toContain("KES 3,000 per 30 days");
    // Offer order in the DOM matches the required order.
    const positions = REQUIRED_ORDER.map((key) => html.indexOf(`data-plan="${key}"`));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("distinguishes ordinary subscriptions from separate products and states exclusions and activation rules", async () => {
    const html = await renderPricing();
    expect(html).toMatch(/Subscription · pay from your dashboard/);
    expect(html).toMatch(/Separate product · purchased in the Business POS workspace/);
    expect(html).toMatch(/Separate product · purchased in the ERP workspace/);
    expect(html).toContain("Showing an offer never activates it");
    expect(html).toContain("SMS and WhatsApp usage charges");
    expect(html).toContain("KRA eTIMS certification or integrator fees");
    expect(html).toMatch(/not claimed as certified or operational/i);
  });

  it("is mobile-scannable: stacked cards, no wide comparison table that needs horizontal scrolling", async () => {
    const html = await renderPricing();
    expect(html).not.toContain("mk-table");
    expect(html).toContain('class="mk-grid"');
    // All seven are mk-card blocks inside the catalogue grid.
    expect(html.match(/class="mk-card"/g)).toHaveLength(7);
  });

  it("keeps the catalogue on one authoritative helper shared with the homepage", () => {
    expect(read("app/pricing/page.tsx")).toContain("homepagePlanCards");
    expect(read("app/products/page.tsx")).toContain("homepagePlanCards");
  });
});

describe("ERP_PRO stays out of every payable list and every purchase control stays in place", () => {
  it("is never a publicly listed (payable) plan", () => {
    expect(publiclyListedPlans(STORED_ROWS).map((plan) => plan.key)).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
    ]);
    expect(publiclyListedPlans(STORED_ROWS).map((plan) => plan.key)).not.toContain("ERP_PRO");
  });

  it("never reaches onboarding or the subscription payable list, only the marketing catalogue", () => {
    const onboarding = read("app/onboarding/page.tsx");
    const subscription = read("app/dashboard/subscription/page.tsx");
    expect(onboarding).toContain("publiclyListedPlans");
    expect(subscription).toContain("publiclyListedPlans");
    // The payable card list comes from the filtered list; the full catalogue is a separate section.
    expect(subscription).toContain("Every JATA AFTERCALL offer");
  });

  it("checkout still validates plan pricing server-side and refuses foreign keys", () => {
    const checkout = read("app/api/checkout/route.ts");
    expect(checkout).toContain("assertPosPlanPricing");
    expect(checkout).toContain("assertAutopilotPlanPricing");
    expect(checkout).toContain("assertInteractivePlanPricing");
    expect(checkout).toContain('fail(400, "PLAN_NOT_ALLOWED"');
    // The BOS PRO card and product page never link into the business-page checkout.
    expect(read("app/page.tsx")).not.toContain("/checkout");
    expect(read("app/products/[slug]/page.tsx")).not.toContain("/checkout");
  });

  it("keeps webhook signature verification, idempotency and the ERP feature flag untouched", () => {
    const webhook = read("app/api/paystack/webhook/route.ts");
    expect(webhook).toContain("verifyWebhookSignature");
    expect(webhook).toContain("isWebhookProcessed");
    expect(webhook).toContain("activateSubscriptionForPayment");
    const entitlement = read("lib/erp/entitlement.ts");
    expect(entitlement).toContain("ERP_PRO_ENABLED");
    expect(entitlement).toContain('export const ERP_PLAN_KEY = "ERP_PRO"');
    expect(entitlement).toContain("assertErpPlanPricing");
    // The purchase flow still requires the stored plan row — the marketing fallback never feeds it.
    const actions = read("app/dashboard/erp/[businessId]/actions.ts");
    expect(actions).toContain("has not been configured on this deployment yet. Nothing was charged.");
  });
});

describe("the other products keep their prices and destinations", () => {
  it("Business POS keeps KES 499/month and /dashboard/pos; JATA Autopilot keeps KES 2,499/month and /dashboard/autopilot", async () => {
    state.plans = STORED_ROWS;
    const html = await renderHome();
    const cards = planCards(html);
    const pos = cards.find((card) => card.key === "BUSINESS_POS")!.inner;
    const autopilot = cards.find((card) => card.key === "JATA_AUTOPILOT")!.inner;

    expect(pos).toContain(">KES 499<");
    expect(pos).toContain("per 30 days");
    expect(pos).toContain('href="/dashboard/pos"');
    expect(autopilot).toContain(">KES 2,499<");
    expect(autopilot).toContain("per 30 days");
    expect(autopilot).toContain('href="/dashboard/autopilot"');
  });

  it("AI Business Front Desk and Website Studio keep their prices and /register destinations", async () => {
    const html = await renderHome();
    const cards = planCards(html);
    const ai = cards.find((card) => card.key === "AI_BUSINESS_FRONT_DESK")!.inner;
    const studio = cards.find((card) => card.key === "INTERACTIVE_BUSINESS")!.inner;

    expect(ai).toContain(">KES 499<");
    expect(ai).toContain('href="/register"');
    expect(studio).toContain(">KES 999<");
    expect(studio).toContain("Website Studio — KES 999/month");
    expect(studio).toContain('href="/register"');
  });

  it("keeps the page-plan includes and badges free of the separate products", () => {
    expect(Object.keys(PLAN_INCLUDES)).toEqual(["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
    expect(Object.keys(PLAN_BADGES)).toEqual(["ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
    expect(Object.keys(PLAN_ICONS)).toEqual(["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
  });
});

describe("the responsive grid rules cover 320–1366 without overflow regressions", () => {
  it("defines one column on phones, two on tablets and a stable three-across desktop grid", () => {
    const styles = read("app/globals.css");
    // 320/360/390/430: single column.
    expect(styles).toContain(".lp-pricing .lp-plans {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);");
    // 768: two columns. 1366: six tracks with every card spanning two (three across).
    expect(styles).toContain("repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("repeat(6, minmax(0, 1fr))");
    expect(styles).toContain('.lp-pricing .lp-plans[data-plan-count="7"] .lp-plan:nth-child(7)');
    // Cards and buttons never overflow their box: the CTA is a full-width flex row with a
    // touch-sized minimum height, and long names wrap instead of clipping.
    expect(styles).toContain("overflow-wrap: anywhere");
    expect(styles).toMatch(/\.lp-plan__cta \{[^}]*min-height: 2\.9rem/);
  });

  it("pricing offer cards stack without a horizontal-scroll container", () => {
    const styles = read("app/globals.css");
    // mk-grid collapses to one column on narrow screens (minmax(min(100%, …))).
    expect(styles).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr))");
  });
});
