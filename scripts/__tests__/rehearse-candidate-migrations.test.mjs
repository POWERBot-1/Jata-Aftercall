import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  CANDIDATE_EXPECTATIONS,
  DEFAULT_RECONCILIATION_PATCH,
  PRE_RECONCILIATION_BASELINE_SHA256,
  applyPreReconciliationFixes,
  candidatePredatesReconciliation,
  canonicalInventory,
  evaluateSnapshot,
  extraMigrations,
  migrationDirectories,
  missingMigrations,
  parseArgs,
  psqlUrl,
  scanForDestructiveStatements,
} from "../ci/rehearse-candidate-migrations.mjs";
import { evaluateModelSide } from "../ci/verify-reconciliation-justification.mjs";

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

test("constraint definitions are compared without identifier quoting", () => {
  // pg_get_constraintdef quotes only what needs quoting: a primary key on a
  // lowercase column renders unquoted, a mixed-case table renders quoted.
  const unquoted = structuredClone(SNAPSHOT_OK);
  unquoted.constraints.find((row) => row.contype === "p").definition = "PRIMARY KEY (id)";
  assert.deepEqual(evaluateSnapshot(unquoted).filter((check) => !check.ok), []);

  const mixedCase = structuredClone(SNAPSHOT_OK);
  mixedCase.constraints.find((row) => row.contype === "f").definition =
    'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE';
  assert.deepEqual(evaluateSnapshot(mixedCase).filter((check) => !check.ok), []);

  const missingCascade = structuredClone(SNAPSHOT_OK);
  missingCascade.constraints.find((row) => row.contype === "f").definition =
    'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE';
  assert.equal(evaluateSnapshot(missingCascade).filter((check) => !check.ok).length, 1);
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

const HISTORICAL_2026_10_20_BASELINE = `{
  "acceptedOn": "2026-10-20",
  "owner": "repository owner",
  "scope": "Pre-existing. Discovered by the release gate on 2026-10-20; present on main at 2575cf4 and unrelated to this branch and to PR #49.",
  "why": "The committed migration history does not reproduce prisma/schema.prisma exactly. The gate must fail on NEW drift without being permanently red on debt nobody has fixed yet, so these exact findings are recorded here.",
  "notA": "This is not an approval, not a waiver of correctness, and not a claim that the differences are harmless. Each one is a real divergence between the Prisma Client types and the actual database.",
  "remediation": "A dedicated schema-reconciliation migration plus matching schema.prisma corrections, in its own reviewed pull request with its own rehearsal. Deliberately out of scope for a CI-infrastructure change, and deliberately not silently corrected here.",
  "entries": [
    "MediaAsset :: [*] Altered column \`updatedAt\` (default changed from \`Some(Now)\` to \`None\`)",
    "MediaAsset :: [*] Changed the table",
    "PaymentAttempt :: [*] Changed the table",
    "PaymentAttempt :: [-] Removed foreign key on columns (businessId)",
    "PaymentDestination :: [*] Altered column \`capabilities\` (default changed from \`Some(Value(List([])))\` to \`None\`)",
    "PaymentDestination :: [*] Changed the table",
    "PaymentDestination :: [*] Renamed index \`PaymentDestination_businessId_provider_providerDestinationId_pr\` to \`PaymentDestination_businessId_provider_providerDestinationI_key\`",
    "PaymentProviderConnection :: [*] Altered column \`capabilities\` (default changed from \`Some(Value(List([])))\` to \`None\`)",
    "PaymentProviderConnection :: [*] Changed the table",
    "PosReceiptSequence :: [*] Changed the table",
    "PosReceiptSequence :: [+] Added unique index on columns (businessId)",
    "PosReceiptSequence :: [-] Dropped the primary key on columns (businessId)"
  ]
}
`;

test("candidatePredatesReconciliation pins historical pre-reconciliation states and rejects spoofed or deleted baselines", () => {
  assert.match(DEFAULT_RECONCILIATION_PATCH, /docs\/schema-reconciliation\/reconciliation\.patch$/);

  const root = mkdtempSync(join(tmpdir(), "jata-recon-detect-"));
  try {
    // 1. Pre-PR-#50 commit (e.g. PR #49 @ 5996229): lacks both baseline and release-validation.yml -> true.
    assert.equal(candidatePredatesReconciliation(root), true);

    // 2. Post-reconciliation branch that deletes schema-drift-baseline.json while release-validation.yml exists -> false.
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "release-validation.yml"), "name: Release Validation\n");
    assert.equal(candidatePredatesReconciliation(root), false);

    // 3. Exact historical 2026-10-20 baseline from main (66c4f33a) -> true.
    mkdirSync(join(root, "scripts", "ci"), { recursive: true });
    writeFileSync(join(root, "scripts", "ci", "schema-drift-baseline.json"), HISTORICAL_2026_10_20_BASELINE);
    assert.equal(PRE_RECONCILIATION_BASELINE_SHA256.length, 64);
    assert.equal(candidatePredatesReconciliation(root), true);

    // 4. Spoofed non-empty post-reconciliation baseline (arbitrary single entry) -> false.
    writeFileSync(
      join(root, "scripts", "ci", "schema-drift-baseline.json"),
      JSON.stringify({ entries: ["MediaAsset :: [*] Changed the table"] }),
    );
    assert.equal(candidatePredatesReconciliation(root), false);

    // 5. Emptied baseline on candidate commit (rebased onto reconciled main) -> false.
    writeFileSync(
      join(root, "scripts", "ci", "schema-drift-baseline.json"),
      JSON.stringify({ entries: [] }),
    );
    assert.equal(candidatePredatesReconciliation(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyPreReconciliationFixes reconciles all 7 model sites accurately even with adjacent candidate fields and refuses already-reconciled schemas", () => {
  const reconciledRepoSchema = readFileSync("prisma/schema.prisma", "utf8");
  // Must refuse an already-reconciled schema so partial regressions cannot hide.
  assert.equal(applyPreReconciliationFixes(reconciledRepoSchema), null);

  // Build synthetic pre-reconciliation schema that ALSO includes PR #49's adjacent `MediaAsset.version` field.
  const preReconWithVersion = reconciledRepoSchema
    .replace(/\n  paymentAttempts\s+PaymentAttempt\[\]/, "")
    .replace(
      /updatedAt\s+DateTime\s+@updatedAt\s+@default\(now\(\)\)/,
      "updatedAt  DateTime @updatedAt\n  version    Int      @default(0)",
    )
    .replace(/(model PosReceiptSequence \{\s+businessId\s+String\s+)@id/, "$1@unique")
    .replace(/(model PaymentDestination \{[\s\S]*?capabilities\s+String\[\])\s+@default\(\[\]\)/, "$1")
    .replace(/, map: "PaymentDestination_businessId_provider_providerDestinationId_pr"\)/, ")")
    .replace(/(model PaymentProviderConnection \{[\s\S]*?capabilities\s+String\[\])\s+@default\(\[\]\)/, "$1")
    .replace(/\n  business\s+Business\s+@relation\(fields: \[businessId\], references: \[id\], onDelete: Cascade\)/, "");

  const fixed = applyPreReconciliationFixes(preReconWithVersion);
  assert.notEqual(fixed, null);
  assert.match(fixed, /updatedAt\s+DateTime\s+@updatedAt\s+@default\(now\(\)\)\n  version\s+Int\s+@default\(0\)/);
  assert.deepEqual(evaluateModelSide(fixed).filter((c) => !c.ok), []);
});
