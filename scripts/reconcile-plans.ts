/**
 * Narrowly-scoped PlanConfig reconciliation — JATA commercial catalogue.
 *
 * Purpose: make the *database-driven* catalogue expose the four canonical offerings
 * (Monthly KES 149/30, Annual KES 999/365, AI Business Front Desk KES 499/30,
 * Interactive Business KES 999/30) without running the general seed.
 *
 * Safety contract (enforced by this file and by tests/unit/plan-catalogue.test.ts):
 *   - Writes ONLY to `PlanConfig` — never users, businesses, subscriptions, payments,
 *     referrals, entitlements, audit history, migrations or Paystack configuration.
 *   - Never deletes and never deactivates: rows are matched by `key` and upserted, so an
 *     existing plan keeps its primary key (`id`) and its subscriptions keep pointing at it.
 *   - Idempotent: running it repeatedly converges to the same state and changes nothing else.
 *   - Dry run by default: nothing is written unless `--apply` is passed.
 *   - Fails closed when DATABASE_URL is missing, and verifies its own result after applying.
 *
 * Usage:
 *   npm run reconcile:plans                # dry run (default) — prints what would change
 *   npm run reconcile:plans -- --apply     # applies exactly those PlanConfig updates
 *
 * The connection string is never printed: only a redacted fingerprint (host/database) so the
 * operator can confirm the target environment before applying anything.
 */

import { PrismaClient } from "@prisma/client";
import {
  CANONICAL_PLANS,
  planMatchesCanonical,
  planReconciliationReport,
  planReconciliationSummary,
  type CanonicalPlan,
} from "../lib/canonicalPlans";

const APPLY = process.argv.includes("--apply");

type StoredPlan = {
  id: string;
  key: string;
  name: string;
  priceKES: number;
  durationDays: number;
  isActive: boolean;
};

/** Host + database name only — never credentials, never query parameters. */
function redactedFingerprint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

function describeAction(action: ReturnType<typeof planReconciliationReport>["actions"][number]): string {
  if (action.kind === "create") {
    const plan = action.plan;
    return `create  ${plan.key} — KES ${plan.priceKES} / ${plan.durationDays} days (active)`;
  }
  if (action.kind === "update") {
    const plan = action.plan;
    return `update  ${action.key} → KES ${plan.priceKES} / ${plan.durationDays} days, active (changed: ${action.changes.join(", ")})`;
  }
  return `keep    ${action.key} (already canonical)`;
}

async function readCatalogue(prisma: PrismaClient): Promise<StoredPlan[]> {
  return prisma.planConfig.findMany({
    select: { id: true, key: true, name: true, priceKES: true, durationDays: true, isActive: true },
    orderBy: { key: "asc" },
  });
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    console.error("[reconcile-plans] DATABASE_URL is not set — refusing to run (no writes, no guesses).");
    console.error("[reconcile-plans] Set DATABASE_URL for the target environment and re-run. Dry run is the default; add --apply to write.");
    process.exit(2);
  }

  // Reported before the client is constructed, so even a connection/client failure tells the
  // operator exactly which target and mode were requested.
  console.log(`[reconcile-plans] target: ${redactedFingerprint(databaseUrl)} (credentials redacted)`);
  console.log(`[reconcile-plans] mode: ${APPLY ? "APPLY" : "DRY RUN (no writes; pass --apply to write)"}`);
  console.log(`[reconcile-plans] canonical catalogue: ${CANONICAL_PLANS.map((plan) => plan.key).join(", ")}`);

  const prisma = new PrismaClient();
  try {
    const before = await readCatalogue(prisma);
    const report = planReconciliationReport(before);
    const summary = planReconciliationSummary(report);

    console.log("[reconcile-plans] plan:");
    for (const action of report.actions) console.log(`[reconcile-plans]   ${describeAction(action)}`);
    if (report.untouchedKeys.length > 0) {
      console.log(`[reconcile-plans]   left untouched (not canonical, never modified): ${report.untouchedKeys.join(", ")}`);
    }
    console.log(
      `[reconcile-plans] summary: ${summary.create} to create, ${summary.update} to update, ${summary.unchanged} already canonical, ${summary.untouched} unrelated row(s) untouched`,
    );

    if (!APPLY) {
      console.log("[reconcile-plans] dry run complete — nothing was written.");
      return;
    }

    for (const action of report.actions) {
      if (action.kind === "unchanged") continue;
      const plan: CanonicalPlan = action.plan;
      // Upsert by unique key: an existing row keeps its id (and therefore its subscription
      // history); a missing row is created. No other table is written anywhere in this script.
      await prisma.planConfig.upsert({
        where: { key: plan.key },
        update: { name: plan.name, priceKES: plan.priceKES, durationDays: plan.durationDays, isActive: true },
        create: { key: plan.key, name: plan.name, priceKES: plan.priceKES, durationDays: plan.durationDays, isActive: true },
      });
      console.log(`[reconcile-plans] ${action.kind === "create" ? "created" : "updated"} ${plan.key}`);
    }

    const after = await readCatalogue(prisma);
    const failures = CANONICAL_PLANS.filter((plan) => {
      const row = after.find((entry) => entry.key === plan.key);
      return !row || !planMatchesCanonical(row);
    });
    for (const plan of CANONICAL_PLANS) {
      const row = after.find((entry) => entry.key === plan.key);
      console.log(
        `[reconcile-plans] verify ${plan.key}: ${row ? `kes=${row.priceKES} days=${row.durationDays} active=${row.isActive} id=${row.id}` : "MISSING"}`,
      );
    }
    if (failures.length > 0) {
      console.error(`[reconcile-plans] verification failed for: ${failures.map((plan) => plan.key).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log("[reconcile-plans] verified: the four canonical offerings are present and active.");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  // Never echo the error object wholesale: a Prisma error can embed the connection string.
  console.error(`[reconcile-plans] failed: ${error instanceof Error ? error.name : "unknown error"} — no unrelated data was modified.`);
  console.error("[reconcile-plans] Check that the Prisma client is generated (npx prisma generate) and that DATABASE_URL is reachable, then re-run.");
  process.exitCode = 1;
});
