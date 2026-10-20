import { test } from "node:test";
import assert from "node:assert/strict";
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
