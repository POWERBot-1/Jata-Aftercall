#!/usr/bin/env node
/**
 * JATA AFTERCALL — test output gate
 *
 * WHY THIS EXISTS
 * ---------------
 * A test suite that "passes" by skipping is not a passing suite. The database
 * suites in this repository self-skip when `DATABASE_URL` is missing, which is
 * correct for local development and catastrophic in a release gate: the step
 * turns green while exercising nothing.
 *
 * This script reads a captured vitest log and fails unless the run actually
 * executed tests and none of them were skipped.
 *
 * USAGE
 *   node scripts/ci/check-test-output.mjs <logfile> [--min N] [--allow-skipped]
 *
 * EXIT CODES
 *   0  the run passed with no failures and no skips
 *   1  the run failed, skipped, or produced no usable summary
 *   2  the log file could not be read (a missing log is a blocker, not a pass)
 *
 * No dependencies. Pure parsing, so it can be unit-tested without a database.
 */

import { readFileSync } from "node:fs";

const ANSI = /\x1b\[[0-9;]*m/g;

/** Remove terminal colour codes so the parser is stable across reporters. */
export function stripAnsi(text) {
  return String(text).replace(ANSI, "");
}

/**
 * Extract the vitest summary line for a label ("Tests" or "Test Files").
 * Vitest prints these at the end, e.g.
 *   Tests  2530 passed (2530)
 *   Tests  1 failed | 2529 passed (2530)
 */
export function summaryLine(plain, label) {
  const match = plain.match(new RegExp(`^\\s*${label}\\s+([^\\n]+)$`, "m"));
  return match ? match[1].trim() : null;
}

/**
 * Parse "1 failed | 2529 passed (2530)" into counts.
 * Returns null when the line contains no recognised token at all, which is how
 * an unparseable or replaced reporter is detected rather than silently accepted.
 */
export function parseCounts(summary) {
  if (!summary) return null;
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  let recognised = 0;
  for (const raw of summary.split("|")) {
    // Drop the trailing "(2530)" total so it cannot be mistaken for a count.
    const part = raw.replace(/\([^)]*\)/g, "").trim();
    const match = part.match(/^(\d+)\s+(passed|failed|skipped|todo)$/);
    if (match) {
      counts[match[2]] = Number(match[1]);
      recognised += 1;
    }
  }
  return recognised === 0 ? null : counts;
}

/**
 * Decide the verdict from parsed counts.
 * `min` is the floor on executed tests; a run that executes almost nothing is a
 * failure even when what little ran passed.
 */
export function verdict(counts, { min = 1, allowSkipped = false } = {}) {
  const problems = [];
  if (!counts) return ["no parsable test summary (the reporter changed or the suite did not run)"];
  if (counts.failed > 0) problems.push(`${counts.failed} failed`);
  if (!allowSkipped && counts.skipped > 0) problems.push(`${counts.skipped} skipped (a skipped test is not a passed test)`);
  if (counts.passed === 0) problems.push("no passing tests");
  if (counts.passed < min) problems.push(`only ${counts.passed} passing tests, floor is ${min}`);
  return problems;
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const minIndex = args.indexOf("--min");
  const min = minIndex === -1 ? 1 : Number(args[minIndex + 1]);
  const allowSkipped = args.includes("--allow-skipped");

  if (!file) {
    console.error("BLOCKED: usage: check-test-output.mjs <logfile> [--min N] [--allow-skipped]");
    process.exit(2);
  }
  if (minIndex !== -1 && (!Number.isInteger(min) || min < 1)) {
    console.error(`BLOCKED: --min expects a positive integer, received ${args[minIndex + 1]}`);
    process.exit(2);
  }

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`BLOCKED: cannot read ${file}: ${error.message}`);
    console.error("A missing log means the step did not run — that is a blocker, never a pass.");
    process.exit(2);
  }

  const plain = stripAnsi(text);
  const counts = parseCounts(summaryLine(plain, "Tests"));
  const files = parseCounts(summaryLine(plain, "Test Files"));
  const problems = verdict(counts, { min, allowSkipped });

  console.log(`[test-output] ${file}`);
  if (counts) console.log(`[test-output] tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.todo} todo`);
  if (files) console.log(`[test-output] files: ${files.passed} passed, ${files.failed} failed, ${files.skipped} skipped`);

  if (problems.length > 0) {
    console.error(`FAIL: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log("PASS: executed tests only, no failures, no skips");
  return 0;
}

// Only run when executed directly, so the parser can be imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
