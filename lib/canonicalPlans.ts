/**
 * Canonical JATA commercial catalogue — the four offerings the product sells.
 *
 * This module is the single source of truth for *which* plans must exist in the
 * database-driven `PlanConfig` catalogue and at what price:
 *
 *   1. JATA AFTERCALL          — Monthly KES 149 / 30 days, Annual KES 999 / 365 days
 *   2. AI Business Front Desk  — KES 499 / 30 days
 *   3. Interactive Business    — KES 999 / 30 days
 *
 * It exists so that:
 *   - `scripts/reconcile-plans.ts` can reconcile exactly these four `PlanConfig` rows and
 *     nothing else (no seed, no other tables);
 *   - server-side fallbacks (`lib/pricing.ts`, the landing page) can never drift into a
 *     partial, hand-written plan list — the defect this replaces was a UI page carrying a
 *     hardcoded catalogue of only two plans;
 *   - tests can assert the catalogue against one declaration instead of a copy.
 *
 * Prices here are *never* trusted for charging: checkout always re-reads the stored
 * `PlanConfig` row server-side and rejects a plan whose stored price is wrong.
 */

export type CanonicalPlan = {
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
};

/** The four canonical offerings, in catalogue order (cheapest term first). */
export const CANONICAL_PLANS: readonly CanonicalPlan[] = [
  { key: "ANNUAL", name: "Annual — KES 999/year", priceKES: 999, durationDays: 365 },
  { key: "MONTHLY", name: "Monthly — KES 149/month", priceKES: 149, durationDays: 30 },
  { key: "AI_BUSINESS_FRONT_DESK", name: "AI Business Front Desk — KES 499/month", priceKES: 499, durationDays: 30 },
  { key: "INTERACTIVE_BUSINESS", name: "Interactive Business — KES 999/month", priceKES: 999, durationDays: 30 },
] as const;

export function canonicalPlanFor(key: string): CanonicalPlan | undefined {
  return CANONICAL_PLANS.find((plan) => plan.key === key);
}

/** True only when a stored row matches the canonical offering exactly and is active. */
export function planMatchesCanonical(row: {
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
  isActive: boolean;
}): boolean {
  const canonical = canonicalPlanFor(row.key);
  if (!canonical) return false;
  return (
    row.isActive === true &&
    row.priceKES === canonical.priceKES &&
    row.durationDays === canonical.durationDays &&
    row.name === canonical.name
  );
}

export type PlanReconciliationAction =
  | { kind: "create"; key: string; plan: CanonicalPlan }
  | { kind: "update"; key: string; plan: CanonicalPlan; changes: string[] }
  | { kind: "unchanged"; key: string }

export type PlanReconciliationReport = {
  actions: PlanReconciliationAction[];
  /** Rows in the catalogue that are not part of the canonical four. Never modified. */
  untouchedKeys: string[];
};

function changesRequired(
  row: { name: string; priceKES: number; durationDays: number; isActive: boolean },
  plan: CanonicalPlan,
): string[] {
  const changes: string[] = [];
  if (row.name !== plan.name) changes.push("name");
  if (row.priceKES !== plan.priceKES) changes.push("priceKES");
  if (row.durationDays !== plan.durationDays) changes.push("durationDays");
  if (row.isActive !== true) changes.push("isActive");
  return changes;
}

/**
 * Pure reconciliation decision: what must change in `PlanConfig` so the database catalogue
 * exposes the four canonical offerings. Rows are matched by `key` so an existing row keeps
 * its primary key (`id`) — the reconciliation never deletes and never recreates a plan
 * that already exists, and it never touches a plan outside the canonical four.
 */
export function planReconciliationReport(
  existing: Array<{ key: string; name: string; priceKES: number; durationDays: number; isActive: boolean }>,
): PlanReconciliationReport {
  const byKey = new Map(existing.map((row) => [row.key, row]));
  const canonicalKeys = new Set(CANONICAL_PLANS.map((plan) => plan.key));
  const actions: PlanReconciliationAction[] = CANONICAL_PLANS.map((plan) => {
    const row = byKey.get(plan.key);
    if (!row) return { kind: "create" as const, key: plan.key, plan };
    const changes = changesRequired(row, plan);
    if (changes.length === 0) return { kind: "unchanged" as const, key: plan.key };
    return { kind: "update" as const, key: plan.key, plan, changes };
  });
  const untouchedKeys = existing.filter((row) => !canonicalKeys.has(row.key)).map((row) => row.key).sort();
  return { actions, untouchedKeys };
}

/** Summary counts for a reconciliation report — used by the CLI and by tests. */
export function planReconciliationSummary(report: PlanReconciliationReport) {
  return {
    create: report.actions.filter((action) => action.kind === "create").length,
    update: report.actions.filter((action) => action.kind === "update").length,
    unchanged: report.actions.filter((action) => action.kind === "unchanged").length,
    untouched: report.untouchedKeys.length,
  };
}

/** Every canonical plan, as the shape the pricing helpers expose (active by definition). */
export const CANONICAL_FALLBACK_PLANS: Array<CanonicalPlan & { isActive: true }> = CANONICAL_PLANS.map((plan) => ({
  ...plan,
  isActive: true as const,
}));
