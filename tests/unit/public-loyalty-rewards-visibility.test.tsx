/**
 * Public Loyalty Rewards — the section a customer actually sees.
 *
 * The defect this closes: the Points & Rewards block was rendered only when a business had an
 * ACTIVE points programme, so on every live page today the feature was invisible and a customer
 * had no way to know it existed. The section is now part of the page in every state and its STATE
 * carries the truth:
 *
 *   inactive → "Points rewards coming soon", no rate, reward, balance or expiry invented,
 *   unknown  → a neutral availability message, still nothing invented,
 *   active   → the configured earning rules, rewards and redemption information, plus the lookup.
 *
 * Rendered through React's server renderer, which is exactly what a visitor's browser receives.
 * There is no browser in this workspace; the interactive half is covered by
 * `tests/unit/business-hub-public-points-lookup.test.ts` and by
 * `scripts/browser/business-hub-journey.check.mjs` (real Chrome, disposable database).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BusinessPage from "@/components/BusinessPage";
import type { PublicLoyaltyRewards } from "@/lib/business-hub/loyaltyPoints";

const THEME = {
  colors: {
    bg: "bg-zinc-950",
    card: "bg-zinc-900",
    text: "text-zinc-50",
    muted: "text-zinc-400",
    primary: "bg-lime-400",
    primaryText: "text-zinc-900",
    accent: "bg-amber-300",
    border: "border-zinc-800",
    surfaceMuted: "bg-zinc-900/60",
  },
  radius: "rounded-2xl",
};

const BUSINESS = {
  id: "bizA",
  slug: "nyumbani-kitchen",
  name: "Nyumbani Kitchen",
  category: "Food & Restaurant",
  phone: "0712000000",
  whatsapp: "0712000000",
  location: "Tom Mboya Street, Nairobi",
  lat: -1.2833,
  lng: 36.8167,
  description: "Home-style Kenyan meals, cooked fresh every morning.",
  theme: "clean",
  aftercallMsg: null,
  openingHours: null,
  socialLinks: null,
} as any;

const LOYALTY_SECTION = 'id="loyalty-rewards"';
const STAMP_SECTION = 'id="loyalty"';

function render(rewards: PublicLoyaltyRewards, loyaltyEnabled = false) {
  return renderToStaticMarkup(
    <BusinessPage
      business={BUSINESS}
      services={[]}
      offer={null}
      theme={THEME}
      products={[]}
      promotions={[]}
      loyaltyEnabled={loyaltyEnabled}
      pointsEnabled={rewards.status === "active"}
      loyaltyRewards={rewards}
    />,
  );
}

/** The markup of the Loyalty Rewards band alone. It holds no nested <section>. */
function band(html: string): string {
  const start = html.indexOf(LOYALTY_SECTION);
  expect(start, "the Loyalty Rewards section is rendered").toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? html.length : end);
}

const INACTIVE: PublicLoyaltyRewards = { status: "inactive", earning: null, redemption: null, rewards: [] };
const UNKNOWN: PublicLoyaltyRewards = { status: "unknown", earning: null, redemption: null, rewards: [] };

const ACTIVE: PublicLoyaltyRewards = {
  status: "active",
  earning: {
    kesPerPoint: 100,
    pointsPerUnit: 1,
    minPurchaseKES: 250,
    expiryMonths: 12,
    description: "Earn while you eat.",
    terms: "Points are added after we verify your purchase.",
  },
  redemption: { minRedeemPoints: 20, pointValueKES: 5, rules: "Collect in store." },
  rewards: [
    { id: "reward_1", title: "Free pilau combo", description: "One combo plate", kind: "FIXED_POINTS", pointsCost: 10, discountKES: null },
    { id: "reward_2", title: "Dessert platter", description: null, kind: "FIXED_POINTS", pointsCost: 30, discountKES: 500 },
  ],
};

/** A programme that is live but whose owner has configured no rate, reward or value. */
const ACTIVE_EMPTY: PublicLoyaltyRewards = {
  status: "active",
  earning: { kesPerPoint: null, pointsPerUnit: null, minPurchaseKES: 0, expiryMonths: null, description: null, terms: null },
  redemption: { minRedeemPoints: 0, pointValueKES: null, rules: null },
  rewards: [],
};

describe("the Loyalty Rewards section is visible on a public page", () => {
  it("is rendered, named and subtitled on every public Business Page", () => {
    for (const state of [INACTIVE, UNKNOWN, ACTIVE]) {
      const html = render(state);
      expect(html).toContain(LOYALTY_SECTION);
      const section = band(html);
      expect(section).toContain("Loyalty Rewards");
      expect(section).toContain("Shop. Earn. Enjoy rewards.");
      // Inherits the public storefront system: the band is drawn from the shared `.st-loyalty`
      // tokens rather than its own one-off palette.
      expect(section).toContain("st-loyalty");
    }
  });

  it("appears before the page's lower sections, not buried under unrelated content", () => {
    const html = render(INACTIVE);
    // Findable: it sits above the About block a customer would otherwise scroll past.
    expect(html.indexOf(LOYALTY_SECTION)).toBeLessThan(html.indexOf('id="info"'));
    expect(html.indexOf(LOYALTY_SECTION)).toBeLessThan(html.indexOf('id="quote"'));
  });
});

describe("STATE A — the programme is not available", () => {
  it("says points rewards are coming soon and explains why there is nothing to show", () => {
    const section = band(render(INACTIVE));
    expect(section).toContain("Points rewards coming soon");
    expect(section).toContain("hasn&#x27;t switched on points rewards yet");
    expect(section).toContain("Stamps are separate and unaffected");
  });

  it("publishes no balance, rate, reward, expiry or redemption value", () => {
    const section = band(render(INACTIVE));
    for (const forbidden of [
      "Available points",
      "Points wallet",
      "points for every",
      "KES 100",
      "expire",
      "Redeem",
      "View points",
      "points-card-code",
    ]) {
      expect(section, `the inactive section must not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it("offers no button that promises a customer can earn or spend points today", () => {
    const section = band(render(INACTIVE));
    expect(section).not.toContain("<button");
    // The three "when it's on" lines are framed in the future tense, not as an offer.
    expect(section).toContain("Earn points on the purchases the business verifies");
    expect(section).toContain("Points are not cash and cannot be withdrawn");
  });

  it("keeps the stamp card independent when only stamps are enabled", () => {
    const html = render(INACTIVE, true);
    expect(html).toContain(STAMP_SECTION);
    expect(html).toContain(LOYALTY_SECTION);
    const section = band(html);
    expect(section).toContain("Points rewards coming soon");
    expect(section).not.toContain("View points");
  });
});

describe("STATE A′ — the configuration could not be read", () => {
  it("keeps the section with a neutral availability message instead of vanishing", () => {
    const section = band(render(UNKNOWN));
    expect(section).toContain("Rewards availability unconfirmed");
    expect(section).toContain("can&#x27;t confirm");
    expect(section).toContain("Please check back soon");
    // It does not claim the programme is coming, because it could not be read.
    expect(section).not.toContain("coming soon");
    expect(section).not.toContain("Points rewards are live");
  });

  it("publishes nothing at all about rates, rewards or balances", () => {
    const section = band(render(UNKNOWN));
    expect(section).not.toContain("Available points");
    expect(section).not.toContain("View points");
    expect(section).not.toContain("<button");
    expect(section).not.toContain("KES");
  });
});

describe("STATE B — the programme is active", () => {
  it("publishes the earning rules the owner configured", () => {
    const section = band(render(ACTIVE));
    expect(section).toContain("Points rewards are live");
    expect(section).toContain("How you earn");
    expect(section).toContain("Earn 1 point for every KES 100 you spend");
    expect(section).toContain("on purchases of KES 250 or more");
    expect(section).toContain("Earn while you eat.");
    expect(section).toContain("Points are added after we verify your purchase.");
    expect(section).toContain("Points expire 12 months after you earn them");
  });

  it("publishes the reward catalogue with the costs the owner set", () => {
    const section = band(render(ACTIVE));
    expect(section).toContain("Rewards");
    expect(section).toContain("Free pilau combo");
    expect(section).toContain("10 points");
    expect(section).toContain("Dessert platter");
    expect(section).toContain("30 points");
    expect(section).toContain("KES 500 off your purchase.");
  });

  it("publishes the redemption information the owner configured", () => {
    const section = band(render(ACTIVE));
    expect(section).toContain("Redeeming your points");
    expect(section).toContain("Collect in store.");
    expect(section).toContain("start redeeming once you hold 20 points");
    expect(section).toContain("Each point is worth about KES 5 of value.");
    expect(section).toContain("Points are not cash and cannot be withdrawn");
  });

  it("still offers the card-code lookup, with its normalisation contract intact", () => {
    const section = band(render(ACTIVE));
    expect(section).toContain('id="points-rewards"');
    expect(section).toContain('id="points-card-code"');
    expect(section).toContain("View points");
    expect(section).toContain("Loyalty card code");
    expect(/Points are separate from stamps/.test(section)).toBe(true);
    // Spaced codes must be typeable: the field is not capped below a normalised code.
    expect(section).toMatch(/maxlength="60"/i);
  });

  it("invents nothing when the owner configured no rate, reward or value", () => {
    const section = band(render(ACTIVE_EMPTY));
    expect(section).toContain("has not published an earning rate yet");
    expect(section).toContain("has not published any rewards yet");
    expect(section).toContain("Your points do not expire.");
    expect(section).not.toContain("points for every");
    expect(section).not.toContain("Each point is worth");
    // The lookup is still offered: the programme IS active, even though it is sparsely configured.
    expect(section).toContain('id="points-card-code"');
  });
});

describe("the section leaks nothing", () => {
  it("carries no business identifier, contact detail or internal model name", () => {
    for (const state of [INACTIVE, UNKNOWN, ACTIVE]) {
      const section = band(render(state));
      expect(section).not.toContain("bizA");
      expect(section).not.toContain("0712000000");
      expect(section).not.toContain("254712000000");
      expect(section).not.toContain("loyaltyPointsAccount");
      expect(section).not.toContain("programmeId");
      expect(section).not.toContain("eligibleItems");
    }
  });
});
