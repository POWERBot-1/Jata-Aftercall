import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPECTATIONS_BY_MIGRATION,
  evaluateExpectations,
  requiredExpectations,
} from "../ci/migration-expectations.mjs";

const M1 = "20261017000000_media_asset_version";
const M2 = "20261018000000_password_reset_security";

/** A snapshot that satisfies every declared expectation. */
function goodSnapshot() {
  return {
    tables: {
      MediaAsset: { columns: { version: { dataType: "integer", nullable: false, default: "0", primaryKey: false } } },
      User: {
        columns: {
          sessionVersion: { dataType: "integer", nullable: false, default: "0", primaryKey: false },
          passwordResetRequestedAt: { dataType: "timestamp without time zone", nullable: true, default: null, primaryKey: false },
        },
      },
      PasswordResetToken: {
        columns: {
          id: { dataType: "text", nullable: false, default: null, primaryKey: true },
          tokenHash: { dataType: "text", nullable: false, default: null, primaryKey: false },
          expiresAt: { dataType: "timestamp without time zone", nullable: false, default: null, primaryKey: false },
          usedAt: { dataType: "timestamp without time zone", nullable: true, default: null, primaryKey: false },
          createdAt: { dataType: "timestamp without time zone", nullable: false, default: "CURRENT_TIMESTAMP", primaryKey: false },
        },
      },
    },
    indexes: {
      PasswordResetToken_userId_key: { table: "PasswordResetToken", unique: true },
      PasswordResetToken_tokenHash_key: { table: "PasswordResetToken", unique: true },
      PasswordResetToken_expiresAt_idx: { table: "PasswordResetToken", unique: false },
    },
    constraints: {
      PasswordResetToken_userId_fkey: {
        table: "PasswordResetToken",
        definition: "FOREIGN KEY (\"userId\") REFERENCES \"User\"(id) ON DELETE CASCADE ON UPDATE CASCADE",
      },
    },
  };
}

test("a migration that is not present contributes no expectations", () => {
  assert.deepEqual(requiredExpectations([]), []);
  assert.deepEqual(requiredExpectations(["20250915000000_init"]), []);
});

test("only the migrations on disk contribute", () => {
  const onlyMedia = requiredExpectations([M1]);
  assert.equal(onlyMedia.length, EXPECTATIONS_BY_MIGRATION[M1].length);
  assert.ok(onlyMedia.every((e) => e.migration === M1));

  const both = requiredExpectations([M1, M2]);
  assert.equal(both.length, EXPECTATIONS_BY_MIGRATION[M1].length + EXPECTATIONS_BY_MIGRATION[M2].length);
});

test("PASS: the fully migrated schema satisfies every expectation", () => {
  const violations = evaluateExpectations(requiredExpectations([M1, M2]), goodSnapshot());
  assert.deepEqual(violations, []);
});

test("FAIL: a missing column is reported", () => {
  const snapshot = goodSnapshot();
  delete snapshot.tables.MediaAsset.columns.version;
  const violations = evaluateExpectations(requiredExpectations([M1]), snapshot);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /MediaAsset\.version: column missing/);
});

test("FAIL: a nullable column where NOT NULL was promised is reported", () => {
  const snapshot = goodSnapshot();
  snapshot.tables.User.columns.sessionVersion.nullable = true;
  const violations = evaluateExpectations(requiredExpectations([M2]), snapshot);
  assert.ok(violations.some((v) => /sessionVersion: nullable is true, expected false/.test(v)));
});

test("FAIL: a wrong default is reported", () => {
  const snapshot = goodSnapshot();
  snapshot.tables.MediaAsset.columns.version.default = "1";
  const violations = evaluateExpectations(requiredExpectations([M1]), snapshot);
  assert.ok(violations.some((v) => /version: default is "1", expected "0"/.test(v)));
});

test("a Postgres-cast default is normalised and still matches", () => {
  const snapshot = goodSnapshot();
  snapshot.tables.MediaAsset.columns.version.default = "'0'::integer";
  assert.deepEqual(evaluateExpectations(requiredExpectations([M1]), snapshot), []);
});

test("FAIL: a missing table is reported once, not once per column", () => {
  const snapshot = goodSnapshot();
  delete snapshot.tables.PasswordResetToken;
  const violations = evaluateExpectations(requiredExpectations([M2]), snapshot);
  assert.ok(violations.some((v) => /table PasswordResetToken: table missing/.test(v)));
  assert.ok(violations.some((v) => /PasswordResetToken\.id: column missing/.test(v)));
});

test("FAIL: a missing unique index is reported", () => {
  const snapshot = goodSnapshot();
  delete snapshot.indexes.PasswordResetToken_tokenHash_key;
  const violations = evaluateExpectations(requiredExpectations([M2]), snapshot);
  assert.ok(violations.some((v) => /index missing/));
});

test("FAIL: a non-unique index where a unique one was promised is reported", () => {
  const snapshot = goodSnapshot();
  snapshot.indexes.PasswordResetToken_userId_key.unique = false;
  const violations = evaluateExpectations(requiredExpectations([M2]), snapshot);
  assert.ok(violations.some((v) => /unique is false, expected true/.test(v)));
});

test("FAIL: a missing foreign key and a missing cascade are both reported", () => {
  const missing = goodSnapshot();
  delete missing.constraints.PasswordResetToken_userId_fkey;
  assert.ok(evaluateExpectations(requiredExpectations([M2]), missing).some((v) => /constraint missing/.test(v)));

  const noCascade = goodSnapshot();
  noCascade.constraints.PasswordResetToken_userId_fkey.definition = "FOREIGN KEY (\"userId\") REFERENCES \"User\"(id)";
  const violations = evaluateExpectations(requiredExpectations([M2]), noCascade);
  assert.ok(violations.some((v) => /ON DELETE CASCADE/.test(v)));
});

// ── regression: constraint tables must compare without identifier quoting ──
// Found on 2026-10-21 while closing D2. `conrelid::regclass::text` renders a
// mixed-case table as `"PasswordResetToken"`, quote included. The only
// constraint expectation in the repository names that table, and it is only
// reachable once PR #49's migrations are present — so the gate would have gone
// red on a correctly migrated database the first time someone rebased PR #49,
// and the failure would have looked like a missing foreign key.
test("a quoted regclass table name still matches the unquoted expectation", () => {
  const expectation = {
    kind: "constraint",
    table: "PasswordResetToken",
    name: "PasswordResetToken_userId_fkey",
    contains: ["FOREIGN KEY", "ON DELETE CASCADE", "ON UPDATE CASCADE"],
  };
  const snapshot = {
    tables: {},
    indexes: {},
    constraints: {
      PasswordResetToken_userId_fkey: {
        table: '"PasswordResetToken"',
        definition:
          'FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE',
      },
    },
  };
  assert.deepEqual(evaluateExpectations([expectation], snapshot), []);

  const unquoted = structuredClone(snapshot);
  unquoted.constraints.PasswordResetToken_userId_fkey.table = "PasswordResetToken";
  assert.deepEqual(evaluateExpectations([expectation], unquoted), []);
});

test("a genuinely wrong table is still reported", () => {
  const expectation = {
    kind: "constraint",
    table: "PasswordResetToken",
    name: "PasswordResetToken_userId_fkey",
    contains: ["FOREIGN KEY"],
  };
  const snapshot = {
    tables: {},
    indexes: {},
    constraints: {
      PasswordResetToken_userId_fkey: { table: '"User"', definition: 'FOREIGN KEY ("userId") REFERENCES "User"(id)' },
    },
  };
  const violations = evaluateExpectations([expectation], snapshot);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /constraint is on "User", expected PasswordResetToken/);
});

// ── the verifier cannot be satisfied by a Prisma model edit ────────────────
// `verify-migrations.mjs` reads exactly two things: the migration directories on
// disk, and the live catalog. It never reads prisma/schema.prisma. That is what
// makes it evidence about the database rather than about the intent — adding a
// relation to the model, or deleting an expectation from a migration comment,
// changes nothing it inspects.
//
// This test pins that by reading the module source. It is a structural test on
// purpose: an import would not fail at runtime if someone later "helpfully"
// wired the verifier to the datamodel, and the failure would be silent.
test("the verifier never reads prisma/schema.prisma", () => {
  const source = readFileSync("scripts/ci/verify-migrations.mjs", "utf8");
  assert.equal(/schema\.prisma/.test(source), false, "verify-migrations.mjs must not consult the datamodel");
  assert.equal(/@prisma\/client\/generated|PrismaClient\s*,\s*type/.test(source), false);
  // Its catalog introspection is SQL against the live database, not a model read.
  assert.ok(source.includes("information_schema.columns"), "columns must come from the database");
  assert.ok(source.includes("pg_constraint"), "constraints must come from the database");
  assert.ok(source.includes("pg_indexes"), "indexes must come from the database");
});

test("a model that claims an object the database lacks is not enough", () => {
  // The snapshot is the only input to the decision. An expectation whose object
  // is absent from the snapshot fails, no matter what any datamodel says.
  const expectation = {
    kind: "constraint",
    table: "PasswordResetToken",
    name: "PasswordResetToken_userId_fkey",
    contains: ["FOREIGN KEY", "ON DELETE CASCADE"],
  };
  const snapshotWithoutIt = { tables: {}, indexes: {}, constraints: {} };
  const violations = evaluateExpectations([expectation], snapshotWithoutIt);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /constraint missing/);
});
