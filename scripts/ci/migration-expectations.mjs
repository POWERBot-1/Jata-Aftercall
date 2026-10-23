/**
 * JATA AFTERCALL — declarative schema expectations for pending migrations
 *
 * WHY THIS EXISTS
 * ---------------
 * "The migration applied" and "the schema is what the migration promised" are
 * different claims. `prisma migrate deploy` proves the first. This module
 * expresses the second and lets it be checked against a live introspection
 * snapshot — or against a fixture, so the checker itself can be tested without
 * a database.
 *
 * Only migrations listed here produce expectations. A migration that is not
 * present on the checked-out ref produces none, so this file never asserts
 * objects that the branch does not create.
 *
 * The entries are derived line-by-line from the committed migration SQL:
 *   prisma/migrations/20261017000000_media_asset_version/migration.sql
 *   prisma/migrations/20261018000000_password_reset_security/migration.sql
 *   prisma/migrations/20261023000000_pos_publication_resolution/migration.sql
 */

/** Expectations keyed by the exact migration directory name. */
export const EXPECTATIONS_BY_MIGRATION = Object.freeze({
  "20261017000000_media_asset_version": [
    {
      kind: "column",
      table: "MediaAsset",
      column: "version",
      dataType: "integer",
      nullable: false,
      default: "0",
      why: "ADD COLUMN \"version\" INTEGER NOT NULL DEFAULT 0",
    },
  ],
  "20261018000000_password_reset_security": [
    { kind: "column", table: "User", column: "sessionVersion", dataType: "integer", nullable: false, default: "0", why: "ADD COLUMN \"sessionVersion\" INTEGER NOT NULL DEFAULT 0" },
    { kind: "column", table: "User", column: "passwordResetRequestedAt", dataType: "timestamp without time zone", nullable: true, why: "ADD COLUMN ... TIMESTAMP(3) (nullable)" },
    { kind: "table", table: "PasswordResetToken", why: "CREATE TABLE \"PasswordResetToken\"" },
    { kind: "column", table: "PasswordResetToken", column: "id", nullable: false, primaryKey: true, why: "PRIMARY KEY (\"id\")" },
    { kind: "column", table: "PasswordResetToken", column: "tokenHash", nullable: false, why: "NOT NULL" },
    { kind: "column", table: "PasswordResetToken", column: "expiresAt", nullable: false, why: "NOT NULL" },
    { kind: "column", table: "PasswordResetToken", column: "usedAt", nullable: true, why: "usedAt TIMESTAMP(3) nullable" },
    { kind: "column", table: "PasswordResetToken", column: "createdAt", nullable: false, why: "DEFAULT CURRENT_TIMESTAMP" },
    { kind: "index", table: "PasswordResetToken", index: "PasswordResetToken_userId_key", unique: true, why: "CREATE UNIQUE INDEX ... (userId)" },
    { kind: "index", table: "PasswordResetToken", index: "PasswordResetToken_tokenHash_key", unique: true, why: "CREATE UNIQUE INDEX ... (tokenHash)" },
    { kind: "index", table: "PasswordResetToken", index: "PasswordResetToken_expiresAt_idx", unique: false, why: "CREATE INDEX ... (expiresAt)" },
    { kind: "constraint", table: "PasswordResetToken", name: "PasswordResetToken_userId_fkey", contains: ["FOREIGN KEY", "ON DELETE CASCADE", "ON UPDATE CASCADE"], why: "guarded FK to User(id)" },
  ],
  "20261023000000_pos_publication_resolution": [
    { kind: "table", table: "PosPublicationResolution", why: "CREATE TABLE for the 72-hour publication-resolution policy" },
    { kind: "column", table: "PosPublicationResolution", column: "paymentId", nullable: false, why: "one authoritative POS payment per case" },
    { kind: "column", table: "PosPublicationResolution", column: "confirmedAt", dataType: "timestamp without time zone", nullable: false, why: "server-recorded confirmation instant" },
    { kind: "column", table: "PosPublicationResolution", column: "deadlineAt", dataType: "timestamp without time zone", nullable: false, why: "confirmedAt + 72 hours" },
    { kind: "column", table: "PosPublicationResolution", column: "status", nullable: false, default: "OPEN", why: "OPEN initial publication state" },
    { kind: "column", table: "PosPublicationResolution", column: "entitlementStatus", nullable: false, default: "ACTIVE", why: "observational entitlement state; never an authorization grant" },
    { kind: "column", table: "PosPublicationResolution", column: "remedyStatus", nullable: false, default: "PENDING_PUBLICATION", why: "publication remedy, with no invented refund state" },
    { kind: "column", table: "PosPublicationResolution", column: "resolvedAt", dataType: "timestamp without time zone", nullable: true, why: "null until actual publication succeeds" },
    { kind: "index", table: "PosPublicationResolution", index: "PosPublicationResolution_paymentId_key", unique: true, why: "duplicate callbacks cannot create a second case" },
    { kind: "index", table: "PosPublicationResolution", index: "PosPublicationResolution_businessId_status_idx", unique: false, why: "tenant-scoped reconciliation" },
    { kind: "index", table: "PosPublicationResolution", index: "PosPublicationResolution_status_deadlineAt_idx", unique: false, why: "due-case lookup" },
    { kind: "constraint", table: "PosPublicationResolution", name: "PosPublicationResolution_businessId_fkey", contains: ["FOREIGN KEY", "ON DELETE CASCADE", "ON UPDATE CASCADE"], why: "tenant-owned policy record" },
    { kind: "constraint", table: "PosPublicationResolution", name: "PosPublicationResolution_paymentId_fkey", contains: ["FOREIGN KEY", "ON DELETE RESTRICT", "ON UPDATE CASCADE"], why: "preserve the authoritative payment ledger" },
  ],
});

/**
 * The expectations implied by the migrations actually present on this ref.
 * Sorted and de-duplicated so output is stable.
 */
export function requiredExpectations(migrationNames) {
  const present = new Set(migrationNames);
  const out = [];
  for (const [migration, expectations] of Object.entries(EXPECTATIONS_BY_MIGRATION)) {
    if (present.has(migration)) out.push(...expectations.map((e) => ({ ...e, migration })));
  }
  return out;
}

/** Normalise a PostgreSQL column default so `0` matches `0` and `'0'::integer`. */
function normaliseDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/::[a-z ]+/gi, "")
    .replace(/'/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
}

/**
 * Compare expectations against an introspection snapshot.
 *
 * snapshot = {
 *   tables:     { [table]: { columns: { [column]: { dataType, nullable, default, primaryKey } } } },
 *   indexes:    { [indexName]: { table, unique } },
 *   constraints:{ [name]: { table, definition } },
 * }
 *
 * Returns an array of human-readable violations; empty means the schema matches.
 */
export function evaluateExpectations(expectations, snapshot) {
  const violations = [];
  for (const expected of expectations) {
    const label = `${expected.migration} → ${expected.kind} ${expected.table}${expected.column ? `.${expected.column}` : ""}`;

    if (expected.kind === "table") {
      if (!snapshot.tables?.[expected.table]) violations.push(`${label}: table missing`);
      continue;
    }

    if (expected.kind === "column") {
      const column = snapshot.tables?.[expected.table]?.columns?.[expected.column];
      if (!column) {
        violations.push(`${label}: column missing`);
        continue;
      }
      if (expected.dataType && column.dataType !== expected.dataType) {
        violations.push(`${label}: data type is ${column.dataType}, expected ${expected.dataType}`);
      }
      if (typeof expected.nullable === "boolean" && column.nullable !== expected.nullable) {
        violations.push(`${label}: nullable is ${column.nullable}, expected ${expected.nullable}`);
      }
      if (expected.default !== undefined) {
        const actual = normaliseDefault(column.default);
        const wanted = normaliseDefault(expected.default);
        if (actual !== wanted) violations.push(`${label}: default is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
      }
      if (expected.primaryKey && !column.primaryKey) violations.push(`${label}: expected part of the primary key`);
      continue;
    }

    if (expected.kind === "index") {
      const index = snapshot.indexes?.[expected.index];
      if (!index) {
        violations.push(`${label}: index missing`);
        continue;
      }
      if (index.table !== expected.table) violations.push(`${label}: index is on ${index.table}, expected ${expected.table}`);
      if (typeof expected.unique === "boolean" && index.unique !== expected.unique) {
        violations.push(`${label}: unique is ${index.unique}, expected ${expected.unique}`);
      }
      continue;
    }

    if (expected.kind === "constraint") {
      const constraint = snapshot.constraints?.[expected.name];
      if (!constraint) {
        violations.push(`${label}: constraint missing`);
        continue;
      }
      // Belt and braces for the quoting defect fixed in verify-migrations.mjs:
      // compare identifiers with their quotes stripped, so a snapshot that
      // renders `"PasswordResetToken"` and an expectation that names
      // `PasswordResetToken` describe the same table rather than a mismatch.
      const bare = (value) => String(value ?? "").replace(/"/g, "");
      if (bare(constraint.table) !== bare(expected.table)) {
        violations.push(`${label}: constraint is on ${constraint.table}, expected ${expected.table}`);
      }
      for (const fragment of expected.contains ?? []) {
        if (!constraint.definition.toUpperCase().includes(fragment.toUpperCase())) {
          violations.push(`${label}: definition does not contain "${fragment}" (got: ${constraint.definition})`);
        }
      }
      continue;
    }

    violations.push(`${label}: unknown expectation kind`);
  }
  return violations;
}
