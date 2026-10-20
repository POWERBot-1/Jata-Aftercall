/**
 * JATA AFTERCALL — migration manifest
 *
 * WHY THIS EXISTS
 * ---------------
 * "16 migrations applied" says nothing about *which* 16. A gate that reports a
 * count cannot tell a reviewer whether the tree it tested is the tree that is
 * about to ship. This module produces a stable identity for the migration
 * history on disk: every `migration.sql`, hashed, in sorted order, folded into
 * one digest.
 *
 * Two trees with the same manifest hash contain byte-identical migration SQL.
 * Two trees with different hashes do not, and no amount of matching counts
 * makes them the same.
 *
 * No dependencies, no database, no I/O beyond reading the files.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build a manifest for `prisma/migrations`.
 *
 * @param {string} migrationsDir absolute path to the migrations directory
 * @returns {{names: string[], entries: {name: string, sha256: string}[], hash: string}}
 */
export function migrationManifest(migrationsDir) {
  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const entries = names.map((name) => {
    const sql = join(migrationsDir, name, "migration.sql");
    const sha256 = createHash("sha256").update(readFileSync(sql)).digest("hex");
    return { name, sha256 };
  });

  return { names, entries, hash: hashEntries(entries) };
}

/**
 * Fold entries into one digest.
 *
 * The digest covers the name *and* the SQL hash, so renaming a migration
 * changes the manifest even if the SQL is untouched — which is correct, because
 * the ledger keys on the directory name.
 */
export function hashEntries(entries) {
  const canonical = entries.map((entry) => `${entry.name} ${entry.sha256}`).join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

/** Compare the manifest against the ledger names read from the database. */
export function compareManifestToLedger(entries, ledgerNames) {
  const expected = entries.map((entry) => entry.name);
  const applied = [...ledgerNames];
  const missing = expected.filter((name) => !applied.includes(name));
  const unexpected = applied.filter((name) => !expected.includes(name));
  return { missing, unexpected };
}
