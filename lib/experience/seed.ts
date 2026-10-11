/**
 * Deterministic seeding (Immersive Website Engine, Phase 3)
 *
 * Extracted from `diversity.ts` so that anything which only needs a stable hash — the motion
 * engine's per-section choreography, for example — does not drag the whole theme table into the
 * client bundle just to reach two small functions. `diversity.ts` re-exports both, so its public
 * API is unchanged.
 *
 * This module is pure and has no imports at all.
 */

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
