import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRows } from "../check-website-studio-readiness.mjs";

test("a PASS requires implementation, acceptance test and traceable run evidence", () => {
  const row = {
    id: "tenant",
    status: "PASS",
    implementation: ["lib/experience/tenant.ts"],
    acceptanceTest: "tests/integration/website-studio-tenant-postgres.test.ts",
    evidence: [{ workflowRunId: 12345, commitSha: "a".repeat(40), workflow: "Studio acceptance" }],
  };
  assert.deepEqual(evaluateRows([row], () => true).blockers, []);
  assert.equal(evaluateRows([{ ...row, evidence: [] }], () => true).blockers.length, 1);
});

test("an unresolved high-severity NOT TESTED requirement blocks the phase", () => {
  const row = { id: "public-render", status: "NOT TESTED", severity: "high", reason: "not verified" };
  assert.match(evaluateRows([row], () => true).blockers[0], /NOT TESTED/);
});

test("a critical BLOCKED requirement cannot be waived as deferred", () => {
  const row = { id: "public-render", status: "BLOCKED", severity: "critical", scopeDecision: "DEFERRED", deferredReason: "later" };
  assert.match(evaluateRows([row], () => true).blockers[0], /BLOCKED/);
});

test("explicit low/medium deferred scope is disclosed and accepted without claiming PASS", () => {
  const row = { id: "seo-domains", status: "NOT TESTED", severity: "low", scopeDecision: "DEFERRED", deferredReason: "Separate phase." };
  assert.deepEqual(evaluateRows([row], () => true).blockers, []);
});
