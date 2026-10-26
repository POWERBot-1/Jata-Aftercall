#!/usr/bin/env node
/**
 * AI Front Desk live-status audit — READ-ONLY dry run.
 *
 *   node scripts/audit/ai-front-desk-live-status-dry-run.mjs            # human report
 *   node scripts/audit/ai-front-desk-live-status-dry-run.mjs --json     # machine report
 *   node scripts/audit/ai-front-desk-live-status-dry-run.mjs --limit 50 # cap detail rows
 *
 * WHY
 * ---
 * Before the P0 remediation an AI Front Desk could be shown — and operated — as LIVE without a
 * verified paid subscription, because the stored operational switch defaulted to LIVE, the
 * dashboard seeded a local LIVE label before its first response, and the status/config APIs
 * accepted `operationalStatus: "LIVE"` without checking the subscription.
 *
 * The label is now derived from persisted publication state + server-verified entitlement, so no
 * new incorrect label can be produced. This script answers the other half of the question: which
 * existing rows are in that state right now? It exists to produce the reconciliation report — it
 * is not a migration and it cannot change anything.
 *
 * SAFETY
 * ------
 *   • Every statement is a SELECT. There is no UPDATE, INSERT, DELETE or DDL, and no `--apply`
 *     flag: applying the reconciliation is a separate owner-authorised, reviewed change.
 *   • It prints no secrets and no customer data: business id, slug, name, plan, subscription and
 *     entitlement status, and whether a PAID payment exists. No customer names, phones,
 *     conversations, messages or payment references are selected.
 *   • A business whose entitlement cannot be read is reported, never assumed paid.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import {
  AI_PLAN_KEY,
  STATES,
  evaluate,
  operationalStatusFromSnapshot,
  parseArgs,
  reconciliationPlan,
} from "./ai-front-desk-live-status-rules.mjs";

const require = createRequire(import.meta.url);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const match = env.match(/^DATABASE_URL=(.*)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env */
  }
  return null;
}

const AUDIT_SQL = `
  SELECT
    b."id"            AS "businessId",
    b."slug"          AS "slug",
    b."name"          AS "name",
    b."isPublished"   AS "isPublished",
    b."status"        AS "businessStatus",
    p."key"           AS "planKey",
    s."status"        AS "subscriptionStatus",
    s."expiresAt"     AS "subscriptionExpiresAt",
    s."graceUntil"    AS "subscriptionGraceUntil",
    e."packageKey"    AS "entitlementPackageKey",
    e."status"        AS "entitlementStatus",
    EXISTS (
      SELECT 1 FROM "Payment" pay
      WHERE pay."businessId" = b."id" AND pay."status" = 'PAID'
    )                 AS "hasPaidPayment",
    kd."content"      AS "configSnapshot"
  FROM "Business" b
  LEFT JOIN "Subscription" s ON s."businessId" = b."id"
  LEFT JOIN "PlanConfig" p   ON p."id" = s."planId"
  LEFT JOIN "AIPackageEntitlement" e ON e."businessId" = b."id"
  LEFT JOIN "AIConfiguration" ac ON ac."businessId" = b."id"
  LEFT JOIN LATERAL (
    SELECT k."content"
    FROM "KnowledgeDocument" k
    WHERE k."businessId" = b."id" AND k."sourceType" = 'AI_SYSTEM_CONFIG'
    ORDER BY k."createdAt" DESC
    LIMIT 1
  ) kd ON TRUE
  WHERE
       s."id" IS NOT NULL
    OR e."id" IS NOT NULL
    OR ac."id" IS NOT NULL
    OR kd."content" IS NOT NULL
    OR b."isPublished" = TRUE
  ORDER BY b."createdAt" ASC
`;

function classify(row, now) {
  const operationalStatus = operationalStatusFromSnapshot(row.configSnapshot);
  const planKey = row.planKey || row.entitlementPackageKey || null;
  const hasPaidPayment = row.hasPaidPayment === true;
  const result = evaluate({
    isPublished: row.isPublished === true,
    operationalStatus,
    subscription: row.subscriptionStatus
      ? {
          status: row.subscriptionStatus,
          expiresAt: row.subscriptionExpiresAt,
          graceUntil: row.subscriptionGraceUntil,
        }
      : null,
    entitlement: row.entitlementStatus ? { status: row.entitlementStatus } : null,
    planKey,
    hasPaidPayment,
    now,
  });

  return {
    businessId: row.businessId,
    slug: row.slug,
    name: row.name,
    isPublished: row.isPublished === true,
    businessStatus: row.businessStatus,
    planKey,
    subscriptionStatus: row.subscriptionStatus || null,
    entitlementStatus: row.entitlementStatus || null,
    hasPaidPayment,
    subscriptionExpiresAt: row.subscriptionExpiresAt || null,
    graceUntil: row.subscriptionGraceUntil || null,
    storedOperationalStatus: operationalStatus,
    derivedState: result.derivedState,
    publiclyOperational: result.publiclyOperational,
    incorrectlyLive: result.incorrectlyLive,
    // Nothing on the row lets us verify the entitlement: reported, never assumed paid.
    unverified: !planKey && !row.entitlementStatus && !row.subscriptionStatus,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Read-only AI Front Desk live-status audit.\n" +
        "  --json         machine-readable output\n" +
        "  --limit <n>    cap detail rows (default 100, max 1000)\n" +
        "This script has no write path: there is no --apply.\n",
    );
    return;
  }

  const databaseUrl = loadDatabaseUrl();
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is not set. The audit only reads, but it still needs a connection string.\n" +
        "Export DATABASE_URL and run it again — no rows will be changed.",
    );
    process.exitCode = 2;
    return;
  }

  let pg;
  try {
    pg = require("pg");
  } catch {
    console.error("The 'pg' driver is required. Run `npm ci` first.");
    process.exitCode = 2;
    return;
  }

  const { Client } = pg;
  const client = new Client({
    connectionString: databaseUrl,
    application_name: "jata-ai-front-desk-audit-readonly",
  });
  await client.connect();

  const generatedAt = new Date().toISOString();
  const now = Date.now();

  try {
    const { rows } = await client.query(AUDIT_SQL);
    const analysed = rows.map((row) => classify(row, now));

    const incorrectlyLive = analysed.filter((row) => row.incorrectlyLive);
    const publishedWithoutEntitlement = analysed.filter(
      (row) => row.isPublished && !row.publiclyOperational && row.derivedState === "SUSPENDED",
    );
    const unverified = analysed.filter((row) => row.unverified);

    const report = {
      generatedAt,
      readOnly: true,
      planKey: AI_PLAN_KEY,
      states: STATES,
      scannedBusinesses: analysed.length,
      summary: {
        incorrectlyLive: incorrectlyLive.length,
        publishedWithoutVerifiedEntitlement: publishedWithoutEntitlement.length,
        unverifiedState: unverified.length,
        derivedLive: analysed.filter((row) => row.publiclyOperational).length,
      },
      reconciliationPlan: reconciliationPlan({
        incorrectlyLive: incorrectlyLive.length,
        withPaymentHistory: incorrectlyLive.filter((row) => row.hasPaidPayment).length,
      }),
      detail: incorrectlyLive.slice(0, options.limit),
      otherFindings: {
        publishedWithoutVerifiedEntitlement: publishedWithoutEntitlement.slice(0, options.limit),
        unverifiedState: unverified.slice(0, options.limit),
      },
    };

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log("");
    console.log("JATA AFTERCALL — AI Front Desk live-status audit (READ-ONLY)");
    console.log(`Generated: ${generatedAt}`);
    console.log(`Plan key:  ${AI_PLAN_KEY}`);
    console.log("");
    console.log(`Businesses scanned ................. ${report.scannedBusinesses}`);
    console.log(`Incorrectly LIVE (stored switch) ... ${report.summary.incorrectlyLive}`);
    console.log(`Published without entitlement ...... ${report.summary.publishedWithoutVerifiedEntitlement}`);
    console.log(`Unverifiable state ................. ${report.summary.unverifiedState}`);
    console.log(`Correctly LIVE ..................... ${report.summary.derivedLive}`);
    console.log("");

    if (incorrectlyLive.length === 0) {
      console.log("No business is currently advertised LIVE without a verified entitlement.");
    } else {
      console.log("Rows to review (no data was changed):");
      console.log(
        ["businessId", "slug", "published", "plan", "subscription", "entitlement", "paid", "derived"].join(" | "),
      );
      for (const row of report.detail) {
        console.log(
          [
            row.businessId,
            row.slug,
            row.isPublished ? "yes" : "no",
            row.planKey || "-",
            row.subscriptionStatus || "-",
            row.entitlementStatus || "-",
            row.hasPaidPayment ? "yes" : "no",
            row.derivedState,
          ].join(" | "),
        );
      }
      if (incorrectlyLive.length > report.detail.length) {
        console.log(
          `… ${incorrectlyLive.length - report.detail.length} more row(s); re-run with --limit ${incorrectlyLive.length} to list them all.`,
        );
      }
    }

    console.log("");
    console.log("Reconciliation plan (nothing below is executed by this script):");
    for (const step of report.reconciliationPlan) {
      console.log(`  ${step.step}. ${step.action}`);
      console.log(`     rows affected: ${step.affectsRows}; data change: ${step.dataChange}`);
    }
    console.log("");
    console.log("No UPDATE, INSERT, DELETE or DDL statement was issued. Publication was not changed.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Audit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
