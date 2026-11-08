/**
 * Public Points & Rewards entry — the four programme combinations, as the browser receives them.
 *
 * There is no browser in this workspace, so the real `BusinessPage` is rendered through React's
 * server renderer and the HTML is asserted. That is what a visitor's browser actually receives:
 * which sections exist, in what order, with which form controls. The interactive half — typing a
 * code, the fetch, the wallet rendering — is covered by `tests/unit/business-hub-public-points-lookup.test.ts`
 * (the service) and by `scripts/browser/business-hub-journey.check.mjs` (real Chrome at 390px).
 *
 * The matrix is the point of this file: points must be visible and usable with the stamp card off,
 * and the stamp card must be untouched by points being on.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BusinessPage from "@/components/BusinessPage";

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

function business(overrides: Record<string, unknown> = {}) {
  return {
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
    openingHours: JSON.stringify({ mon: "08:00–18:00", tue: "08:00–18:00" }),
    socialLinks: null,
    ...overrides,
  } as any;
}

function render(flags: { loyaltyEnabled?: boolean; pointsEnabled?: boolean }, biz: any = business()) {
  return renderToStaticMarkup(
    <BusinessPage
      business={biz}
      services={[]}
      offer={null}
      theme={THEME}
      products={[]}
      promotions={[]}
      loyaltyEnabled={flags.loyaltyEnabled ?? false}
      pointsEnabled={flags.pointsEnabled ?? false}
    />,
  );
}

const POINTS_SECTION = 'id="points-rewards"';
const STAMP_SECTION = 'id="loyalty"';
// The Loyalty Rewards band is part of the page in EVERY programme state; only the lookup inside it
// is gated on the programme being active.
const LOYALTY_SECTION = 'id="loyalty-rewards"';

/** The markup of the loyalty band alone — from its opening tag to its closing tag. The band holds
 *  no nested <section>, so the first closing tag after it is the band's own. */
function loyaltySection(html: string): string {
  const start = html.indexOf(LOYALTY_SECTION);
  expect(start, "the Loyalty Rewards section is rendered").toBeGreaterThan(-1);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? html.length : end);
}

describe("the four programme combinations on a public Business Page", () => {
  it("stamps off and points off still shows Loyalty Rewards, with no lookup and no stamp card", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: false });
    expect(html).toContain(LOYALTY_SECTION);
    // The section is present but the programme is not, so nothing offers a balance.
    expect(html).not.toContain(POINTS_SECTION);
    expect(html).not.toContain(STAMP_SECTION);
  });

  it("stamps on and points off shows the stamp card beside an announced Loyalty Rewards section", () => {
    const html = render({ loyaltyEnabled: true, pointsEnabled: false });
    expect(html).toContain(STAMP_SECTION);
    expect(html).toContain('id="loyalty-code"');
    expect(html).toContain("Check my card");
    expect(html).toContain(LOYALTY_SECTION);
    expect(html).not.toContain(POINTS_SECTION);
  });

  it("stamps off and points on shows the points lookup only", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: true });
    expect(html).toContain(LOYALTY_SECTION);
    expect(html).toContain(POINTS_SECTION);
    expect(html).toContain('id="points-card-code"');
    expect(html).toContain("View points");
    expect(html).not.toContain(STAMP_SECTION);
    // Nothing on the page tells the customer to look up a stamp card first.
    expect(html).not.toContain("Check my card");
  });

  it("stamps on and points on shows both, as independent sections", () => {
    const html = render({ loyaltyEnabled: true, pointsEnabled: true });
    expect(html).toContain(STAMP_SECTION);
    expect(html).toContain(LOYALTY_SECTION);
    expect(html).toContain(POINTS_SECTION);
    // Neither section contains the other: the points lookup does not live inside the stamp form,
    // so it cannot disappear when the stamp card is switched off, and a stamp lookup is not a
    // precondition for reaching points.
    const stampAt = html.indexOf(STAMP_SECTION);
    const loyaltyAt = html.indexOf(LOYALTY_SECTION);
    expect(stampAt).toBeGreaterThan(-1);
    expect(loyaltyAt).toBeGreaterThan(-1);
    const between = html.slice(Math.min(stampAt, loyaltyAt), Math.max(stampAt, loyaltyAt));
    expect(between).toContain("</section>");
    expect(html).toContain('id="loyalty-code"');
    expect(html).toContain('id="points-card-code"');
  });
});

describe("what the points section offers a customer", () => {
  it("names itself, asks for a card code, and says points are separate from stamps", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: true });
    expect(html).toContain("Loyalty Rewards");
    expect(html).toContain("Shop. Earn. Enjoy rewards.");
    expect(html).toContain("<label");
    expect(html).toContain("Loyalty card code");
    expect(html).toContain("View points");
    expect(/Points are separate from stamps/.test(html)).toBe(true);
  });

  it("renders the input as a labelled, upper-cased, non-autocompleting field", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: true });
    const input = html.slice(html.indexOf('id="points-card-code"'));
    expect(input.slice(0, 400)).toMatch(/autocomplete="off"/i);
    expect(input.slice(0, 400)).toContain("uppercase");
    // The label is wired to the input, so a screen reader announces it.
    const label = html.slice(0, html.indexOf('id="points-card-code"'));
    expect(label).toMatch(/for="points-card-code"/);
  });

  it("is laid out with the loyalty band's own styling and responsive controls", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: true });
    const section = loyaltySection(html);
    expect(section).toContain("bg-[#16181d]");
    expect(section).toContain("text-[#b6ff2e]");
    // Full width on a phone, auto width from the small breakpoint up.
    expect(section).toContain("w-full");
    expect(section).toContain("sm:w-auto");
  });

  it("exposes no contact detail, identifier or administrative value", () => {
    const html = render({ loyaltyEnabled: false, pointsEnabled: true }, business());
    // Scoped to the points section: the page as a whole legitimately publishes the business's own
    // phone number in its Contact block. Nothing private may ride along with the points form.
    const section = loyaltySection(html);
    expect(section).not.toContain("0712000000");
    expect(section).not.toContain("254712000000");
    // Internal identifiers and model names are not part of the customer-facing markup.
    expect(section).not.toContain("bizA");
    expect(section).not.toContain("loyaltyPointsAccount");
    expect(section).not.toContain("programmeId");
  });
});

describe("the gate is per business, not global", () => {
  const withPoints = business({ id: "bizA", slug: "nyumbani-kitchen", name: "Nyumbani Kitchen" });
  const withoutPoints = business({
    id: "bizB",
    slug: "mwangi-hardware",
    name: "Mwangi Hardware",
    phone: "0723000000",
    whatsapp: "0723000000",
  });

  it("offers the lookup on the points business and only announces rewards on the other", () => {
    expect(render({ loyaltyEnabled: true, pointsEnabled: true }, withPoints)).toContain(POINTS_SECTION);
    const other = render({ loyaltyEnabled: true, pointsEnabled: false }, withoutPoints);
    expect(other).toContain(LOYALTY_SECTION);
    expect(other).not.toContain(POINTS_SECTION);
    expect(other).toContain("Mwangi Hardware");
  });

  it("renders no balance, no wallet and no lookup for a business with points off", () => {
    const html = render({ loyaltyEnabled: true, pointsEnabled: false }, withoutPoints);
    const section = loyaltySection(html);
    expect(section).not.toContain("Available points");
    expect(section).not.toContain("Points wallet");
    expect(section).not.toContain("View points");
    expect(section).not.toContain('id="points-card-code"');
    // It says what IS true instead: the programme is not available to customers yet.
    expect(section).toContain("Points rewards coming soon");
    expect(section).toContain("Mwangi Hardware");
  });
});

describe("the stamp card is unchanged by points", () => {
  it("keeps its own section, form and wording when both programmes are on", () => {
    const html = render({ loyaltyEnabled: true, pointsEnabled: true });
    // The stamp card keeps its own section wherever it sits on the page; slice it by its own
    // closing tag rather than by the position of another section.
    const stampStart = html.indexOf(STAMP_SECTION);
    const stampSection = html.slice(stampStart, html.indexOf("</section>", stampStart));
    expect(stampSection).toContain("Loyalty card");
    expect(stampSection).toContain('id="loyalty-code"');
    expect(stampSection).toContain("Check my card");
    // The stamp form does not carry the points wallet any more: points are their own entry point.
    expect(stampSection).not.toContain("Points wallet");
  });
});
