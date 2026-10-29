/**
 * The public homepage's JATA Autopilot plan card (Stage C Phase 4).
 *
 * JATA Autopilot shipped as an authenticated dashboard product, but the homepage pricing grid
 * never advertised it: the three Autopilot plan keys are private (`PRIVATE_PLAN_KEYS`, §67) and
 * `homepagePlanCards()` only re-appended the Business POS as a presentation card, so no
 * Autopilot card or icon ever rendered. The standard package (`JATA_AUTOPILOT`, KES 2,499 /
 * 30 days per `AUTOPILOT_PLAN_CATALOG`, the seed and `FALLBACK_PLANS`) is the fourth card of
 * the same grid under the owner-mandated 2026-10-27 homepage order, with the spark mark the
 * workspace already uses for this product.
 *
 * Commercial and security behaviour is unchanged: the card names the product, shows the price
 * the server owns, says the preview is free and live actions start only after Paystack confirms
 * payment, and links into the existing authenticated `/dashboard/autopilot` flow (preview,
 * Command Center and the existing checkout). All three Autopilot keys stay private, so none of
 * them is a payable choice on onboarding, the AFTERCALL subscription screen or checkout lists,
 * and the Pro/Enterprise tiers are never homepage cards.
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
        { id: "plan_pos", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
        { id: "plan_ap", key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
        { id: "plan_ap_pro", key: "JATA_AUTOPILOT_PRO", name: "JATA Autopilot Pro — KES 6,999/month", priceKES: 6999, durationDays: 30, isActive: true },
        { id: "plan_ap_ent", key: "JATA_AUTOPILOT_ENTERPRISE", name: "JATA Autopilot Enterprise — KES 19,999/month", priceKES: 19999, durationDays: 30, isActive: true },
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
import { FALLBACK_PLANS, PRIVATE_PLAN_KEYS, homepagePlanCards, publiclyListedPlans } from "@/lib/pricing";
import { AUTOPILOT_PLAN_CATALOG, assertAutopilotPlanPricing } from "@/lib/autopilot/entitlement";

const root = path.resolve(__dirname, "../..");
const source = () => readFileSync(path.join(root, "app/page.tsx"), "utf8");
const renderHome = async () => renderToStaticMarkup(await HomePage());

const planCards = (html: string) =>
  [...html.matchAll(/<article class="lp-plan"[^>]*data-plan="([A-Z_]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => ({
    key: match[1],
    inner: match[2],
  }));

describe("the homepage renders the standard JATA Autopilot package in the shared pricing grid", () => {
  it("puts JATA Autopilot seventh (last) in the one grid under the 2026-10-29 owner order", async () => {
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
    expect(html.match(/class="lp-plans"/g)).toHaveLength(1);
    expect(html).toContain('data-plan-count="7"');
    expect(html.match(/data-plan="JATA_AUTOPILOT"/g)).toHaveLength(1);
  });

  it("never advertises the Pro or Enterprise tiers on the homepage", async () => {
    const html = await renderHome();
    expect(html).not.toContain('data-plan="JATA_AUTOPILOT_PRO"');
    expect(html).not.toContain('data-plan="JATA_AUTOPILOT_ENTERPRISE"');
    expect(html).not.toContain("Autopilot Pro");
    expect(html).not.toContain("Autopilot Enterprise");
    // Even when the higher tiers are present in the plan list, only the standard package is appended.
    const cards = homepagePlanCards([
      { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
      { key: "JATA_AUTOPILOT_PRO", name: "Pro", priceKES: 6999, durationDays: 30 },
      { key: "JATA_AUTOPILOT_ENTERPRISE", name: "Enterprise", priceKES: 19999, durationDays: 30 },
    ]);
    expect(cards.map((card) => card.key)).toEqual(["MONTHLY", "BUSINESS_POS", "ERP_PRO", "JATA_AUTOPILOT"]);
  });

  it("gives the Autopilot card its product icon and the same structure as every other card", async () => {
    const html = await renderHome();
    const cards = planCards(html);
    const autopilot = cards.find((card) => card.key === "JATA_AUTOPILOT")!;

    for (const part of ["lp-plan__icon", "lp-plan__name", "lp-plan__badge", "lp-plan__price", "lp-plan__period", "lp-plan__blurb", "lp-plan__includes", "lp-plan__cta", "lp-plan__fine"]) {
      expect(autopilot.inner, part).toContain(part);
    }
    // The icon is a real inline SVG (the landing icon system), rendered before the plan name.
    expect(autopilot.inner).toMatch(/lp-plan__icon"[^>]*>\s*<svg/);
    expect(autopilot.inner.indexOf("lp-plan__icon")).toBeLessThan(autopilot.inner.indexOf("lp-plan__name"));
    // Every card renders an icon, so the shared rows stay aligned at every width.
    for (const card of cards) expect(card.inner, card.key).toContain("lp-plan__icon");
    expect(html.match(/lp-plan__icon/g)).toHaveLength(7);
  });

  it("names the standard package, the verified price and the way in", async () => {
    const html = await renderHome();
    const autopilot = planCards(html).find((card) => card.key === "JATA_AUTOPILOT")!;

    expect(autopilot.inner).toContain("JATA Autopilot — KES 2,499/month");
    expect(autopilot.inner).toContain(">KES 2,499<");
    expect(autopilot.inner).toContain("per 30 days");
    expect(autopilot.inner).toContain("30 days access");
    expect(autopilot.inner).toContain("Owner-only add-on");
    expect(autopilot.inner).toContain("Open JATA Autopilot");
    expect(autopilot.inner).toContain('href="/dashboard/autopilot"');
    // The entry links into the existing authenticated flow and nowhere else.
    expect([...autopilot.inner.matchAll(/href="([^"]*)"/g)].map((match) => match[1])).toEqual(["/dashboard/autopilot"]);
    expect(autopilot.inner).not.toContain('href="/register"');
    expect(autopilot.inner).not.toContain("/checkout");
    expect(html.match(/Open JATA Autopilot/g)).toHaveLength(1);
    expect(html.match(/href="\/dashboard\/autopilot"/g)).toHaveLength(1);
  });

  it("describes only verified capability: diagnosis, industry packs and approval-first drafts", async () => {
    const html = await renderHome();
    const autopilot = planCards(html).find((card) => card.key === "JATA_AUTOPILOT")!;

    expect(autopilot.inner).toContain("Business health diagnosis with 15 industry packs");
    expect(autopilot.inner).toContain("approval queue");
    expect(autopilot.inner).toContain("Nothing runs without your approval");
    expect(autopilot.inner).toContain("Preview it free in your dashboard before you pay");
    // No promise of live customer messaging or autonomous sending.
    expect(autopilot.inner).not.toMatch(/sends? (whatsapp|sms|messages?)/i);
    expect(html).not.toMatch(/Autopilot is (now )?(live|active)/i);
  });

  it("says the preview is free and live actions start only after confirmed payment", async () => {
    const html = await renderHome();
    const autopilot = planCards(html).find((card) => card.key === "JATA_AUTOPILOT")!;
    expect(autopilot.inner).toContain("The preview is free; live actions switch on only once Paystack confirms the payment.");
    expect(autopilot.inner).toContain("It is owner-only");
  });
});

describe("the Autopilot price on the homepage is the authoritative server-side one", () => {
  it("agrees across the entitlement catalog, the fallback rows and the seed — KES 2,499 / 30 days", () => {
    const catalog = AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT;
    expect(catalog).toMatchObject({ key: "JATA_AUTOPILOT", tier: "STANDARD", name: "JATA Autopilot", priceKES: 2499, durationDays: 30 });

    const fallback = FALLBACK_PLANS.find((plan) => plan.key === "JATA_AUTOPILOT")!;
    expect(fallback).toMatchObject({ priceKES: 2499, durationDays: 30 });
    // The fallback row itself satisfies the server-side pricing guard used at checkout.
    expect(assertAutopilotPlanPricing(fallback)).toEqual({ ok: true });

    const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
    expect(seed).toContain('{ key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30 }');
  });

  it("shows the stored plan row rather than a number written into the page", async () => {
    const page = source();
    expect(page).toContain("homepagePlanCards");
    expect(page).not.toMatch(/2499|2,499/);
    // The standard package name is not written into the page either; it comes from the plan row.
    expect(page).not.toContain("JATA Autopilot — KES");
  });

  it("still renders the card from the canonical row when the database is unavailable", async () => {
    const db = await import("@/lib/db");
    const findMany = db.default.planConfig.findMany as unknown as { mockImplementationOnce: (fn: () => Promise<never>) => void };
    findMany.mockImplementationOnce(async () => {
      throw new Error("offline");
    });

    const html = renderToStaticMarkup(await HomePage());
    const autopilot = planCards(html).find((card) => card.key === "JATA_AUTOPILOT")!;
    expect(autopilot).toBeTruthy();
    expect(autopilot.inner).toContain("JATA Autopilot — KES 2,499/month");
    expect(autopilot.inner).toContain(">KES 2,499<");
    expect(autopilot.inner).toContain('href="/dashboard/autopilot"');
  });
});

describe("the Autopilot card does not weaken any purchase boundary", () => {
  it("keeps every Autopilot key out of the payable plan lists", () => {
    for (const key of ["JATA_AUTOPILOT", "JATA_AUTOPILOT_PRO", "JATA_AUTOPILOT_ENTERPRISE"]) {
      expect(PRIVATE_PLAN_KEYS, key).toContain(key);
    }
    expect(
      publiclyListedPlans([
        { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
        { key: "JATA_AUTOPILOT", name: "Autopilot", priceKES: 2499, durationDays: 30 },
      ]).map((plan) => plan.key),
    ).toEqual(["MONTHLY"]);
    for (const file of ["app/onboarding/page.tsx", "app/dashboard/subscription/page.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).toContain("publiclyListedPlans");
    }
    expect(source()).not.toMatch(/href="\/checkout[^"]*JATA_AUTOPILOT/);
  });

  it("is gated by the existing server-side sign-in redirect, like the POS", () => {
    const route = readFileSync(path.join(root, "app/dashboard/autopilot/page.tsx"), "utf8");
    expect(route).toContain('if (!session) redirect("/login")');
  });

  it("leaves the other five plans, their prices and their destinations untouched", async () => {
    const html = await renderHome();
    const cards = planCards(html);
    for (const key of ["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]) {
      expect(cards.find((card) => card.key === key)!.inner, key).toContain('href="/register"');
    }
    expect(cards.find((card) => card.key === "BUSINESS_POS")!.inner).toContain('href="/dashboard/pos"');
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).toContain("Annual — KES 999/year");
    expect(html).toContain("AI Business Front Desk — KES 499/month");
    expect(html).toContain("Website Studio — KES 999/month");
    expect(html).toContain("Open Business POS");
  });
});
