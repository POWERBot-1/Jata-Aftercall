#!/usr/bin/env node
/**
 * JATA AFTERCALL — reconciliation justification verifier
 *
 * WHY THIS EXISTS
 * ---------------
 * `schema-reconciliation-proposal` proves that applying
 * `docs/schema-reconciliation/reconciliation.patch` makes `prisma migrate diff`
 * return nothing. That is necessary and not sufficient: a patch can silence a
 * diff by describing something the database does not have, and "zero drift"
 * would then be a new lie rather than a fixed one.
 *
 * This script checks both sides of all six recorded divergences:
 *
 *   A. the DATABASE really has the object the model edit describes;
 *   B. the PATCHED DATAMODEL really asserts it.
 *
 * Either half alone is worthless. A model edit with no database object invents
 * a constraint; a database object with no model edit leaves the drift.
 *
 * The six, and what each is allowed to be:
 *
 *   1. MediaAsset.updatedAt        DB default now()                 → model @default(now())
 *   2. PaymentAttempt.businessId   DB FK → Business(id) CASCADE     → model business relation
 *   3. PaymentDestination.capabilities            DB default {}     → model @default([])
 *   4. PaymentDestination unique index  DB name is the 63-char form → model map: that name
 *   5. PaymentProviderConnection.capabilities     DB default {}     → model @default([])
 *   6. PosReceiptSequence.businessId  DB PRIMARY KEY, not just unique → model @id
 *
 * SAFETY
 * ------
 * Read-only. It issues SELECTs against `information_schema` and `pg_catalog`
 * only, never DDL, never a write. It runs against the disposable database the
 * gate has already migrated.
 *
 * EXIT CODES
 *   0  every divergence is justified on both sides
 *   1  a divergence is unjustified, or the patch asserts something the database
 *      does not contain
 *   2  blocked: no database, no generated client, or the schema file is absent
 *
 * USAGE
 *   node scripts/ci/verify-reconciliation-justification.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

/** Extract the body of a Prisma model block. */
export function modelBlock(schemaText, modelName) {
  const match = schemaText.match(new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  return match ? match[1] : null;
}

/**
 * The model-side half of the check, as pure text assertions so it can be
 * unit-tested without a schema file on disk.
 *
 * Returns `[{ id, ok, detail }]`.
 */
export function evaluateModelSide(schemaText) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });

  const media = modelBlock(schemaText, "MediaAsset");
  add(
    "1. MediaAsset.updatedAt carries @default(now())",
    Boolean(media) && /updatedAt\s+DateTime\s+@updatedAt\s+@default\(now\(\)\)/.test(media ?? ""),
    media ? "field line inspected" : "model MediaAsset not found",
  );

  const attempt = modelBlock(schemaText, "PaymentAttempt");
  add(
    "2. PaymentAttempt declares the business relation to Business",
    Boolean(attempt) &&
      /business\s+Business\s+@relation\(fields:\s*\[businessId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/.test(
        attempt ?? "",
      ),
    attempt ? "relation line inspected" : "model PaymentAttempt not found",
  );

  const destination = modelBlock(schemaText, "PaymentDestination");
  add(
    "3. PaymentDestination.capabilities carries @default([])",
    Boolean(destination) && /capabilities\s+String\[\]\s+@default\(\[\]\)/.test(destination ?? ""),
    destination ? "field line inspected" : "model PaymentDestination not found",
  );
  add(
    "4. PaymentDestination's unique index declares the database's truncated name",
    Boolean(destination) &&
      /@@unique\(\[businessId,\s*provider,\s*providerDestinationId,\s*providerAccountRef\],\s*map:\s*"PaymentDestination_businessId_provider_providerDestinationId_pr"\)/.test(
        destination ?? "",
      ),
    destination ? "index line inspected" : "model PaymentDestination not found",
  );

  const connection = modelBlock(schemaText, "PaymentProviderConnection");
  add(
    "5. PaymentProviderConnection.capabilities carries @default([])",
    Boolean(connection) && /capabilities\s+String\[\]\s+@default\(\[\]\)/.test(connection ?? ""),
    connection ? "field line inspected" : "model PaymentProviderConnection not found",
  );

  const sequence = modelBlock(schemaText, "PosReceiptSequence");
  add(
    "6. PosReceiptSequence.businessId is @id (the database's primary key)",
    Boolean(sequence) && /businessId\s+String\s+@id\b/.test(sequence ?? ""),
    sequence ? "field line inspected" : "model PosReceiptSequence not found",
  );
  add(
    "6b. PosReceiptSequence no longer also declares @unique on the same column",
    Boolean(sequence) && !/businessId\s+String\s+@unique\b/.test(sequence ?? ""),
    "a column cannot be both @id and @unique",
  );

  return checks;
}

/** The database-side half, evaluated against an introspected snapshot. */
export function evaluateDatabaseSide(snapshot) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();
  const column = (table, name) => snapshot.columns.find((row) => row.table_name === table && row.column_name === name);

  const updatedAt = column("MediaAsset", "updatedAt");
  // PostgreSQL renders the migration's `DEFAULT CURRENT_TIMESTAMP` as
  // CURRENT_TIMESTAMP; `now()` is the same function under another name and is
  // what a hand-written default may produce. Accept both, reject anything else.
  add(
    "1. MediaAsset.updatedAt has a database default of the current time",
    Boolean(updatedAt) && /^(now\(\)|current_timestamp)$/i.test(String(updatedAt.column_default ?? "").trim()),
    updatedAt ? `default = ${updatedAt.column_default ?? "(none)"}` : "column missing",
  );

  // pg_constraint.confdeltype is a one-character code: 'c' is CASCADE,
  // 'a' is NO ACTION, 'r' RESTRICT, 'n' SET NULL, 'd' SET DEFAULT.
  const cascadeCodes = new Set(["c", "CASCADE"]);
  const fk = snapshot.foreignKeys.find(
    (row) =>
      row.table_name === "PaymentAttempt" &&
      row.referenced_table === "Business" &&
      cascadeCodes.has(String(row.delete_action)),
  );
  add(
    "2. PaymentAttempt.businessId has a CASCADE foreign key to Business",
    Boolean(fk),
    fk ? fk.definition : `PaymentAttempt FKs: ${snapshot.foreignKeys.filter((row) => row.table_name === "PaymentAttempt").map((row) => row.definition).join(" | ") || "(none)"}`,
  );

  for (const [id, table] of [
    ["3. PaymentDestination.capabilities has a database default", "PaymentDestination"],
    ["5. PaymentProviderConnection.capabilities has a database default", "PaymentProviderConnection"],
  ]) {
    const capabilities = column(table, "capabilities");
    add(
      id,
      Boolean(capabilities) && /\{\}|ARRAY\[\]/i.test(capabilities.column_default ?? ""),
      capabilities ? `default = ${capabilities.column_default ?? "(none)"}` : "column missing",
    );
  }

  const index = snapshot.indexes.find(
    (row) => row.table_name === "PaymentDestination" && row.is_unique && row.is_primary === false && /businessId/.test(row.columns ?? ""),
  );
  add(
    "4. PaymentDestination's unique index name is the 63-character form",
    Boolean(index) && index.index_name === "PaymentDestination_businessId_provider_providerDestinationId_pr",
    index ? `name = ${index.index_name} (${index.index_name.length} chars)` : "no matching unique index",
  );

  const sequence = snapshot.indexes.find((row) => row.table_name === "PosReceiptSequence" && row.is_primary);
  add(
    "6. PosReceiptSequence is keyed by a primary key on businessId",
    Boolean(sequence) && squash(sequence.columns) === "businessId",
    sequence ? `primary key columns = ${sequence.columns}` : "no primary key",
  );

  return checks;
}

const SNAPSHOT_SQL = {
  columns: `SELECT table_name, column_name, data_type, is_nullable, column_default
              FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
             ORDER BY table_name, ordinal_position`,
  indexes: `SELECT i.relname AS index_name, c.relname AS table_name,
                   ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
                   (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                      FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum) AS columns
              FROM pg_index ix
              JOIN pg_class i ON i.oid = ix.indexrelid
              JOIN pg_class c ON c.oid = ix.indrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname <> '_prisma_migrations'`,
  foreignKeys: `SELECT c.relname AS table_name,
                       rc.relname AS referenced_table,
                       p.confdeltype::text AS delete_action,
                       pg_get_constraintdef(p.oid) AS definition
                  FROM pg_constraint p
                  JOIN pg_class c ON c.oid = p.conrelid
                  JOIN pg_class rc ON rc.oid = p.confrelid
                 WHERE p.contype = 'f' AND p.connamespace = 'public'::regnamespace`,
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("BLOCKED: DATABASE_URL is not set. A justification check with no database certifies nothing.");
    console.error("::error::BLOCKED: no DATABASE_URL — the justification check did not run");
    return 2;
  }

  let schemaText;
  try {
    schemaText = readFileSync(SCHEMA_PATH, "utf8");
  } catch (error) {
    console.error(`BLOCKED: cannot read ${SCHEMA_PATH} (${error.message})`);
    console.error("::error::BLOCKED: prisma/schema.prisma is unreadable");
    return 2;
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = await import("@prisma/client"));
  } catch (error) {
    console.error(`BLOCKED: @prisma/client is not generated (${error.message})`);
    console.error("::error::BLOCKED: @prisma/client is not generated — run `npx prisma generate` before this step");
    return 2;
  }

  const prisma = new PrismaClient();
  let snapshot;
  try {
    snapshot = {};
    for (const [key, sql] of Object.entries(SNAPSHOT_SQL)) {
      snapshot[key] = await prisma.$queryRawUnsafe(sql);
    }
  } catch (error) {
    console.error(`BLOCKED: the catalog could not be introspected (${error.message})`);
    console.error("::error::BLOCKED: the catalog could not be introspected");
    await prisma.$disconnect();
    return 2;
  }
  await prisma.$disconnect();

  const modelChecks = evaluateModelSide(schemaText);
  const dbChecks = evaluateDatabaseSide(snapshot);

  let failed = 0;
  const emit = (check) => {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}${check.ok ? "" : ` — ${check.detail}`}`);
    if (!check.ok) {
      failed += 1;
      // An annotation survives when the log artifact does not. A check that can
      // fail must be able to say why in the only channel that is always
      // readable from here.
      const detail = String(check.detail ?? "").replace(/%/g, "%25").replace(/\r?\n/g, " | ");
      console.log(`::error::reconciliation ${check.id} FAILED — ${detail.slice(0, 400)}`);
    }
  };
  console.log("── datamodel side (the patch as applied) ──");
  for (const check of modelChecks) emit(check);
  console.log("── database side (the migrations as applied) ──");
  for (const check of dbChecks) emit(check);

  // Always print what was observed, so a PASS is auditable and a FAIL is
  // diagnosable without a second run.
  console.log("── observed ──");
  for (const row of snapshot.columns.filter((r) => ["updatedAt", "capabilities", "businessId"].includes(r.column_name))) {
    console.log(`  column ${row.table_name}.${row.column_name} default=${row.column_default ?? "(none)"}`);
  }
  for (const row of snapshot.indexes.filter((r) => r.table_name === "PosReceiptSequence" || (r.table_name === "PaymentDestination" && r.is_unique))) {
    console.log(`  index  ${row.table_name}.${row.index_name} unique=${row.is_unique} primary=${row.is_primary} columns=${row.columns}`);
  }
  for (const row of snapshot.foreignKeys.filter((r) => r.table_name === "PaymentAttempt")) {
    console.log(`  fk     ${row.table_name} -> ${row.referenced_table} del=${row.delete_action} ${row.definition}`);
  }

  if (failed > 0) {
    console.error(`\nFAIL: ${failed} of ${modelChecks.length + dbChecks.length} justification checks failed.`);
    console.error("      Zero drift is only meaningful when both sides describe the same thing.");
    return 1;
  }
  console.log(`\nPASS: all ${modelChecks.length + dbChecks.length} justification checks hold — every model edit describes an object the database already has.`);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("verify-reconciliation-justification.mjs")) {
  // An uncaught exception means the check could not run, which is BLOCKED —
  // never a statement about the schema, and never a silent exit 1 that reads
  // like "a check failed".
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`BLOCKED: the justification check threw — ${error?.stack ?? error}`);
      console.error("::error::BLOCKED: the justification check threw; treat the reconciliation as UNVERIFIED");
      process.exitCode = 2;
    },
  );
}
