/**
 * Production audit 2026-10-04 — the public plan cards.
 *
 * 1. Production rendered "AI Business Front Desk � KES 499/month" and "Interactive Business �
 *    KES 999/month": the stored plan names carried U+FFFD. Known plans now fall back to their
 *    canonical name when the stored one is corrupt; correct stored names are shown untouched.
 * 2. When the plan read failed the page fell back to Monthly and Annual only, silently dropping
 *    two advertised products. The fallback now lists every advertised plan.
 *
 * Current homepage presentation: six cards in one grid — Monthly Business Page, AI Business Front Desk,
 * Website Studio, Business POS, JATA BOS PRO (ERP_PRO, marketing surface only), JATA Autopilot.
 * Annual Business Page remains available from the Business Page details and /pricing, not the homepage.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ rows: null as null | Array<Record<string, unknown>>, fail: false }));

vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findMany: vi.fn(async () => {
        if (state.fail) throw new Error("offline");
        return state.rows ?? [];
      }),
    },
  },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => null),
  requireSession: vi.fn(async () => null),
  SESSION_COOKIE_NAME: "jata_session",
}));

import HomePage from "@/app/page";
import { FALLBACK_PLANS, HOMEPAGE_PLAN_ORDER, homepagePlanCards, orderHomepagePlans, planDisplayName, publiclyListedPlans } from "@/lib/pricing";

const render = async () => renderToStaticMarkup(await HomePage());

describe("planDisplayName", () => {
  it("brands the stable INTERACTIVE_BUSINESS product as Website Studio even for healthy legacy stored names", () => {
    expect(planDisplayName({ key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month" }))
      .toBe("Website Studio — KES 999/month");
    expect(planDisplayName({ key: "INTERACTIVE_BUSINESS", name: "Old marketing name" }))
      .toBe("Website Studio — KES 999/month");
  });
  it("shows a healthy stored name exactly as written", () => {
    expect(planDisplayName({ key: "MONTHLY", name: "Monthly — KES 149/month" })).toBe("Monthly — KES 149/month");
    expect(planDisplayName({ key: "PROMO", name: "Promo — KES 499/year" })).toBe("Promo — KES 499/year");
  });

  it("falls back to the canonical name when the stored one is corrupt or blank", () => {
    expect(planDisplayName({ key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk \uFFFD KES 499/month" })).toBe("AI Business Front Desk — KES 499/month");
    expect(planDisplayName({ key: "INTERACTIVE_BUSINESS", name: "Interactive Business \uFFFD KES 999/month" })).toBe("Website Studio — KES 999/month");
    expect(planDisplayName({ key: "ANNUAL", name: "" })).toBe("Annual — KES 999/year");
  });

  it("never emits U+FFFD for an unknown plan with a corrupt name", () => {
    const shown = planDisplayName({ key: "PROMO", name: "Promo \uFFFD KES 499" });
    expect(shown).not.toContain("\uFFFD");
    expect(shown).toContain("Promo");
  });
});

describe("homepage plan cards", () => {
  // Homepage hides the annual Business Page card; both billing options remain on its detail page.
  const expectedOrder = ["Monthly — KES 149/month", "AI Business Front Desk — KES 499/month", "Website Studio — KES 999/month", "JATA AFTERCALL — Business POS", "JATA BOS PRO", "JATA Autopilot — KES 2,499/month"];
  const assertOrder = (html: string) => {
    const positions = expectedOrder.map((name) => html.indexOf(name));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // All six visible cards live in one grid; Annual is intentionally not on the homepage.
    const grid = html.slice(html.indexOf('class="lp-plans"'), html.indexOf('class="lp-pricing__note"'));
    for (const name of expectedOrder) expect(grid, name).toContain(name);
    expect(grid).not.toContain('data-plan="ANNUAL"');
    const monthly = grid.match(/<article class="lp-plan"[^>]*data-plan="MONTHLY"[^>]*>([\\s\\S]*?)<\\/article>/)?.[1] ?? "";
    expect(monthly).toContain('href="/products/business-page"');
    expect(html).not.toContain('id="business-pos-heading"');
    expect(html.match(/class="lp-plan"/g)).toHaveLength(6);
    expect(html).not.toContain(">Interactive Business<");
  };

  it("orders the visible homepage cards Monthly → AI Front Desk → Website Studio → Business POS → JATA BOS PRO → JATA Autopilot in one grid", async () => {
    state.fail = false;
    state.rows = [
      { key: "AI_BUSINESS_FRONT_DESK", name: expectedOrder[1], priceKES: 499, durationDays: 30 },
      { key: "JATA_AUTOPILOT", name: expectedOrder[5], priceKES: 2499, durationDays: 30 },
      { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30 },
      { key: "MONTHLY", name: expectedOrder[0], priceKES: 149, durationDays: 30 },
      { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365 },
      { key: "BUSINESS_POS", name: expectedOrder[3], priceKES: 499, durationDays: 30 },
      { key: "ERP_PRO", name: "POS / ERP - PRO", priceKES: 3000, durationDays: 30 },
    ];
    assertOrder(await render());
  });

  it("keeps the same required order on a database failure", async () => {
    state.fail = true;
    try { assertOrder(await render()); } finally { state.fail = false; }
  });

  it("marketing sorting does not mutate input or replace server-derived IDs/prices/durations", () => {
    const input = [
      { id: "annual-stored", key: "ANNUAL", priceKES: 999, durationDays: 365 },
      { id: "monthly-stored", key: "MONTHLY", priceKES: 149, durationDays: 30 },
    ];
    const before = structuredClone(input);
    const sorted = orderHomepagePlans(input);
    expect(input).toEqual(before);
    expect(sorted).toEqual([input[1], input[0]]);
    expect(sorted[0]).toBe(input[1]);
  });
  it("renders no replacement characters and keeps every price when stored names are corrupt", async () => {
    state.fail = false;
    state.rows = [
      { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
      { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk \uFFFD KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
      { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
      { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business \uFFFD KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
      { id: "pp", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30, isActive: true },
    ];
    const html = await render();
    expect(html).not.toContain("\uFFFD");
    expect(html).toContain("AI Business Front Desk — KES 499/month");
    expect(html).toContain("Website Studio — KES 999/month");
    expect(html).toContain("Monthly — KES 149/month");
    expect(html).not.toContain('data-plan="ANNUAL"');
    // The price shown is always the stored price, never the name's text.
    expect(html).toContain(">KES 499<");
    // The POS card shows the stored name as-is rather than a price written into the page.
    expect(html).toContain("JATA AFTERCALL — Business POS");
  });

  it("falls back to the six visible homepage offers when plans cannot be read", async () => {
    state.fail = true;
    const html = await render();
    state.fail = false;
    for (const name of ["Monthly — KES 149/month", "AI Business Front Desk — KES 499/month", "Website Studio — KES 999/month"]) {
      expect(html, name).toContain(name);
    }
    // The POS, BOS PRO and JATA Autopilot cards are filled from their canonical fallback rows,
    // with their own CTAs.
    expect(html).toContain("JATA AFTERCALL — Business POS");
    expect(html).toContain("Open Business POS");
    expect(html).toContain('href="/dashboard/pos"');
    expect(html).toContain("JATA BOS PRO");
    expect(html).toContain("Explore JATA BOS PRO");
    expect(html).toContain('href="/products/erp-pro"');
    expect(html).toContain("JATA Autopilot — KES 2,499/month");
    expect(html).toContain("Open JATA Autopilot");
    expect(html).toContain('href="/dashboard/autopilot"');
    expect(html.match(/class="lp-plan"/g)).toHaveLength(6);
  });

  it("retains all seven catalogue offers for /pricing and the subscription catalogue", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
      "ERP_PRO",
      "JATA_AUTOPILOT",
    ]);
    const input = [
      { key: "JATA_AUTOPILOT", name: "JATA Autopilot", priceKES: 2499, durationDays: 30 },
      { key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS", priceKES: 499, durationDays: 30 },
      { key: "INTERACTIVE_BUSINESS", name: "Website Studio", priceKES: 999, durationDays: 30 },
      { key: "ANNUAL", name: "Annual", priceKES: 999, durationDays: 365 },
      { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk", priceKES: 499, durationDays: 30 },
      { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
    ];
    const before = structuredClone(input);
    const cards = homepagePlanCards(input);

    expect(cards.map((card) => card.key)).toEqual([...HOMEPAGE_PLAN_ORDER]);
    // Marketing order only: no stored field is rewritten, and the input list is untouched.
    expect(input).toEqual(before);
    // The BOS PRO slot is filled from its documented fallback (KES 3,000 / 30 days) because the
    // input carries no stored ERP_PRO row; every other card keeps its stored values.
    expect(cards.map((card) => card.priceKES)).toEqual([149, 999, 499, 999, 499, 3000, 2499]);
    expect(cards.map((card) => card.durationDays)).toEqual([30, 365, 30, 30, 30, 30, 30]);
    // The POS, BOS PRO and Autopilot are in the grid but still not publicly listed (payable) plans.
    expect(publiclyListedPlans(cards).map((card) => card.key)).not.toContain("BUSINESS_POS");
    expect(publiclyListedPlans(cards).map((card) => card.key)).not.toContain("ERP_PRO");
    expect(publiclyListedPlans(cards).map((card) => card.key)).not.toContain("JATA_AUTOPILOT");
  });

  it("fills the separate-product slots from the canonical fallback rows when their stored rows are missing", () => {
    const cards = homepagePlanCards([
      { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
      { key: "ANNUAL", name: "Annual", priceKES: 999, durationDays: 365 },
    ]);
    const canonical = FALLBACK_PLANS.find((plan) => plan.key === "BUSINESS_POS")!;
    const canonicalAutopilot = FALLBACK_PLANS.find((plan) => plan.key === "JATA_AUTOPILOT")!;
    expect(cards.map((card) => card.key)).toEqual(["MONTHLY", "ANNUAL", "BUSINESS_POS", "ERP_PRO", "JATA_AUTOPILOT"]);
    expect(cards[2]).toMatchObject({ priceKES: canonical.priceKES, durationDays: canonical.durationDays });
    expect(cards[2].priceKES).toBe(499);
    expect(cards[2].durationDays).toBe(30);
    // The BOS PRO fallback is the documented KES 3,000 / 30 days marketing row.
    expect(cards[3]).toMatchObject({ key: "ERP_PRO", priceKES: 3000, durationDays: 30 });
    expect(cards[4]).toMatchObject({ priceKES: canonicalAutopilot.priceKES, durationDays: canonicalAutopilot.durationDays });
    expect(cards[4].priceKES).toBe(2499);
    expect(cards[4].durationDays).toBe(30);
  });
});
