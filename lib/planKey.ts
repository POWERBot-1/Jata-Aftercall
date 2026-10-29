/**
 * Normalisation for `PlanConfig.key` — the stored identifier every product resolves its plan by.
 *
 * Keys are identifiers, not copy: they are written once, matched exactly by
 * `planConfig.findUnique({ where: { key } })`, and embedded in payment metadata and subscription
 * rows. They must round-trip unchanged.
 *
 * The admin plans route used to pass keys through `sanitizeText(..., 20)`. That silently truncated
 * the two longest canonical keys — `AI_BUSINESS_FRONT_DESK` (22) became
 * `AI_BUSINESS_FRONT_DE` and `JATA_AUTOPILOT_ENTERPRISE` (25) became `JATA_AUTOPILOT_ENTER` — so an
 * operator repairing the catalogue through `/admin/plans` could create a row that no product can
 * ever resolve, with no error. This module replaces that path: a key is either valid and returned
 * exactly, or rejected so the operator sees the problem instead of a broken row.
 *
 * Length is bounded by the longest canonical key (25) with headroom for future products, and the
 * character set is deliberately narrow: no whitespace, punctuation or markup.
 */

export const PLAN_KEY_MAX_LENGTH = 64;

const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * Returns the canonical stored key (trimmed, upper-cased) or `null` when the input cannot be a
 * plan key. Callers must treat `null` as a validation error, never as an empty key.
 */
export function normalizePlanKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toUpperCase();
  if (key.length < 2 || key.length > PLAN_KEY_MAX_LENGTH) return null;
  return PLAN_KEY_PATTERN.test(key) ? key : null;
}
