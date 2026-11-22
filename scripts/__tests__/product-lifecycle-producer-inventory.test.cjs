"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scanSourceText, isTestPath } = require("../audit/product-lifecycle-producer-inventory.cjs");

test("detects aliased named imports and their original adapter symbols", () => {
  const source = 'import { enqueueLifecycleTasks as enqueue } from "@/lib/admin/product-lifecycle-execution-store";\nenqueue(runId, tasks);';
  const result = scanSourceText("app/api/example/route.ts", source);
  assert.equal(result.parseErrors.length, 0);
  assert.ok(result.hits.some((hit) => hit.target === "enqueueLifecycleTasks"));
  assert.ok(result.hits.some((hit) => hit.target === "execution-store-module"));
});

test("detects namespace imports and static dynamic-import/require references", () => {
  const source = [
    'import * as lifecycle from "@/lib/admin/product-lifecycle-execution-store";',
    'lifecycle.createLifecycleExecutionRun(input);',
    'const adapter = require("@/lib/admin/product-lifecycle-execution-store");',
    'const later = import("@/lib/admin/product-lifecycle-execution-store");',
  ].join("\n");
  const result = scanSourceText("lib/example.ts", source);
  assert.equal(result.parseErrors.length, 0);
  assert.ok(result.hits.some((hit) => hit.target === "createLifecycleExecutionRun"));
  assert.ok(result.hits.filter((hit) => hit.target === "execution-store-module").length >= 3);
});

test("does not flag unrelated lifecycle code", () => {
  const result = scanSourceText("lib/admin/planner.ts", 'export function planLifecycleObservation() { return "IGNORE"; }');
  assert.deepEqual(result.hits, []);
  assert.equal(result.parseErrors.length, 0);
});

test("classifies test paths separately from production paths", () => {
  assert.equal(isTestPath("tests/unit/lifecycle.test.ts"), true);
  assert.equal(isTestPath("scripts/__tests__/audit.test.mjs"), true);
  assert.equal(isTestPath("app/api/cron/observer/route.ts"), false);
});

test("reports syntax errors instead of silently skipping malformed source", () => {
  const result = scanSourceText("lib/broken.ts", "export const = ;");
  assert.ok(result.parseErrors.length > 0);
});
