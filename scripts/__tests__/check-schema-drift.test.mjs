import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToBaseline, parseFindings } from "../ci/check-schema-drift.mjs";

const DIFF = [
  "",
  "[*] Changed the `MediaAsset` table",
  "  [*] Altered column `updatedAt` (default changed from `Some(Now)` to `None`)",
  "",
  "[*] Changed the `PaymentDestination` table",
  "  [*] Altered column `capabilities` (default changed from `Some(Value(List([])))` to `None`)",
  "  [*] Renamed index `A_pr` to `A_key`",
  "",
  "[*] Changed the `PosReceiptSequence` table",
  "  [-] Dropped the primary key on columns (businessId)",
  "  [+] Added unique index on columns (businessId)",
].join("\n");

test("findings carry the table they belong to", () => {
  const findings = parseFindings(DIFF);
  assert.ok(findings.includes("MediaAsset :: [*] Changed the table"));
  assert.ok(findings.includes("MediaAsset :: [*] Altered column `updatedAt` (default changed from `Some(Now)` to `None`)"));
  assert.ok(findings.includes("PosReceiptSequence :: [+] Added unique index on columns (businessId)"));
});

test("ignores non-finding lines", () => {
  const findings = parseFindings("Prisma schema loaded\n\nnothing to report\n");
  assert.deepEqual(findings, []);
});

test("strips ANSI colour codes", () => {
  const coloured = "\u001b[33m[*] Changed the `X` table\u001b[0m";
  assert.deepEqual(parseFindings(coloured), ["X :: [*] Changed the table"]);
});

test("identical-looking findings on different tables stay distinct", () => {
  const diff = [
    "[*] Changed the `A` table",
    "  [*] Altered column `capabilities` (default changed from `Some` to `None`)",
    "[*] Changed the `B` table",
    "  [*] Altered column `capabilities` (default changed from `Some` to `None`)",
  ].join("\n");
  const findings = parseFindings(diff);
  assert.equal(findings.length, 4);
  assert.ok(findings.some((f) => f.startsWith("A :: ")));
  assert.ok(findings.some((f) => f.startsWith("B :: ")));
});

test("PASS: an exact match reports nothing added and nothing removed", () => {
  const findings = parseFindings(DIFF);
  const { added, removed, matching } = compareToBaseline(findings, findings);
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
  assert.equal(matching.length, findings.length);
});

test("FAIL: new drift is reported as added", () => {
  const findings = parseFindings(DIFF);
  const baseline = findings.filter((f) => !f.includes("Added unique index"));
  const { added } = compareToBaseline(findings, baseline);
  assert.equal(added.length, 1);
  assert.match(added[0], /Added unique index/);
});

test("FAIL: a baseline entry that disappeared is reported as stale", () => {
  const findings = parseFindings(DIFF).filter((f) => !f.includes("Removed foreign key"));
  const baseline = parseFindings(DIFF).concat("PaymentAttempt :: [-] Removed foreign key on columns (businessId)");
  const { removed } = compareToBaseline(findings, baseline);
  assert.equal(removed.length, 1);
  assert.match(removed[0], /Removed foreign key/);
});

test("a clean schema (no findings, empty baseline) passes", () => {
  const { added, removed } = compareToBaseline([], []);
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});
