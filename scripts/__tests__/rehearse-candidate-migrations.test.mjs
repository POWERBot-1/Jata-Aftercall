import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANDIDATE_EXPECTATIONS,
  canonicalInventory,
  evaluateSnapshot,
  extraMigrations,
  migrationDirectories,
  missingMigrations,
  parseArgs,
  psqlUrl,
  scanForDestructiveStatements,
} from "../ci/rehearse-candidate-migrations.mjs";

// These tests exist because the rehearsal script is the only thing standing
// between "the SQL reads plausibly" and "the SQL was executed". If the checker
// silently accepted a missing foreign key, or flagged ON DELETE CASCADE as a
// destructive statement, the rehearsal would report a verdict it had not
// earned. Nothing here needs a database.

const ADDITIVE_MEDIA = `-- Media metadata compare-and-swap token: one additive, defaulted integer column only.
-- Existing rows read as version 0; no historical data is rewritten or backfilled.
-- Apply this migration before deploying application code that selects/writes MediaAsset.version.
ALTER TABLE "MediaAsset" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
`;

const ADDITIVE_RESET = `-- Password recovery: additive controls only. Existing users retain sessionVersion 0.
-- No token, password, or account data is backfilled or rewritten.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetRequestedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_userId_key" ON "PasswordResetToken"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PasswordResetToken_userId_fkey'
      AND conrelid = '"PasswordResetToken"'::regclass
  ) THEN
    ALTER TABLE "PasswordResetToken"
      ADD CONSTRAINT "PasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
`;

test("the two candidate migrations are recognised as additive", () => {
  assert.deepEqual(scanForDestructiveStatements(ADDITIVE_MEDIA), []);
  assert.deepEqual(scanForDestructiveStatements(ADDITIVE_RESET), []);
});

test("a cascading foreign key is not mistaken for a DELETE statement", () => {
  // The single most likely false positive: ON DELETE CASCADE is part of a
  // constraint, not a data-removing statement.
  const findings = scanForDestructiveStatements(
    'ALTER TABLE "A" ADD CONSTRAINT "A_b_fkey" FOREIGN KEY ("bId") REFERENCES "B"("id") ON DELETE CASCADE;',
  );
  assert.deepEqual(findings, []);
});

test("destructive statements are detected wherever they appear", () => {
  assert.equal(scanForDestructiveStatements('DROP TABLE "MediaAsset";').length, 1);
  assert.equal(scanForDestructiveStatements('ALTER TABLE "User" DROP COLUMN "email";').length, 1);
  assert.equal(scanForDestructiveStatements('TRUNCATE "PaymentAttempt";').length, 1);
  assert.equal(scanForDestructiveStatements('DELETE FROM "User";').length, 1);
  assert.equal(scanForDestructiveStatements('  UPDATE "User" SET "role" = \'ADMIN\';').length, 1);
  assert.equal(scanForDestructiveStatements('ALTER TABLE "User" ALTER COLUMN "id" TYPE BIGINT;').length, 1);
  assert.equal(scanForDestructiveStatements('DROP INDEX "User_email_idx";').length, 1);
});

test("a comment that mentions a dangerous verb does not count, and a comment cannot hide one", () => {
  assert.deepEqual(scanForDestructiveStatements('-- we deliberately do not DROP TABLE "User" here\nSELECT 1;'), []);
  // The comment is stripped, but the statement after it is still scanned.
  assert.equal(scanForDestructiveStatements('-- tidy up\nDROP TABLE "User";').length, 1);
});

const SNAPSHOT_OK = {
  tables: [{ table_name: "User" }, { table_name: "MediaAsset" }, { table_name: "PasswordResetToken" }],
  columns: [
    { table_name: "MediaAsset", column_name: "version", data_type: "integer", is_nullable: "NO", column_default: "0", datetime_precision: null, numeric_precision: 32, character_maximum_length: null },
    { table_name: "User", column_name: "sessionVersion", data_type: "integer", is_nullable: "NO", column_default: "0", datetime_precision: null, numeric_precision: 32, character_maximum_length: null },
    { table_name: "User", column_name: "passwordResetRequestedAt", data_type: "timestamp without time zone", is_nullable: "YES", column_default: null, datetime_precision: 3, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "id", data_type: "text", is_nullable: "NO", column_default: null, datetime_precision: null, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "userId", data_type: "text", is_nullable: "NO", column_default: null, datetime_precision: null, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "tokenHash", data_type: "text", is_nullable: "NO", column_default: null, datetime_precision: null, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "expiresAt", data_type: "timestamp without time zone", is_nullable: "NO", column_default: null, datetime_precision: 3, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "usedAt", data_type: "timestamp without time zone", is_nullable: "YES", column_default: null, datetime_precision: 3, numeric_precision: null, character_maximum_length: null },
    { table_name: "PasswordResetToken", column_name: "createdAt", data_type: "timestamp without time zone", is_nullable: "NO", column_default: "CURRENT_TIMESTAMP", datetime_precision: 3, numeric_precision: null, character_maximum_length: null },
  ],
  indexes: [
    { index_name: "PasswordResetToken_pkey", table_name: "PasswordResetToken", is_unique: true, is_primary: true, columns: "id" },
    { index_name: "PasswordResetToken_userId_key", table_name: "PasswordResetToken", is_unique: true, is_primary: false, columns: "userId" },
    { index_name: "PasswordResetToken_tokenHash_key", table_name: "PasswordResetToken", is_unique: true, is_primary: false, columns: "tokenHash" },
    { index_name: "PasswordResetToken_expiresAt_idx", table_name: "PasswordResetToken", is_unique: false, is_primary: false, columns: "expiresAt" },
  ],
  constraints: [
    { conname: "PasswordResetToken_pkey", table_name: "PasswordResetToken", contype: "p", definition: 'PRIMARY KEY ("id")' },
    {
      conname: "PasswordResetToken_userId_fkey",
      table_name: "PasswordResetToken",
      contype: "f",
      definition: 'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    },
  ],
};

test("a complete catalog satisfies every expectation", () => {
  const checks = evaluateSnapshot(SNAPSHOT_OK);
  const failures = checks.filter((check) => !check.ok);
  assert.deepEqual(failures, []);
  assert.equal(checks.length, CANDIDATE_EXPECTATIONS.length);
});

test("each expectation can fail on its own", () => {
  const withoutVersion = structuredClone(SNAPSHOT_OK);
  withoutVersion.columns = withoutVersion.columns.filter((row) => row.column_name !== "version");
  const missingColumn = evaluateSnapshot(withoutVersion).filter((check) => !check.ok);
  assert.equal(missingColumn.length, 1);
  assert.match(missingColumn[0].name, /MediaAsset\.version/);

  const wrongDefault = structuredClone(SNAPSHOT_OK);
  wrongDefault.columns.find((row) => row.column_name === "sessionVersion").column_default = null;
  const defaultFailures = evaluateSnapshot(wrongDefault).filter((check) => !check.ok);
  assert.equal(defaultFailures.length, 1);
  assert.match(defaultFailures[0].detail, /default is \(none\), expected 0/);

  const wrongNullability = structuredClone(SNAPSHOT_OK);
  wrongNullability.columns.find((row) => row.column_name === "usedAt").is_nullable = "NO";
  assert.equal(evaluateSnapshot(wrongNullability).filter((check) => !check.ok).length, 1);

  const missingIndex = structuredClone(SNAPSHOT_OK);
  missingIndex.indexes = missingIndex.indexes.filter((row) => row.index_name !== "PasswordResetToken_expiresAt_idx");
  const indexFailures = evaluateSnapshot(missingIndex).filter((check) => !check.ok);
  assert.equal(indexFailures.length, 1);
  assert.match(indexFailures[0].detail, /missing/);

  const wrongIndexName = structuredClone(SNAPSHOT_OK);
  wrongIndexName.indexes.find((row) => row.index_name === "PasswordResetToken_userId_key").index_name = "PasswordResetToken_userId_idx";
  assert.equal(evaluateSnapshot(wrongIndexName).filter((check) => !check.ok).length, 1);

  const nonUnique = structuredClone(SNAPSHOT_OK);
  nonUnique.indexes.find((row) => row.index_name === "PasswordResetToken_tokenHash_key").is_unique = false;
  assert.equal(evaluateSnapshot(nonUnique).filter((check) => !check.ok).length, 1);

  const degradedForeignKey = structuredClone(SNAPSHOT_OK);
  degradedForeignKey.constraints.find((row) => row.contype === "f").definition =
    'FOREIGN KEY ("userId") REFERENCES "User"(id)';
  const fkFailures = evaluateSnapshot(degradedForeignKey).filter((check) => !check.ok);
  assert.equal(fkFailures.length, 1);
  assert.match(fkFailures[0].detail, /ON DELETE CASCADE/);

  const noTable = structuredClone(SNAPSHOT_OK);
  noTable.tables = noTable.tables.filter((row) => row.table_name !== "PasswordResetToken");
  assert.equal(evaluateSnapshot(noTable).filter((check) => !check.ok).length, 1);
});

test("the canonical inventory ignores row order but not content", () => {
  const forward = canonicalInventory(SNAPSHOT_OK);
  const reversed = structuredClone(SNAPSHOT_OK);
  reversed.columns.reverse();
  reversed.indexes.reverse();
  reversed.constraints.reverse();
  reversed.tables.reverse();
  assert.equal(canonicalInventory(reversed), forward);

  const changed = structuredClone(SNAPSHOT_OK);
  changed.columns.find((row) => row.column_name === "version").column_default = "1";
  assert.notEqual(canonicalInventory(changed), forward);
});

test("migration directory discovery and set comparisons", () => {
  const root = mkdtempSync(join(tmpdir(), "jata-migrations-test-"));
  try {
    for (const name of ["20260101000000_a", "20260202000000_b", "20260303000000_c"]) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "migration.sql"), `SELECT 1; -- ${name}\n`);
    }
    writeFileSync(join(root, "migration_lock.toml"), 'provider = "postgresql"\n');
    const names = migrationDirectories(root);
    assert.deepEqual(names, ["20260101000000_a", "20260202000000_b", "20260303000000_c"]);
    assert.deepEqual(extraMigrations(names.slice(0, 2), names), ["20260303000000_c"]);
    assert.deepEqual(missingMigrations(names, names.slice(0, 2)), ["20260303000000_c"]);
    assert.deepEqual(extraMigrations(names, names), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("arguments are parsed strictly and default to a local disposable target", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.candidateDir, "candidate");
  assert.equal(defaults.allowRemoteHost, false);
  const parsed = parseArgs(["--admin-url", "postgresql://u:p@localhost:5432/postgres", "--summary-file", "/tmp/s.md"]);
  assert.equal(parsed.summaryFile, "/tmp/s.md");
  assert.throws(() => parseArgs(["--nope"]), /unknown argument --nope/);
  assert.throws(() => parseArgs(["--admin-url"]), /needs a value/);
});

test("a database name is substituted without disturbing the credentials", () => {
  assert.equal(
    psqlUrl("postgresql://jata:secret@localhost:5432/postgres", "jata_rehearsal_full"),
    "postgresql://jata:secret@localhost:5432/jata_rehearsal_full",
  );
});
