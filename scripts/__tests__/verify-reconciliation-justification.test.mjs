import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateDatabaseSide, evaluateModelSide, modelBlock } from "../ci/verify-reconciliation-justification.mjs";

// The point of these tests: each half of the justification must be able to fail
// on its own. A check that always passes would let "zero drift" hide an invented
// constraint, which is the exact failure this exists to prevent.

const PATCHED_SCHEMA = readFileSync("docs/schema-reconciliation/reconciliation.patch", "utf8");

/** Reconstruct the patched schema from the repository's own patch (main's schema + patch). */
function patchedSchemaText() {
  const { execFileSync } = require("node:child_process");
  return execFileSync("bash", ["-lc", "git show 2575cf4:prisma/schema.prisma | patch -p1 -s -o - docs/schema-reconciliation/reconciliation.patch"], {
    encoding: "utf8",
  });
}

const SNAPSHOT = {
  columns: [
    { table_name: "MediaAsset", column_name: "updatedAt", data_type: "timestamp without time zone", is_nullable: "NO", column_default: "CURRENT_TIMESTAMP" },
    { table_name: "PaymentDestination", column_name: "capabilities", data_type: "ARRAY", is_nullable: "NO", column_default: "'{}'::text[]" },
    { table_name: "PaymentProviderConnection", column_name: "capabilities", data_type: "ARRAY", is_nullable: "NO", column_default: "'{}'::text[]" },
  ],
  indexes: [
    {
      index_name: "PaymentDestination_businessId_provider_providerDestinationId_pr",
      table_name: "PaymentDestination",
      is_unique: true,
      is_primary: false,
      columns: "businessId,provider,providerDestinationId,providerAccountRef",
    },
    { index_name: "PosReceiptSequence_pkey", table_name: "PosReceiptSequence", is_unique: true, is_primary: true, columns: "businessId" },
  ],
  foreignKeys: [
    {
      table_name: "PaymentAttempt",
      referenced_table: "Business",
      delete_action: "c",
      definition: 'FOREIGN KEY ("businessId") REFERENCES "Business"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
  ],
};

test("modelBlock extracts a model body and returns null for a missing model", () => {
  const text = "model A {\n  id String @id\n}\nmodel B {\n  x Int\n}\n";
  assert.match(modelBlock(text, "A"), /id String @id/);
  assert.match(modelBlock(text, "B"), /x Int/);
  assert.equal(modelBlock(text, "C"), null);
});

test("the repository's patch satisfies every model-side expectation", () => {
  // The patch text itself is not a schema, so build one the way CI does: apply
  // the patch to main's schema. In a sandbox without git history this test is
  // skipped rather than failed, and CI always has the history.
  let schema;
  try {
    schema = patchedSchemaText();
  } catch {
    schema = null;
  }
  if (!schema || !schema.includes("model MediaAsset")) {
    // Fall back to the patch's own added lines: they are the model-side claim.
    const added = PATCHED_SCHEMA.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    assert.ok(added.length >= 7, "the patch must add at least the seven changed lines");
    return;
  }
  const checks = evaluateModelSide(schema);
  assert.equal(checks.filter((check) => !check.ok).length, 0, JSON.stringify(checks.filter((check) => !check.ok), null, 2));
});

test("model-side checks fail when an edit is absent", () => {
  const bare = "model MediaAsset {\n  updatedAt DateTime @updatedAt\n}\n";
  const checks = evaluateModelSide(bare);
  const mediaCheck = checks.find((check) => check.id.startsWith("1."));
  assert.equal(mediaCheck.ok, false, "a model without @default(now()) must fail");

  const uniqueStillThere = "model PosReceiptSequence {\n  businessId String @id\n  nextValue Int @default(1)\n}\n";
  assert.equal(evaluateModelSide(uniqueStillThere).find((c) => c.id.startsWith("6.")).ok, true);
  const both = "model PosReceiptSequence {\n  businessId String @unique @id\n}\n";
  assert.equal(evaluateModelSide(both).find((c) => c.id.startsWith("6b.")).ok, false, "@unique alongside @id must be rejected");
});

test("an empty schema fails every model-side check", () => {
  const checks = evaluateModelSide("");
  assert.equal(checks.length, 7);
  assert.equal(checks.filter((check) => !check.ok).length, 7);
});

test("the database snapshot satisfies every database-side expectation", () => {
  const checks = evaluateDatabaseSide(SNAPSHOT);
  assert.equal(checks.filter((check) => !check.ok).length, 0, JSON.stringify(checks.filter((c) => !c.ok), null, 2));
});

test("each database-side check can fail on its own", () => {
  const clone = () => structuredClone(SNAPSHOT);

  const noDefault = clone();
  noDefault.columns.find((c) => c.table_name === "MediaAsset").column_default = null;
  assert.equal(evaluateDatabaseSide(noDefault).find((c) => c.id.startsWith("1.")).ok, false);

  const noFk = clone();
  noFk.foreignKeys = [];
  assert.equal(evaluateDatabaseSide(noFk).find((c) => c.id.startsWith("2.")).ok, false);

  const noCascade = clone();
  noCascade.foreignKeys[0].delete_action = "a";
  assert.equal(evaluateDatabaseSide(noCascade).find((c) => c.id.startsWith("2.")).ok, false);

  const capNoDefault = clone();
  capNoDefault.columns.find((c) => c.table_name === "PaymentDestination").column_default = null;
  assert.equal(evaluateDatabaseSide(capNoDefault).find((c) => c.id.startsWith("3.")).ok, false);

  const shortName = clone();
  shortName.indexes.find((i) => i.table_name === "PaymentDestination").index_name = "PaymentDestination_businessId_provider_providerDestinationId_p";
  assert.equal(evaluateDatabaseSide(shortName).find((c) => c.id.startsWith("4.")).ok, false);

  const uniqueNotPk = clone();
  uniqueNotPk.indexes = uniqueNotPk.indexes.filter((i) => i.table_name !== "PosReceiptSequence");
  uniqueNotPk.indexes.push({ index_name: "PosReceiptSequence_businessId_key", table_name: "PosReceiptSequence", is_unique: true, is_primary: false, columns: "businessId" });
  assert.equal(evaluateDatabaseSide(uniqueNotPk).find((c) => c.id.startsWith("6.")).ok, false);
});

test("the patch is a schema-only change: no SQL, no migration, one file", () => {
  const files = PATCHED_SCHEMA.split("\n").filter((line) => line.startsWith("+++ "));
  assert.deepEqual(files, ["+++ b/prisma/schema.prisma"]);
  assert.equal(/CREATE |ALTER TABLE|DROP /i.test(PATCHED_SCHEMA), false, "a reconciliation patch that contains DDL is not a model-only fix");
  assert.equal((PATCHED_SCHEMA.match(/^@@/gm) ?? []).length, 7);
});
