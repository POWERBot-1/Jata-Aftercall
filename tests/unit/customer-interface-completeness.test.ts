/**
 * Customer interface completion — the complete approved package family must be discoverable
 * throughout the actual customer journey, not only on `/products`:
 *
 *   • Homepage: the four AI Front Desk 2.0 tiers render inside the pricing experience, with a
 *     route to the full `/products` catalogue.
 *   • `/pricing`: every approved package — including Standard, Pro and Voice — with approved
 *     prices and honest availability; owner-only products stay labelled as separate products.
 *   • `/dashboard/subscription` (authenticated): a top-of-page navigation action jumps to the
 *     complete catalogue, and the catalogue section carries all four tiers.
 *
 * Rendered in four PlanConfig states — empty (database unreachable), partial (the seven
 * owner rows only), complete (+ the three missing tier rows) and mismatch (tier rows present
 * but out of spec, which checkout refuses) — so visibility never depends on a stored row and
 * no surface ever advertises a price checkout would refuse. Voice must read provider-gated in
 * EVERY state, no surface may render a `/checkout` link from a family card, and every
 * `/products/*` destination must exist.
 *
 * Nothing here writes data or starts a payment: presentation contracts only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  session: null as null | { userId: string; role: string },
  plans: [] as Array<Record<string, unknown>>,
  plansFail: false,
  businesses: [] as Array<Record<string, unknown>>,
  payments: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({
  default: {
    planConfig: {
      findMany: vi.fn(async () => {
        if (state.plansFail) throw new Error("database unavailable");
        return state.plans;
      }),
    },
    business: { findMany: vi.fn(async () => state.businesses) },
    payment: { findMany: vi.fn(async () => state.payments) },
    posSubscription: { findUnique: vi.fn(async () => null) },
    erpSubscription: { findUnique: vi.fn(async () => null) },
    autopilotSubscription: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => state.session),
  requireSession: vi.fn(async () => state.session),
  SESSION_COOKIE_NAME: "jata_session",
}));

import HomePage from "@/app/page";
import PricingPage from "@/app/pricing/page";
import SubscriptionPage from "@/app/dashboard/subscription/page";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const OWNER_ROWS = [
  { id: "p1", key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30, isActive: true },
  { id: "p2", key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365, isActive: true },
  { id: "p3", key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p4", key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  { id: "p5", key: "BUSINESS_POS", name: "JATA AFTERCALL — Business POS — KES 499/month", priceKES: 499, durationDays: 30, isActive: true },
  { id: "p6", key: "ERP_PRO", name: "JATA BOS PRO", priceKES: 3000, durationDays: 30, isActive: true },
  { id: "p7", key: "JATA_AUTOPILOT", name: "JATA Autopilot — KES 2,499/month", priceKES: 2499, durationDays: 30, isActive: true },
];

/** The three tier rows production was missing — the "complete" PlanConfig state. */
const TIER_ROWS = [
  { id: "p8", key: "AI_FRONT_DESK_STANDARD", name: "Front Desk Standard — KES 999/month", priceKES: 999, durationDays: 30, isActive: true },
  { id: "p9", key: "AI_FRONT_DESK_PRO", name: "Front Desk Pro — KES 1,999/month", priceKES: 1999, durationDays: 30, isActive: true },
  { id: "p10", key: "AI_FRONT_DESK_VOICE", name: "Front Desk Voice — KES 3,999/month", priceKES: 3999, durationDays: 30, isActive: true },
];

const TIER_ORDER = ["AI_BUSINESS_FRONT_DESK", "AI_FRONT_DESK_STANDARD", "AI_FRONT_DESK_PRO", "AI_FRONT_DESK_VOICE"];
const TIER_PRICES = ["KES 499 / 30 days", "KES 999 / 30 days", "KES 1,999 / 30 days", "KES 3,999 / 30 days"];
/** Approved price strings per tier (workspace cards render amount and period separately). */
const TIER_APPROVED: Record<string, string> = {
  AI_BUSINESS_FRONT_DESK: "499",
  AI_FRONT_DESK_STANDARD: "999",
  AI_FRONT_DESK_PRO: "1,999",
  AI_FRONT_DESK_VOICE: "3,999",
};

type StateName = "empty" | "partial" | "complete" | "mismatch";
const applyState = (name: StateName) => {
  if (name === "empty") {
    state.plansFail = true;
    state.plans = [];
  } else if (name === "partial") {
    state.plansFail = false;
    state.plans = [...OWNER_ROWS];
  } else if (name === "mismatch") {
    // Tier rows exist but violate the approved price/term (fail-closed PLAN_PRICING_INVALID):
    // no surface may advertise the out-of-spec stored price next to the family block.
    state.plansFail = false;
    state.plans = [
      ...OWNER_ROWS,
      { id: "p8", key: "AI_FRONT_DESK_STANDARD", name: "Front Desk Standard", priceKES: 900, durationDays: 30, isActive: true },
      { id: "p9", key: "AI_FRONT_DESK_PRO", name: "Front Desk Pro", priceKES: 2500, durationDays: 30, isActive: true },
      { id: "p10", key: "AI_FRONT_DESK_VOICE", name: "Front Desk Voice", priceKES: 3999, durationDays: 365, isActive: true },
    ];
  } else {
    state.plansFail = false;
    state.plans = [...OWNER_ROWS, ...TIER_ROWS];
  }
  // Public surfaces render as a signed-out visitor with no demo businesses; the
  // subscription describe below adds the authenticated owner before rendering.
  state.session = null;
  state.businesses = [];
  state.payments = [];
};
const STATES: StateName[] = ["empty", "partial", "complete", "mismatch"];

/** The authenticated subscription journey: a signed-in owner with one business. */
const applyOwner = () => {
  state.session = { userId: "user_owner", role: "OWNER" };
  state.businesses = [
    {
      id: "biz_owned",
      name: "Biashara Ltd",
      slug: "biashara-ltd",
      category: "Retail",
      subscription: { status: "ACTIVE", planId: "p1", expiresAt: new Date("2026-12-31T00:00:00Z"), plan: { name: "Monthly — KES 149/month" } },
    },
  ];
};

const renderHome = async () => renderToStaticMarkup(await HomePage());
const renderPricing = async () => renderToStaticMarkup(await PricingPage());
const renderSubscription = async () => {
  applyOwner();
  return renderToStaticMarkup(await SubscriptionPage({ searchParams: Promise.resolve({}) } as any));
};

/** Family cards only — `data-tier` articles (the plan grid keeps `data-plan`). */
const tierCards = (html: string) =>
  [...html.matchAll(/<article[^>]*data-tier="([A-Z_]+)"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => ({
    key: match[1],
    inner: match[2],
  }));

/** Inner markup of the first plan card (grid/payable/catalogue) carrying `data-plan="key"`. */
const planCardInner = (html: string, key: string): string | null => {
  const match = html.match(new RegExp(`<article[^>]*data-plan="${key}"[^>]*>([\\s\\S]*?)<\\/article>`));
  return match ? match[1] : null;
};

/** Every /products/* destination used by a rendered page must exist in the detail route. */
const assertDetailDestinations = (label: string, html: string) => {
  const detail = read("app/products/[slug]/page.tsx");
  const known = new Set([...detail.matchAll(/^  "([a-z-]+)": \{$/gm)].map((match) => match[1]));
  const hrefs = [...html.matchAll(/href="(\/products\/[a-z-]+)(#[a-z]+)?"/g)].map((match) => match[1]);
  expect(hrefs.length, `${label} should link to product details`).toBeGreaterThan(0);
  for (const href of hrefs) {
    const slug = href.replace("/products/", "");
    expect(known.has(slug), `${label}: ${href} must resolve to a detail page`).toBe(true);
  }
};

describe("homepage: the four AI Front Desk tiers live in the pricing experience", () => {
  for (const name of STATES) {
    it(`renders the complete family with honest availability (${name} PlanConfig state)`, async () => {
      applyState(name);
      const html = await renderHome();

      const cards = tierCards(html);
      expect(cards.map((card) => card.key)).toEqual(TIER_ORDER);
      for (const price of TIER_PRICES) expect(html, price).toContain(price);

      // Availability is honest in every state: Voice is always provider-gated, and a tier
      // only reads active when its price-matched row actually exists.
      const voice = cards.find((card) => card.key === "AI_FRONT_DESK_VOICE")!;
      expect(voice.inner).toContain("Awaiting provider activation — not for sale");
      const starter = cards.find((card) => card.key === "AI_BUSINESS_FRONT_DESK")!;
      const standard = cards.find((card) => card.key === "AI_FRONT_DESK_STANDARD")!;
      const pro = cards.find((card) => card.key === "AI_FRONT_DESK_PRO")!;
      // Starter's own row exists in partial and complete states; the tier rows only in complete.
      if (name === "empty") {
        expect(starter.inner).toContain("Awaiting catalogue activation — not for sale");
      } else {
        expect(starter.inner).toContain("Active in the server catalogue");
      }
      const tierStatus = name === "complete" ? "Active in the server catalogue" : "Awaiting catalogue activation — not for sale";
      expect(standard.inner).toContain(tierStatus);
      expect(pro.inner).toContain(tierStatus);

      // Out-of-spec stored tier rows (fail-closed PLAN_PRICING_INVALID): the grid must show
      // the approved price, never the refused stored price, so the grid and the family block
      // on the same page can never print conflicting prices (Codex P2 on PR #88).
      if (name === "mismatch") {
        const gridPro = planCardInner(html, "AI_FRONT_DESK_PRO");
        const gridStandard = planCardInner(html, "AI_FRONT_DESK_STANDARD");
        expect(gridPro, "grid renders the Pro tier card").not.toBeNull();
        expect(gridStandard, "grid renders the Standard tier card").not.toBeNull();
        expect(gridPro!).toContain("KES 1,999");
        expect(gridStandard!).toContain("KES 999");
        // The refused stored price must appear on neither the grid card nor the family card
        // (page-level absence is not asserted: the hero demo carries unrelated sample prices).
        expect(gridPro!).not.toContain("2,500");
        expect(pro.inner).not.toContain("2,500");
        expect(gridStandard!).not.toContain("900");
        expect(standard.inner).not.toContain("900");
      }

      // Discoverability and safety on the homepage itself.
      expect(html).toContain('href="/products"');
      expect(html).toContain('id="ai-front-desk-tiers"');
      expect(html).toContain('href="/products/ai-front-desk#voice"');
      expect(html).not.toContain("/checkout");
      expect(html).not.toContain("Autopilot Pro");
      expect(html).not.toContain("Autopilot Enterprise");
      // Owner-only products keep their workspace destinations, never an ordinary purchase path.
      expect(html).toContain('href="/dashboard/pos"');
      expect(html).toContain('href="/products/erp-pro"');
      expect(html).toContain('href="/dashboard/autopilot"');
      assertDetailDestinations("homepage", html);
    });
  }
});

describe("/pricing: every approved package with authoritative prices and honest availability", () => {
  for (const name of STATES) {
    it(`lists the family beside the seven marketing cards (${name} PlanConfig state)`, async () => {
      applyState(name);
      const html = await renderPricing();

      const cards = tierCards(html);
      expect(cards.map((card) => card.key)).toEqual(TIER_ORDER);
      for (const price of TIER_PRICES) expect(html, price).toContain(price);

      const voice = cards.find((card) => card.key === "AI_FRONT_DESK_VOICE")!;
      expect(voice.inner).toContain("Awaiting provider activation — not for sale");
      expect(voice.inner).toContain("Not yet for sale");
      expect(voice.inner).toContain('href="/products/ai-front-desk#voice"');

      const standard = cards.find((card) => card.key === "AI_FRONT_DESK_STANDARD")!;
      const pro = cards.find((card) => card.key === "AI_FRONT_DESK_PRO")!;
      if (name === "complete") {
        expect(standard.inner).toContain("Active in the server catalogue");
        expect(pro.inner).toContain("Active in the server catalogue");
      } else {
        expect(standard.inner).toContain("Awaiting catalogue activation — not for sale");
        expect(standard.inner).toContain("Not yet for sale");
        expect(pro.inner).toContain("Awaiting catalogue activation — not for sale");
      }

      // Out-of-spec stored tier rows: the marketing grid must show the approved price so it
      // cannot conflict with the family block below (Codex P2 on PR #88).
      if (name === "mismatch") {
        const gridPro = planCardInner(html, "AI_FRONT_DESK_PRO");
        expect(gridPro, "grid renders the Pro tier card").not.toBeNull();
        expect(gridPro!).toContain("KES 1,999");
        expect(gridPro!).not.toContain("2,500");
        expect(pro.inner).not.toContain("2,500");
        expect(planCardInner(html, "AI_FRONT_DESK_STANDARD")!).not.toContain("900");
        expect(standard.inner).not.toContain("900");
      }

      // The seven marketing cards remain, owner order intact, and the ordinary/separate
      // distinction is explicit.
      expect(html.match(/data-plan="/g)!.length).toBeGreaterThanOrEqual(7);
      expect(html).toContain('data-plan="ERP_PRO"');
      expect(html).toContain("Separate product · purchased in the Business POS workspace");
      expect(html).toContain("Separate product · purchased in the ERP workspace");
      expect(html).toContain("Separate product · purchased in the Autopilot workspace");
      expect(html).toContain("Subscription · pay from your dashboard");
      expect(html).toContain("Showing an offer never activates it");

      // No family card may imply a checkout that is not actually available.
      for (const card of cards) expect(card.inner, card.key).not.toContain("/checkout");
      expect(html).not.toContain("Autopilot Pro");
      expect(html).not.toContain("Autopilot Enterprise");
      assertDetailDestinations("/pricing", html);
    });
  }
});

describe("/dashboard/subscription: the complete catalogue is reachable from the top", () => {
  for (const name of STATES) {
    it(`offers a top navigation action and the full family (${name} PlanConfig state)`, async () => {
      applyState(name);
      const html = await renderSubscription();

      // Requirement: a clear link/action near the top of the page → the complete catalogue.
      expect(html).toContain('href="#catalogue"');
      expect(html).toContain('id="catalogue"');
      expect(html).toContain("Every JATA AFTERCALL offer");

      const cards = tierCards(html);
      expect(cards.map((card) => card.key)).toEqual(TIER_ORDER);
      // Workspace cards render the approved amount and term as separate spans.
      for (const card of cards) {
        expect(card.inner, card.key).toContain(`KES ${TIER_APPROVED[card.key]}`);
        expect(card.inner, card.key).toContain("per 30 days");
      }

      const voice = cards.find((card) => card.key === "AI_FRONT_DESK_VOICE")!;
      expect(voice.inner).toContain("Awaiting provider activation — not for sale");
      expect(voice.inner).toContain('href="/products/ai-front-desk#voice"');
      for (const card of cards) expect(card.inner, card.key).not.toContain("/checkout");

      const standard = cards.find((card) => card.key === "AI_FRONT_DESK_STANDARD")!;
      const pro = cards.find((card) => card.key === "AI_FRONT_DESK_PRO")!;
      if (name === "complete") {
        expect(standard.inner).toContain("Active in the server catalogue");
      } else {
        expect(standard.inner).toContain("Awaiting catalogue activation — not for sale");
      }

      // Out-of-spec stored tier rows: neither the payable list nor the catalogue may show a
      // price checkout refuses while the family block shows the approved one (Codex P2).
      if (name === "mismatch") {
        const catPro = planCardInner(html, "AI_FRONT_DESK_PRO");
        expect(catPro, "catalogue/payable renders the Pro card").not.toBeNull();
        expect(catPro!).toContain("KES 1,999");
        expect(catPro!).not.toContain("2,500");
        expect(pro.inner).not.toContain("2,500");
        expect(planCardInner(html, "AI_FRONT_DESK_STANDARD")!).not.toContain("900");
        expect(standard.inner).not.toContain("900");
      }

      // Ordinary vs owner-only stays explicit, and owner products never become checkout choices.
      expect(html).toContain("Page plan · ordinary subscription");
      expect(html).toContain("Separate product · bought in its own workspace");
      expect(html).toContain("an offer here is not a subscription");
      expect(html).not.toContain("Autopilot Pro");
      expect(html).not.toContain("Autopilot Enterprise");

      // The catalogue grid itself keeps every marketing card (voice stays excluded there).
      expect(html.match(/data-plan="/g)!.length).toBeGreaterThanOrEqual(7);
      assertDetailDestinations("subscription", html);
    });
  }
});

describe("cross-surface contracts", () => {
  it("every owner workspace destination used by the three surfaces exists as a route", () => {
    expect(existsSync(path.join(root, "app/dashboard/pos/page.tsx"))).toBe(true);
    expect(existsSync(path.join(root, "app/dashboard/autopilot/page.tsx"))).toBe(true);
    expect(existsSync(path.join(root, "app/dashboard/erp/[businessId]/page.tsx"))).toBe(true);
    expect(existsSync(path.join(root, "app/products/page.tsx"))).toBe(true);
    expect(existsSync(path.join(root, "app/dashboard/subscription/page.tsx"))).toBe(true);
  });

  it("the family status vocabulary stays single-sourced in lib/productCatalogue", () => {
    const source = read("lib/productCatalogue.ts");
    expect(source).toContain("export function frontDeskFamilyCard");
    // All three surfaces build their family through the shared helper and normalise tier
    // display prices through the shared rule, so grid and family can never disagree.
    for (const file of ["app/page.tsx", "app/pricing/page.tsx", "app/dashboard/subscription/page.tsx"]) {
      expect(read(file), file).toContain("frontDeskFamilyCard(");
      expect(read(file), file).toContain("FRONT_DESK_TIER_KEYS.map");
      expect(read(file), file).toContain("displayTierPricing(");
    }
    // Paystack / entitlement protections are untouched by these surfaces.
    expect(read("app/pricing/page.tsx")).not.toMatch(/prisma\.\w+\.(create|update|upsert|delete)/);
    expect(read("app/dashboard/subscription/page.tsx")).not.toMatch(
      /prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
    );
  });
});
