/**
 * Experience diversity and deterministic seeding (Immersive Website Engine, Phase 3)
 *
 * The goal is measurable difference, not random difference. A website is reduced to a
 * structural fingerprint (theme family, hero and navigation treatment, section order, primary
 * call to action). Two fingerprints are compared with a weighted similarity in [0, 1].
 *
 * A candidate that is too similar to a recent experience for the same business should be
 * regenerated with a different seed, rather than only changing colours. Seeds are plain
 * strings hashed with FNV-1a so the same seed always makes the same choice, which keeps
 * generation reproducible and testable.
 *
 * This module is pure. It does not call AI providers or write to the database.
 */

import { resolveExperienceTheme } from "./themes";
import type { ExperienceDocument, ExperienceSection } from "./types";

/** Above this similarity a candidate is considered a near-duplicate. Tunable. */
export const DEFAULT_DIVERSITY_THRESHOLD = 0.85;

export type ExperienceFingerprint = {
  categoryKey: string;
  themeKey: string;
  heroStyle: string;
  navStyle: string;
  cardStyle: string;
  /** Visible sections in page order, excluding navigation and hero (which are structural constants). */
  sectionOrder: string[];
  primaryCta: string;
};

export function fingerprintOf(doc: ExperienceDocument): ExperienceFingerprint {
  const theme = resolveExperienceTheme(doc.themeKey);
  const sectionOrder = doc.sections
    .filter((section: ExperienceSection) => section.visible && section.type !== "navigation" && section.type !== "hero")
    .map((section) => section.type);
  return {
    categoryKey: doc.categoryKey,
    themeKey: theme.key,
    heroStyle: theme.treatment.heroStyle,
    navStyle: theme.treatment.navStyle,
    cardStyle: theme.treatment.cardStyle,
    sectionOrder,
    primaryCta: (doc.sections.find((section) => section.type === "hero")?.cta?.label || "").toLowerCase(),
  };
}

/** Length of the longest common subsequence. Used to compare section order, not just membership. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[b.length];
}

const WEIGHTS = {
  themeKey: 0.2,
  heroStyle: 0.15,
  navStyle: 0.1,
  cardStyle: 0.1,
  sectionOrder: 0.3,
  sectionSet: 0.1,
  primaryCta: 0.05,
} as const;

/** Weighted similarity of two fingerprints, 0 (unrelated) to 1 (identical structure). */
export function similarity(a: ExperienceFingerprint, b: ExperienceFingerprint): number {
  const same = (x: string, y: string) => (x === y ? 1 : 0);

  const longest = Math.max(a.sectionOrder.length, b.sectionOrder.length);
  const orderScore = longest === 0 ? 1 : lcsLength(a.sectionOrder, b.sectionOrder) / longest;

  const setA = new Set(a.sectionOrder);
  const setB = new Set(b.sectionOrder);
  const union = new Set([...setA, ...setB]).size;
  let intersection = 0;
  for (const value of setA) if (setB.has(value)) intersection += 1;
  const setScore = union === 0 ? 1 : intersection / union;

  const total =
    WEIGHTS.themeKey * same(a.themeKey, b.themeKey) +
    WEIGHTS.heroStyle * same(a.heroStyle, b.heroStyle) +
    WEIGHTS.navStyle * same(a.navStyle, b.navStyle) +
    WEIGHTS.cardStyle * same(a.cardStyle, b.cardStyle) +
    WEIGHTS.sectionOrder * orderScore +
    WEIGHTS.sectionSet * setScore +
    WEIGHTS.primaryCta * same(a.primaryCta, b.primaryCta);

  return Math.round(total * 1000) / 1000;
}

export type DiversityReport = {
  ok: boolean;
  threshold: number;
  maxSimilarity: number;
  /** Index into `recent` of the closest experience, or -1 when there is nothing to compare. */
  closestIndex: number;
};

/** Checks a candidate against recent experiences for the same business. */
export function diversityReport(
  candidate: ExperienceDocument,
  recent: readonly ExperienceDocument[],
  threshold = DEFAULT_DIVERSITY_THRESHOLD,
): DiversityReport {
  const fingerprint = fingerprintOf(candidate);
  let maxSimilarity = 0;
  let closestIndex = -1;
  recent.forEach((doc, index) => {
    const score = similarity(fingerprint, fingerprintOf(doc));
    if (score > maxSimilarity || closestIndex === -1) {
      maxSimilarity = score;
      closestIndex = index;
    }
  });
  if (recent.length === 0) maxSimilarity = 0;
  return { ok: maxSimilarity < threshold, threshold, maxSimilarity, closestIndex: recent.length === 0 ? -1 : closestIndex };
}

/** FNV-1a 32-bit hash. Stable across runtimes, so the same seed always gives the same choice. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Picks one option deterministically from a seed. Returns undefined for an empty list. */
export function seededChoice<T>(seed: string, options: readonly T[]): T | undefined {
  if (options.length === 0) return undefined;
  return options[hashSeed(seed) % options.length];
}

/**
 * Builds the seed for regeneration attempt N. Attempt 0 is the business's base seed; each
 * retry changes the seed so a near-duplicate is replaced with a different structure.
 */
export function regenerationSeed(baseSeed: string, attempt: number): string {
  return attempt <= 0 ? baseSeed : `${baseSeed}#${attempt}`;
}
