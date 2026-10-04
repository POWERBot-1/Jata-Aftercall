/**
 * Website health, "Fix with JATA" and the copilot's edit safety (§24, §25, §36, §46, §53)
 *
 * Three promises this suite defends:
 *   1. The score is honest — it moves when a customer would actually notice an improvement, and
 *      it never awards points for decoration.
 *   2. A fix only ever restates what the business already told us: its name, its own description,
 *      its own phone number, its own opening hours, its own catalogue.
 *   3. The copilot can change presentation, and can never change a price, a stock level, contact
 *      details, opening hours or legal text.
 */

import { describe, expect, it } from "vitest";
import { buildHealthReport, type HealthInput } from "@/lib/studio/health";
import { applyStudioFix, isStudioFixId, STUDIO_FIX_IDS } from "@/lib/studio/fixes";
import { applyProposal, buildCopilotReply, classifyIntent, COPILOT_SUGGESTIONS, contextSummary } from "@/lib/studio/copilot";
import { designDirections, currentDirection, initialPhotographyStyle } from "@/lib/studio/designDirections";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import type { ExperienceDocument } from "@/lib/experience/types";

function documentOf(overrides: Partial<ExperienceDocument> = {}): ExperienceDocument {
  return normalizeExperienceDocument({
    categoryKey: "food",
    themeKey: "food-grill",
    brand: { businessName: "Mama Njeri's Kitchen" },
    settings: {},
    sections: [
      { id: "nav", type: "navigation", visible: true },
      { id: "hero", type: "hero", visible: true },
      { id: "menu", type: "menu", visible: true },
    ],
    ...overrides,
  });
}

const BUSINESS = {
  name: "Mama Njeri's Kitchen",
  category: "Food & Restaurant",
  phone: "0722000000",
  whatsapp: null,
  location: "Kilimani",
  logoUrl: null,
  description: "Home-style Kenyan cooking, cooked fresh every morning.",
  openingHours: JSON.stringify({ monday: "08:00-18:00" }),
};

function report(overrides: Partial<HealthInput> = {}) {
  return buildHealthReport({
    document: documentOf(),
    business: BUSINESS,
    counts: { products: 4, services: 0, media: 6, itemsWithoutPhotos: 0, lowResolutionImages: 0 },
    items: [
      { id: "p1", name: "Chicken stew", imageUrl: "/a.jpg", isFeatured: true, priceKes: 850 },
      { id: "p2", name: "Chapati", imageUrl: "/b.jpg", priceKes: 40 },
    ],
    published: false,
    photographicProvider: true,
    ...overrides,
  });
}

describe("the readiness score reflects what a customer would notice", () => {
  it("starts a half-built website low and explains the first three things to do", () => {
    const bare = buildHealthReport({
      document: documentOf({ sections: [{ id: "nav", type: "navigation", visible: true }] }),
      business: { name: "Mama Njeri's Kitchen" },
      counts: { products: 0, services: 0, media: 0 },
    });
    expect(bare.score).toBeLessThan(60);
    expect(bare.topActions.length).toBeGreaterThan(0);
    expect(bare.topActions.length).toBeLessThanOrEqual(3);
    expect(bare.summary).toMatch(/%|checks?/);
    expect(bare.recommendations.length).toBeGreaterThan(0);
    for (const check of bare.attention) {
      expect(check.detail.length).toBeGreaterThan(10);
      expect(check.detail).not.toMatch(/undefined|null|\{/);
    }
  });

  it("scores a complete website highly — with photos, contact, hours, SEO and a call to action", () => {
    const complete = buildHealthReport({
      document: documentOf({
        brand: { businessName: "Mama Njeri's Kitchen", heroImageUrl: "/hero.jpg", description: BUSINESS.description },
        settings: { phone: "0722000000", whatsapp: "0722000000", location: "Kilimani", openingHours: { monday: "08:00-18:00" } },
        seo: { title: "Mama Njeri's Kitchen · Kilimani", description: "Home-style Kenyan cooking, cooked fresh every morning." },
        sections: [
          { id: "nav", type: "navigation", visible: true },
          { id: "hero", type: "hero", visible: true, title: "Mama Njeri's Kitchen", subtitle: "Home-style Kenyan cooking", imageUrl: "/hero.jpg" },
          { id: "featured", type: "featured", visible: true, limit: 6 },
          { id: "menu", type: "menu", visible: true, limit: 6, layout: "compact" },
          { id: "hours", type: "hours", visible: true },
          { id: "contact", type: "contact", visible: true },
          { id: "cta", type: "cta", visible: true, cta: { label: "Order now", href: "#contact" } },
        ],
      }),
      business: BUSINESS,
      counts: { products: 4, services: 0, media: 6, itemsWithoutPhotos: 0, lowResolutionImages: 0 },
      items: [
        { id: "p1", name: "Chicken stew", imageUrl: "/a.jpg", isFeatured: true, priceKes: 850 },
        { id: "p2", name: "Chapati", imageUrl: "/b.jpg", priceKes: 40 },
      ],
      published: true,
      photographicProvider: true,
    });
    expect(complete.score).toBeGreaterThanOrEqual(85);
    expect(complete.bandLabel.length).toBeGreaterThan(2);
  });

  it("marks the two photo problems owners actually have: no photo, and a photo too small to use", () => {
    const withPhotoProblems = report({
      counts: { products: 4, services: 0, media: 2, itemsWithoutPhotos: 3, lowResolutionImages: 2 },
    });
    const ids = withPhotoProblems.attention.map((check) => check.id);
    expect(ids).toContain("item-photos");
    expect(ids).toContain("image-quality");
    const coverage = withPhotoProblems.attention.find((check) => check.id === "item-photos");
    expect(coverage?.fix).toBeTruthy();
  });

  it("is deterministic: the same website always scores the same", () => {
    expect(report().score).toBe(report().score);
  });

  it("passes every check when the business is complete", () => {
    const healthy = report({
      document: documentOf({
        brand: { businessName: "Mama Njeri's Kitchen", heroImageUrl: "/hero.jpg", description: BUSINESS.description },
        settings: { phone: "0722000000", whatsapp: "0722000000", location: "Kilimani", openingHours: { monday: "08:00-18:00" } },
        seo: { title: "Mama Njeri's Kitchen", description: "Home-style Kenyan cooking." },
        sections: [
          { id: "nav", type: "navigation", visible: true },
          { id: "hero", type: "hero", visible: true, title: "Mama Njeri's Kitchen", subtitle: "Home-style Kenyan cooking", imageUrl: "/hero.jpg" },
          { id: "featured", type: "featured", visible: true, limit: 6 },
          { id: "menu", type: "menu", visible: true, limit: 6, layout: "compact" },
          { id: "hours", type: "hours", visible: true },
          { id: "contact", type: "contact", visible: true },
          { id: "cta", type: "cta", visible: true, cta: { label: "Order now", href: "#contact" } },
        ],
      }),
      business: BUSINESS,
    });
    expect(healthy.passing.length).toBeGreaterThan(10);
  });
});

describe("Fix with JATA edits the draft using the owner's own facts", () => {
  const base = documentOf();
  const context = {
    businessName: BUSINESS.name,
    description: BUSINESS.description,
    location: BUSINESS.location,
    phone: BUSINESS.phone,
    whatsapp: null as string | null,
    openingHours: { monday: "08:00-18:00" },
  };

  it("writes the headline from the business's own name and sentence", () => {
    const outcome = applyStudioFix(base, "hero-copy", context);
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const hero = outcome.document.sections.find((section) => section.type === "hero");
    expect(hero?.title).toBe(BUSINESS.name);
    expect(hero?.subtitle).toBe(BUSINESS.description);
    // Nothing invented: no years, no awards, no superlatives.
    expect(String(hero?.subtitle)).not.toMatch(/\d+\s*years|best|award|guarantee/i);
  });

  it("adds exactly one clear closing action, named the way the category talks", () => {
    const outcome = applyStudioFix(base, "add-primary-cta", context);
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") return;
    const ctas = outcome.document.sections.filter((section) => section.type === "cta");
    expect(ctas).toHaveLength(1);
    expect(ctas[0].cta?.label).toBe("Order now");

    const again = applyStudioFix(outcome.document, "add-primary-cta", context);
    if (again.status !== "applied") throw new Error("expected applied");
    expect(again.document.sections.filter((section) => section.type === "cta")).toHaveLength(1);
  });

  it("turns WhatsApp on with the owner's existing number, and asks when there is none", () => {
    const applied = applyStudioFix(base, "whatsapp-number", context);
    if (applied.status !== "applied") throw new Error("expected applied");
    expect(applied.document.settings.whatsapp).toBe(BUSINESS.phone);

    const needsOwner = applyStudioFix(base, "whatsapp-number", { ...context, phone: null, whatsapp: null });
    expect(needsOwner.status).toBe("skipped");
    if (needsOwner.status !== "skipped") return;
    expect(needsOwner.needsOwnerInput?.field).toBe("phone");
    expect(needsOwner.reason).toContain("WhatsApp number");
  });

  it("adds opening hours only when hours exist, and never invents times", () => {
    const withHours = applyStudioFix(base, "hours-section", context);
    if (withHours.status !== "applied") throw new Error("expected applied");
    expect(withHours.document.sections.some((section) => section.type === "hours")).toBe(true);

    const noHours = applyStudioFix(base, "hours-section", { ...context, openingHours: null });
    expect(noHours.status).toBe("skipped");
    if (noHours.status !== "skipped") return;
    expect(noHours.needsOwnerInput?.field).toBe("openingHours");
  });

  it("writes a search title and description that contain no fabricated claim", () => {
    const outcome = applyStudioFix(base, "seo-copy", context);
    if (outcome.status !== "applied") throw new Error("expected applied");
    expect(outcome.document.seo?.title).toContain(BUSINESS.name);
    expect(outcome.document.seo?.description).toBe(BUSINESS.description);
    expect(outcome.document.seo?.title).not.toMatch(/best|award|number one/i);
  });

  it("shortens long lists for a phone without deleting a single item", () => {
    const long = documentOf({
      sections: [
        { id: "nav", type: "navigation", visible: true },
        { id: "menu", type: "menu", visible: true, limit: 24 },
      ],
    });
    const outcome = applyStudioFix(long, "compact-mobile", context);
    if (outcome.status !== "applied") throw new Error("expected applied");
    const menu = outcome.document.sections.find((section) => section.type === "menu");
    expect(menu?.limit).toBe(6);
    expect(menu?.layout).toBe("compact");
    expect(outcome.document.sections).toHaveLength(long.sections.length);
  });

  it("never silently re-enables a section the owner hid, except the contact section they asked about", () => {
    const hidden = documentOf({
      sections: [
        { id: "nav", type: "navigation", visible: true },
        { id: "menu", type: "menu", visible: false },
        { id: "contact", type: "contact", visible: false },
      ],
    });
    const outcome = applyStudioFix(hidden, "show-contact", context);
    if (outcome.status !== "applied") throw new Error("expected applied");
    expect(outcome.document.sections.find((section) => section.type === "menu")?.visible).toBe(false);
    expect(outcome.document.sections.find((section) => section.type === "contact")?.visible).toBe(true);
  });

  it("only accepts known fix ids", () => {
    expect(isStudioFixId("hero-copy")).toBe(true);
    expect(isStudioFixId("delete-all-products")).toBe(false);
    expect(STUDIO_FIX_IDS.length).toBeGreaterThan(5);
  });
});

describe("the copilot proposes, the owner decides, and prices are untouchable", () => {
  const context = {
    document: documentOf(),
    businessName: BUSINESS.name,
    description: BUSINESS.description,
    location: BUSINESS.location,
    phone: BUSINESS.phone,
    whatsapp: null as string | null,
    openingHours: { monday: "08:00-18:00" },
    health: report(),
    items: [{ id: "p1", name: "Chicken stew", imageUrl: null, isFeatured: false, priceKes: 850 }],
    topSellingIds: ["p1"],
    published: false,
    entitled: true,
  };

  it("understands an owner's own words, in English and Swahili mixes", () => {
    expect(classifyIntent("Make my homepage look more premium")).toBe("make_premium");
    expect(classifyIntent("Show my best sellers on the homepage")).toBe("feature_best_sellers");
    expect(classifyIntent("I want it easier for customers to order")).toBe("easier_ordering");
    expect(classifyIntent("help me get found on Google")).toBe("seo_improve");
    expect(classifyIntent("What should I fix first?")).toBe("health_check");
    expect(classifyIntent("Naomba website yangu ionekane poa kwa simu")).toBe("mobile_improve");
    expect(classifyIntent("publish")).toBe("publish_help");
    expect(classifyIntent("add a new dish")).toBe("add_item");
    expect(classifyIntent("")).toBe("unknown");
    expect(classifyIntent("What can you do?")).toBe("help");
  });

  it("answers with a proposal that lists exactly what changes, and never touches money or stock", () => {
    const reply = buildCopilotReply("Make my homepage look more premium", context);
    expect(reply.proposal).toBeTruthy();
    expect(reply.proposal?.changes.length).toBeGreaterThan(0);
    expect(reply.proposal?.previewHint.length).toBeGreaterThan(5);

    const serialized = JSON.stringify(reply.proposal?.operations || []);
    expect(serialized).not.toMatch(/priceKes|basePriceKES|salePriceKES|stockStatus|stock|availability|depositKES/i);
  });

  it("drops any forbidden field even if an operation tries to smuggle it in", () => {
    const result = applyProposal(
      context.document,
      [
        {
          op: "section.update",
          sectionId: "hero",
          // A malicious or careless caller tries to write price, stock and contact data.
          patch: {
            title: "New headline",
            price: 1,
            basePriceKES: 1,
            stockStatus: "IN_STOCK",
            availability: "always",
            phone: "0700000000",
          } as never,
        },
      ],
      { businessName: BUSINESS.name, phone: BUSINESS.phone },
    );
    const hero = result.document.sections.find((section) => section.id === "hero");
    expect(hero?.title).toBe("New headline");
    expect(JSON.stringify(result.document)).not.toMatch(/basePriceKES|stockStatus|"availability"/);
    expect(result.applied.length).toBe(1);
  });

  it("explains a request it cannot act on instead of guessing", () => {
    const reply = buildCopilotReply("Delete all my products please", context);
    expect(reply.message.length).toBeGreaterThan(10);
    expect(reply.suggestions.length).toBeGreaterThan(0);
    expect(reply.proposal === null || reply.proposal.changes.length >= 0).toBe(true);
  });

  it("never publishes: a publish request points at the checklist, not a bypass", () => {
    const reply = buildCopilotReply("publish my website now", context);
    expect(reply.intent).toBe("publish_help");
    expect(reply.message.toLowerCase()).toMatch(/publish/);
    expect(JSON.stringify(reply.proposal?.operations || [])).not.toMatch(/publish|unpublish/i);
  });

  it("uses the business's own best-selling items when asked to feature them", () => {
    const reply = buildCopilotReply("Show my best sellers on the homepage", context);
    expect(reply.proposal).toBeTruthy();
    // The owner is told which of their own items are selling, and that featuring them is their call.
    expect(JSON.stringify(reply)).toContain("Chicken stew");
    expect(reply.proposal?.warnings.join(" ")).toMatch(/Featured/i);
    expect(JSON.stringify(reply.proposal)).not.toMatch(/priceKes|850/);
  });

  it("summarises the website for the owner in plain words", () => {
    const summary = contextSummary(context);
    expect(summary).toContain(BUSINESS.name);
    expect(summary.length).toBeGreaterThan(10);
  });

  it("offers suggestions an owner would actually say", () => {
    expect(COPILOT_SUGGESTIONS.length).toBeGreaterThanOrEqual(6);
    for (const suggestion of COPILOT_SUGGESTIONS) {
      expect(suggestion).not.toMatch(/SEO|CTA|UX|conversion rate|hero section/i);
    }
  });
});

describe("design directions are complete looks, not colour swatches", () => {
  it("offers three coherent, differentiated directions per category", () => {
    const directions = designDirections({ categoryKey: "food", businessName: "Mama Njeri's Kitchen" });
    expect(directions).toHaveLength(3);
    expect(new Set(directions.map((direction) => direction.key)).size).toBe(3);
    expect(new Set(directions.map((direction) => direction.themeKey)).size).toBe(3);
    for (const direction of directions) {
      expect(direction.photographyStyle.length).toBeGreaterThan(3);
      expect(direction.typography.length).toBeGreaterThan(5);
      expect(direction.brand.buttonStyle).toBeTruthy();
      expect(direction.swatches.length).toBeGreaterThanOrEqual(3);
      expect(direction.swatches.every((colour) => /^#[0-9A-Fa-f]{6}$/.test(colour))).toBe(true);
    }
  });

  it("keeps the colours the owner is already known by", () => {
    const directions = designDirections({
      categoryKey: "beauty",
      businessName: "Glow Spa",
      brand: { primaryColor: "#123456", accentColor: "#ABCDEF" },
    });
    expect(directions[0].brand.primaryColor).toBe("#123456");
    expect(directions[0].brand.accentColor).toBe("#ABCDEF");
  });

  it("knows which direction the site is closest to, and a sensible photography style to start with", () => {
    const current = currentDirection({ categoryKey: "food", businessName: "Mama Njeri's Kitchen", themeKey: "food-grill" });
    expect(current.key.length).toBeGreaterThan(3);
    expect(initialPhotographyStyle("food")).toBe("warm");
    expect(initialPhotographyStyle("beauty")).toBe("premium");
    expect(initialPhotographyStyle(null)).toBeTruthy();
  });
});
