/**
 * "Fix with JATA" (§36, §46, §53)
 *
 * Website-health checks end in an action, never in advice the owner has to translate into work.
 * Each fix is a small, reviewable edit to the *draft* document built only from facts the business
 * already gave us: its name, its own description, its phone number, its opening hours, its
 * catalogue. A fix never publishes, never prices, never writes contact details that were not
 * already there, and never invents a claim (Content Truth Principle, §53).
 *
 * The whole module is pure: it takes a document and returns a document, so the Studio can show a
 * before/after, and the tests can prove every branch.
 */

import type { ExperienceDocument, ExperienceSection, SectionType } from "../experience/types";
import { getExperienceProfile } from "../experience/categories";
import { sectionDefinition } from "../experience/sections";

import type { StudioFixId } from "./health";

export type { StudioFixId };

export type FixContext = {
  businessName: string;
  description?: string | null;
  location?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  openingHours?: Record<string, string> | null;
};

export type FixOutcome =
  | { status: "applied"; document: ExperienceDocument; summary: string; changedSections: string[] }
  | { status: "skipped"; reason: string; needsOwnerInput?: { field: string; href: string; label: string } };

export const STUDIO_FIX_IDS: StudioFixId[] = [
  "hero-copy",
  "add-primary-cta",
  "show-contact",
  "feature-items",
  "compact-mobile",
  "seo-copy",
  "hours-section",
  "whatsapp-number",
];

function firstSentence(text: string | null | undefined, max = 120): string {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const cut = clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
  return cut;
}

function clone(document: ExperienceDocument): ExperienceDocument {
  return {
    ...document,
    brand: { ...document.brand },
    settings: { ...document.settings },
    seo: { ...(document.seo || {}) },
    sections: document.sections.map((section) => ({ ...section })),
  };
}

function findSection(document: ExperienceDocument, type: SectionType): ExperienceSection | undefined {
  return document.sections.find((section) => section.type === type);
}

/** Adds a section from the registry's own defaults, so a fix can never invent a new shape. */
function addSection(document: ExperienceDocument, type: SectionType, context: FixContext): ExperienceSection | null {
  const definition = sectionDefinition(type);
  if (!definition) return null;
  const profile = getExperienceProfile(document.categoryKey);
  const created = definition.defaults(profile, { businessName: context.businessName, location: context.location ?? null });
  const section: ExperienceSection = { ...created, id: `${type}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}` };
  document.sections.push(section);
  return section;
}

export function applyStudioFix(document: ExperienceDocument, fixId: StudioFixId, context: FixContext): FixOutcome {
  if (!document) return { status: "skipped", reason: "There is no website draft to change yet." };
  const next = clone(document);
  const profile = getExperienceProfile(next.categoryKey);
  const businessName = context.businessName || next.brand.businessName || "";

  switch (fixId) {
    case "hero-copy": {
      // The headline is the owner's own name; the sub-line is their own sentence about the
      // business. Nothing is written that the business did not already tell us.
      const hero = findSection(next, "hero") || addSection(next, "hero", context);
      if (!hero) return { status: "skipped", reason: "This website has no opening section." };
      hero.visible = true;
      hero.title = (hero.title && hero.title.trim()) || businessName || profile.label;
      const fromOwner = firstSentence(context.description || next.brand.description, 120);
      if (!hero.subtitle || !hero.subtitle.trim()) {
        if (fromOwner) hero.subtitle = fromOwner;
      }
      const changed = [hero.id];
      if (!next.brand.description && context.description) next.brand.description = firstSentence(context.description, 200);
      return {
        status: "applied",
        document: next,
        summary: fromOwner
          ? "Used your own words as the opening line, with your business name as the headline."
          : "Made sure your business name leads the page. Add a line about what you do and customers will know immediately.",
        changedSections: changed,
      };
    }

    case "add-primary-cta": {
      const existing = findSection(next, "cta");
      const label = profile.cta.primary.slice(0, 30);
      if (existing) {
        existing.visible = true;
        if (!existing.cta?.label) existing.cta = { label, href: "#contact" };
        return {
          status: "applied",
          document: next,
          summary: `Your closing button now says “${existing.cta?.label || label}”.`,
          changedSections: [existing.id],
        };
      }
      const created = addSection(next, "cta", context);
      if (!created) return { status: "skipped", reason: "This website cannot show a closing action." };
      created.cta = { label, href: "#contact" };
      return {
        status: "applied",
        document: next,
        summary: `Added one clear closing action: “${label}”.`,
        changedSections: [created.id],
      };
    }

    case "show-contact": {
      const contact = findSection(next, "contact") || addSection(next, "contact", context);
      if (!contact) return { status: "skipped", reason: "This website cannot show contact buttons." };
      contact.visible = true;
      if (!contact.title) contact.title = "Get in touch";
      const hasContact = Boolean(next.settings.phone || next.settings.whatsapp || next.settings.email);
      return {
        status: "applied",
        document: next,
        summary: hasContact
          ? "Your contact section is visible, so customers can call or message you from the page."
          : "Your contact section is visible. Add your phone or WhatsApp number so the buttons work.",
        changedSections: [contact.id],
      };
    }

    case "feature-items": {
      const existing = findSection(next, "featured");
      if (existing) {
        existing.visible = true;
        existing.limit = Math.min(Math.max(existing.limit ?? 6, 2), 8);
        return {
          status: "applied",
          document: next,
          summary: `Showing up to ${existing.limit} highlighted ${profile.itemNounPlural.toLowerCase()} near the top of your page.`,
          changedSections: [existing.id],
        };
      }
      const created = addSection(next, "featured", context);
      if (!created) return { status: "skipped", reason: "This website cannot highlight items yet." };
      created.limit = 6;
      if (!created.title) created.title = profile.capabilities.includes("booking") ? "Popular services" : `Popular ${profile.itemNounPlural.toLowerCase()}`;
      return {
        status: "applied",
        document: next,
        summary: `Added a highlight row for your best ${profile.itemNounPlural.toLowerCase()}. Use “Featured” on an item to place it there.`,
        changedSections: [created.id],
      };
    }

    case "compact-mobile": {
      const targets = next.sections.filter((section) => ["menu", "services", "properties", "collections", "featured"].includes(section.type));
      if (targets.length === 0) return { status: "skipped", reason: "Your layout is already comfortable on a phone." };
      let changed = 0;
      for (const section of targets) {
        if ((section.limit ?? 0) > 6 || !section.limit) {
          section.limit = 6;
          changed += 1;
        }
        if (!section.layout) {
          section.layout = "compact";
          changed += 1;
        }
      }
      return {
        status: "applied",
        document: next,
        summary:
          changed > 0
            ? "Limited long lists to six items per row so the page stays quick to scroll on a phone."
            : "Your layout is already comfortable on a phone.",
        changedSections: targets.map((section) => section.id),
      };
    }

    case "seo-copy": {
      const place = firstSentence(context.location || next.settings.location, 40);
      const title = [businessName || profile.label, place ? `in ${place}` : "", profile.label].filter(Boolean).join(" · ").slice(0, 70);
      const ownerLine = firstSentence(context.description || next.brand.description, 110);
      const description = (
        ownerLine ||
        `${profile.label}${place ? ` in ${place}` : ""}. Browse ${profile.itemNounPlural.toLowerCase()}, prices and contact details.`
      ).slice(0, 160);
      next.seo = { ...(next.seo || {}), title, description };
      return {
        status: "applied",
        document: next,
        summary: "Wrote your search title and description from your own details — open Design to adjust the words.",
        changedSections: [],
      };
    }

    case "hours-section": {
      const hours = context.openingHours || next.settings.openingHours || null;
      if (!hours || Object.keys(hours).length === 0) {
        return {
          status: "skipped",
          reason: "Add your opening hours first and JATA will put them on the page.",
          needsOwnerInput: { field: "openingHours", href: "theme", label: "Add opening hours" },
        };
      }
      const existing = findSection(next, "hours") || addSection(next, "hours", context);
      if (!existing) return { status: "skipped", reason: "This website cannot show opening hours." };
      existing.visible = true;
      return {
        status: "applied",
        document: next,
        summary: "Added your opening hours so customers know when to visit.",
        changedSections: [existing.id],
      };
    }

    case "whatsapp-number": {
      const candidate = String(context.whatsapp || context.phone || next.settings.whatsapp || next.settings.phone || "").trim();
      if (!candidate) {
        return {
          status: "skipped",
          reason: "Add your WhatsApp number and JATA will switch on WhatsApp ordering.",
          needsOwnerInput: { field: "phone", href: "theme", label: "Add phone number" },
        };
      }
      if (next.settings.whatsapp === candidate) {
        return { status: "skipped", reason: "WhatsApp already uses this number." };
      }
      next.settings.whatsapp = candidate;
      return {
        status: "applied",
        document: next,
        summary: "Switched on WhatsApp ordering with the number on your account.",
        changedSections: [],
      };
    }

    default:
      return { status: "skipped", reason: "That fix is not available." };
  }
}

/** True when the id is one JATA may apply without asking the owner anything else. */
export function isStudioFixId(value: unknown): value is StudioFixId {
  return typeof value === "string" && (STUDIO_FIX_IDS as string[]).includes(value);
}
