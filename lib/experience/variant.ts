/**
 * Seeded structural variants with a bounded diversity gate (Immersive Website Engine, Phase 3)
 *
 * A variant changes the things an owner can see as *structure*: the theme family chosen from
 * the business's own category and the order of its movable sections. It never changes business
 * facts (name, prices, contact details, products, orders), and it never touches the hero or
 * navigation positions or the contact section, which are kept where they are so every variant
 * still has a clear first action and a clear way to reach the business.
 *
 * Generation is deterministic: the same document, seed and recent history always produce the
 * same candidate. The gate retries at most MAX_VARIANT_ATTEMPTS times with derived seeds and
 * then stops, returning the least-similar candidate with `accepted: false` so the owner can
 * decide. There is no unbounded regeneration loop.
 *
 * This module returns a candidate document. It does not save anything. Saving happens only when
 * the owner applies the candidate through the existing draft write path, which keeps undo history.
 */

import { themesForCategory } from "./themes";
import { diversityReport, hashSeed, regenerationSeed, seededChoice, type DiversityReport } from "./diversity";
import type { ExperienceDocument, ExperienceSection, SectionType } from "./types";

export const VARIANT_GENERATION_VERSION = 1;
export const MAX_VARIANT_ATTEMPTS = 5;

/** Sections that keep their slot in every variant. */
const PINNED_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["navigation", "hero", "contact"]);

/** Small, fast, well-distributed PRNG (mulberry32). Seeded from the FNV-1a hash of a string. */
function prng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle of a copy of `items`. */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const next = prng(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export type VariantChange = { themeChanged: boolean; sectionOrderChanged: boolean };

/**
 * Builds one candidate for a seed. Pure: the input document is never mutated.
 * The chosen theme is always different from the current one when the category offers another.
 */
export function buildVariant(
  doc: ExperienceDocument,
  seed: string,
  attempt = 0,
): { document: ExperienceDocument; change: VariantChange } {
  const themeOptions = themesForCategory(doc.categoryKey)
    .map((theme) => theme.key)
    .filter((key) => key !== doc.themeKey);
  const themeKey = seededChoice(`${seed}|theme`, themeOptions) ?? doc.themeKey;

  // Movable sections fill the movable slots in a new order; pinned sections keep their slot.
  const movableIndexes: number[] = [];
  doc.sections.forEach((section, index) => {
    if (!PINNED_TYPES.has(section.type)) movableIndexes.push(index);
  });
  const movable = movableIndexes.map((index) => doc.sections[index]);
  const shuffled = seededShuffle(movable, `${seed}|order`);
  const sections: ExperienceSection[] = [...doc.sections];
  movableIndexes.forEach((slot, position) => {
    sections[slot] = shuffled[position];
  });

  const sectionOrderChanged = movable.some((section, position) => section.id !== shuffled[position].id);
  const themeChanged = themeKey !== doc.themeKey;

  const document: ExperienceDocument = {
    ...doc,
    themeKey,
    sections,
    generation: {
      seed,
      version: VARIANT_GENERATION_VERSION,
      attempt: Math.max(0, Math.min(MAX_VARIANT_ATTEMPTS - 1, attempt)),
    },
  };
  return { document, change: { themeChanged, sectionOrderChanged } };
}

export type VariantAttemptRecord = { attempt: number; seed: string; maxSimilarity: number; ok: boolean };

/** What the gate could actually compare against. Reported so the owner is never told more than was checked. */
export type HistoryBasis = {
  /** Number of the business's own published versions compared (in addition to the current draft). */
  publishedCompared: number;
  /** Plain-language limitation, or null when published history was available. */
  limitation: string | null;
};

export const NO_PUBLISHED_HISTORY_LIMITATION =
  "There are no published versions to compare against yet, so this layout was checked only against your current draft. It may still resemble a layout you have used before.";

export function historyBasisFor(publishedCount: number): HistoryBasis {
  const count = Math.max(0, Math.floor(publishedCount));
  return { publishedCompared: count, limitation: count === 0 ? NO_PUBLISHED_HISTORY_LIMITATION : null };
}

export type VariantResult = {
  /** The best candidate found. Save only if the owner applies it. */
  document: ExperienceDocument;
  seed: string;
  accepted: boolean;
  report: DiversityReport;
  attempts: VariantAttemptRecord[];
  change: VariantChange;
  history: HistoryBasis;
};

/**
 * Generates a variant that passes the diversity gate, trying at most `maxAttempts` derived seeds.
 *
 * `recent` should be the business's own recent published experiences. The current draft is always
 * compared too: a candidate identical in structure to the draft the owner already has is not useful.
 */
export function generateGatedVariant(params: {
  document: ExperienceDocument;
  baseSeed: string;
  recent: readonly ExperienceDocument[];
  threshold?: number;
  maxAttempts?: number;
}): VariantResult {
  const maxAttempts = Math.max(1, Math.min(MAX_VARIANT_ATTEMPTS, params.maxAttempts ?? MAX_VARIANT_ATTEMPTS));
  const compareWith = [params.document, ...params.recent];
  const attempts: VariantAttemptRecord[] = [];
  let best: { result: VariantResult; similarity: number } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const seed = regenerationSeed(params.baseSeed, attempt);
    const { document, change } = buildVariant(params.document, seed, attempt);
    const report = diversityReport(document, compareWith, params.threshold);
    attempts.push({ attempt, seed, maxSimilarity: report.maxSimilarity, ok: report.ok });

    const candidate: VariantResult = { document, seed, accepted: report.ok, report, attempts, change, history: historyBasisFor(params.recent.length) };
    if (report.ok) {
      return { ...candidate, attempts: [...attempts] };
    }
    if (!best || report.maxSimilarity < best.similarity) {
      best = { result: candidate, similarity: report.maxSimilarity };
    }
  }

  // Nothing passed the gate within the budget. Return the least-similar candidate, unaccepted.
  const fallback = best!.result;
  return { ...fallback, accepted: false, attempts: [...attempts] };
}

/**
 * A short, human-readable description of a document's structure, for prompts and the owner's
 * diagnostics. Business facts are never included, only the theme family and the section order.
 */
export function layoutSummaryOf(doc: ExperienceDocument): string {
  const order = doc.sections
    .filter((section) => section.visible && section.type !== "navigation" && section.type !== "hero")
    .map((section) => section.type)
    .join(" > ");
  return `theme ${doc.themeKey}; sections ${order || "none"}`.slice(0, 160);
}

/**
 * Seeds a brand-new draft so that later regenerations are reproducible. The default layout is
 * deliberately NOT randomised: a business with no history gets the standard structure, and the
 * seed only records provenance. The diversity status says plainly that nothing was compared.
 */
export function seedNewDocument(
  doc: ExperienceDocument,
  businessId: string,
): { document: ExperienceDocument; diversity: { status: "no-history"; limitation: string; seed: string } } {
  const seed = `${businessId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}:1`;
  return {
    document: { ...doc, generation: { seed, version: VARIANT_GENERATION_VERSION, attempt: 0 } },
    diversity: { status: "no-history", limitation: NO_PUBLISHED_HISTORY_LIMITATION, seed },
  };
}
