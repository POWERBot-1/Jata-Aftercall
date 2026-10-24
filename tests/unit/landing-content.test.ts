/**
 * Landing content: accuracy and demo-card data.
 *
 * The landing page makes no performance claims, shows no testimonials and invents no prices. These
 * tests pin that, and pin the rule that a demo card's prices always come from the demo page's own
 * rows (or the documented demo seed), never from copy written for marketing.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LANDING_BENEFITS,
  LANDING_DEMO_SLUGS,
  LANDING_FAQ,
  LANDING_STEPS,
  LANDING_STORY,
  PLAN_BADGES,
  PLAN_INCLUDES,
  buildLandingDemoCards,
} from "@/lib/landing";
import { DEMO_BUSINESSES } from "@/lib/demoData";

const root = path.resolve(__dirname, "../..");
const marketingCopy = () =>
  [
    ...LANDING_STORY.flatMap((act) => [act.title, act.body]),
    ...LANDING_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]),
    ...LANDING_FAQ.flatMap((item) => [item.question, item.answer]),
    ...LANDING_STEPS,
    ...Object.values(PLAN_INCLUDES).flat(),
    ...Object.values(PLAN_BADGES),
  ].join("\n");

describe("landing copy makes no unverified claim", () => {
  it("carries no testimonial, rating, review or customer-count language", () => {
    const copy = marketingCopy();
    for (const banned of [
      /testimonial/i,
      /\breviews?\b/i,
      /★|⭐/,
      /\brating\b/i,
      /customers? (trust|love|choose)/i,
      /trusted by \d/i,
      /\d[\d,.]*\s*(customers|businesses|owners)\b/i,
      /\b(best|leading|number one|#1)\b/i,
      /guarantee(d|s)? (sales|revenue|results|rankings)/i,
    ]) {
      expect(copy, String(banned)).not.toMatch(banned);
    }
  });

  it("does not promise a business outcome or income", () => {
    const copy = marketingCopy();
    expect(copy).not.toMatch(/\b(increase|boost|double|triple)\b[^.]*\b(sales|revenue|income|profit)\b/i);
    expect(copy).not.toMatch(/\bKES [\d,]+\s*(more|extra|per month in)\b/i);
    expect(copy).not.toMatch(/within \d+ (days|weeks)/i);
  });

  it("never puts the private Business POS into a plan card", () => {
    expect(Object.keys(PLAN_INCLUDES)).toEqual(["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
    expect(Object.keys(PLAN_INCLUDES)).not.toContain("BUSINESS_POS");
    expect(Object.values(PLAN_INCLUDES).flat().join(" ")).not.toMatch(/point of sale|point-of-sale|POS/i);
  });

  it("answers the POS question in the FAQ by separating it from the page plans", () => {
    const faq = LANDING_FAQ.find((item) => item.question.includes("POS"));
    expect(faq).toBeTruthy();
    expect(faq!.answer).toMatch(/separate/i);
    expect(faq!.answer).toMatch(/not included/i);
  });

  it("does not invent prices in the marketing copy", () => {
    const copy = marketingCopy();
    // Only the plan names in PLAN_INCLUDES/PLAN_BADGES could carry a price, and they must not.
    expect(copy).not.toMatch(/KES\s?[\d,]+/);
  });
});

describe("the owner-only POS stays owner-only", () => {
  const page = readFileSync(path.join(root, "app/page.tsx"), "utf8");

  it("links into the authenticated POS flow and nothing else", () => {
    const hrefs = [...page.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    expect(hrefs.filter((href) => /pos/i.test(href))).toEqual(["/dashboard/pos"]);
    expect(page).toContain("It is owner-only");
  });

  it("is still gated by the existing server-side sign-in redirect", () => {
    const route = readFileSync(path.join(root, "app/dashboard/pos/page.tsx"), "utf8");
    expect(route).toContain('if (!session) redirect("/login")');
    expect(route).toContain("getOwnedBusinessIds");
  });

  it("never appears as a fifth plan card and never on a demo page", () => {
    expect(page).toContain("publiclyListedPlans");
    for (const file of ["components/BusinessPage.tsx", "components/storefront/DemoShowcaseBand.tsx", "lib/demoShowcase.ts"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/Business POS|BUSINESS_POS/);
    }
    // The only place the landing copy names it is the FAQ answer that separates it from the plans.
    const landingCopy = readFileSync(path.join(root, "lib/landing.ts"), "utf8");
    const mentions = landingCopy.split("\n").filter((line) => /Business POS/.test(line));
    expect(mentions).toHaveLength(2); // the FAQ question and its answer
    expect(mentions.join(" ")).toMatch(/separate owner-only point-of-sale/);
    expect(mentions.join(" ")).toMatch(/not included in, and not required for, the four page plans/i);
  });
});

describe("demo cards", () => {
  it("always lists the four demo businesses in the documented order", () => {
    expect([...LANDING_DEMO_SLUGS]).toEqual(["nyumbani-kitchen", "marys-beauty-studio", "kamau-auto-care", "john-kamau-properties"]);
    expect(buildLandingDemoCards([]).map((card) => card.slug)).toEqual([...LANDING_DEMO_SLUGS]);
    expect(buildLandingDemoCards(null).map((card) => card.slug)).toEqual([...LANDING_DEMO_SLUGS]);
  });

  it("falls back to the documented demo content, marked as an example, when rows are missing", () => {
    const cards = buildLandingDemoCards(null);
    for (const [index, card] of cards.entries()) {
      const demo = DEMO_BUSINESSES[index];
      expect(card.source).toBe("example");
      expect(card.name).toBe(demo.name);
      expect(card.services.map((service) => service.title)).toEqual(demo.services.map((service) => service.title));
      expect(card.services.map((service) => service.priceLabel)).toEqual(demo.services.map((service) => service.priceLabel));
      expect(card.offer?.title).toBe(demo.offer.title);
    }
  });

  it("uses the demo page's own price labels when the published rows exist", () => {
    const [first] = buildLandingDemoCards([
      {
        slug: "nyumbani-kitchen",
        name: "Nyumbani Kitchen",
        category: "Restaurant",
        location: "Kilimani, Nairobi",
        services: [{ title: "Ugali & Sukuma", priceLabel: "KES 350", priceFrom: 350, isActive: true }],
        offer: { title: "Lunch special KES 450", subtitle: "Weekdays" },
      },
    ]);
    expect(first.source).toBe("live");
    expect(first.services).toEqual([{ title: "Ugali & Sukuma", priceLabel: "KES 350" }]);
    expect(first.offer).toEqual({ title: "Lunch special KES 450", subtitle: "Weekdays" });
  });

  it("ignores inactive services and never shows a made-up price for one without a label", () => {
    const cards = buildLandingDemoCards([
      {
        slug: "marys-beauty-studio",
        name: "Mary's Beauty Studio",
        category: "Beauty",
        location: null,
        services: [
          { title: "Hidden", priceLabel: "KES 1", priceFrom: 1, isActive: false },
          { title: "Gel nails", priceLabel: null, priceFrom: 1200, isActive: true },
        ],
        offer: null,
      },
    ]);
    const card = cards.find((entry) => entry.slug === "marys-beauty-studio")!;
    expect(card.services).toEqual([{ title: "Gel nails", priceLabel: "From KES 1,200" }]);
    expect(card.location).toBe("Kitengela, Kajiado");
  });

  it("falls back to the documented example when a published row has no services", () => {
    const cards = buildLandingDemoCards([
      { slug: "kamau-auto-care", name: "Kamau Auto Care", category: "Mechanic", location: "Westlands, Nairobi", services: [{ title: "Off", priceLabel: "KES 1", priceFrom: 1, isActive: false }], offer: null },
    ]);
    const card = cards.find((entry) => entry.slug === "kamau-auto-care")!;
    expect(card.source).toBe("example");
    expect(card.services.length).toBeGreaterThan(0);
  });

  it("labels every image as illustrative and ships the file it points at", () => {
    for (const card of buildLandingDemoCards(null)) {
      expect(card.imageAlt).toContain("Illustrative");
      for (const variant of [".jpg", ".webp", "-720.jpg", "-720.webp"]) {
        expect(existsSync(path.join(root, "public", `${card.image}${variant}`)), `${card.image}${variant}`).toBe(true);
      }
    }
  });

  it("does not repeat a card's demo slug into the landing copy as a claim", () => {
    const cards = buildLandingDemoCards(null);
    for (const card of cards) {
      expect(card.story).not.toMatch(/KES\s?[\d,]+/);
    }
  });
});

describe("landing imagery on disk", () => {
  it("ships the hero photograph in both formats and both widths", () => {
    for (const file of [
      "public/landing/hero-nairobi.jpg",
      "public/landing/hero-nairobi.webp",
      "public/landing/hero-nairobi-1080.jpg",
      "public/landing/hero-nairobi-1080.webp",
      "public/landing/john-kamau-properties-interior.jpg",
    ]) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }
  });

  it("keeps every landing image small enough for a Kenyan mobile connection", () => {
    const landing = path.join(root, "public/landing");
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    for (const file of readdirSync(landing)) {
      const size = statSync(path.join(landing, file)).size;
      // 260 KB is the hard ceiling; the largest file today is the 1600px hero at ~215 KB.
      expect(size, file).toBeLessThan(260 * 1024);
    }
  });

  it("does not reference a stock-provider or third-party image host", () => {
    const sources = [
      "app/page.tsx",
      "components/landing/Hero.tsx",
      "components/landing/DemoShowcase.tsx",
      "components/storefront/DemoShowcaseBand.tsx",
    ].map((file) => readFileSync(path.join(root, file), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/unsplash|pexels|pixabay|cloudinary|images\./i);
    }
  });
});
