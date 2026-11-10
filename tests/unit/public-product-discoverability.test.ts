/**
 * Public package discoverability (PR #83 follow-through):
 *
 *   • Catalogue visibility never depends on a PlanConfig row being installed — empty,
 *     partial and full inputs all yield the complete approved grid, with stored rows
 *     winning their own slots and approved canonical prices filling every hole.
 *   • Availability labels are a single source of truth and never claim a package is
 *     sellable without its real catalogue / provider conditions.
 *   • Every /products package action resolves to an existing public destination; nothing
 *     links to a checkout, and the workspace-only Autopilot tiers stay out of the homepage.
 *   • Public navigation exposes /products on desktop and mobile through the one existing
 *     navigation system, plus the marketing header/footer entry points.
 *   • The Vercel ignored-build-step can never cancel a preview again (vercel.json override).
 *
 * Nothing here writes data or starts a payment; these are presentation and configuration
 * contracts only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProductsPage from "@/app/products/page";

// Deterministic render in BOTH environments: this suite pins the no-catalogue-rows state
// (approved constants only, everything honestly "not for sale"), while the DB-backed CI
// jobs exercise the stored-row state on their own. Without this mock the render follows
// whatever database the runner happens to have.
vi.mock("@/lib/db", () => ({
  default: { planConfig: { findMany: async () => [] } },
  prisma: { planConfig: { findMany: async () => [] } },
}));
import {
  buildMarketingCatalogue,
  catalogueCardStatus,
  frontDeskTierStatus,
  isPriceMatchedRow,
  priceMatchedGridKeys,
  CATALOGUE_STATUS,
  VOICE_SELLING_CONDITIONS,
} from "@/lib/productCatalogue";
import { FALLBACK_PLANS, HOMEPAGE_PLAN_ORDER, PRIVATE_PLAN_KEYS } from "@/lib/pricing";
import { AI_FRONT_DESK_VOICE_KEY, FRONT_DESK_TIER_KEYS } from "@/lib/frontDeskTiers";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const row = (key: string, name: string, priceKES: number, durationDays: number) => ({
  key,
  name,
  priceKES,
  durationDays,
});

/** The full approved grid: the owner's seven cards, then the two workspace Autopilot tiers. */
const EXPECTED_GRID_KEYS = [
  ...HOMEPAGE_PLAN_ORDER,
  "JATA_AUTOPILOT_PRO",
  "JATA_AUTOPILOT_ENTERPRISE",
];

const CANONICAL_ROWS = FALLBACK_PLANS.map((plan) =>
  row(plan.key, plan.name, plan.priceKES, plan.durationDays),
);

describe("catalogue visibility survives missing PlanConfig rows", () => {
  it("lists every approved non-family package for empty, partial and full stored input", () => {
    const fixtures: (typeof CANONICAL_ROWS)[] = [
      [],
      [row("MONTHLY", "Monthly — KES 149/month", 149, 30)],
      [
        row("MONTHLY", "Monthly — KES 149/month", 149, 30),
        row("ERP_PRO", "JATA BOS PRO", 3000, 30),
      ],
      CANONICAL_ROWS,
    ];
    for (const stored of fixtures) {
      expect(buildMarketingCatalogue(stored).map((card) => card.key)).toEqual([...EXPECTED_GRID_KEYS]);
    }
  });

  it("prices every hole with the approved canonical constants and lets a stored row win", () => {
    const empty = buildMarketingCatalogue([]);
    expect(empty.map((card) => [card.key, card.priceKES, card.durationDays])).toEqual([
      ["MONTHLY", 149, 30],
      ["ANNUAL", 999, 365],
      ["AI_BUSINESS_FRONT_DESK", 499, 30],
      ["INTERACTIVE_BUSINESS", 999, 30],
      ["BUSINESS_POS", 499, 30],
      ["ERP_PRO", 3000, 30],
      ["JATA_AUTOPILOT", 2499, 30],
      ["JATA_AUTOPILOT_PRO", 6999, 30],
      ["JATA_AUTOPILOT_ENTERPRISE", 19999, 30],
    ]);

    // A price-matched stored row wins its own slot — the operator's label lands on the card
    // while the approved amount stays authoritative.
    const matchedRows = [
      row("ERP_PRO", "Operator label", 3000, 30),
      row("MONTHLY", "Monthly — KES 149/month", 149, 30),
    ];
    const matched = buildMarketingCatalogue(matchedRows);
    expect(matched.find((card) => card.key === "ERP_PRO")).toMatchObject({
      priceKES: 3000,
      name: "Operator label",
    });
    expect([...priceMatchedGridKeys(matchedRows)].sort()).toEqual(["ERP_PRO", "MONTHLY"]);

    // An out-of-spec amount never reaches the public grid: checkout would refuse that row
    // with PLAN_PRICING_INVALID, so the approved constants win, the card keeps rendering
    // (visibility never depends on a row), and the key stops counting as catalogue-present.
    const mismatchedRows = [
      row("ERP_PRO", "Operator label", 2500, 30),
      row("MONTHLY", "Monthly — KES 159/month", 159, 30),
      row("ANNUAL", "Annual — KES 999/year", 999, 30),
    ];
    const mismatched = buildMarketingCatalogue(mismatchedRows);
    expect(mismatched.find((card) => card.key === "ERP_PRO")).toMatchObject({ priceKES: 3000 });
    expect(mismatched.find((card) => card.key === "MONTHLY")).toMatchObject({ priceKES: 149, durationDays: 30 });
    expect(mismatched.find((card) => card.key === "ANNUAL")).toMatchObject({ priceKES: 999, durationDays: 365 });
    expect(priceMatchedGridKeys(mismatchedRows).size).toBe(0);
    // End-to-end status: the page feeds those keys straight into the shared label function.
    expect(
      catalogueCardStatus({
        key: "ERP_PRO",
        hasStoredRow: priceMatchedGridKeys(mismatchedRows).has("ERP_PRO"),
        voiceCanSell: false,
      }),
    ).toBe("Approved package — switched on from the ERP workspace");
  });

  it("keeps the Standard/Pro/Voice family tiers out of the grid even when their rows exist", () => {
    const cards = buildMarketingCatalogue([
      ...CANONICAL_ROWS,
      row("AI_FRONT_DESK_STANDARD", "Front Desk Standard — KES 999/month", 999, 30),
      row("AI_FRONT_DESK_PRO", "Front Desk Pro — KES 1,999/month", 1999, 30),
      row("AI_FRONT_DESK_VOICE", "Front Desk Voice — KES 3,999/month", 3999, 30),
    ]);
    const keys = cards.map((card) => card.key);
    // The family section on /products renders those from FRONT_DESK_TIER_KEYS; the grid never
    // duplicates them (the Starter key keeps its owner-mandated grid slot).
    expect(keys).toEqual([...EXPECTED_GRID_KEYS]);
    expect(keys).toContain("AI_BUSINESS_FRONT_DESK");
  });

  it("routes the two workspace Autopilot tiers directly after the standard package", () => {
    const keys = buildMarketingCatalogue([]).map((card) => card.key);
    const auto = keys.indexOf("JATA_AUTOPILOT");
    expect(keys[auto + 1]).toBe("JATA_AUTOPILOT_PRO");
    expect(keys[auto + 2]).toBe("JATA_AUTOPILOT_ENTERPRISE");
    // They remain private: no payable public surface may ever receive them.
    for (const key of ["JATA_AUTOPILOT_PRO", "JATA_AUTOPILOT_ENTERPRISE"]) {
      expect(PRIVATE_PLAN_KEYS).toContain(key);
    }
  });
});

describe("availability states (single source of truth)", () => {
  it("marks a family tier active only on a price-matched stored row", () => {
    const approved = { key: "AI_FRONT_DESK_STANDARD" as const, priceKES: 999, durationDays: 30 };
    expect(isPriceMatchedRow(undefined, "AI_FRONT_DESK_STANDARD")).toBe(false);
    expect(isPriceMatchedRow({ ...approved, priceKES: 998 }, "AI_FRONT_DESK_STANDARD")).toBe(false);
    expect(isPriceMatchedRow(approved, "AI_FRONT_DESK_STANDARD")).toBe(true);

    expect(
      frontDeskTierStatus({ key: "AI_FRONT_DESK_STANDARD", catalogueMatch: false, voiceCanSell: false }),
    ).toBe(CATALOGUE_STATUS.awaiting);
    expect(
      frontDeskTierStatus({ key: "AI_FRONT_DESK_STANDARD", catalogueMatch: true, voiceCanSell: false }),
    ).toBe(CATALOGUE_STATUS.active);
  });

  it("never shows Voice as sellable without the full provider and commercial gates", () => {
    expect(
      frontDeskTierStatus({ key: AI_FRONT_DESK_VOICE_KEY, catalogueMatch: true, voiceCanSell: false }),
    ).toBe(CATALOGUE_STATUS.providerPending);
    expect(
      frontDeskTierStatus({ key: AI_FRONT_DESK_VOICE_KEY, catalogueMatch: false, voiceCanSell: true }),
    ).toBe(CATALOGUE_STATUS.awaiting);
    expect(
      frontDeskTierStatus({ key: AI_FRONT_DESK_VOICE_KEY, catalogueMatch: true, voiceCanSell: true }),
    ).toBe(CATALOGUE_STATUS.providerVerified);
    expect(
      catalogueCardStatus({ key: AI_FRONT_DESK_VOICE_KEY, hasStoredRow: true, voiceCanSell: false }),
    ).toBe(CATALOGUE_STATUS.providerPending);
  });

  it("labels grid cards with the real catalogue row state and workspace sales channels", () => {
    expect(catalogueCardStatus({ key: "MONTHLY", hasStoredRow: true, voiceCanSell: false })).toBe(
      CATALOGUE_STATUS.active,
    );
    expect(catalogueCardStatus({ key: "MONTHLY", hasStoredRow: false, voiceCanSell: false })).toBe(
      CATALOGUE_STATUS.awaiting,
    );
    expect(catalogueCardStatus({ key: "BUSINESS_POS", hasStoredRow: true, voiceCanSell: false })).toBe(
      `${CATALOGUE_STATUS.active} — sold from your dashboard`,
    );
    expect(catalogueCardStatus({ key: "ERP_PRO", hasStoredRow: false, voiceCanSell: false })).toBe(
      "Approved package — switched on from the ERP workspace",
    );
    expect(
      catalogueCardStatus({ key: "JATA_AUTOPILOT_PRO", hasStoredRow: true, voiceCanSell: false }),
    ).toBe(`${CATALOGUE_STATUS.active} — sold inside the JATA Autopilot workspace`);
  });

  it("lists exactly the six required Voice selling conditions, in the release-rule order", () => {
    expect([...VOICE_SELLING_CONDITIONS]).toEqual([
      "Telnyx account and inbound number readiness",
      "Required provider credentials and environment configuration",
      "Media streaming worker readiness, including its handshake token",
      "Provider callback and event handling verification",
      "Real handset inbound call testing",
      "Commercial activation approval for customer billing",
    ]);
  });
});

describe("/products page wiring", () => {
  const page = read("app/products/page.tsx");
  const detail = read("app/products/[slug]/page.tsx");

  it("assembles the grid through the one authoritative helper shared with the homepage", () => {
    expect(page).toContain("homepagePlanCards");
    expect(page).toContain("buildMarketingCatalogue(stored, homepagePlanCards)");
    // Review follow-up: only price-matched rows feed the status signal, and the detail page
    // applies checkout's fail-closed pricing assertion and fetches the Voice row too.
    expect(page).toContain("priceMatchedGridKeys(stored, homepagePlanCards)");
    expect(detail).toContain("assertFrontDeskTierPricing(row).ok");
    expect(detail).toContain('"AI_FRONT_DESK_VOICE"');
  });

  it("renders availability from the shared status functions for both sections", () => {
    expect(page).toContain("catalogueCardStatus(");
    expect(page).toContain("frontDeskTierStatus(");
    expect(page).toContain("FRONT_DESK_TIER_KEYS.map");
    // The single Voice card lives in the family section; the old duplicate grid card is gone.
    expect(page).not.toContain('key="AI_FRONT_DESK_VOICE"');
    expect(page).toContain("VOICE_SELLING_CONDITIONS");
    expect(page).toContain("not for sale");
  });

  it("resolves every package action to an existing public destination (no checkout links)", () => {
    const slugs = [...page.matchAll(/slug: "([a-z-]+)"/g)].map((match) => match[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(9);
    const known = new Set([...detail.matchAll(/^  "([a-z-]+)": \{$/gm)].map((match) => match[1]));
    for (const slug of slugs) expect(known.has(slug), `slug ${slug} must exist on [slug]/page.tsx`).toBe(true);
    expect(page).not.toContain('href="/checkout');
    expect(detail).not.toContain('href="/checkout');
    // Family cards and voice readiness links only point at real sections of the detail page.
    expect(page).toContain('"/products/ai-front-desk#voice"');
    expect(detail).toContain('section.heading.startsWith("Voice receptionist") ? "voice"');
  });

  it("lists all four approved tiers with per-tier availability on the detail page", () => {
    expect(detail).toContain("FRONT_DESK_TIER_KEYS.map");
    expect(detail).toContain("awaiting catalogue activation, not yet for sale");
    expect(detail).toContain("awaiting provider activation, not yet for sale");
    expect(detail).toContain("VOICE_SELLING_CONDITIONS");
  });

  it("keeps the Autopilot tier blurbs byte-identical to AUTOPILOT_PLAN_CATALOG", () => {
    const catalog = read("lib/autopilot/entitlement.ts");
    for (const key of ["JATA_AUTOPILOT_PRO", "JATA_AUTOPILOT_ENTERPRISE"]) {
      const fromCatalog = catalog.match(new RegExp(`${key}: \\{[\\s\\S]*?description:\\s*"([^"]+)"`))?.[1];
      const fromPage = page.match(
        new RegExp(`${key}: \\{\\s*slug: "jata-autopilot",\\s*blurb: "([^"]+)"`),
      )?.[1];
      expect(fromCatalog, key).toBeTruthy();
      expect(fromPage, key).toBe(fromCatalog);
    }
  });
});

describe("public navigation entry points", () => {
  it("exposes /products in the homepage navbar's desktop list and mobile panel alike", () => {
    const navbar = read("components/Navbar.tsx");
    expect(navbar).toContain('{ href: "/products", label: "Products" }');
    // One navigation system: both renderings map the same SECTIONS array.
    expect(navbar.match(/\{SECTIONS\.map\(/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("exposes /products from the marketing header, marketing footer and homepage footer", () => {
    const shell = read("components/marketing/MarketingShell.tsx");
    expect(shell).toContain('{ href: "/products", label: "Products" }');
    expect(shell).toContain('<Link href="/products">All products</Link>');
    const landingFooter = read("components/landing/FaqAndFooter.tsx");
    expect(landingFooter).toContain('<Link href="/products">All products</Link>');
  });
});

describe("Vercel preview build configuration", () => {
  it("forces every deployment, including PR previews, to build (vercel.json overrides the dashboard)", () => {
    const config = JSON.parse(read("vercel.json"));
    // Ignored-build-step contract: exit 0 cancels the build, exit 1 proceeds.
    expect(config.ignoreCommand).toBe("exit 1");
  });
});

describe("rendered /products page (offline, no database)", () => {
  const render = async () => renderToStaticMarkup(await ProductsPage());

  it("shows all four Front Desk tiers, every approved grid package and honest labels", async () => {
    const html = await render();
    // Family section: four tiers at their approved prices.
    for (const [key, price] of [
      ["AI_BUSINESS_FRONT_DESK", "499"],
      ["AI_FRONT_DESK_STANDARD", "999"],
      ["AI_FRONT_DESK_PRO", "1,999"],
      ["AI_FRONT_DESK_VOICE", "3,999"],
    ] as const) {
      expect(html, key).toContain(`data-tier="${key}"`);
      expect(html, key).toContain(`KES ${price} / 30 days`);
    }
    // Grid: the complete approved catalogue, priced from the canonical constants offline.
    for (const fragment of [
      "Monthly — KES 149/month",
      "Annual — KES 999/year",
      "Website Studio — KES 999/month",
      "JATA AFTERCALL — Business POS",
      "JATA BOS PRO",
      "JATA Autopilot — KES 2,499/month",
      "JATA Autopilot Pro — KES 6,999/month",
      "JATA Autopilot Enterprise — KES 19,999/month",
    ]) {
      expect(html, fragment).toContain(fragment);
    }
    // Offline the database is unreadable, so nothing may read as in the catalogue…
    expect(html).toContain(CATALOGUE_STATUS.awaiting);
    expect(html).not.toContain(">Active in the server catalogue<");
    // …and Voice states every pending condition instead of implying it can be sold.
    expect(html).toContain(CATALOGUE_STATUS.providerPending);
    expect(html).toContain("Pending before Front Desk Voice can be sold or take live calls:");
    expect(html).toContain(VOICE_SELLING_CONDITIONS[4]);
    // Navigation entry points render on this public page.
    expect(html).toContain('href="/products"');
    // No customer action starts checkout from this page.
    expect(html).not.toContain("/checkout");
  });
});
