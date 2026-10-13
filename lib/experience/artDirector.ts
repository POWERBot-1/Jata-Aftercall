/** Content/intent-led deterministic art direction. This is policy reasoning, not a configured AI/provider call,
 * visual/conversion quality measurement or a hardware score. Safe configuration only; no facts/media generated.
 */
import { getExperienceProfile } from "./categories";
import { hashSeed } from "./diversity";
import { validateExperienceDocument } from "./schema";
import { TEMPLATE_FAMILIES, templateForDocument, DESIGN_GOALS, DESIGN_PERSONALITIES, DESIGN_AUDIENCES, DESIGN_DENSITIES, type ArtDirection, type TemplateFamily, type TemplateFamilyKey } from "./templateFamilies";
import type { ExperienceDocument, ExperienceSection, SectionType } from "./types";

export type DesignBrief = Partial<Omit<ArtDirection, "family" | "version">>;
export type ArtDirectionSignals = { products: number; services: number; images: number; hasHeroImage: boolean; hasLocation: boolean; hasHours: boolean };
export type FamilyReason = { code: string; explanation: string; contribution: number };
export type RankedFamily = { family: TemplateFamily; score: number; reasons: FamilyReason[] };
const PINNED = new Set<SectionType>(["navigation", "hero", "contact"]);
const DATA_LAYOUTS = new Set<SectionType>(["featured", "menu", "services", "properties", "gallery"]);

export function parseDesignBrief(input: unknown): DesignBrief {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error("Use a supported design brief.");
  const value = input as Record<string, unknown>;
  const allowed = { goal: DESIGN_GOALS, personality: DESIGN_PERSONALITIES, audience: DESIGN_AUDIENCES, density: DESIGN_DENSITIES };
  if (Object.keys(value).some((key) => !Object.hasOwn(allowed, key))) throw new Error("Use a supported design brief.");
  for (const [key, choices] of Object.entries(allowed)) if (value[key] !== undefined && !(choices as readonly unknown[]).includes(value[key])) throw new Error("Use a supported design brief.");
  return { ...value } as DesignBrief;
}
/** Counts must come from server-owned catalogue queries, never client resource IDs or client claims. */
export function directionSignals(doc: ExperienceDocument, counts?: { products: number; services: number }): ArtDirectionSignals {
  const images = doc.sections.reduce((sum, section) => sum + (section.imageUrl ? 1 : 0) + (section.images?.length || 0), doc.brand.heroImageUrl ? 1 : 0);
  const safeCount = (value: number | undefined) => Number.isSafeInteger(value) && value >= 0 ? Math.min(100000, value) : 0;
  return { products: safeCount(counts?.products), services: safeCount(counts?.services), images,
    hasHeroImage: Boolean(doc.brand.heroImageUrl || doc.sections.find((section) => section.type === "hero")?.imageUrl),
    hasLocation: Boolean(doc.settings.location), hasHours: Boolean(doc.settings.openingHours && Object.keys(doc.settings.openingHours).length) };
}
export function defaultDesignGoal(doc: ExperienceDocument): ArtDirection["goal"] {
  const caps = getExperienceProfile(doc.categoryKey).capabilities;
  if (caps.includes("commerce")) return "sell";
  if (caps.includes("booking") && doc.settings.bookingEnabled !== false) return "book";
  if (caps.includes("enquiry") || caps.includes("quote")) return "enquire";
  return "browse";
}
function completedBrief(doc: ExperienceDocument, brief: DesignBrief): Omit<ArtDirection, "family" | "version"> {
  const current = doc.artDirection;
  const goal = brief.goal || current?.goal || defaultDesignGoal(doc);
  const caps = getExperienceProfile(doc.categoryKey).capabilities;
  if ((goal === "sell" && !caps.includes("commerce")) || (goal === "book" && !caps.includes("booking"))) throw new Error("This goal does not match this business's customer flow.");
  return { goal, personality: brief.personality || current?.personality || (["premium", "luxury"].includes(doc.photographyStyle || "") ? "premium" : doc.photographyStyle === "minimal" ? "minimal" : "warm"),
    audience: brief.audience || current?.audience || "local", density: brief.density || current?.density || "balanced" };
}
export function rankTemplateFamilies(doc: ExperienceDocument, brief: DesignBrief = {}, counts?: { products: number; services: number }): RankedFamily[] {
  const intent = completedBrief(doc, brief), signals = directionSignals(doc, counts);
  return TEMPLATE_FAMILIES.filter((family) => family.goals.includes(intent.goal)).map((family) => {
    const reasons: FamilyReason[] = [];
    const add = (code: string, explanation: string, contribution: number) => reasons.push({ code, explanation, contribution });
    add("customer-flow", `Keeps the existing ${intent.goal} flow and server-bound actions.`, 20);
    if (family.categories.includes(doc.categoryKey)) add("category-fit", `Composition is designed for ${getExperienceProfile(doc.categoryKey).label.toLowerCase()} content.`, 24);
    if (family.categories.length === 0) add("general-composition", "Category-neutral split composition remains compatible.", 8);
    if (family.personality === intent.personality) add("personality", `Matches the owner's ${intent.personality} direction.`, 8);
    if (family.audience === intent.audience) add("audience", `Matches the selected ${intent.audience} audience.`, 6);
    if (family.density === intent.density) add("density", `Matches the selected ${intent.density} information density.`, 6);
    if (intent.goal === "sell" && ["grid", "spotlight", "comparison", "carousel"].includes(family.catalogue)) add("commercial-discovery", "Puts catalogue discovery before decorative narrative.", 10);
    if (intent.goal === "book" && family.flow[0] === "services") add("booking-journey", "Services and trust precede the existing booking action.", 20);
    if (intent.goal === "enquire" && ["chapters", "paired", "location-led"].includes(family.body)) add("enquiry-context", "Provides context for an informed enquiry.", 10);
    if (family.flow[0] === "gallery" && signals.images < 2) add("missing-gallery-content", "No asset generation is enabled; this needs more existing images.", -35);
    if (["cinematic", "fullscreen-media"].includes(family.key) && !signals.hasHeroImage) add("missing-hero-image", "No existing hero image; prefer a text/product-led composition.", -25);
    if (family.key === "map-driven") add("location-readiness", signals.hasLocation ? "Uses the owner's existing address/directions, never invented coordinates." : "No existing address; prefer a non-location-led structure.", signals.hasLocation ? 12 : -35);
    if (family.key === "map-driven" && intent.goal === "sell") add("order-first", "An order objective generally prefers a catalogue-first rather than location-first flow.", -15);
    if (family.catalogue === "comparison" && signals.products < 2) add("comparison-readiness", "Too few current products for a useful comparison; no fake products added.", -15);
    if (signals.products > 12 && family.density === "compact") add("catalogue-density", "Existing catalogue volume benefits from concise browsing.", 8);
    if (signals.services > 0 && family.key === "service-journey") add("existing-services", "Existing services support an actual service journey.", 10);
    return { family, score: reasons.reduce((sum, item) => sum + item.contribution, 0), reasons };
  }).sort((a, b) => b.score - a.score || (a.family.key < b.family.key ? -1 : a.family.key > b.family.key ? 1 : 0));
}
/** Semantic flow, not a shuffle. Equal-priority blocks retain owner order; pinned actions retain their slots. */
function arrangedSections(doc: ExperienceDocument, family: TemplateFamily): ExperienceSection[] {
  const rank = (type: SectionType) => { const index = family.flow.indexOf(type); return index < 0 ? 100 : index; };
  const movable = doc.sections.filter((section) => !PINNED.has(section.type)).map((section, index) => ({ section, index })).sort((a, b) => rank(a.section.type) - rank(b.section.type) || a.index - b.index);
  let index = 0;
  return doc.sections.map((section) => PINNED.has(section.type) ? { ...section } : {
    ...movable[index++].section,
    ...(DATA_LAYOUTS.has(movable[index - 1].section.type) ? { layout: "family" } : {}),
  });
}
export type ArtDirectedCandidate = { document: ExperienceDocument; family: TemplateFamilyKey; semanticScore: number; reasons: FamilyReason[]; considered: number };
export function buildArtDirectedCandidate(doc: ExperienceDocument, seed: string, options: { brief?: DesignBrief; counts?: { products: number; services: number }; attempt?: number; family?: TemplateFamilyKey } = {}): ArtDirectedCandidate {
  const brief = parseDesignBrief(options.brief);
  const ranked = rankTemplateFamilies(doc, brief, options.counts);
  const existingFamily = templateForDocument(doc)?.key;
  const cutoff = ranked[0].score - 24;
  let pool = ranked.filter((entry) => entry.score >= cutoff && entry.family.key !== existingFamily);
  if (!pool.length) pool = ranked;
  const selected = options.family ? ranked.find((entry) => entry.family.key === options.family) : pool[(hashSeed(`${seed}|intent-family`) + Math.max(0, Math.floor(options.attempt || 0))) % pool.length];
  if (!selected) throw new Error("This family does not support the selected customer flow.");
  const direction: ArtDirection = { version: 1, family: selected.family.key, ...completedBrief(doc, brief) };
  const candidate: ExperienceDocument = { ...doc, version: 2, artDirection: direction, sections: arrangedSections(doc, selected.family) };
  const valid = validateExperienceDocument(candidate);
  if (!valid.ok) throw new Error("The generated composition did not pass the safe configuration boundary.");
  return { document: candidate, family: selected.family.key, semanticScore: selected.score, reasons: selected.reasons, considered: ranked.length };
}
