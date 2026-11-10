/**
 * Prompt-to-website generation for the integrated Website Studio.
 *
 * The pipeline deliberately reuses JATA's existing, tested generation engine rather
 * than inventing a second one:
 *
 *   brief -> rankTemplateFamilies -> buildArtDirectedCandidate (JATA art direction)
 *         -> experienceToSiteConfig (OpenPage view)
 *         -> applyLayoutPlan (OpenPage structural plan)
 *         -> siteConfigToExperience (strict adapter, JATA remains authoritative)
 *         -> validateExperienceDocument (JATA schema gate)
 *
 * Nothing is written to the database. The result is preview-only; saving happens later
 * through the existing `/api/experience` versioned draft write.
 */

import { buildArtDirectedCandidate, rankTemplateFamilies, type DesignBrief } from "@/lib/experience/artDirector";
import { addSection, themeOf } from "@/lib/experience/document";
import { fingerprintOf, similarity } from "@/lib/experience/diversity";
import { validateExperienceDocument } from "@/lib/experience/schema";
import { themesForCategory } from "@/lib/experience/themes";
import { familyGeometrySignature, type TemplateFamilyKey } from "@/lib/experience/templateFamilies";
import type { ExperienceDocument, ExperienceSection } from "@/lib/experience/types";
import { sanitizeText } from "@/lib/validation";
import { experienceToSiteConfig, siteConfigToExperience, type AdapterNote } from "./adapter";
import { applyLayoutPlan, planForPrompt, LAYOUT_PLANS, type LayoutPlan } from "./layoutPlans";
import { OPENPAGE_LAYOUT_VARIANTS } from "./layoutVariants";
import type { StudioRequirements } from "./requirements";

export type StudioCandidate = {
  id: string;
  index: number;
  label: string;
  family: TemplateFamilyKey;
  familyName: string;
  familyRationale: string;
  themeKey: string;
  themeName: string;
  document: ExperienceDocument;
  summary: string;
  why: string[];
  layoutPlan: { id: string; name: string };
  /** How many of the 42 upstream layout variants this candidate exercises. */
  layoutVariants: string[];
  mapping: {
    mapped: number;
    unsupported: number;
    retained: number;
    reviewRequired: number;
    /** Every explicit adapter record (dropped, unsupported or presentational), with reasons. */
    notices: AdapterNote[];
  };
  /** Highest structural similarity to the other candidates (0–1). Lower is more distinct. */
  similarityToOthers: number;
  distinct: boolean;
  notes: string[];
  generationKind: "deterministic-jata-experience+openpage-plan";
};

export type StudioGenerationResult = {
  candidates: StudioCandidate[];
  distinctCount: number;
  materiallyDistinct: boolean;
  notes: string[];
  seed: string;
  layoutPlan: { id: string; name: string };
  baseDraftVersion: number;
  requirements: StudioRequirements;
  provider: { key: string; label: string; usedModel: boolean };
};

const MAX_CANDIDATES = 3;
const MAX_ATTEMPTS = 12;
const DISTINCT_THRESHOLD = 0.85;

const TONE_LABELS: Record<string, string> = {
  cinematic: "Cinematic",
  editorial: "Editorial",
  luxury: "Luxury",
  minimal: "Minimal",
  magazine: "Magazine",
  marketplace: "Marketplace",
  "product-first": "Product-first",
  storytelling: "Storytelling",
  spatial: "Spatial",
  "interactive-showroom": "Showroom",
  gallery: "Gallery",
  "split-screen": "Split-screen",
  "fullscreen-media": "Fullscreen",
  scrollytelling: "Scrollytelling",
  "cardless-immersive": "Immersive",
  "map-driven": "Location-led",
  catalog: "Catalog",
  portfolio: "Portfolio",
  "service-journey": "Service journey",
  experimental: "Experimental",
};

function visibleSections(document: ExperienceDocument): ExperienceSection[] {
  return document.sections.filter((section) => section.visible);
}

function structuralKey(document: ExperienceDocument): string {
  return document.sections
    .map((section) => `${section.visible ? "v" : "h"}:${section.type}:${section.layout || "-"}`)
    .join(">");
}

/**
 * A single plan must not make every candidate structurally identical. After the first
 * candidate, the non-furniture part of the plan is rotated, which changes the reading
 * order (catalogue-first vs story-first) while keeping the plan's vocabulary.
 */
function rotatePlan(plan: LayoutPlan, index: number): LayoutPlan {
  if (index <= 0) return plan;
  const pinned = plan.blocks.filter((block) => block.type === "navbar" || block.type === "hero");
  const rest = plan.blocks.filter((block) => block.type !== "navbar" && block.type !== "hero");
  if (rest.length < 2) return plan;
  const shift = index % rest.length;
  return {
    ...plan,
    name: `${plan.name} · ${index === 1 ? "catalogue first" : "story first"}`,
    blocks: [...pinned, ...rest.slice(shift), ...rest.slice(0, shift)],
  };
}

/**
 * Applies only owner-supplied words. Every existing business sentence is preserved;
 * prompts fill blanks, they never overwrite published copy.
 */
function applyOwnerWords(document: ExperienceDocument, requirements: StudioRequirements): ExperienceDocument {
  const next: ExperienceDocument = JSON.parse(JSON.stringify(document));
  const highlight = requirements.highlights[0] ? sanitizeText(requirements.highlights[0], 140) : "";
  const hero = next.sections.find((section) => section.type === "hero");
  if (hero && !hero.subtitle && highlight) hero.subtitle = sanitizeText(highlight, 120);
  if (!next.brand.tagline && highlight) next.brand.tagline = sanitizeText(highlight, 140);

  const about = next.sections.find((section) => section.type === "about");
  if (about && !about.body && next.brand.description) about.body = sanitizeText(next.brand.description, 700);

  for (const type of requirements.requestedSections) {
    const section = next.sections.find((entry) => entry.type === type);
    if (section) {
      section.visible = true;
      continue;
    }
    // Empty testimonial/FAQ sections would render a blank block. Only add the section when
    // the business already has content to fill it, or it is a data-backed section.
    const dataBacked = ["featured", "menu", "services", "categories", "collections", "properties"].includes(type);
    const hasContent = dataBacked || next.sections.some((entry) => entry.type === type);
    if (hasContent) {
      next.sections = addSection(next, type).sections;
    }
  }
  return next;
}

function variantIdsFor(document: ExperienceDocument): string[] {
  const ids = new Set<string>();
  const hero = document.sections.find((section) => section.type === "hero");
  if (hero?.layout) ids.add(`hero/${hero.layout}`);
  for (const section of document.sections) {
    if (section.layout) {
      const match = OPENPAGE_LAYOUT_VARIANTS.find((entry) => entry.support === "mapped" && entry.sectionTypes.includes(section.type) && entry.jataLayout === section.layout);
      if (match) ids.add(match.id);
    }
  }
  return [...ids].sort();
}

function candidateNotes(adapter: { unsupported: AdapterNote[]; retained: Array<{ sectionType: string }>; reviewRequired: AdapterNote[] }): string[] {
  const notes: string[] = [];
  const unsupportedCount = adapter.unsupported.filter((entry) => entry.severity === "warning").length;
  if (unsupportedCount > 0) {
    notes.push(`${unsupportedCount} OpenPage element${unsupportedCount === 1 ? " was" : "s were"} not representable in the JATA schema and ${unsupportedCount === 1 ? "was" : "were"} left out explicitly.`);
  }
  if (adapter.retained.length > 0) {
    notes.push(`${adapter.retained.length} existing JATA section${adapter.retained.length === 1 ? "" : "s"} had no OpenPage block and ${adapter.retained.length === 1 ? "was" : "were"} preserved unchanged.`);
  }
  const faqOrTestimonial = adapter.reviewRequired.filter((entry) => ["unverified_testimonials_not_imported", "unverified_faq_not_imported"].includes(entry.code)).length;
  if (faqOrTestimonial > 0) notes.push("Generated review/FAQ content was not imported as fact; only your existing content was kept.");
  return notes;
}

/**
 * Generates up to three materially distinct candidate websites.
 *
 * Determinism: the same document, business id, requirements, seed and recent history
 * always produce the same candidates. `attempt` only varies when the diversity gate
 * rejects a structure.
 */
export function generateStudioCandidates(params: {
  baseDocument: ExperienceDocument;
  businessId: string;
  requirements: StudioRequirements;
  brief: DesignBrief;
  counts: { products: number; services: number };
  recent?: ExperienceDocument[];
  seed?: string;
  baseDraftVersion?: number;
  maxCandidates?: number;
}): StudioGenerationResult {
  const recent = params.recent || [];
  const baseSeed = params.seed || `${params.businessId}:openpage`;
  const desired = Math.max(1, Math.min(MAX_CANDIDATES, params.maxCandidates ?? MAX_CANDIDATES));
  const ranked = rankTemplateFamilies(params.baseDocument, params.brief, params.counts);
  const themes = themesForCategory(params.baseDocument.categoryKey);
  const plan =
    LAYOUT_PLANS.find((entry) => entry.id === params.requirements.plan.id) ||
    planForPrompt(params.requirements.prompt);

  const candidates: StudioCandidate[] = [];
  const usedFamilies = new Set<string>();
  const usedGeometries = new Set<string>();
  const usedStructures = new Set<string>();
  const fingerprints: Array<{ index: number; fingerprint: ReturnType<typeof fingerprintOf> }> = [];
  let attempts = 0;
  const notes: string[] = [];

  // Prefer highly ranked families, but never repeat the same geometry: a colour change
  // is not a distinct layout. The existing JATA diversity metric is the acceptance gate.
  const familyPool = ranked.length > 0 ? ranked.map((entry) => entry.family) : [];
  const fallbackFamilies = familyPool.length > 0 ? familyPool : [];

  while (candidates.length < desired && attempts < MAX_ATTEMPTS) {
    const family = fallbackFamilies[attempts % Math.max(1, fallbackFamilies.length)];
    attempts += 1;
    if (!family || usedFamilies.has(family.key)) continue;
    const geometry = familyGeometrySignature(family);
    if (usedGeometries.has(geometry) && candidates.length > 0) continue;

    const theme = themes.length > 0 ? themes[(candidates.length + attempts) % themes.length] : null;
    const seed = `${baseSeed}|${family.key}|${attempts}`;
    const candidatePlan = rotatePlan(plan, candidates.length);

    let document: ExperienceDocument;
    try {
      document = buildArtDirectedCandidate(params.baseDocument, seed, {
        brief: params.brief,
        counts: params.counts,
        family: family.key,
        attempt: attempts,
      }).document;
    } catch {
      continue;
    }

    if (theme) document.themeKey = theme.key;
    document = applyOwnerWords(document, params.requirements);

    // Real adapter round-trip: JATA -> OpenPage SiteConfig -> OpenPage plan -> JATA.
    const config = experienceToSiteConfig(document, { seed }).config;
    const planned = applyLayoutPlan(config, candidatePlan, seed);
    const adapted = siteConfigToExperience(planned, document, {
      trustedContent: false,
      applyTheme: false,
      seed,
    });

    const validated = validateExperienceDocument(adapted.document);
    if (!validated.ok) {
      notes.push(`${family.name} was skipped because its adapted document did not pass the JATA schema gate.`);
      continue;
    }

    const fingerprint = fingerprintOf(validated.document);
    const similarities = fingerprints.map((entry) => similarity(fingerprint, entry.fingerprint));
    const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
    const structure = structuralKey(validated.document);
    const distinct = !usedStructures.has(structure) && maxSimilarity < DISTINCT_THRESHOLD;
    if (!distinct && candidates.length >= 1) {
      notes.push(`${family.name} repeated a reading order already shown and was replaced with a different structure.`);
      continue;
    }

    usedFamilies.add(family.key);
    usedGeometries.add(geometry);
    usedStructures.add(structure);
    const resolvedTheme = themeOf(validated.document);
    const reasons = ranked.find((entry) => entry.family.key === family.key)?.reasons.slice(0, 3).map((reason) => reason.explanation) || [];
    const label = `${TONE_LABELS[family.key] || family.name} · ${resolvedTheme.name}`;

    const candidate: StudioCandidate = {
      id: `candidate_${family.key}_${candidates.length + 1}`,
      index: candidates.length,
      label,
      family: family.key,
      familyName: family.name,
      familyRationale: family.rationale,
      themeKey: validated.document.themeKey,
      themeName: resolvedTheme.name,
      document: validated.document,
      summary: `${candidatePlan.name} · ${family.name} composition · ${resolvedTheme.name} theme · ${visibleSections(validated.document).length} visible sections`,
      why: [
        ...reasons,
        `Uses the ${candidatePlan.name} block sequence, adapted into JATA sections.`,
      ].slice(0, 4),
      layoutPlan: { id: plan.id, name: candidatePlan.name },
      layoutVariants: variantIdsFor(validated.document),
      mapping: {
        mapped: adapted.mapped.length,
        unsupported: adapted.unsupported.filter((entry) => entry.severity === "warning").length,
        retained: adapted.retained.length,
        reviewRequired: adapted.reviewRequired.length,
        notices: adapted.unsupported,
      },
      similarityToOthers: Math.round(maxSimilarity * 100) / 100,
      distinct,
      notes: candidateNotes(adapted),
      generationKind: "deterministic-jata-experience+openpage-plan",
    };

    fingerprints.push({ index: candidate.index, fingerprint });
    candidates.push(candidate);
  }

  if (candidates.length < desired) {
    notes.push(`Only ${candidates.length} materially distinct layout${candidates.length === 1 ? "" : "s"} could be generated from this brief without repeating your existing structure. Nothing was padded with a near-duplicate.`);
  }

  const distinctCount = candidates.filter((candidate) => candidate.distinct).length;
  return {
    candidates,
    distinctCount,
    materiallyDistinct: distinctCount >= desired,
    notes,
    seed: baseSeed,
    layoutPlan: { id: plan.id, name: plan.name },
    baseDraftVersion: params.baseDraftVersion ?? 1,
    requirements: params.requirements,
    provider: { key: "jata-local", label: "JATA built-in", usedModel: false },
  };
}
