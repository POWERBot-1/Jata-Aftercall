/**
 * The public homepage's Business POS plan card.
 *
 * Product decision (2026-10-03): the Business POS needs an entry on the landing page — the product
 * was deployed and reachable from the dashboard, but an owner had no way to find it from the public
 * site. That entry used to be a standalone promotional block below the pricing section.
 *
 * Product decision (2026-10-25, revised 2026-10-27): the POS is the sixth (last) card of the
 * *same* pricing grid as the four page plans, so no plan is isolated in its own section. The
 * commercial and security behaviour
 * is unchanged: the card names the product, shows the price the server owns, says plainly that the
 * POS switches on only after Paystack confirms payment, and links into the existing
 * `/dashboard/pos` flow. The POS is still a private plan key (`PRIVATE_PLAN_KEYS`), so it is not a
 * payable choice on onboarding, the AFTERCALL subscription screen or checkout.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findMany: vi.fn(async () => [
        { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
        { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
        { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
        { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
        // The private POS plan is active in production; under the 2026-10-27 order it fills the sixth (last) grid slot.
        { id: "plan_pos", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
      ]),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => null),
  requireSession: vi.fn(async () => null),
  SESSION_COOKIE_NAME: "jata_session",
}));

import HomePage from "@/app/page";
import { POS_PLAN_PRICE_KES } from "@/lib/pos/entitlement";
import { PRIVATE_PLAN_KEYS, publiclyListedPlans } from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");
const source = () => readFileSync(path.join(root, "app/page.tsx"), "utf8");
const css = () => readFileSync(path.join(root, "app/globals.css"), "utf8");

const renderHome = async () => renderToStaticMarkup(await HomePage());

/** Every plan card in document order, as the grid renders them. */
const planCards = (html: string) =>
  [...html.matchAll(/<article class="lp-plan"[^>]*data-plan="([A-Z_]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => ({
    key: match[1],
    inner: match[2],
  }));

const gridMarkup = (html: string) => {
  const start = html.indexOf('class="lp-plans"');
  const end = html.indexOf("</p>", html.indexOf('class="lp-pricing__note"'));
  return html.slice(start, end);
};

describe("the homepage renders the Business POS in the shared pricing grid (2026-10-25)", () => {
  it("keeps the POS fifth in the one grid under the 2026-10-29 owner order", async () => {
    const html = await renderHome();
    const cards = planCards(html);

    expect(cards.map((card) => card.key)).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
      "ERP_PRO",
      "JATA_AUTOPILOT",
    ]);
    // One grid container holds all seven cards.
    expect(html.match(/class="lp-plans"/g)).toHaveLength(1);
    expect(html).toContain('data-plan-count="7"');
    expect(gridMarkup(html)).toContain('data-plan="BUSINESS_POS"');
  });

  it("no longer renders the POS in a separate section or standalone block", async () => {
    const page = source();
    const html = await renderHome();

    expect(page).not.toContain("business-pos-heading");
    expect(html).not.toContain("business-pos-heading");
    // The old Tailwind promotional block is gone entirely.
    expect(page).not.toContain("mx-auto max-w-6xl px-4 pb-10 sm:px-6");
    expect(page).not.toContain("sm:flex sm:items-center sm:gap-5");
    // Exactly one pricing section, and it owns every card and the note.
    expect(page.match(/id="pricing"/g)).toHaveLength(1);
    expect(html.match(/data-plan="BUSINESS_POS"/g)).toHaveLength(1);
  });

  it("gives the POS card the same card structure as the page plans", async () => {
    const html = await renderHome();
    const cards = planCards(html);
    const pos = cards.find((card) => card.key === "BUSINESS_POS")!;
    const pagePlan = cards.find((card) => card.key === "MONTHLY")!;

    for (const part of ["lp-plan__icon", "lp-plan__name", "lp-plan__badge", "lp-plan__price", "lp-plan__period", "lp-plan__blurb", "lp-plan__includes", "lp-plan__cta", "lp-plan__fine"]) {
      expect(pos.inner, part).toContain(part);
    }
    // Same building blocks in the same order for both cards.
    // Positions of the parts a card actually has (a card without a badge or blurb has no such row).
    const order = (inner: string) =>
      ["lp-plan__icon", "lp-plan__name", "lp-plan__badge", "lp-plan__price", "lp-plan__period", "lp-plan__blurb", "lp-plan__includes", "lp-plan__cta", "lp-plan__fine"]
        .map((part) => inner.indexOf(part))
        .filter((index) => index >= 0);
    expect(order(pos.inner)).toEqual([...order(pos.inner)].sort((a, b) => a - b));
    expect(order(pagePlan.inner)).toEqual([...order(pagePlan.inner)].sort((a, b) => a - b));
  });

  it("names the product, the price and the way in", async () => {
    const html = await renderHome();

    expect(html).toContain("Business POS");
    expect(html).toContain("Owner-only");
    expect(html).toContain('href="/dashboard/pos"');
    expect(html).toContain("Open Business POS");
    // The entry links into the existing flow and nowhere else.
    expect(html).not.toContain('href="/dashboard/pos/new"');
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.filter((href) => /pos/i.test(href))).toEqual(["/dashboard/pos"]);
    // In the source the POS card's destination is the only POS route the page knows.
    expect(source()).toContain('"/dashboard/pos"');
    expect(source()).not.toMatch(/dashboard\/pos\//);
  });

  it("shows the server-owned price rather than a number written into the page", async () => {
    const html = await renderHome();
    const page = source();

    expect(POS_PLAN_PRICE_KES).toBe(499);
    // The stored plan row is the source of the card's price and billing period.
    expect(page).toContain("homepagePlanCards");
    expect(page).not.toMatch(/\b499\b/);
    expect(html).toContain(">KES 499<");
    expect(html).toContain("per 30 days");
    expect(html).toContain("30 days access");
  });

  it("says the POS switches on only after confirmed payment and never claims it is live", async () => {
    const html = await renderHome();
    const pos = planCards(html).find((card) => card.key === "BUSINESS_POS")!;

    expect(pos.inner).toContain("It switches on only once Paystack confirms the payment.");
    expect(pos.inner).toContain("It is owner-only");
    expect(html).not.toMatch(/POS is (now )?(live|active)/i);
  });

  it("preserves AFTERCALL prices and checkout for the four page plans", async () => {
    const html = await renderHome();

    for (const name of [
      "Monthly — KES 149/month",
      "Annual — KES 999/year",
      "AI Business Front Desk — KES 499/month",
      "Website Studio — KES 999/month",
    ]) {
      expect(html, name).toContain(name);
    }
    expect(html).toContain(">KES 149<");
    expect(html).toContain(">KES 999<");
    expect(html).toContain("Get my business page");
    expect(html).toContain("Secure Paystack checkout. Your plan starts once payment is confirmed.");

    // The four page plans still buy through /register; only the POS uses its own flow.
    const cards = planCards(html);
    for (const key of ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]) {
      expect(cards.find((card) => card.key === key)!.inner, key).toContain('href="/register"');
    }
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).not.toContain('href="/register"');
  });

  it("still renders all seven cards when the database is unavailable (the existing fallback)", async () => {
    const db = await import("@/lib/db");
    const findMany = db.default.planConfig.findMany as unknown as { mockImplementationOnce: (fn: () => Promise<never>) => void };
    findMany.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    const html = renderToStaticMarkup(await HomePage());
    expect(planCards(html).map((card) => card.key)).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
      "ERP_PRO",
      "JATA_AUTOPILOT",
    ]);
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).toContain("Annual — KES 999/year");
    expect(html).toContain("Business POS");
    expect(html).toContain(`>KES ${POS_PLAN_PRICE_KES}<`);
    expect(html).toContain('href="/dashboard/pos"');
  });

  it("keeps the POS out of every payable plan list while the card is on the homepage", () => {
    // The card is presentation only: the plan key stays private for selection and checkout.
    expect(PRIVATE_PLAN_KEYS).toContain("BUSINESS_POS");
    expect(
      publiclyListedPlans([
        { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
        { key: "BUSINESS_POS", name: "POS", priceKES: 499, durationDays: 30 },
      ]).map((plan) => plan.key),
    ).toEqual(["MONTHLY"]);
    for (const file of ["app/onboarding/page.tsx", "app/dashboard/subscription/page.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).toContain("publiclyListedPlans");
    }
    // The card never links to checkout or register: buying the POS stays inside the POS flow.
    expect(source()).not.toMatch(/href="\/checkout[^"]*BUSINESS_POS/);
  });

  it("shares one responsive grid definition for every card (no POS-only layout rules)", () => {
    const styles = css();
    // The pricing grid itself is defined once, for all cards.
    expect(styles).toContain(".lp-pricing .lp-plans {");
    expect(styles).toContain("repeat(2, minmax(0, 1fr))");
    expect(styles).toContain("repeat(6, minmax(0, 1fr))");
    expect(styles).toContain('.lp-pricing .lp-plans[data-plan-count="5"] .lp-plan:nth-child(4)');
    expect(styles).toContain('.lp-pricing .lp-plans[data-plan-count="5"] .lp-plan:nth-child(5)');
    // No selector targets the POS card on its own.
    expect(styles).not.toMatch(/data-plan="BUSINESS_POS"/);
    expect(styles).not.toMatch(/business-pos/i);
  });
});

describe("the Business POS card does not disturb the rest of the landing page", () => {
  it("keeps the hero, how-it-works and demo sections", async () => {
    const html = await renderHome();
    expect(html).toContain("Turn every customer conversation");
    expect(html).toContain("Create your page");
    expect(html).not.toContain("in ~5 minutes");
    expect(html).toContain("Demo businesses");
    expect(html).toContain('id="demo"');
    expect(html).toContain("Simple pricing");
  });

  it("adds exactly one POS card, one heading per pricing section and one POS call to action", async () => {
    const page = source();
    const html = await renderHome();
    expect(html.match(/Open Business POS/g)).toHaveLength(1);
    expect(html.match(/href="\/dashboard\/pos"/g)).toHaveLength(1);
    expect(page.match(/id="pricing-title"/g)).toHaveLength(1);
    expect(html.match(/data-plan="BUSINESS_POS"/g)).toHaveLength(1);
  });
});
