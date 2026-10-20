#!/usr/bin/env node
/**
 * JATA AFTERCALL — migration ledger and schema verifier
 *
 * Runs against whatever database `DATABASE_URL` names. In the release gate that
 * is a disposable PostgreSQL 18 service; it is never run against production.
 *
 * WHAT IT PROVES
 * --------------
 *   1. Every migration directory on disk is recorded exactly once in
 *      `_prisma_migrations`, is finished, and was not rolled back.
 *   2. No migration is recorded that does not exist on disk (a ledger row
 *      without a directory means the schema came from somewhere else).
 *   3. Every schema object promised by a known pending migration is present
 *      with the right shape — see `migration-expectations.mjs`.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * Provider-specific behaviour (Neon branching, point-in-time restore, compute
 * suspension) is out of scope; a container is not a Neon project.
 *
 * EXIT CODES
 *   0  ledger and schema match
 *   1  a concrete mismatch was found (the details are printed)
 *   2  blocked: no DATABASE_URL, no generated client, or the ledger is absent
 *
 * USAGE
 *   node scripts/ci/verify-migrations.mjs
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateExpectations, requiredExpectations } from "./migration-expectations.mjs";
import { compareManifestToLedger, migrationManifest } from "./migration-manifest.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** Migration directory names on disk, excluding the lock file. */
export function migrationsOnDisk(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function fail(code, message) {
  console.error(`FAIL: ${message}`);
  process.exit(code);
}

async function introspect(prisma) {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const primaryKeys = await prisma.$queryRawUnsafe(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  `);

  const indexes = await prisma.$queryRawUnsafe(`
    SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  `);

  const constraints = await prisma.$queryRawUnsafe(`
    SELECT c.conname AS name, c.conrelid::regclass::text AS table_name,
           pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public'
  `);

  const pkColumns = new Set(primaryKeys.map((row) => `${row.table_name}.${row.column_name}`));
  const tables = {};
  for (const row of columns) {
    tables[row.table_name] ??= { columns: {} };
    tables[row.table_name].columns[row.column_name] = {
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
      default: row.column_default,
      primaryKey: pkColumns.has(`${row.table_name}.${row.column_name}`),
    };
  }

  const indexMap = {};
  for (const row of indexes) {
    indexMap[row.indexname] = {
      table: row.tablename,
      unique: String(row.indexdef).toUpperCase().includes("UNIQUE INDEX"),
      definition: row.indexdef,
    };
  }

  const constraintMap = {};
  for (const row of constraints) {
    constraintMap[row.name] = { table: row.table_name, definition: row.definition };
  }

  return { tables, indexes: indexMap, constraints: constraintMap };
}

/**
 * Print the identity of what is about to be verified: commit, migration count
 * and manifest digest. Without this, a passing run says "some migrations
 * applied" and gives a reviewer no way to tie the result to a tree.
 */
function printIdentity(manifest, { postgres = null } = {}) {
  const commit = process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "(unknown)";
  const ref = process.env.GITHUB_REF_NAME || "(unknown)";
  console.log(`[verify] commit: ${commit}`);
  console.log(`[verify] ref: ${ref}`);
  console.log(`[verify] migrations directory: prisma/migrations`);
  console.log(`[verify] migrations on disk: ${manifest.names.length}`);
  console.log(`[verify] manifest sha256: ${manifest.hash}`);
  console.log(`[verify] first: ${manifest.names[0] ?? "(none)"}`);
  console.log(`[verify] last:  ${manifest.names[manifest.names.length - 1] ?? "(none)"}`);
  if (postgres) console.log(`[verify] postgres server_version: ${postgres}`);
}

async function main() {
  const manifest = migrationManifest(MIGRATIONS_DIR);

  // `--manifest-only` needs no database: it exists so a build log can record the
  // exact history under test before anything runs.
  if (process.argv.includes("--manifest-only")) {
    printIdentity(manifest);
    for (const entry of manifest.entries) console.log(`[verify]   ${entry.name} ${entry.sha256}`);
    return;
  }

  if (!process.env.DATABASE_URL) {
    fail(2, "BLOCKED: DATABASE_URL is not set. A verifier with no database cannot pass.");
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = await import("@prisma/client"));
  } catch (error) {
    fail(2, `BLOCKED: @prisma/client is not generated (${error.message}). Run \`npx prisma generate\` first.`);
  }

  const onDisk = manifest.names;

  const prisma = new PrismaClient();
  try {
    // 0. identity first: if the ledger turns out to be unreadable, the log still
    //    says which commit and which migration history we were looking at.
    let postgres = null;
    try {
      const rows = await prisma.$queryRawUnsafe("SELECT current_setting('server_version') AS v");
      postgres = String(rows[0].v);
    } catch {
      /* reported as a problem below once the ledger has been read */
    }
    printIdentity(manifest, { postgres });

    let ledger;
    try {
      ledger = await prisma.$queryRawUnsafe(
        `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at ASC`,
      );
    } catch (error) {
      fail(2, `BLOCKED: _prisma_migrations is unreadable (${error.message}). Has \`prisma migrate deploy\` run against this database?`);
    }

    const problems = [];
    if (postgres === null) problems.push("could not read server_version from the database");

    const ledgerNames = ledger.map((row) => row.migration_name);

    // 1. every directory applied exactly once
    for (const name of onDisk) {
      const hits = ledgerNames.filter((entry) => entry === name).length;
      if (hits === 0) problems.push(`migration ${name} is on disk but not recorded as applied`);
      if (hits > 1) problems.push(`migration ${name} is recorded ${hits} times`);
    }

    // 2. nothing recorded that is not on disk
    const { unexpected } = compareManifestToLedger(manifest.entries, ledgerNames);
    for (const name of unexpected) {
      problems.push(`migration ${name} is recorded in the ledger but has no directory on disk`);
    }

    // 3. every applied migration finished and none was rolled back
    for (const row of ledger) {
      if (row.finished_at === null || row.finished_at === undefined) problems.push(`migration ${row.migration_name} has no finished_at (it failed or is still running)`);
      if (row.rolled_back_at !== null && row.rolled_back_at !== undefined) problems.push(`migration ${row.migration_name} is marked rolled back`);
      if (Number(row.applied_steps_count) < 1) problems.push(`migration ${row.migration_name} applied 0 steps`);
    }

    // 4. schema objects promised by pending migrations
    const expectations = requiredExpectations(onDisk);
    console.log(`[verify] declarative expectations: ${expectations.length} (from ${new Set(expectations.map((e) => e.migration)).size} migration(s))`);
    const snapshot = await introspect(prisma);
    const violations = evaluateExpectations(expectations, snapshot);
    problems.push(...violations);

    if (problems.length > 0) {
      console.error(`[verify] ${problems.length} problem(s):`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }

    console.log(`[verify] ledger: ${ledger.length} applied, all finished, none rolled back`);
    console.log(`[verify] schema: ${Object.keys(snapshot.tables).length} tables, ${Object.keys(snapshot.indexes).length} indexes, ${Object.keys(snapshot.constraints).length} constraints`);
    console.log(`PASS: ledger and schema expectations match for manifest ${manifest.hash}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`FAIL: verifier crashed: ${error.stack || error.message}`);
    process.exit(1);
  });
}
