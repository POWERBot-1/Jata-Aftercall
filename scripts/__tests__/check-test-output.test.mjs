import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCounts, stripAnsi, summaryLine, verdict } from "../ci/check-test-output.mjs";

// These tests cover the release gate's own failure logic. They exist because a
// gate whose "fail" branch has never executed is decoration, not a gate.

test("strips ANSI colour codes from captured vitest output", () => {
  assert.equal(stripAnsi("\u001b[32mTests\u001b[0m  3 passed (3)"), "Tests  3 passed (3)");
});

test("reads the Tests summary line, not the Test Files line", () => {
  const log = ["Test Files  206 passed (206)", "     Tests  2530 passed (2530)"].join("\n");
  const plain = stripAnsi(log);
  assert.equal(summaryLine(plain, "Tests"), "2530 passed (2530)");
  assert.equal(summaryLine(plain, "Test Files"), "206 passed (206)");
  assert.deepEqual(parseCounts(summaryLine(plain, "Tests")), { passed: 2530, failed: 0, skipped: 0, todo: 0 });
});

test("parses a mixed pass/fail/skip summary", () => {
  assert.deepEqual(parseCounts("1 failed | 2529 passed | 2 skipped (2532)"), {
    passed: 2529,
    failed: 1,
    skipped: 2,
    todo: 0,
  });
});

test("returns null when the summary has no recognised token", () => {
  assert.equal(parseCounts("everything is fine, trust me"), null);
  assert.equal(parseCounts(null), null);
});

test("PASS: a clean run has no problems", () => {
  assert.deepEqual(verdict({ passed: 2530, failed: 0, skipped: 0, todo: 0 }), []);
});

test("FAIL: any skipped test blocks the gate (a skipped test is not a passed test)", () => {
  const problems = verdict({ passed: 2529, failed: 0, skipped: 1, todo: 0 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /skipped/);
});

test("--allow-skipped opts out deliberately", () => {
  assert.deepEqual(verdict({ passed: 10, failed: 0, skipped: 2, todo: 0 }, { allowSkipped: true }), []);
});

test("FAIL: a failing test blocks the gate", () => {
  assert.match(verdict({ passed: 10, failed: 1, skipped: 0, todo: 0 })[0], /1 failed/);
});

test("FAIL: a suite that executed nothing blocks the gate", () => {
  assert.match(verdict({ passed: 0, failed: 0, skipped: 0, todo: 0 })[0], /no passing tests/);
});

test("FAIL: an unparseable summary blocks rather than silently passing", () => {
  assert.match(verdict(null)[0], /no parsable test summary/);
});

test("FAIL: a run below the executed-test floor blocks", () => {
  assert.match(verdict({ passed: 3, failed: 0, skipped: 0, todo: 0 }, { min: 100 })[0], /floor is 100/);
});
