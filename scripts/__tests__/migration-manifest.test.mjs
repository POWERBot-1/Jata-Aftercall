import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareManifestToLedger, hashEntries, migrationManifest } from "../ci/migration-manifest.mjs";

// D6 regression suite. A count of migrations is not an identity: the gate must
// be able to say *which* history it exercised, and must notice when the same
// count arrives with different SQL.

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  for (const [name, sql] of Object.entries(files)) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "migration.sql"), sql);
  }
  return dir;
}

test("manifest is sorted and hashes every migration.sql", () => {
  const dir = fixture({
    "20260102000000_second": "SELECT 2;",
    "20260101000000_first": "SELECT 1;",
  });
  const m = migrationManifest(dir);
  assert.deepEqual(m.names, ["20260101000000_first", "20260102000000_second"]);
  assert.equal(m.entries.length, 2);
  assert.match(m.entries[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(m.hash, /^[0-9a-f]{64}$/);
});

test("identical trees produce an identical manifest hash", () => {
  const a = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;" }));
  const b = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;" }));
  assert.equal(a.hash, b.hash);
});

test("different SQL at the same name produces a different hash — the count is unchanged", () => {
  const a = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;" }));
  const b = migrationManifest(fixture({ "20260101000000_x": "SELECT 2;" }));
  assert.equal(a.names.length, b.names.length);
  assert.notEqual(a.hash, b.hash, "same count, different content must not collide");
});

test("renaming a migration changes the hash even when the SQL is identical", () => {
  const a = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;" }));
  const b = migrationManifest(fixture({ "20260101000000_y": "SELECT 1;" }));
  assert.notEqual(a.hash, b.hash, "the ledger keys on the directory name");
});

test("adding a migration changes the hash", () => {
  const a = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;" }));
  const b = migrationManifest(fixture({ "20260101000000_x": "SELECT 1;", "20260102000000_y": "SELECT 2;" }));
  assert.notEqual(a.hash, b.hash);
});

test("hashEntries is order-independent only after sorting — callers must sort", () => {
  const entries = [{ name: "a", sha256: "1" }, { name: "b", sha256: "2" }];
  assert.equal(hashEntries(entries), hashEntries([...entries]));
  assert.notEqual(hashEntries(entries), hashEntries([...entries].reverse()));
});

test("ledger comparison finds a migration on disk that never applied", () => {
  const m = migrationManifest(fixture({ "20260101000000_a": "SELECT 1;", "20260102000000_b": "SELECT 2;" }));
  const { missing, unexpected } = compareManifestToLedger(m.entries, ["20260101000000_a"]);
  assert.deepEqual(missing, ["20260102000000_b"]);
  assert.deepEqual(unexpected, []);
});

test("ledger comparison finds a ledger row with no directory", () => {
  const m = migrationManifest(fixture({ "20260101000000_a": "SELECT 1;" }));
  const { missing, unexpected } = compareManifestToLedger(m.entries, ["20260101000000_a", "20990101000000_ghost"]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unexpected, ["20990101000000_ghost"]);
});
