/**
 * Landing content: accuracy and demo-card data.
 *
 * The landing page makes no performance claims, shows no testimonials and invents no prices. These
 * tests pin that, and pin the rule that a demo card's prices always come from the demo page's own
 * rows (or the documented demo seed), never from copy written for marketing.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LANDING_BENEFITS,
  LANDING_DEMO_SLUGS,
  LANDING_FAQ,
  LANDING_STEPS,
  LANDING_STORY,
  AUTOPILOT_PLAN_CARD,
  ERP_PRO_PLAN_CARD,
  PLAN_BADGES,
  PLAN_ICONS,
  PLAN_INCLUDES,
  POS_PLAN_CARD,
  buildLandingDemoCards,
} from "@/lib/landing";
import { DEMO_BUSINESSES, DEMO_OWNER_EMAIL, DEMO_PAYMENT_PREFIX } from "@/lib/demoData";
import { isVerifiedDemoRecord } from "@/lib/demoContent";
import { EVENT_TYPES } from "@/lib/analytics";
import { DemoShowcase } from "@/components/landing/DemoShowcase";
import { LandingFooter } from "@/components/landing/FaqAndFooter";

const root = path.resolve(__dirname, "../..");
const landingComponentCopy = () =>
  ["components/landing/Sections.tsx", "components/landing/Hero.tsx", "app/page.tsx", "app/layout.tsx"]
    .map((file) => readFileSync(path.join(root, file), "utf8"))
    .join("\n");
const eligibleLandingRow = (slug: string, overrides: Record<string, any> = {}) => {
  const demo = DEMO_BUSINESSES.find((entry) => entry.slug === slug)!;
  return {
    slug,
    name: demo.name,
    category: demo.category,
    location: demo.location,
    isPublished: true,
    status: "ACTIVE",
    isVerifiedDemo: true,
    services: [{ title: demo.services[0].title, priceLabel: demo.services[0].priceLabel, priceFrom: demo.services[0].priceFrom, isActive: true }],
    offer: { title: "Untrusted database offer", subtitle: null, isActive: true, validUntil: null },
    ...overrides,
  };
};
const marketingCopy = () =>
  [
    ...LANDING_STORY.flatMap((act) => [act.title, act.body]),
    ...LANDING_BENEFITS.flatMap((benefit) => [benefit.title, benefit.body]),
    ...LANDING_FAQ.flatMap((item) => [item.question, item.answer]),
    ...LANDING_STEPS,
    ...Object.values(PLAN_INCLUDES).flat(),
    ...Object.values(PLAN_BADGES),
    POS_PLAN_CARD.badge,
    POS_PLAN_CARD.blurb,
    POS_PLAN_CARD.fine,
    ...POS_PLAN_CARD.includes,
    AUTOPILOT_PLAN_CARD.badge,
    AUTOPILOT_PLAN_CARD.blurb,
    AUTOPILOT_PLAN_CARD.fine,
    ...AUTOPILOT_PLAN_CARD.includes,
    ERP_PRO_PLAN_CARD.badge,
    ERP_PRO_PLAN_CARD.name,
    ERP_PRO_PLAN_CARD.subtitle,
    ERP_PRO_PLAN_CARD.blurb,
    ERP_PRO_PLAN_CARD.fine,
    ...ERP_PRO_PLAN_CARD.includes,
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

  it("removes unsupported loss, sale-outcome and universal tap-tracking claims from component copy", () => {
    const copy = `${marketingCopy()}\n${landingComponentCopy()}\n${readFileSync(path.join(root, "lib/landing.ts"), "utf8")}`;
    for (const unsupported of [
      /most small businesses lose/i,
      /decides? the sale/i,
      /you keep the sale/i,
      /every (?:tap|click) is (?:counted|tracked)/i,
      /all (?:taps|clicks) (?:are|is) (?:counted|tracked)/i,
      /create your page in ~?\d+ minutes/i,
      /your next customer is one link away/i,
      /no waiting for a reply/i,
      /light on data/i,
    ]) {
      expect(copy, String(unsupported)).not.toMatch(unsupported);
    }
    expect(marketingCopy()).toMatch(/Some events may not be recorded/i);
  });

  it("advertises only analytics events the public page actually instruments", () => {
    const businessPage = readFileSync(path.join(root, "components/BusinessPage.tsx"), "utf8");
    const eventNames = [...businessPage.matchAll(/\"([A-Z_]+)\"/g)]
      .map((match) => match[1])
      .filter((event) => event === "PAGE_VIEW" || event.endsWith("_CLICK"));
    expect(eventNames).toContain("DIRECTIONS_CLICK");
    expect(eventNames).not.toContain("DIRECTION_CLICK");
    for (const event of new Set(eventNames)) {
      expect(EVENT_TYPES, `${event} must be accepted by the analytics endpoint`).toContain(event);
    }
    for (const event of ["WHATSAPP_CLICK", "CALL_CLICK", "DIRECTIONS_CLICK", "SHARE_CLICK", "SERVICE_CLICK"]) {
      expect(eventNames).toContain(event);
    }
  });

  it("labels all synthetic business data as fictional and removes unsupported property claims", () => {
    const demoData = readFileSync(path.join(root, "lib/demoData.ts"), "utf8");
    const seed = readFileSync(path.join(root, "prisma/seed.ts"), "utf8");
    const contentAssist = readFileSync(path.join(root, "lib/experience/contentAssist.ts"), "utf8");
    for (const demo of DEMO_BUSINESSES) {
      expect(demo.description, demo.slug).toMatch(/fictional demonstration data|fictional property-page demonstration/i);
    }
    for (const source of [demoData, seed]) {
      expect(source).not.toMatch(/verified listings|no brokers|viewing this weekend/i);
      expect(source).not.toMatch(/today only|this week only/i);
      expect(source).toMatch(/Fictional demo|Fictional demonstration data/i);
    }
    for (const demo of DEMO_BUSINESSES) {
      expect(seed).toContain(`phone: "${demo.phone}"`);
      expect(seed).toContain(`whatsapp: "${demo.whatsapp}"`);
    }
    expect(contentAssist).not.toMatch(/verified listing|verified homes|no brokers|viewing this weekend/i);
  });

  it("never puts the private Business POS into a plan card", () => {
    expect(Object.keys(PLAN_INCLUDES)).toEqual(["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
    expect(Object.keys(PLAN_INCLUDES)).not.toContain("BUSINESS_POS");
    expect(Object.values(PLAN_INCLUDES).flat().join(" ")).not.toMatch(/point of sale|point-of-sale|POS/i);
  });

  it("never puts the private JATA Autopilot plans into a plan card", () => {
    for (const key of ["JATA_AUTOPILOT", "JATA_AUTOPILOT_PRO", "JATA_AUTOPILOT_ENTERPRISE"]) {
      expect(Object.keys(PLAN_INCLUDES), key).not.toContain(key);
      expect(Object.keys(PLAN_BADGES), key).not.toContain(key);
    }
    expect(Object.values(PLAN_INCLUDES).flat().join(" ")).not.toMatch(/autopilot/i);
  });

  it("gives every advertised plan its established product icon", () => {
    expect(Object.keys(PLAN_ICONS)).toEqual(["MONTHLY", "ANNUAL", "AI_BUSINESS_FRONT_DESK", "INTERACTIVE_BUSINESS"]);
    // The separate-product cards carry dedicated marks: the storefront, the spark and the ledger.
    expect(POS_PLAN_CARD.icon).toBe("store");
    expect(AUTOPILOT_PLAN_CARD.icon).toBe("spark");
    expect(ERP_PRO_PLAN_CARD.icon).toBe("ledger");
    // The ledger icon exists in the landing icon set with an accessible-hidden SVG.
    const icons = readFileSync(path.join(root, "components/landing/Icons.tsx"), "utf8");
    expect(icons).toMatch(/ledger:\s*\(/);
    expect(icons).toContain('aria-hidden="true"');
  });

  it("keeps the JATA BOS PRO card truthful: renamed product, separate from POS, exclusions stated, no eTIMS claim", () => {
    // Customer-facing name and subtitle exactly as renamed; the internal key is never marketing copy.
    expect(ERP_PRO_PLAN_CARD.name).toBe("JATA BOS PRO");
    expect(ERP_PRO_PLAN_CARD.subtitle).toBe("Business Operating System Pro");
    // Explains how it differs from the separate Business POS product.
    const copy = [ERP_PRO_PLAN_CARD.blurb, ...ERP_PRO_PLAN_CARD.includes, ERP_PRO_PLAN_CARD.fine].join(" ");
    expect(copy).toMatch(/Business POS/);
    expect(copy).toMatch(/Beyond the separate Business POS till/);
    // States the excluded provider charges.
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/SMS and WhatsApp usage charges/);
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/Sender ID fees/);
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/payment-provider fees/);
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/KRA eTIMS certification or integrator fees are excluded/);
    // Claims no eTIMS certification or hardware integration, and no price inside the copy.
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/eTIMS submission is not claimed as certified/i);
    expect(copy).not.toMatch(/KES\s?[\d,]+/);
    expect(copy).not.toMatch(/certified (adapter|integration) (is|available)/i);
    // Viewing starts nothing: activation wording is explicit.
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/Viewing the product starts nothing/);
    expect(ERP_PRO_PLAN_CARD.fine).toMatch(/after the server confirms the payment/i);
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
    // The card's destination is the existing authenticated route; the page knows no other POS path.
    expect(page).toContain('"/dashboard/pos"');
    expect(page).not.toMatch(/dashboard\/pos\//);
    expect(page).not.toContain("/checkout");
    // The card says in words that it is owner-only (copy lives in lib/landing.ts).
    expect(readFileSync(path.join(root, "lib/landing.ts"), "utf8")).toContain("It is owner-only");
  });

  it("is still gated by the existing server-side sign-in redirect", () => {
    const route = readFileSync(path.join(root, "app/dashboard/pos/page.tsx"), "utf8");
    expect(route).toContain('if (!session) redirect("/login")');
    expect(route).toContain("getOwnedBusinessIds");
  });

  it("sits in the shared pricing grid but never on a demo or customer-facing page", () => {
    // 2026-10-25: the POS is the homepage's fifth card; payable choices still come only from
    // publiclyListedPlans(), which keeps excluding it.
    expect(page).toContain("homepagePlanCards");
    expect(readFileSync(path.join(root, "lib/pricing.ts"), "utf8")).toContain("publiclyListedPlans");
    for (const file of ["components/BusinessPage.tsx", "components/storefront/DemoShowcaseBand.tsx", "lib/demoShowcase.ts"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/Business POS|BUSINESS_POS/);
    }
    // The card copy and the FAQ answer both keep it separate from the four page plans.
    expect(POS_PLAN_CARD.badge).toBe("Owner-only");
    expect(POS_PLAN_CARD.blurb).toMatch(/separate from your page plan/i);
    expect(POS_PLAN_CARD.fine).toMatch(/switches on only once Paystack confirms the payment/i);
    const faq = LANDING_FAQ.find((item) => item.question.includes("POS"))!;
    expect(faq.answer).toMatch(/separate owner-only point-of-sale/);
    expect(faq.answer).toMatch(/not included in, and not required for, the four page plans/i);
  });
});

describe("the owner-only JATA Autopilot stays owner-only", () => {
  const page = readFileSync(path.join(root, "app/page.tsx"), "utf8");

  it("links into the authenticated Autopilot flow and nothing else", () => {
    expect(page).toContain('"/dashboard/autopilot"');
    expect(page).not.toMatch(/dashboard\/autopilot\//);
    expect(page).not.toContain("/checkout");
    expect(readFileSync(path.join(root, "lib/landing.ts"), "utf8")).toContain("It is owner-only");
  });

  it("is still gated by the existing server-side sign-in redirect", () => {
    const route = readFileSync(path.join(root, "app/dashboard/autopilot/page.tsx"), "utf8");
    expect(route).toContain('if (!session) redirect("/login")');
  });

  it("keeps the card copy inside verified capability and separate from the page plans", () => {
    expect(AUTOPILOT_PLAN_CARD.badge).toBe("Owner-only add-on");
    expect(AUTOPILOT_PLAN_CARD.blurb).toMatch(/separate from your page plan/i);
    expect(AUTOPILOT_PLAN_CARD.fine).toMatch(/preview is free/i);
    expect(AUTOPILOT_PLAN_CARD.fine).toMatch(/only once Paystack confirms the payment/i);
    const cardCopy = [AUTOPILOT_PLAN_CARD.blurb, ...AUTOPILOT_PLAN_CARD.includes].join(" ");
    // Approval-first is the shipped behaviour; live customer messaging is never promised here.
    expect(cardCopy).toMatch(/nothing runs without your approval/i);
    expect(cardCopy).not.toMatch(/sends? (whatsapp|sms|messages?)/i);
    expect(cardCopy).not.toMatch(/KES\s?[\d,]+/);
    const faq = LANDING_FAQ.find((item) => item.question.includes("Autopilot"))!;
    expect(faq).toBeTruthy();
    expect(faq.answer).toMatch(/separate owner-only add-on/);
    expect(faq.answer).toMatch(/not included in, and not required for, the four page plans/i);
  });
});

describe("demo cards", () => {
  it("verifies synthetic identity using the dedicated owner and payment namespace, not slug alone", () => {
    const slug = "nyumbani-kitchen";
    expect(isVerifiedDemoRecord({ slug, ownerEmail: DEMO_OWNER_EMAIL, paymentReferences: [`${DEMO_PAYMENT_PREFIX}${slug}`] })).toBe(true);
    expect(isVerifiedDemoRecord({ slug, ownerEmail: "real-owner@example.com", paymentReferences: [] })).toBe(false);
    expect(isVerifiedDemoRecord({ slug, ownerEmail: DEMO_OWNER_EMAIL, paymentReferences: ["PSK_real_customer"] })).toBe(false);
    expect(isVerifiedDemoRecord({ slug: "real-business", ownerEmail: DEMO_OWNER_EMAIL, paymentReferences: [] })).toBe(false);
  });

  it("always lists the four demo businesses in the documented order", () => {
    expect([...LANDING_DEMO_SLUGS]).toEqual(["nyumbani-kitchen", "marys-beauty-studio", "kamau-auto-care", "john-kamau-properties"]);
    expect(buildLandingDemoCards([]).map((card) => card.slug)).toEqual([...LANDING_DEMO_SLUGS]);
    expect(buildLandingDemoCards(null).map((card) => card.slug)).toEqual([...LANDING_DEMO_SLUGS]);
  });

  it("uses clearly labelled fictional fallback content without linking to missing routes", () => {
    const cards = buildLandingDemoCards(null);
    for (const [index, card] of cards.entries()) {
      const demo = DEMO_BUSINESSES[index];
      expect(card.source).toBe("example");
      expect(card.routeAvailable).toBe(false);
      expect(card.name).toBe(demo.name);
      expect(card.services.map((service) => service.title)).toEqual(demo.services.map((service) => service.title));
      expect(card.services.map((service) => service.priceLabel)).toEqual(demo.services.map((service) => service.priceLabel));
      expect(card.offer?.title).toBe(demo.slug === "john-kamau-properties" ? undefined : demo.offer.title);
    }
  });

  it("uses active service prices and safely labels an eligible published demo route", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const row = eligibleLandingRow("nyumbani-kitchen", {
      services: [{ title: "Ugali & Sukuma", priceLabel: "KES 350", priceFrom: 350, isActive: true }],
      offer: { title: "Stale database wording", subtitle: "Today only", isActive: true, validUntil: new Date("2026-10-25T00:00:00.000Z") },
    });
    const [first] = buildLandingDemoCards([row], now);
    expect(first.source).toBe("live");
    expect(first.routeAvailable).toBe(true);
    expect(first.services).toEqual([{ title: "Ugali & Sukuma", priceLabel: "KES 350" }]);
    expect(first.offer).toEqual(DEMO_BUSINESSES[0].offer);
    expect(first.offer?.title).not.toBe("Stale database wording");
  });

  it("does not relabel or link a real owner row that happens to use a demo slug", () => {
    const row = eligibleLandingRow("nyumbani-kitchen", {
      name: "Authorized Kitchen",
      isVerifiedDemo: false,
      services: [{ title: "Owner's actual menu", priceLabel: "KES 999", priceFrom: 999, isActive: true }],
    });
    const card = buildLandingDemoCards([row])[0];
    expect(card.routeAvailable).toBe(false);
    expect(card.source).toBe("example");
    expect(card.name).toBe(DEMO_BUSINESSES[0].name);
    expect(card.services.map((service) => service.title)).not.toContain("Owner's actual menu");
  });

  it("filters inactive services and inactive or expired offers", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const row = eligibleLandingRow("marys-beauty-studio", {
      location: null,
      services: [
        { title: "Hidden", priceLabel: "KES 1", priceFrom: 1, isActive: false },
        { title: "Gel nails", priceLabel: null, priceFrom: 1200, isActive: true },
      ],
      offer: { title: "Expired database offer", subtitle: null, isActive: true, validUntil: new Date("2026-10-23T23:59:59.000Z") },
    });
    const card = buildLandingDemoCards([row], now).find((entry) => entry.slug === "marys-beauty-studio")!;
    expect(card.routeAvailable).toBe(true);
    expect(card.services).toEqual([{ title: "Gel nails", priceLabel: "From KES 1,200" }]);
    expect(card.location).toBe("Kitengela, Kajiado");
    expect(card.offer).toBeNull();

    const inactiveOfferRow = eligibleLandingRow("marys-beauty-studio", {
      offer: { title: "Inactive database offer", subtitle: null, isActive: false, validUntil: null },
    });
    expect(buildLandingDemoCards([inactiveOfferRow], now).find((entry) => entry.slug === "marys-beauty-studio")!.offer).toBeNull();
  });

  it("marks a row unavailable when unpublished, non-ACTIVE or missing active services", () => {
    const unpublished = eligibleLandingRow("kamau-auto-care", { isPublished: false });
    const suspended = eligibleLandingRow("kamau-auto-care", { status: "SUSPENDED" });
    const noServices = eligibleLandingRow("kamau-auto-care", { services: [{ title: "Off", priceLabel: "KES 1", priceFrom: 1, isActive: false }] });
    for (const row of [unpublished, suspended, noServices]) {
      const card = buildLandingDemoCards([row]).find((entry) => entry.slug === "kamau-auto-care")!;
      expect(card.source).toBe("example");
      expect(card.routeAvailable).toBe(false);
      expect(card.services.length).toBeGreaterThan(0);
    }
  });

  it("the browser checker asserts collected page errors and route availability", () => {
    const checker = readFileSync(path.join(root, "scripts/browser/landing-showcase.check.mjs"), "utf8");
    expect(checker).toContain('page.on("pageerror", (error) => interactionErrors.push');
    expect(checker).toContain("interactionErrors.length === 0");
    expect(checker).toContain("data-route-available");
    expect(checker).toContain("eligible demo destination responds successfully");
    expect(checker).not.toMatch(/check\(["']no page errors during interaction["'],\s*true\)/);
  });

  it("renders links only for eligible destinations, including the footer sitemap", () => {
    const rows = [eligibleLandingRow("nyumbani-kitchen"), eligibleLandingRow("marys-beauty-studio", { isPublished: false })];
    const cards = buildLandingDemoCards(rows);
    const showcase = renderToStaticMarkup(createElement(DemoShowcase, { cards }));
    expect(showcase).toContain('href="/b/nyumbani-kitchen"');
    expect(showcase).not.toContain('href="/b/marys-beauty-studio"');
    expect(showcase).toContain('data-route-available="false"');
    const hero = readFileSync(path.join(root, "components/landing/Hero.tsx"), "utf8");
    expect(hero).not.toMatch(/href=["']\/b\//);
    const footer = renderToStaticMarkup(createElement(LandingFooter, { availableDemoSlugs: cards.filter((card) => card.routeAvailable).map((card) => card.slug) }));
    expect(footer).toContain('href="/b/nyumbani-kitchen"');
    expect(footer).not.toContain('href="/b/marys-beauty-studio"');
    expect(footer).not.toContain('href="/b/kamau-auto-care"');
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

  it("eager-loads the active showcase panel and lazy-loads the hidden panels", () => {
    // Regression for the blank showcase image: the first panel must not depend on an
    // IntersectionObserver before it can paint; the three hidden panels stay lazy.
    const cards = buildLandingDemoCards(null);
    const markup = renderToStaticMarkup(createElement(DemoShowcase, { cards }));
    const eager: string[] = markup.match(/<img[^>]*loading="eager"[^>]*>/g) ?? [];
    const lazy: string[] = markup.match(/<img[^>]*loading="lazy"[^>]*>/g) ?? [];
    expect(eager).toHaveLength(1);
    expect(eager[0]).toContain(`${cards[0].image}.jpg`);
    expect(eager[0]).toContain('fetchPriority="high"');
    expect(lazy).toHaveLength(cards.length - 1 + 1); // three hidden panels + the property inset frame
    expect(lazy.every((img) => !img.includes(cards[0].image))).toBe(true);
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
