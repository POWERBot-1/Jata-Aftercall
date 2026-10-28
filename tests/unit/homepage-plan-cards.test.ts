/**
 * Production audit 2026-10-04 — the public plan cards.
 *
 * 1. Production rendered "AI Business Front Desk � KES 499/month" and "Interactive Business �
 *    KES 999/month": the stored plan names carried U+FFFD. Known plans now fall back to their
 *    canonical name when the stored one is corrupt; correct stored names are shown untouched.
 * 2. When the plan read failed the page fell back to Monthly and Annual only, silently dropping
 *    two advertised products. The fallback now lists every advertised plan.
 *
 * 2026-10-27 owner order: six cards in one grid — Monthly, Annual, AI Business Front Desk,
 * JATA Autopilot, Website Studio, Business POS (last). The POS and Autopilot are still never
 * payable plan choices (§67).
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
  // Owner-mandated 2026-10-27 sequence: Monthly, Annual, AI Front Desk, Autopilot, Website Studio, POS.
  const expectedOrder = ["Monthly — KES 149/month", "Annual — KES 999/year", "AI Business Front Desk — KES 499/month", "JATA Autopilot — KES 2,499/month", "Website Studio — KES 999/month", "JATA AFTERCALL — Business POS"];
  const assertOrder = (html: string) => {
    const positions = expectedOrder.map((name) => html.indexOf(name));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // All six cards live in the one grid, and the POS has no separate heading of its own.
    const grid = html.slice(html.indexOf('class="lp-plans"'), html.indexOf('class="lp-pricing__note"'));
    for (const name of expectedOrder) expect(grid, name).toContain(name);
    expect(html).not.toContain('id="business-pos-heading"');
    expect(html.match(/class="lp-plan"/g)).toHaveLength(6);
    expect(html).not.toContain(">Interactive Business<");
  };

  it("orders database-backed cards Monthly → Annual → AI Front Desk → JATA Autopilot → Website Studio → Business POS in one grid", async () => {
    state.fail = false;
    state.rows = [
      { key: "AI_BUSINESS_FRONT_DESK", name: expectedOrder[2], priceKES: 499, durationDays: 30 },
      { key: "JATA_AUTOPILOT", name: expectedOrder[3], priceKES: 2499, durationDays: 30 },
      { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30 },
      { key: "MONTHLY", name: expectedOrder[0], priceKES: 149, durationDays: 30 },
      { key: "ANNUAL", name: expectedOrder[1], priceKES: 999, durationDays: 365 },
      { key: "BUSINESS_POS", name: expectedOrder[5], priceKES: 499, durationDays: 30 },
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
    expect(html).toContain("Annual — KES 999/year");
    // The price shown is always the stored price, never the name's text.
    expect(html).toContain(">KES 499<");
    // The POS card shows the stored name as-is rather than a price written into the page.
    expect(html).toContain("JATA AFTERCALL — Business POS");
  });

  it("falls back to all six advertised plans when plans cannot be read", async () => {
    state.fail = true;
    const html = await render();
    state.fail = false;
    for (const name of ["Monthly — KES 149/month", "AI Business Front Desk — KES 499/month", "Annual — KES 999/year", "Website Studio — KES 999/month"]) {
      expect(html, name).toContain(name);
    }
    // The POS and JATA Autopilot cards are filled from their canonical plan rows, with their own CTAs.
    expect(html).toContain("JATA AFTERCALL — Business POS");
    expect(html).toContain("Open Business POS");
    expect(html).toContain('href="/dashboard/pos"');
    expect(html).toContain("JATA Autopilot — KES 2,499/month");
    expect(html).toContain("Open JATA Autopilot");
    expect(html).toContain('href="/dashboard/autopilot"');
    expect(html.match(/class="lp-plan"/g)).toHaveLength(6);
  });

  it("advertises all six plans in one list in the 2026-10-27 owner order, with Business POS last", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "JATA_AUTOPILOT",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
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
    expect(cards.map((card) => card.priceKES)).toEqual([149, 999, 499, 2499, 999, 499]);
    expect(cards.map((card) => card.durationDays)).toEqual([30, 365, 30, 30, 30, 30]);
    // The POS and Autopilot are in the grid but still not publicly listed (payable) plans.
    expect(publiclyListedPlans(cards).map((card) => card.key)).not.toContain("BUSINESS_POS");
    expect(publiclyListedPlans(cards).map((card) => card.key)).not.toContain("JATA_AUTOPILOT");
  });

  it("fills the owner-only slots from the canonical plan rows when the POS and Autopilot rows are missing", () => {
    const cards = homepagePlanCards([
      { key: "MONTHLY", name: "Monthly", priceKES: 149, durationDays: 30 },
      { key: "ANNUAL", name: "Annual", priceKES: 999, durationDays: 365 },
    ]);
    const canonical = FALLBACK_PLANS.find((plan) => plan.key === "BUSINESS_POS")!;
    const canonicalAutopilot = FALLBACK_PLANS.find((plan) => plan.key === "JATA_AUTOPILOT")!;
    expect(cards.map((card) => card.key)).toEqual(["MONTHLY", "ANNUAL", "JATA_AUTOPILOT", "BUSINESS_POS"]);
    expect(cards[3]).toMatchObject({ priceKES: canonical.priceKES, durationDays: canonical.durationDays });
    expect(cards[3].priceKES).toBe(499);
    expect(cards[3].durationDays).toBe(30);
    expect(cards[2]).toMatchObject({ priceKES: canonicalAutopilot.priceKES, durationDays: canonicalAutopilot.durationDays });
    expect(cards[2].priceKES).toBe(2499);
    expect(cards[2].durationDays).toBe(30);
  });
});
