#!/usr/bin/env node
/**
 * JATA AFTERCALL — dependency audit summariser
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm audit` exits **1** when it finds vulnerabilities. Under the default
 * `bash -e` used by GitHub Actions `run:` steps, that kills the step on the
 * `npm audit ... > file` line — before the reporter that explains *what* was
 * found ever runs. The gate failed closed, but it failed silently, leaving an
 * empty log exactly when a log was most needed.
 *
 * This module is the reporter, extracted so it can be tested without a network
 * or an npm registry. It draws the distinction the raw exit code cannot:
 *
 *   PASS     the audit completed and found nothing
 *   FAIL     the audit completed and found something
 *   BLOCKED  the audit did not complete (network, malformed report, npm error)
 *
 * Treating BLOCKED as FAIL would misreport an outage as a vulnerability.
 * Treating BLOCKED as PASS would certify a dependency tree nobody inspected.
 *
 * USAGE
 *   node scripts/ci/summarise-audit.mjs \
 *     --production /tmp/audit-production.json --production-status 1 \
 *     --full /tmp/audit-full.json --full-status 1
 *
 * Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED.
 */

import { readFileSync } from "node:fs";

/** npm's own exit code for "vulnerabilities found". */
const NPM_FOUND_VULNERABILITIES = 1;

/**
 * Classify one audit result.
 *
 * @param {{status: number|null, report: object|null, parseError?: string|null}} input
 * @returns {{verdict: "PASS"|"FAIL"|"BLOCKED", reason: string, total: number|null}}
 */
export function classifyAudit({ status, report, parseError = null }) {
  if (parseError) {
    return { verdict: "BLOCKED", reason: `report unreadable: ${parseError}`, total: null };
  }
  if (!report) {
    return { verdict: "BLOCKED", reason: "no report produced", total: null };
  }
  if (report.error) {
    const detail = report.error.summary || report.error.detail || JSON.stringify(report.error);
    return { verdict: "BLOCKED", reason: `npm reported an audit error: ${detail}`, total: null };
  }

  const vulnerabilities = report.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities.total !== "number") {
    // A well-formed npm audit report always carries this block. Its absence
    // means the audit did not get far enough to inspect anything.
    return { verdict: "BLOCKED", reason: "no vulnerability metadata — the audit did not complete", total: null };
  }

  if (status !== 0 && status !== NPM_FOUND_VULNERABILITIES) {
    return { verdict: "BLOCKED", reason: `npm exited ${status}, which is neither success nor "findings"`, total: null };
  }

  // Consistency: the exit code must agree with the report. A disagreement in
  // either direction means one of the two is lying, and neither is trustworthy.
  if (status === 0 && vulnerabilities.total > 0) {
    return { verdict: "BLOCKED", reason: `npm exited 0 but the report lists ${vulnerabilities.total} finding(s)`, total: null };
  }
  if (status === NPM_FOUND_VULNERABILITIES && vulnerabilities.total === 0) {
    return { verdict: "BLOCKED", reason: "npm exited 1 but the report lists no findings", total: null };
  }

  if (vulnerabilities.total === 0) {
    return { verdict: "PASS", reason: "audit completed with 0 findings", total: 0 };
  }

  const parts = ["critical", "high", "moderate", "low", "info"]
    .filter((key) => vulnerabilities[key] > 0)
    .map((key) => `${vulnerabilities[key]} ${key}`);
  return {
    verdict: "FAIL",
    reason: `audit completed with ${vulnerabilities.total} finding(s): ${parts.join(", ")}`,
    total: vulnerabilities.total,
  };
}

/** Read and parse a JSON report, returning data or an error string. */
export function readReport(path) {
  if (!path) return { report: null, parseError: "no path supplied" };
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return { report: null, parseError: `cannot read ${path}: ${error.code || error.message}` };
  }
  if (raw.trim() === "") {
    return { report: null, parseError: `${path} is empty` };
  }
  try {
    return { report: JSON.parse(raw), parseError: null };
  } catch (error) {
    return { report: null, parseError: `${path} is not valid JSON: ${error.message}` };
  }
}

/** Parse a status argument. Absent or non-numeric becomes null, never 0. */
export function parseStatus(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

function main(argv) {
  const args = argv.slice(2);
  const productionStatus = parseStatus(argValue(args, "--production-status"));
  const fullStatus = parseStatus(argValue(args, "--full-status"));

  const production = { ...readReport(argValue(args, "--production")), status: productionStatus };
  const full = { ...readReport(argValue(args, "--full")) , status: fullStatus };

  const prod = classifyAudit(production);
  console.log(`[audit] production tree: ${prod.verdict} — ${prod.reason}`);
  console.log(`[audit] production audit exit code: ${productionStatus === null ? "(not supplied)" : productionStatus}`);

  if (full.report || full.parseError) {
    const all = classifyAudit(full);
    // The full tree includes development-only dependencies. This repository has
    // one documented, non-waived development advisory (braces@3.0.3,
    // GHSA-vfj7-8cjw-p6xm), so full-tree findings are REPORTED, not gating.
    // BLOCKED is still surfaced, because "the audit did not run" must never be
    // reported as "the full tree is clean".
    console.log(`[audit] full tree (reported, not gating): ${all.verdict} — ${all.reason}`);
  }

  if (prod.verdict === "BLOCKED") {
    console.error("BLOCKED: the production dependency audit did not complete — cannot certify the dependency tree");
    return 2;
  }
  if (prod.verdict === "FAIL") {
    console.error("FAIL: production advisories remain");
    return 1;
  }
  console.log("PASS: production dependency audit — 0 findings");
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
