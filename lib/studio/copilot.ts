/**
 * Website Studio copilot (§5, §8, §24, §25, §55)
 *
 * A contextual assistant that understands the owner's *actual* website. It answers in plain
 * language and — when a change is safe and grounded — proposes a concrete, previewable edit the
 * owner can Apply, Preview or Undo.
 *
 * Hard rules, enforced by construction:
 *   • A proposal is a list of draft operations. Nothing is written here; the client applies them
 *     through the existing experience API and can undo them with one tap.
 *   • Prices, stock, availability, contact details, legal text, hours and payment information are
 *     never modified by the copilot — there is no operation that touches them.
 *   • Copy is generated from facts the owner supplied; where a fact is missing the copilot asks
 *     for it instead of inventing it.
 *
 * The interpreter is deterministic and testable; a configured text provider is used for wording
 * that benefits from it, through `lib/ai/copyLab.ts`.
 */

import { getExperienceProfile } from "../experience/categories";
import { navigationFor } from "../experience/document";
import { sectionDefinition } from "../experience/sections";
import { designDirections } from "./designDirections";
import type { ExperienceDocument, ExperienceSection } from "../experience/types";
import type { HealthReport } from "./health";
import { applyStudioFix, type FixContext, type StudioFixId } from "./fixes";

export type CopilotOperation =
  | { op: "theme.set"; themeKey: string }
  | { op: "brand.update"; brand: { primaryColor?: string; accentColor?: string; secondaryColor?: string; buttonStyle?: string; tagline?: string; fontPairing?: string } }
  | { op: "design.set"; photographyStyle: string; directionKey: string }
  | { op: "section.update"; sectionId: string; patch: Partial<ExperienceSection> }
  | { op: "section.add"; type: ExperienceSection["type"] }
  | { op: "section.toggle"; sectionId: string; visible: boolean }
  | { op: "section.move"; sectionId: string; direction: "up" | "down" }
  | { op: "seo.update"; seo: { title?: string; description?: string } }
  | { op: "studio.fix"; fixId: StudioFixId };

export type CopilotProposal = {
  title: string;
  summary: string;
  /** Plain-language list of exactly what will change. */
  changes: string[];
  /** Things the owner should know before applying. */
  warnings: string[];
  operations: CopilotOperation[];
  /** How to see the result. */
  previewHint: string;
  /** true when the proposal edits content the owner supplied. */
  requiresReview: boolean;
};

export type CopilotAction =
  | { kind: "navigate"; href: string; label: string }
  | { kind: "photo-lab"; label: string; subjectType: "PRODUCT" | "SERVICE" | "BUSINESS"; subjectId: string | null; subjectName: string }
  | { kind: "assist"; label: string; sectionId: string | null; field: "title" | "subtitle" | "body" }
  | { kind: "ask"; question: string };

export type CopilotReply = {
  intent: CopilotIntent;
  message: string;
  proposal: CopilotProposal | null;
  actions: CopilotAction[];
  /** Follow-up chips the UI can show under the answer. */
  suggestions: string[];
};

export type CopilotIntent =
  | "make_premium"
  | "add_item"
  | "write_description"
  | "item_photos"
  | "hero"
  | "feature_best_sellers"
  | "easier_ordering"
  | "mobile_improve"
  | "seo_improve"
  | "publish_help"
  | "health_check"
  | "help"
  | "unknown";

export type CopilotContext = {
  document: ExperienceDocument;
  businessName: string;
  description?: string | null;
  location?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  openingHours?: Record<string, string> | null;
  health: HealthReport;
  items: Array<{ id: string; name: string; imageUrl: string | null; isFeatured?: boolean; priceKes?: number | null }>;
  services?: Array<{ id: string; name: string; imageUrl: string | null }>;
  /** Best-selling item ids from the business's own order history, when available. */
  topSellingIds?: string[];
  published?: boolean;
  entitled?: boolean;
};

export const COPILOT_SUGGESTIONS = [
  "Make my homepage look more premium",
  "Show my best sellers on the homepage",
  "Make the website easier for customers to order",
  "Improve my homepage for mobile",
  "Create an opening image for my business",
  "Write a better description for my services",
  "Improve my search description",
  "What should I fix first?",
];

function normalize(message: string): string {
  return String(message || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Cheap, deterministic intent routing — no provider call needed to know what is being asked. */
export function classifyIntent(message: string): CopilotIntent {
  const text = normalize(message);
  if (!text) return "unknown";
  if (/\b(premium|expensive|high[- ]end|luxur|classy|upscale|posh)\b/.test(text)) return "make_premium";
  if (/\b(add|create|new)\b.*\b(product|item|dish|service|package)\b/.test(text)) return "add_item";
  if (/\b(photo|picture|image|photograph)\b/.test(text) && /\b(create|make|generate|professional|better|improve|look)\b/.test(text)) return "item_photos";
  if (/\b(describe|description|write|copy|text|wording|say)\b/.test(text) && /\b(service|product|item|dish|about)\b/.test(text)) return "write_description";
  if (/\bhero\b/.test(text) && /\b(create|make|build|add|better|improve|rewrite)\b/.test(text)) return "hero";
  if (/\b(best[- ]?sellers?|bestselling|popular|top)\b/.test(text) && /\b(show|feature|display|homepage|home page|home)\b/.test(text)) return "feature_best_sellers";
  if (/\b(easier|simpler|easy)\b.*\b(order|buy|checkout|book)\b/.test(text) || /\border(ing)?\b.*\b(easier|simple)\b/.test(text)) return "easier_ordering";
  if (/\b(mobile|phone|tablet|small screen|simu|kwenye simu)\b/.test(text)) return "mobile_improve";
  if (/\b(seo|google|search|meta|description for google)\b/.test(text)) return "seo_improve";
  if (/\b(publish|go live|make it live)\b/.test(text)) return "publish_help";
  if (/\b(health|check|audit|readiness|score|what.*fix|missing)\b/.test(text)) return "health_check";
  if (/\b(help|what can you do|options)\b/.test(text)) return "help";
  return "unknown";
}

function visibleSection(document: ExperienceDocument, type: string): ExperienceSection | null {
  return document.sections.find((section) => section.type === type && section.visible) || null;
}

function firstSentence(text: string | null | undefined, max = 120): string {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  const sentence = value.split(/(?<=[.!?])\s/)[0] || value;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

function fixContext(context: CopilotContext): FixContext {
  return {
    businessName: context.businessName,
    description: context.description,
    location: context.location,
    phone: context.phone,
    whatsapp: context.whatsapp,
    openingHours: context.openingHours ?? null,
  };
}

/** Builds the reply for one owner message. Pure: same input, same proposal. */
export function buildCopilotReply(message: string, context: CopilotContext): CopilotReply {
  const intent = classifyIntent(message);
  const profile = getExperienceProfile(context.document.categoryKey);
  const document = context.document;
  const suggestions = COPILOT_SUGGESTIONS;

  switch (intent) {
    case "make_premium": {
      const directions = designDirections({
        categoryKey: document.categoryKey,
        businessName: context.businessName,
        brand: document.brand,
        themeKey: document.themeKey,
      });
      const chosen = directions.find((direction) => direction.tone === "premium") || directions[0];
      return {
        intent,
        message: `I can move ${context.businessName || "your website"} to a more premium direction: “${chosen.name}” — ${chosen.description.toLowerCase()}`,
        proposal: {
          title: `Apply the ${chosen.name} direction`,
          summary: "Changes type, spacing, colour and button style across the whole site. Your words, prices and products stay exactly as they are.",
          changes: [
            `Theme: ${chosen.themeKey}`,
            `Primary colour: ${chosen.brand.primaryColor}`,
            `Button style: ${chosen.brand.buttonStyle}`,
            `Photography style: ${chosen.photographyStyle}`,
          ],
          warnings: ["Preview it first — this changes how every section looks."],
          operations: [
            { op: "theme.set", themeKey: chosen.themeKey },
            { op: "brand.update", brand: { ...chosen.brand } },
            { op: "design.set", photographyStyle: chosen.photographyStyle, directionKey: chosen.key },
          ],
          previewHint: "Open Preview, then Undo if you prefer your current look.",
          requiresReview: true,
        },
        actions: [],
        suggestions,
      };
    }

    case "add_item": {
      const catalogue = profile.catalogueLabel.toLowerCase();
      return {
        intent,
        message: `Adding ${profile.itemNounPlural.toLowerCase()} is quick — I won't guess your prices or details. Open your ${catalogue} and I'll help with the wording of each one.`,
        proposal: null,
        actions: [
          { kind: "navigate", href: "items", label: `Add a ${profile.itemNoun.toLowerCase()}` },
          { kind: "photo-lab", label: "Create a photo at the same time", subjectType: "PRODUCT", subjectId: null, subjectName: profile.itemNoun },
        ],
        suggestions,
      };
    }

    case "write_description": {
      const section = visibleSection(document, "services") || visibleSection(document, "menu") || visibleSection(document, "about");
      const item = context.services?.[0] || context.items[0];
      return {
        intent,
        message: item
          ? `I can write a description for “${item.name}” using only the details you have saved. You review it before it is saved.`
          : "Tell me which service or product, and I'll write a description from the details you have already given me.",
        proposal: null,
        actions: [
          { kind: "assist", label: item ? `Write a description for ${item.name}` : "Open my catalogue", sectionId: section?.id ?? null, field: "body" },
          { kind: "navigate", href: "items", label: "Open my catalogue" },
        ],
        suggestions,
      };
    }

    case "item_photos": {
      const missing = context.items.filter((item) => !item.imageUrl);
      const target = missing[0] || context.items[0] || null;
      return {
        intent,
        message: missing.length > 0
          ? `${missing.length} of your ${context.items.length} items have no photo. I can create images that match your website style — you choose which one to use.`
          : "I can create new images that match your website style, or improve photos you already have.",
        proposal: null,
        actions: [
          {
            kind: "photo-lab",
            label: target ? `Create a photo for ${target.name}` : "Create a product photo",
            subjectType: "PRODUCT",
            subjectId: target?.id ?? null,
            subjectName: target?.name || profile.itemNoun,
          },
          { kind: "navigate", href: "photos", label: "Open my photos" },
        ],
        suggestions,
      };
    }

    case "hero": {
      const ensureHero = document.sections.find((section) => section.type === "hero");
      const subtitle = firstSentence(context.description || document.brand.description, 120);
      const operations: CopilotOperation[] = [];
      if (ensureHero) {
        operations.push({
          op: "section.update",
          sectionId: ensureHero.id,
          patch: {
            visible: true,
            title: document.brand.businessName || context.businessName,
            ...(subtitle ? { subtitle } : {}),
            cta: { label: profile.cta.primary, href: "#featured" },
          },
        });
      } else {
        operations.push({ op: "section.add", type: "hero" });
      }
      return {
        intent,
        message: `I'll build the opening section from your business name${subtitle ? " and your own description" : ""}, with a “${profile.cta.primary}” button. I won't write claims you haven't given me.`,
        proposal: {
          title: "Rebuild the homepage opening section",
          summary: "Uses only your business name, your description and your business type.",
          changes: [
            `Headline: ${document.brand.businessName || context.businessName}`,
            subtitle ? "Subtitle: taken from your description" : "Subtitle: left empty for you to write (or ask me)",
            `Button: ${profile.cta.primary}`,
          ],
          warnings: subtitle ? [] : ["Add a description in Design and I can fill the supporting line too."],
          operations,
          previewHint: "Preview on mobile and desktop before publishing.",
          requiresReview: true,
        },
        actions: [],
        suggestions,
      };
    }

    case "feature_best_sellers": {
      const featured = document.sections.find((section) => section.type === "featured");
      const top = (context.topSellingIds || [])
        .map((id) => context.items.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 6);
      const operations: CopilotOperation[] = [];
      if (featured) {
        operations.push({ op: "section.update", sectionId: featured.id, patch: { visible: true, limit: top.length > 0 ? Math.min(Math.max(top.length, 3), 6) : 6 } });
      } else {
        operations.push({ op: "section.add", type: "featured" });
      }
      return {
        intent,
        message: top.length > 0
          ? `Your best sellers right now are ${top.map((item) => item.name).join(", ")}. I'll feature that many at the top of your homepage.`
          : "I'll put a “Popular right now” section on your homepage. Mark items as featured in your catalogue — or, once you have orders, I'll use your real best sellers.",
        proposal: {
          title: "Show popular items on the homepage",
          summary: "Adds or re-enables the featured section. Prices come from your catalogue, never from me.",
          changes: [
            featured ? "Featured section: made visible" : "Featured section: added",
            top.length > 0
              ? `Your best sellers from recent orders: ${top.map((item) => item.name).join(", ")}`
              : `Showing ${Math.min(Math.max(top.length, 3), 6)} items`,
          ],
          warnings:
            top.length > 0
              ? ["Mark these as Featured in Products & services so they always lead the page — I can't change your catalogue from here."]
              : [],
          operations,
          previewHint: "Preview the homepage to see the order your customers will see.",
          requiresReview: false,
        },
        actions: [{ kind: "navigate", href: "items", label: "Choose which items to feature" }],
        suggestions,
      };
    }

    case "easier_ordering": {
      const operations: CopilotOperation[] = [];
      const changes: string[] = [];
      const hero = visibleSection(document, "hero");
      if (hero && !hero.cta?.label) {
        operations.push({ op: "section.update", sectionId: hero.id, patch: { cta: { label: profile.cta.primary, href: "#featured" } } });
        changes.push(`Added a “${profile.cta.primary}” button to your opening section`);
      }
      if (!document.sections.some((section) => section.type === "cta")) {
        operations.push({ op: "section.add", type: "cta" });
        changes.push(`Added a single clear “${profile.cta.primary}” section`);
      }
      if (!visibleSection(document, "contact")) {
        operations.push({ op: "studio.fix", fixId: "show-contact" });
        changes.push("Made your contact section visible");
      }
      if (context.phone && !context.whatsapp) {
        operations.push({ op: "studio.fix", fixId: "whatsapp-number" });
        changes.push("Added a WhatsApp button using your phone number");
      }
      if (changes.length === 0) {
        return {
          intent,
          message: "Your main actions are already in place. The next biggest win is a photo of what you sell most.",
          proposal: null,
          actions: [
            { kind: "navigate", href: "preview", label: "Preview my homepage" },
            { kind: "navigate", href: "items", label: "Review my items" },
          ],
          suggestions,
        };
      }
      return {
        intent,
        message: "I'll reduce the number of competing actions and give customers one obvious next step.",
        proposal: {
          title: "Make ordering obvious",
          summary: "Adds one primary action and a WhatsApp option. Prices, availability and delivery settings are untouched.",
          changes,
          warnings: [],
          operations,
          previewHint: "Tap Preview, then try the buttons as a customer would.",
          requiresReview: false,
        },
        actions: [],
        suggestions,
      };
    }

    case "mobile_improve": {
      const heavy = document.sections.filter(
        (section) => section.visible && ["menu", "services", "properties", "categories", "collections"].includes(section.type) && (section.layout !== "compact" || (section.limit ?? 0) > 6),
      );
      if (heavy.length === 0) {
        return {
          intent,
          message: "Your sections are already sized for a phone. The remaining risk is image weight — JATA already optimizes every upload.",
          proposal: null,
          actions: [{ kind: "navigate", href: "preview", label: "Check the mobile preview" }],
          suggestions,
        };
      }
      return {
        intent,
        message: `I'll shorten ${heavy.length} long section${heavy.length === 1 ? "" : "s"} and use the compact layout so customers scroll less on a phone.`,
        proposal: {
          title: "Make the homepage comfortable on a phone",
          summary: "Layout only — your items, prices and words are unchanged.",
          changes: heavy.map((section) => `${section.title || section.type}: compact layout, up to 6 items`),
          warnings: [],
          operations: [{ op: "studio.fix", fixId: "compact-mobile" }],
          previewHint: "Use the mobile preview to scroll the whole page.",
          requiresReview: false,
        },
        actions: [],
        suggestions,
      };
    }

    case "seo_improve": {
      const name = context.businessName || document.brand.businessName;
      const title = `${name}${document.settings.location ? ` — ${document.settings.location}` : ` — ${profile.label}`}`.slice(0, 68);
      const description = firstSentence(context.description || document.brand.description, 150) ||
        `${name}${document.settings.location ? ` in ${document.settings.location}` : ""}. See ${profile.itemNounPlural.toLowerCase()}, prices and contact details.`;
      return {
        intent,
        message: "I'll write your search title and description from your own business details — no keyword stuffing, no claims.",
        proposal: {
          title: "Improve how you appear on Google",
          summary: "Adds a page title and description used by search engines and link previews.",
          changes: [`Title: ${title}`, `Description: ${description}`],
          warnings: [],
          operations: [{ op: "seo.update", seo: { title, description } }],
          previewHint: "Nothing about the visible page changes.",
          requiresReview: true,
        },
        actions: [{ kind: "navigate", href: "design", label: "Edit my search description" }],
        suggestions,
      };
    }

    case "publish_help": {
      const blockers = context.health.attention.filter((check) => ["contact", "catalogue", "hero-image", "primary-action"].includes(check.id));
      return {
        intent,
        message: context.entitled === false
          ? "Your website is ready to publish as soon as the Interactive Business plan is active — your content is saved and safe until then."
          : blockers.length > 0
            ? `Before you publish, ${blockers.length} thing${blockers.length === 1 ? "" : "s"} still need attention: ${blockers.map((check) => check.label.toLowerCase()).join(", ")}.`
            : "Everything checks out. Publish from the Overview page and your site goes live at your JATA address.",
        proposal: null,
        actions: [{ kind: "navigate", href: "overview", label: "Open publish checklist" }],
        suggestions,
      };
    }

    case "health_check": {
      const top = context.health.topActions;
      return {
        intent,
        message:
          top.length === 0
            ? `Your website readiness is ${context.health.score}%. Everything a customer needs is in place.`
            : `Your website readiness is ${context.health.score}%. The three biggest wins: ${top.map((check) => `${check.label.toLowerCase()} (${check.detail.toLowerCase()})`).join("; ")}.`,
        proposal: top.some((check) => check.fix?.kind === "apply")
          ? {
              title: "Fix the top items with JATA",
              summary: "Applies the recommended structural fixes. Business facts stay yours.",
              changes: top
                .filter((check) => check.fix?.kind === "apply")
                .map((check) => (check.fix && check.fix.kind === "apply" ? check.fix.label : check.label)),
              warnings: ["Some fixes need information only you have (for example opening hours). JATA will ask instead of guessing."],
              operations: top
                .filter((check) => check.fix?.kind === "apply")
                .map((check) => ({ op: "studio.fix" as const, fixId: (check.fix as { kind: "apply"; id: StudioFixId }).id })),
              previewHint: "Preview, then Undo if you want to go back.",
              requiresReview: true,
            }
          : null,
        actions: [{ kind: "navigate", href: "overview", label: "See the full health check" }],
        suggestions,
      };
    }

    case "help":
    default: {
      return {
        intent: intent === "help" ? "help" : "unknown",
        message:
          intent === "help"
            ? "I can restyle your website, build or rebuild sections, feature your best sellers, improve how you look on Google, make lists phone-friendly, and create images that match your brand. I never change your prices, stock, hours or contact details."
            : `I can help with that. Try one of these, or tell me what you want to change about ${context.businessName || "your website"}.`,
        proposal: null,
        actions: [{ kind: "navigate", href: "preview", label: "Preview my website" }],
        suggestions,
      };
    }
  }
}

/**
 * Applies a proposal to a document. Pure and total: operations that would touch commercial or
 * contact facts are ignored outright, so a proposal can never smuggle one in.
 */
export function applyProposal(document: ExperienceDocument, operations: CopilotOperation[], context: FixContext): { document: ExperienceDocument; applied: string[]; skipped: string[] } {
  let next = document;
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const operation of operations) {
    switch (operation.op) {
      case "theme.set": {
        next = { ...next, themeKey: operation.themeKey };
        applied.push(`theme → ${operation.themeKey}`);
        break;
      }
      case "brand.update": {
        const allowed: Record<string, string> = {};
        for (const key of ["primaryColor", "accentColor", "secondaryColor", "buttonStyle", "fontPairing"] as const) {
          const value = (operation.brand as Record<string, unknown>)[key];
          if (typeof value === "string" && value.trim()) allowed[key] = value.trim();
        }
        // A tagline may be proposed only when it came from the owner's own description.
        const description = String(context.description || "").trim();
        if (operation.brand.tagline && description && operation.brand.tagline.includes(description.slice(0, 20))) {
          allowed.tagline = operation.brand.tagline;
        }
        next = { ...next, brand: { ...next.brand, ...allowed } };
        applied.push("brand colours");
        break;
      }
      case "design.set": {
        next = { ...next, photographyStyle: operation.photographyStyle } as ExperienceDocument;
        applied.push(`photography → ${operation.photographyStyle}`);
        break;
      }
      case "section.update": {
        const section = next.sections.find((entry) => entry.id === operation.sectionId);
        if (!section) {
          skipped.push(`section ${operation.sectionId} no longer exists`);
          break;
        }
        const safePatch = sanitizeSectionPatch(operation.patch);
        next = { ...next, sections: next.sections.map((entry) => (entry.id === operation.sectionId ? { ...entry, ...safePatch } : entry)) };
        applied.push(`${section.type} updated`);
        break;
      }
      case "section.add": {
        const profile = getExperienceProfile(next.categoryKey);
        const definition = sectionDefinition(operation.type);
        if (!definition) {
          skipped.push(`${operation.type} is not a section type`);
          break;
        }
        if (next.sections.some((section) => section.type === operation.type)) {
          next = { ...next, sections: next.sections.map((section) => (section.type === operation.type ? { ...section, visible: true } : section)) };
          applied.push(`${operation.type} shown`);
          break;
        }
        next = {
          ...next,
          sections: [...next.sections, { id: `${operation.type}-${Date.now().toString(36)}`, ...definition.defaults(profile, { businessName: next.brand.businessName || context.businessName, location: next.settings.location }) }],
        };
        applied.push(`${operation.type} added`);
        break;
      }
      case "section.toggle": {
        next = { ...next, sections: next.sections.map((section) => (section.id === operation.sectionId ? { ...section, visible: operation.visible } : section)) };
        applied.push("section visibility changed");
        break;
      }
      case "section.move": {
        const index = next.sections.findIndex((section) => section.id === operation.sectionId);
        const target = operation.direction === "up" ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= next.sections.length) {
          skipped.push("section cannot move further");
          break;
        }
        const sections = [...next.sections];
        const [moved] = sections.splice(index, 1);
        sections.splice(target, 0, moved);
        next = { ...next, sections };
        applied.push("section moved");
        break;
      }
      case "seo.update": {
        next = { ...next, seo: { ...(next.seo || {}), ...(operation.seo.title ? { title: operation.seo.title } : {}), ...(operation.seo.description ? { description: operation.seo.description } : {}) } };
        applied.push("search description");
        break;
      }
      case "studio.fix": {
        const outcome = applyStudioFix(next, operation.fixId, context);
        if (outcome.status === "applied") {
          next = outcome.document;
          applied.push(outcome.summary);
        } else {
          skipped.push(outcome.reason);
        }
        break;
      }
      default: {
        skipped.push("unsupported change");
      }
    }
  }

  return { document: next, applied, skipped };
}

/** Section fields the copilot may write. Prices, stock, contact and legal fields are absent. */
function sanitizeSectionPatch(patch: Partial<ExperienceSection>): Partial<ExperienceSection> {
  const allowed: Partial<ExperienceSection> = {};
  if (typeof patch.title === "string") allowed.title = patch.title.slice(0, 90);
  if (typeof patch.subtitle === "string") allowed.subtitle = patch.subtitle.slice(0, 200);
  if (typeof patch.body === "string") allowed.body = patch.body.slice(0, 900);
  if (typeof patch.layout === "string") allowed.layout = patch.layout.slice(0, 20);
  if (typeof patch.limit === "number") allowed.limit = Math.max(1, Math.min(24, Math.round(patch.limit)));
  if (typeof patch.visible === "boolean") allowed.visible = patch.visible;
  if (patch.cta && typeof patch.cta.label === "string") {
    allowed.cta = { label: patch.cta.label.slice(0, 40), href: typeof patch.cta.href === "string" ? patch.cta.href.slice(0, 200) : "" };
  }
  return allowed;
}

/** The copilot's summary of what it can see, used in the panel header (§5). */
export function contextSummary(context: CopilotContext): string {
  const visible = context.document.sections.filter((section) => section.visible).length;
  const nav = navigationFor(context.document).length;
  const name = context.businessName || "Your business";
  return `${name} · ${visible} sections · ${nav} nav links · readiness ${context.health.score}%`;
}
