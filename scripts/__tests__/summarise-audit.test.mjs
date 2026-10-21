import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyAudit, parseStatus, readReport } from "../ci/summarise-audit.mjs";

// D1 regression suite. The bug was that `npm audit` exiting 1 killed the step
// under `bash -e` before any of this logic could run. These tests pin the
// distinction the exit code alone cannot express: completed-with-findings
// (FAIL) versus did-not-complete (BLOCKED).

const clean = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
const vulnerable = { metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 3, critical: 0, total: 6 } } };

test("PASS: completed, exit 0, no findings", () => {
  const r = classifyAudit({ status: 0, report: clean });
  assert.equal(r.verdict, "PASS");
  assert.equal(r.total, 0);
});

test("FAIL: completed with findings and exit 1 — the case that used to be silent", () => {
  const r = classifyAudit({ status: 1, report: vulnerable });
  assert.equal(r.verdict, "FAIL");
  assert.equal(r.total, 6);
  assert.match(r.reason, /6 finding/);
  assert.match(r.reason, /3 high/);
  assert.match(r.reason, /2 moderate/);
});

test("BLOCKED: audit could not run — distinguished from findings", () => {
  const r = classifyAudit({ status: 1, report: { error: { summary: "registry unreachable" } } });
  assert.equal(r.verdict, "BLOCKED");
  assert.match(r.reason, /registry unreachable/);
});

test("BLOCKED: report missing entirely", () => {
  assert.equal(classifyAudit({ status: null, report: null, parseError: "empty file" }).verdict, "BLOCKED");
  assert.equal(classifyAudit({ status: 1, report: null }).verdict, "BLOCKED");
});

test("BLOCKED: no vulnerability metadata means the audit did not complete", () => {
  assert.equal(classifyAudit({ status: 0, report: {} }).verdict, "BLOCKED");
  assert.equal(classifyAudit({ status: 0, report: { metadata: {} } }).verdict, "BLOCKED");
});

test("BLOCKED: unexpected npm exit code", () => {
  assert.equal(classifyAudit({ status: 2, report: clean }).verdict, "BLOCKED");
  assert.equal(classifyAudit({ status: null, report: clean }).verdict, "BLOCKED");
});

test("BLOCKED: exit code and report disagree in either direction", () => {
  // exit 0 but findings — never silently pass an inspected tree that isn't clean
  assert.equal(classifyAudit({ status: 0, report: vulnerable }).verdict, "BLOCKED");
  // exit 1 but clean — the report cannot be trusted either
  assert.equal(classifyAudit({ status: 1, report: clean }).verdict, "BLOCKED");
});

test("BLOCKED is never reported as PASS (the fail-open this gate must not have)", () => {
  const blockedCases = [
    { status: 1, report: { error: {} } },
    { status: 0, report: {} },
    { status: 7, report: clean },
    { status: 1, report: null, parseError: "nope" },
  ];
  for (const c of blockedCases) {
    assert.notEqual(classifyAudit(c).verdict, "PASS", JSON.stringify(c));
  }
});

test("parseStatus never coerces a missing or junk status to 0", () => {
  assert.equal(parseStatus(undefined), null);
  assert.equal(parseStatus(""), null);
  assert.equal(parseStatus("abc"), null);
  assert.equal(parseStatus("1"), 1);
  assert.equal(parseStatus("0"), 0);
});

test("readReport distinguishes empty, missing and malformed files", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  const empty = join(dir, "empty.json");
  writeFileSync(empty, "");
  assert.match(readReport(empty).parseError, /empty/);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.match(readReport(bad).parseError, /not valid JSON/);

  assert.match(readReport(join(dir, "absent.json")).parseError, /cannot read/);

  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify(clean));
  assert.deepEqual(readReport(good).report, clean);
  assert.equal(readReport(good).parseError, null);
});
