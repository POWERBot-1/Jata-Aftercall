/**
 * Conversational refinement for the integrated Website Studio.
 *
 * The owner's message is interpreted into a small set of structural/content actions.
 * Every action is applied to the JATA Experience document and then passes the same
 * schema gate as a manual save. Prices, stock, payment settings and contact details are
 * absent from the action set by construction: a prompt cannot change them.
 *
 * Preview only. The caller saves through `/api/experience` with its draft version.
 */

import { addSection, themeOf } from "@/lib/experience/document";
import { validateExperienceDocument } from "@/lib/experience/schema";
import { themesForCategory } from "@/lib/experience/themes";
import { getExperienceProfile } from "@/lib/experience/categories";
import { buildArtDirectedCandidate, rankTemplateFamilies, type DesignBrief } from "@/lib/experience/artDirector";
import type { ExperienceDocument, ExperienceSection, SectionType } from "@/lib/experience/types";
import { experienceToSiteConfig, siteConfigToExperience } from "./adapter";
import { applyLayoutPlan, planForPrompt, LAYOUT_PLANS } from "./layoutPlans";
import type { StudioRequirements } from "./requirements";

export type RefineResult = {
  document: ExperienceDocument;
  reply: string;
  changes: string[];
  suggestions: string[];
  reviewNotes: string[];
  changed: boolean;
  intent: string;
};

const OPTIONAL_CONTENT: SectionType[] = ["why", "steps", "faq", "testimonials", "gallery", "about", "offers"];
const DATA_SECTIONS: SectionType[] = ["featured", "menu", "services", "categories", "collections", "properties"];

const SUGGESTIONS = [
  "Make it feel more premium",
  "Use a calmer, minimal layout",
  "Put the menu first",
  "Show my gallery",
  "Make it shorter and clearer",
  "Use a darker theme",
];

function norm(message: string): string {
  return String(message || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function findSection(document: ExperienceDocument, type: SectionType): ExperienceSection | undefined {
  return document.sections.find((section) => section.type === type);
}

function ensureVisible(document: ExperienceDocument, type: SectionType): { document: ExperienceDocument; label: string | null } {
  const existing = findSection(document, type);
  if (existing) {
    if (existing.visible) return { document, label: null };
    return {
      document: { ...document, sections: document.sections.map((section) => (section.id === existing.id ? { ...section, visible: true } : section)) },
      label: `${existing.title || type} is visible again`,
    };
  }
  // Add only when the schema permits it for this category.
  const added = addSection(document, type);
  return { document: added, label: `${type} section added` };
}

/** Hides a section without deleting it, so the owner can bring it back. */
function hideSection(document: ExperienceDocument, type: SectionType): { document: ExperienceDocument; label: string | null } {
  const existing = findSection(document, type);
  if (!existing || !existing.visible) return { document, label: null };
  return {
    document: { ...document, sections: document.sections.map((section) => (section.id === existing.id ? { ...section, visible: false } : section)) },
    label: `${existing.title || type} hidden (your content is kept)`,
  };
}

function moveAfterHero(document: ExperienceDocument, type: SectionType): ExperienceDocument {
  const index = document.sections.findIndex((section) => section.type === type);
  if (index < 0) return document;
  const sections = [...document.sections];
  const [moved] = sections.splice(index, 1);
  const heroIndex = sections.findIndex((section) => section.type === "hero");
  sections.splice(heroIndex >= 0 ? heroIndex + 1 : 0, 0, moved);
  return { ...document, sections };
}

function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  if (raw.length !== 6) return 0;
  const channels = [0, 2, 4].map((offset) => parseInt(raw.slice(offset, offset + 2), 16) / 255);
  return channels.reduce((sum, value) => sum + value, 0) / 3;
}

function chooseTheme(document: ExperienceDocument, want: "dark" | "light" | "next"): string {
  const themes = themesForCategory(document.categoryKey);
  if (themes.length === 0) return document.themeKey;
  if (want === "next") {
    const index = themes.findIndex((theme) => theme.key === document.themeKey);
    return themes[(index + 1) % themes.length].key;
  }
  const sorted = [...themes].sort((a, b) => luminance(a.palette.bg) - luminance(b.palette.bg));
  return want === "dark" ? sorted[0].key : sorted[sorted.length - 1].key;
}

function applyPersonality(document: ExperienceDocument, requirements: StudioRequirements, personality: DesignBrief["personality"], seed: string): ExperienceDocument {
  if (!personality) return document;
  const brief: DesignBrief = {
    goal: requirements.goal,
    personality,
    audience: requirements.audience,
    density: requirements.density,
  };
  const ranked = rankTemplateFamilies(document, brief);
  const current = document.artDirection?.family;
  const family = ranked.find((entry) => entry.family.key !== current)?.family.key || current;
  if (!family) return document;
  try {
    return buildArtDirectedCandidate(document, `${seed}|refine|${personality}`, { brief, family }).document;
  } catch {
    return document;
  }
}

function quotedText(message: string): string | null {
  const match = /["“']([^"”']{3,80})["”']/.exec(message);
  return match ? match[1].trim() : null;
}

/**
 * Applies one conversational instruction.
 */
export function refineWebsite(params: {
  document: ExperienceDocument;
  message: string;
  requirements: StudioRequirements;
  seed?: string;
}): RefineResult {
  const message = String(params.message || "").slice(0, 800);
  const text = norm(message);
  const seed = params.seed || "studio-refine";
  let document: ExperienceDocument = JSON.parse(JSON.stringify(params.document));
  const changes: string[] = [];
  const reviewNotes: string[] = [];
  const profile = getExperienceProfile(document.categoryKey);

  if (!text) {
    return { document: params.document, reply: "Tell me what you want to change — the look, the order of sections, or the words.", changes, suggestions: SUGGESTIONS, reviewNotes, changed: false, intent: "empty" };
  }

  // Protected facts are never changed by a prompt.
  if (/(price|cost|fee|charge|stock|quantity|payment|paystack|phone|whatsapp|email|address|opening hours)/i.test(text)) {
    return {
      document: params.document,
      reply: "I can change the design, section order and your own words, but prices, stock, payment settings and contact details are protected. Edit those in your business settings and they will appear on the site automatically.",
      changes,
      suggestions: SUGGESTIONS,
      reviewNotes,
      changed: false,
      intent: "protected_fact",
    };
  }

  // Art direction.
  let personality: DesignBrief["personality"] | null = null;
  if (/\b(premium|luxur|high[- ]end|elegant|classy|upscale)\b/.test(text)) personality = "premium";
  else if (/\b(minimal|clean|simple|calm|understated|quiet)\b/.test(text)) personality = "minimal";
  else if (/\b(bold|vibrant|energetic|dramatic|striking|playful)\b/.test(text)) personality = "bold";
  else if (/\b(editorial|magazine|journal|sophisticated)\b/.test(text)) personality = "editorial";
  else if (/\b(warm|friendly|welcoming|cosy|cozy|community)\b/.test(text)) personality = "warm";
  if (personality) {
    const before = document.artDirection?.family;
    document = applyPersonality(document, params.requirements, personality, seed);
    const after = document.artDirection?.family;
    if (before !== after) changes.push(`composition → ${after}`);
    changes.push(`tone → ${personality}`);
  }

  // Theme.
  let themeIntent = "";
  if (/\b(dark|black|moody|night)\b/.test(text)) themeIntent = "dark";
  else if (/\b(light|bright|airy|white)\b/.test(text)) themeIntent = "light";
  else if (/\b(colour|color|palette|theme|restyle|different look)\b/.test(text)) themeIntent = "next";
  if (themeIntent) {
    const before = document.themeKey;
    document.themeKey = chooseTheme(document, themeIntent as "dark" | "light" | "next");
    if (document.themeKey !== before) changes.push(`theme → ${themeOf(document).name}`);
  }

  // Section visibility / ordering. A hide request must not be interpreted as "show".
  const wantsHide = /\b(hide|remove|drop|without|turn off|less|fewer)\b/.test(text);
  const visibility = (document: ExperienceDocument, type: SectionType) => {
    if (!wantsHide) return ensureVisible(document, type);
    const result = hideSection(document, type);
    if (!result.label) reviewNotes.push(`There is no ${type} section on this page to hide.`);
    return result;
  };

  if (/\b(gallery|photos|pictures|images|portfolio)\b/.test(text)) {
    const result = visibility(document, "gallery");
    document = result.document;
    if (result.label) changes.push(result.label);
  }
  if (/\b(testimonials?|reviews?|quotes?)\b/.test(text)) {
    const result = visibility(document, "testimonials");
    document = result.document;
    if (result.label) changes.push(result.label);
    if (document.sections.find((section) => section.type === "testimonials" && (section.items?.length || 0) === 0)) {
      reviewNotes.push("The testimonial section is ready but empty. Add real customer quotes before publishing; generated quotes are never used as fact.");
    }
  }
  if (/\b(faq|questions?)\b/.test(text)) {
    const result = visibility(document, "faq");
    document = result.document;
    if (result.label) changes.push(result.label);
  }
  if (/\b(about|story|our history)\b/.test(text)) {
    const result = visibility(document, "about");
    document = result.document;
    if (result.label) changes.push(result.label);
  }
  if (/\b(hours|opening|open late)\b/.test(text)) {
    const result = visibility(document, "hours");
    document = result.document;
    if (result.label) changes.push(result.label);
  }
  if (/\b(location|directions|find us|map)\b/.test(text)) {
    const result = visibility(document, "location");
    document = result.document;
    if (result.label) changes.push(result.label);
  }

  const wantsCatalogueFirst = /\b(menu|products?|services?|shop|order|booking|book)\b/.test(text) && /\b(first|top|front|before|priority|easy|easier)\b/.test(text);
  if (wantsCatalogueFirst) {
    const present = DATA_SECTIONS.filter((type) => findSection(document, type));
    for (const type of present) document = moveAfterHero(document, type);
    if (present.length > 0) changes.push(`moved ${present.join(", ")} directly after the hero`);
    else reviewNotes.push(`No ${profile.itemNounPlural.toLowerCase()} are in the catalogue yet, so there is no catalogue section to move. Add them first.`);
  }

  if (/\b(short|shorter|less|simpl|concise|strip|minimal)\b/.test(text)) {
    const hidden = document.sections.filter((section) => section.visible && OPTIONAL_CONTENT.includes(section.type));
    if (hidden.length > 0) {
      document = { ...document, sections: document.sections.map((section) => (hidden.some((entry) => entry.id === section.id) ? { ...section, visible: false } : section)) };
      changes.push(`hid ${hidden.length} optional section${hidden.length === 1 ? "" : "s"} for a shorter page`);
    }
    if (document.artDirection) document.artDirection = { ...document.artDirection, density: "compact" };
  }

  if (/\b(longer|more detail|more sections|fuller|more information)\b/.test(text)) {
    const hidden = document.sections.filter((section) => !section.visible);
    if (hidden.length > 0) {
      document = { ...document, sections: document.sections.map((section) => (hidden.some((entry) => entry.id === section.id) ? { ...section, visible: true } : section)) };
      changes.push(`revealed ${hidden.length} hidden section${hidden.length === 1 ? "" : "s"}`);
    }
  }

  // An explicit owner-supplied headline is allowed; nothing else writes copy.
  const quoted = quotedText(message);
  if (quoted && /\b(headline|hero|title)\b/.test(text)) {
    const hero = findSection(document, "hero");
    if (hero) {
      document = { ...document, sections: document.sections.map((section) => (section.id === hero.id ? { ...section, title: quoted.slice(0, 80) } : section)) };
      changes.push(`hero headline → “${quoted.slice(0, 80)}”`);
    }
  }

  // A named layout plan can restructure the page through the OpenPage adapter.
  const planMatch = LAYOUT_PLANS.find((plan) => plan.keywords.some((keyword) => text.includes(keyword)));
  if (planMatch && /\b(layout|style|like a|structure|rearrange|arrange|page)\b/.test(text)) {
    const config = experienceToSiteConfig(document, { seed }).config;
    const planned = applyLayoutPlan(config, planForPrompt(message), seed);
    const adapted = siteConfigToExperience(planned, document, { seed });
    const validated = validateExperienceDocument(adapted.document);
    if (validated.ok) {
      document = validated.document;
      changes.push(`applied the ${planMatch.name} layout plan`);
      reviewNotes.push(...adapted.reviewRequired.filter((entry) => entry.severity === "warning").map((entry) => entry.message));
    }
  }

  const validated = validateExperienceDocument(document);
  if (!validated.ok) {
    return {
      document: params.document,
      reply: "That change would have produced an unsupported website, so nothing was changed. Try a simpler instruction.",
      changes: [],
      suggestions: SUGGESTIONS,
      reviewNotes,
      changed: false,
      intent: "rejected",
    };
  }

  const changed = changes.length > 0;
  const reply = changed
    ? `Done — ${changes.join("; ")}. The preview has updated. Nothing is live until you publish.`
    : reviewNotes.length > 0
      ? reviewNotes.join(" ")
      : "I can adjust the layout, theme, section order and your own wording. Try “put the menu first”, “make it more premium”, or “hide the gallery”.";

  return {
    document: validated.document,
    reply,
    changes,
    suggestions: SUGGESTIONS,
    reviewNotes,
    changed,
    intent: personality ? "art_direction" : themeIntent ? "theme" : wantsCatalogueFirst ? "section_order" : changed ? "content" : "help",
  };
}
