/**
 * The public homepage's Business POS entry.
 *
 * Product decision (2026-10-03): the Business POS gets one dedicated entry on the landing page —
 * the product was deployed and reachable from the dashboard, but an owner had no way to find it
 * from the public site. The entry is an entry point only: it names the product, shows the price
 * that the server owns, says plainly that the POS switches on after Paystack confirms payment, and
 * links into the existing `/dashboard/pos` flow. Nothing about it creates a second flow, and the
 * AFTERCALL plan cards come from the same `publiclyListedPlans()` list as before.
 *
 * This is the documented §67 exception: the AFTERCALL plan list still excludes the private POS
 * plan, and the customer-facing business page and referral copy still never mention it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
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
        // The private POS plan is active in production and must still never appear as a plan card.
        { id: "plan_pos", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true },
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

const root = path.resolve(__dirname, "../..");
const source = () => readFileSync(path.join(root, "app/page.tsx"), "utf8");

const renderHome = async () => renderToStaticMarkup(await HomePage());

describe("the homepage offers one Business POS entry (§67 exception, 2026-10-03)", () => {
  it("names the product, the price and the way in", async () => {
    const html = await renderHome();

    expect(html).toContain("Business POS");
    expect(html).toContain("KES 499/month");
    expect(html).toContain('href="/dashboard/pos"');
    expect(html).toContain("Open Business POS");
    // The entry links into the existing flow and nowhere else.
    expect(html).not.toContain('href="/dashboard/pos/new"');
  });

  it("shows the server-side price constant rather than a number written into the page", async () => {
    expect(POS_PLAN_PRICE_KES).toBe(499);
    expect(source()).toContain("POS_PLAN_PRICE_KES");
    expect(source()).not.toMatch(/\b499\b/);
    expect(await renderHome()).toContain(`KES ${POS_PLAN_PRICE_KES}/month`);
  });

  it("says the POS switches on only after confirmed payment", async () => {
    const html = await renderHome();
    expect(html).toContain("It switches on only once Paystack confirms the payment.");
    // No claim that a POS is already live or that anything is switched on today.
    expect(html).not.toMatch(/POS is (now )?(live|active)/i);
  });

  it("leaves the AFTERCALL plan cards and their checkout exactly as they were", async () => {
    const html = await renderHome();

    for (const name of [
      "Monthly — KES 149/month",
      "Annual — KES 999/year",
      "AI Business Front Desk — KES 499/month",
      "Interactive Business — KES 999/month",
    ]) {
      expect(html, name).toContain(name);
    }
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).toContain(">KES 149<");
    expect(html).toContain(">KES 999<");
    expect(html).toContain("Get my business page");
    expect(html).toContain('href="/register"');
    expect(html).toContain("Secure Paystack checkout. Your plan starts once payment is confirmed.");

    // The private POS plan is still filtered out of the card list.
    expect(html).not.toContain("JATA AFTERCALL — Business POS");
    expect(source()).toContain("publiclyListedPlans");
  });

  it("keeps the page's landmark structure and responsive markup", async () => {
    const html = await renderHome();
    const page = source();

    expect(page).toContain('<main id="main">');
    expect(html).toContain('<main id="main">');
    expect(page).toContain('className="mx-auto max-w-6xl px-4 pb-10 sm:px-6"');
    // The entry stacks on a phone and spreads out from the small breakpoint up, like its siblings.
    expect(page).toContain("sm:flex sm:items-center sm:gap-5");
    expect(page).toContain("sm:w-60 sm:shrink-0");
    expect(html).toContain('aria-labelledby="business-pos-heading"');
    expect(html).toContain("<h3");
    // The icon is inline SVG in the house palette — no image request, no icon dependency.
    expect(page).toContain("<svg");
    expect(page).toContain("bg-amber-50");
    expect(page).not.toContain("<img");
  });

  it("points at the existing POS flow only — no second POS route", async () => {
    const hrefs = [...source().matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.filter((href) => /pos/i.test(href))).toEqual(["/dashboard/pos"]);
  });

  it("still renders when the database is unavailable (the existing fallback)", async () => {
    // The plan cards fall back to the seeded pair; the POS entry reads a constant, so it survives.
    const db = await import("@/lib/db");
    const findMany = db.default.planConfig.findMany as unknown as { mockImplementationOnce: (fn: () => Promise<never>) => void };
    findMany.mockImplementationOnce(async () => { throw new Error("offline"); });

    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).toContain("Annual — KES 999/year");
    expect(html).toContain("Business POS");
    expect(html).toContain(`KES ${POS_PLAN_PRICE_KES}/month`);
  });
});

describe("the Business POS entry does not disturb the rest of the landing page", () => {
  it("keeps the hero, how-it-works and demo sections", async () => {
    const html = await renderHome();
    expect(html).toContain("Turn every customer interaction");
    expect(html).toContain("Create your page in ~5 minutes");
    expect(html).toContain("Demo businesses");
    expect(html).toContain('id="demo"');
    expect(html).toContain("Simple pricing");
  });

  it("adds one entry, one heading and one call to action — no second POS surface", async () => {
    const page = source();
    const html = await renderHome();
    expect(page.match(/<section aria-labelledby="business-pos-heading"/g)).toHaveLength(1);
    expect(html.match(/id="business-pos-heading"/g)).toHaveLength(1);
    expect(html.match(/Open Business POS/g)).toHaveLength(1);
    expect(html.match(/href="\/dashboard\/pos"/g)).toHaveLength(1);
  });
});
