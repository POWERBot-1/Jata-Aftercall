#!/usr/bin/env node
/**
 * JATA AFTERCALL — schema drift comparison against a recorded baseline
 *
 * WHY THIS EXISTS
 * ---------------
 * `prisma migrate diff` compares the migrated database with
 * `prisma/schema.prisma` and exits 2 when they differ. Run as a bare gate it
 * fails on this repository today — the divergence is pre-existing, predates
 * this branch, and predates PR #49.
 *
 * A gate that is red for reasons unrelated to the change under review gets
 * ignored, which is worse than no gate. A gate that is quietly softened to
 * "warn" is worse still. So the exact known differences are recorded in
 * `schema-drift-baseline.json` and this script fails when the diff contains
 * anything that is not recorded — new drift — or when a recorded finding has
 * disappeared and the baseline has gone stale.
 *
 * The baseline is debt with a name on it, not an approval. The report that
 * accompanies this work labels the underlying condition FAIL, not PASS.
 *
 * EXIT CODES
 *   0  the diff matches the baseline exactly
 *   1  new drift, or a stale baseline entry
 *   2  blocked: the diff or the baseline could not be read
 *
 * USAGE
 *   node scripts/ci/check-schema-drift.mjs /tmp/step-migrate-diff.log
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BASELINE = join(HERE, "schema-drift-baseline.json");

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Extract the individual findings from `prisma migrate diff` output.
 * Findings are the lines flagged [*] (changed), [-] (removed) or [+] (added).
 * Everything else — headers, blank lines, commentary — is ignored, so a
 * cosmetic reporter change cannot manufacture drift.
 */
export function parseFindings(text) {
  const plain = String(text).replace(ANSI, "");
  const findings = new Set();
  let table = "(unknown table)";
  for (const raw of plain.split("\n")) {
    const line = raw.trim();
    // `prisma migrate diff` groups findings under a table header. Tracking it
    // keeps two identical-looking findings on different tables (both
    // `capabilities` defaults, for instance) distinguishable.
    const header = line.match(/^\[[*+-]\]\s+Changed the `([^`]+)` table$/);
    if (header) {
      table = header[1];
      findings.add(`${table} :: [*] Changed the table`);
      continue;
    }
    if (!/^\[[*+-]\]/.test(line)) continue;
    findings.add(`${table} :: ${line.replace(/\s+/g, " ")}`);
  }
  return [...findings].sort();
}

/** Compare observed findings with the recorded baseline. */
export function compareToBaseline(findings, baselineEntries) {
  const observed = new Set(findings);
  const accepted = new Set(baselineEntries.map((entry) => String(entry).trim().replace(/\s+/g, " ")));
  const added = [...observed].filter((entry) => !accepted.has(entry)).sort();
  const removed = [...accepted].filter((entry) => !observed.has(entry)).sort();
  return { added, removed, matching: [...observed].filter((entry) => accepted.has(entry)).sort() };
}

function main(argv) {
  const file = argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("BLOCKED: usage: check-schema-drift.mjs <prisma-migrate-diff-log>");
    process.exit(2);
  }

  let diff;
  try {
    diff = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`BLOCKED: cannot read ${file}: ${error.message}`);
    process.exit(2);
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(DEFAULT_BASELINE, "utf8"));
  } catch (error) {
    console.error(`BLOCKED: cannot read the drift baseline: ${error.message}`);
    process.exit(2);
  }

  const findings = parseFindings(diff);
  const { added, removed, matching } = compareToBaseline(findings, baseline.entries ?? []);

  console.log(`[drift] findings in diff: ${findings.length}`);
  console.log(`[drift] matched against the recorded baseline: ${matching.length}`);
  console.log(`[drift] baseline accepted on ${baseline.acceptedOn}: ${(baseline.entries ?? []).length} entries`);

  if (added.length > 0) {
    console.error(`[drift] NEW drift not in the baseline (${added.length}):`);
    for (const entry of added) console.error(`  + ${entry}`);
  }
  if (removed.length > 0) {
    console.error(`[drift] baseline entries that no longer appear (${removed.length}) — the baseline is stale:`);
    for (const entry of removed) console.error(`  - ${entry}`);
  }

  if (added.length > 0 || removed.length > 0) {
    console.error("FAIL: the schema diff no longer matches the recorded baseline");
    console.error("      New drift must be fixed or explicitly recorded. A stale baseline must be updated in the same change.");
    process.exit(1);
  }

  console.log("PASS: the schema diff matches the recorded baseline exactly (recorded debt, not a clean schema)");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
