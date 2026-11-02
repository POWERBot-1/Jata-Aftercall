#!/usr/bin/env node
/**
 * Fail-closed reader for the output of scripts/test-db/run-db-suite.mjs.
 *
 *   node scripts/test-db/assert-db-suite.mjs <log-file> --expect <number of tests>
 *
 * The runner's own exit code is not enough: a run in which every test was skipped exits 0.
 * This asserts that the suite really executed against the disposable database: the expected number
 * of tests passed, none failed, none were skipped, and every committed migration was applied.
 * It prints the sanitised summary only; it never prints the log itself, a connection string or a secret.
 */
import { readFileSync } from "node:fs";

const [logPath, flag, expectRaw] = process.argv.slice(2);
const expected = flag === "--expect" ? Number(expectRaw) : NaN;
if (!logPath || !Number.isSafeInteger(expected) || expected < 1) {
  console.error("usage: assert-db-suite.mjs <log-file> --expect <positive integer>");
  process.exit(2);
}

const plain = readFileSync(logPath, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
const failures = [];

const summaryLine = plain.split("\n").find((line) => line.startsWith("DB_SUITE_SUMMARY "));
if (!summaryLine) failures.push("the runner printed no DB_SUITE_SUMMARY (it did not reach the summary step)");
let summary = null;
if (summaryLine) {
  try { summary = JSON.parse(summaryLine.slice("DB_SUITE_SUMMARY ".length)); } catch { failures.push("the runner summary is not valid JSON"); }
}

if (summary) {
  if (summary.engine !== "wasm-query-engine+adapter-pg") failures.push(`unexpected engine label: ${summary.engine}`);
  if (!/^PostgreSQL 18\./.test(String(summary.postgres || ""))) failures.push("the database is not PostgreSQL 18");
  const m = summary.migrations || {};
  if (!(m.total > 0) || m.applied !== m.total) failures.push(`migrations incomplete: applied ${m.applied} of ${m.total}`);
  if (!summary.vitest || summary.vitest.exitCode !== 0) failures.push(`vitest exit code ${summary.vitest?.exitCode}`);
}

const passed = plain.match(/Tests\s+(?:\S+\s+)?(\d+) passed/);
const failed = plain.match(/(\d+) failed/);
const skipped = plain.match(/(\d+) skipped/);
const passedCount = passed ? Number(passed[1]) : 0;
if (failed) failures.push(`${failed[1]} test(s) failed`);
if (skipped) failures.push(`${skipped[1]} test(s) skipped; a skipped test is not a passed test`);
if (passedCount !== expected) failures.push(`expected ${expected} passing tests, observed ${passedCount}`);

const engineNote = summary ? `${summary.engine}; ${summary.postgres}; migrations ${summary.migrations?.applied}/${summary.migrations?.total}` : "no summary";
if (failures.length) {
  console.log(`DB_SUITE_ASSERTION: FAIL (${engineNote})`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log(`DB_SUITE_ASSERTION: PASS (${passedCount}/${expected} tests; ${engineNote})`);
console.log("RESULT: PASS");
