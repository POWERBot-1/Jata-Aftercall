#!/usr/bin/env node
/**
 * JATA AFTERCALL — evidence manifest verifier
 *
 * WHY THIS EXISTS
 * ---------------
 * A report cannot contain its own SHA-256. Writing one creates a fixed point
 * that does not exist: the digest changes the file that produced it, which
 * changes the digest. Previous reports in this repository worked around that by
 * writing "(computed at commit)", which is honest but useless to a reader who
 * wants to check something.
 *
 * The workaround is a manifest: a separate file, in `sha256sum` format, that
 * lists every evidence artifact *except itself*. Anyone can then run the
 * standard tool:
 *
 *     sha256sum -c docs/release/EVIDENCE-MANIFEST.sha256
 *
 * This script is the same check with better reporting, and it adds the two
 * things `sha256sum -c` cannot know:
 *
 *   1. which files are REQUIRED — a manifest that silently omits an artifact
 *      would otherwise verify as complete;
 *   2. that the manifest does not list itself, and that nothing is listed twice.
 *
 * EXIT CODES
 *   0  every listed file matches, every required file is listed, no duplicates
 *   1  a mismatch, a missing file, a missing required file, or a duplicate
 *   2  blocked: the manifest could not be read or parsed
 *
 * USAGE
 *   node scripts/ci/verify-evidence-manifest.mjs [manifest path]
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const DEFAULT_MANIFEST = "docs/release/EVIDENCE-MANIFEST.sha256";

/**
 * Artifacts a complete manifest must cover.
 *
 * Deliberately explicit rather than "every file under docs/": a glob would
 * quietly accept a manifest that lost an entry when a file was renamed, and the
 * point of a manifest is to notice exactly that.
 */
export const REQUIRED_ARTIFACTS = [
  "docs/release/RELEASE-GATE-REPORT.md",
  "docs/release/RELEASE-GATE-REPORT-REV4.md",
  "docs/release/RELEASE-GATE-REPORT-REV5.md",
  "docs/release/FINAL-RELEASE-READINESS.md",
  "docs/release/RELEASE-GATE-REPORT-REV6.md",
  "docs/release/RELEASE-GATE-REPORT-REV7.md",
  "docs/release/PR49-REHEARSAL-RESULTS.md",
  "docs/release/PR50-REVIEW.md",
  "docs/release/MAIN-PROTECTION-PROPOSAL.md",
  "docs/release/PR49-REVALIDATION-PLAN.md",
  "docs/schema-reconciliation/reconciliation.patch",
  "docs/schema-reconciliation/reconciliation-tests.patch",
  "docs/schema-reconciliation/PR-BUNDLE.md",
  "docs/schema-reconciliation/PR-BODY.md",
  "docs/schema-reconciliation/README.md",
  "docs/NEON-RECOVERY-READINESS.md",
  "docs/release/PRODUCTION-SMOKE-PROCEDURE.md",
  "docs/RELEASE-GATE-PROPOSAL.md",
  ".github/workflows/release-validation.yml",
  ".github/workflows/candidate-rehearsal.yml",
  ".github/workflows/production-smoke.yml",
  "scripts/ci/rehearse-candidate-migrations.mjs",
  "scripts/ci/verify-reconciliation-justification.mjs",
  "scripts/ci/check-workflow-expressions.mjs",
  "scripts/ci/verify-migrations.mjs",
  "scripts/ci/schema-drift-baseline.json",
  "scripts/__tests__/authorize-migration.test.mjs",
  "scripts/__tests__/check-schema-drift.test.mjs",
  "scripts/__tests__/check-test-output.test.mjs",
  "scripts/__tests__/check-workflow-expressions.test.mjs",
  "scripts/__tests__/migration-allowlist-enrollment.test.mjs",
  "scripts/__tests__/migration-expectations.test.mjs",
  "scripts/__tests__/migration-gate-refusal.test.mjs",
  "scripts/__tests__/migration-manifest.test.mjs",
  "scripts/__tests__/migration-target-guard.test.mjs",
  "scripts/__tests__/rehearse-candidate-migrations.test.mjs",
  "scripts/__tests__/smoke-production-e2e.test.mjs",
  "scripts/__tests__/smoke-production.test.mjs",
  "scripts/__tests__/summarise-audit.test.mjs",
  "scripts/__tests__/verify-evidence-manifest.test.mjs",
  "scripts/__tests__/verify-reconciliation-justification.test.mjs",
];

/**
 * Parse `sha256sum` output.
 *
 * Returns `{ entries, problems }` where `entries` is `[{ hash, path }]`.
 * A malformed line is a problem, not a skip: a manifest whose bad line is
 * ignored verifies a smaller claim than it appears to make.
 */
export function parseManifest(text) {
  const entries = [];
  const problems = [];
  String(text)
    .split("\n")
    .forEach((raw, index) => {
      const line = raw.replace(/\r$/, "");
      if (line.trim() === "") return;
      if (line.trimStart().startsWith("#")) return;
      const match = line.match(/^([0-9a-f]{64})\s{1,2}(.+)$/);
      if (!match) {
        problems.push(`line ${index + 1} is not "<sha256>  <path>": ${line.slice(0, 120)}`);
        return;
      }
      entries.push({ hash: match[1], path: match[2] });
    });
  return { entries, problems };
}

/** Compute the SHA-256 of a file, or null when it cannot be read. */
export function hashFile(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Compare a parsed manifest against the filesystem.
 *
 * Pure with respect to the arguments, so it can be tested against a temporary
 * directory without touching the repository.
 */
export function verifyManifest(entries, { root = process.cwd(), manifestPath = DEFAULT_MANIFEST, required = REQUIRED_ARTIFACTS } = {}) {
  const results = [];
  const seen = new Map();

  for (const entry of entries) {
    if (seen.has(entry.path)) {
      results.push({ path: entry.path, status: "DUPLICATE", detail: `listed twice (${seen.get(entry.path)} and ${entry.hash})` });
      continue;
    }
    seen.set(entry.path, entry.hash);

    const absolute = resolve(root, entry.path);
    const actual = hashFile(absolute);
    if (actual === null) {
      results.push({ path: entry.path, status: "MISSING", detail: "file does not exist" });
    } else if (actual !== entry.hash) {
      results.push({ path: entry.path, status: "MISMATCH", detail: `recorded ${entry.hash}, actual ${actual}` });
    } else {
      results.push({ path: entry.path, status: "PASS", detail: "" });
    }
  }

  // Self-reference: the manifest must not list itself.
  const manifestRelative = relative(root, resolve(root, manifestPath)).split("\\").join("/");
  if (seen.has(manifestRelative) || entries.some((entry) => resolve(root, entry.path) === resolve(root, manifestPath))) {
    results.push({
      path: manifestRelative,
      status: "SELF_REFERENCE",
      detail: "the manifest lists itself, which cannot verify — remove that entry",
    });
  }

  for (const path of required) {
    if (!seen.has(path)) {
      results.push({ path, status: "NOT_LISTED", detail: "required artifact is absent from the manifest" });
    }
  }

  const failed = results.filter((result) => result.status !== "PASS");
  return { results, failed };
}

function main(argv) {
  const manifestPath = argv[2] ?? DEFAULT_MANIFEST;
  const root = process.cwd();
  const absolute = resolve(root, manifestPath);

  if (!existsSync(absolute)) {
    console.error(`BLOCKED: ${manifestPath} does not exist`);
    return 2;
  }
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch (error) {
    console.error(`BLOCKED: cannot read ${manifestPath} (${error.message})`);
    return 2;
  }

  const { entries, problems } = parseManifest(text);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL manifest: ${problem}`);
    return 2;
  }
  if (entries.length === 0) {
    console.error("BLOCKED: the manifest lists no files. An empty manifest verifies nothing.");
    return 2;
  }

  const { results, failed } = verifyManifest(entries, { root, manifestPath });
  for (const result of results) {
    if (result.status === "PASS") console.log(`PASS ${result.path}`);
    else console.error(`FAIL ${result.status} ${result.path} — ${result.detail}`);
  }

  if (failed.length > 0) {
    console.error(`\nFAIL: ${failed.length} of ${results.length} manifest checks failed.`);
    return 1;
  }
  console.log(`\nPASS: ${entries.length} artifacts match the manifest; every required artifact is listed; the manifest does not list itself.`);
  console.log("      Reproduce independently with: sha256sum -c docs/release/EVIDENCE-MANIFEST.sha256");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("verify-evidence-manifest.mjs")) {
  process.exit(main(process.argv));
}
