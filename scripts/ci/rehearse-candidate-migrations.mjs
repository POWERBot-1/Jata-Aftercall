#!/usr/bin/env node
/**
 * JATA AFTERCALL — disposable-PostgreSQL rehearsal of a candidate migration set
 *
 * WHY THIS EXISTS
 * ---------------
 * Pull request #49 proposes two additive migrations that are not on `main`:
 *
 *   prisma/migrations/20261017000000_media_asset_version
 *   prisma/migrations/20261018000000_password_reset_security
 *
 * Neither has been executed on a database by this review. A static read of the
 * SQL is not evidence that the history applies in order, that the ledger ends
 * complete, that the objects the application selects really exist, or that a
 * failure in the middle of the history is reported as a failure. This script
 * performs that rehearsal against a database that the caller guarantees is
 * disposable, and it prints what it actually did.
 *
 * WHAT IT PROVES
 * --------------
 *   1. The candidate history (preceding migrations first, in filename order,
 *      then both candidates) applies to an empty database with `migrate deploy`.
 *   2. The ledger has one finished, non-rolled-back, log-free row per migration,
 *      and no row that has no directory on disk.
 *   3. Every column, index, primary key and foreign key promised by the two
 *      candidate migrations exists with the promised shape.
 *   4. Applying the same 18 files with `psql -f` (no ledger, no Prisma) reaches
 *      a byte-identical catalog inventory — the chain is not order-dependent
 *      magic performed by the CLI.
 *   5. A second `migrate deploy` applies nothing (the history is idempotent from
 *      Prisma's point of view).
 *   6. A deliberately broken migration makes `migrate deploy` exit non-zero,
 *      leaves a failed row with logs, and makes `migrate status` exit non-zero.
 *      A rehearsal that cannot detect this is not a rehearsal.
 *   7. The candidate still generates a client, typechecks and runs its own test
 *      suite against the migrated database.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 * A container is not Neon. Nothing here says anything about branching, restore,
 * compute suspension, connection pooling or provider-side behaviour. Nothing
 * here is deployed: the candidate tree is read, never written.
 *
 * SAFETY
 * ------
 * The script only writes to databases it is told to create, named
 * `jata_rehearsal_*`, on the server named by `--admin-url`. It refuses to run if
 * the URL resolves to a host other than localhost/127.0.0.1 unless
 * `--allow-remote-host` is passed, and it refuses any database name that does
 * not start with `jata_rehearsal_`. No production target can be reached by
 * accident.
 *
 * USAGE
 *   node scripts/ci/rehearse-candidate-migrations.mjs \
 *     --candidate-dir ./candidate \
 *     --baseline-dir ./gate/prisma/migrations \
 *     --admin-url postgresql://user:pass@localhost:5432/postgres \
 *     --summary-file /tmp/rehearsal-summary.md
 *
 * EXIT CODES
 *   0  every check passed
 *   1  a concrete check failed (details printed)
 *   2  blocked: a precondition could not be met (no psql, no candidate tree,
 *      no Prisma CLI, a migration set that could not be identified)
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrationManifest } from "./migration-manifest.mjs";

// ── Expectations for the two candidate migrations ──────────────────────────
// Declarative on purpose: the reader can compare this list against the two
// migration.sql files without reading any control flow.
export const CANDIDATE_EXPECTATIONS = [
  { kind: "column", table: "MediaAsset", column: "version", type: "integer", nullable: "NO", default: "0" },
  { kind: "column", table: "User", column: "sessionVersion", type: "integer", nullable: "NO", default: "0" },
  {
    kind: "column",
    table: "User",
    column: "passwordResetRequestedAt",
    type: "timestamp without time zone",
    nullable: "YES",
    default: null,
  },
  { kind: "table", table: "PasswordResetToken" },
  { kind: "column", table: "PasswordResetToken", column: "id", type: "text", nullable: "NO", default: null },
  { kind: "column", table: "PasswordResetToken", column: "userId", type: "text", nullable: "NO", default: null },
  { kind: "column", table: "PasswordResetToken", column: "tokenHash", type: "text", nullable: "NO", default: null },
  {
    kind: "column",
    table: "PasswordResetToken",
    column: "expiresAt",
    type: "timestamp without time zone",
    nullable: "NO",
    default: null,
  },
  {
    kind: "column",
    table: "PasswordResetToken",
    column: "usedAt",
    type: "timestamp without time zone",
    nullable: "YES",
    default: null,
  },
  {
    kind: "column",
    table: "PasswordResetToken",
    column: "createdAt",
    type: "timestamp without time zone",
    nullable: "NO",
    default: "CURRENT_TIMESTAMP",
  },
  { kind: "index", table: "PasswordResetToken", name: "PasswordResetToken_userId_key", columns: "userId", unique: true },
  {
    kind: "index",
    table: "PasswordResetToken",
    name: "PasswordResetToken_tokenHash_key",
    columns: "tokenHash",
    unique: true,
  },
  {
    kind: "index",
    table: "PasswordResetToken",
    name: "PasswordResetToken_expiresAt_idx",
    columns: "expiresAt",
    unique: false,
  },
  {
    kind: "constraint",
    table: "PasswordResetToken",
    type: "p",
    definitionIncludes: ['PRIMARY KEY ("id")'],
  },
  {
    kind: "constraint",
    table: "PasswordResetToken",
    type: "f",
    definitionIncludes: [
      'FOREIGN KEY ("userId") REFERENCES "User"(id)',
      "ON DELETE CASCADE",
      "ON UPDATE CASCADE",
    ],
  },
];

// Statements that would destroy or rewrite existing rows or objects. The two
// candidate migrations are additive by contract; a rehearsal that silently
// accepted a DROP would be worthless.
const DESTRUCTIVE = [
  { label: "DROP", pattern: /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|SCHEMA|TYPE|EXTENSION)\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "UPDATE", pattern: /^\s*UPDATE\s/i },
  { label: "DELETE FROM", pattern: /^\s*DELETE\s+FROM\s/i },
  { label: "ALTER COLUMN TYPE", pattern: /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i },
];

/**
 * Split SQL into statements well enough for a keyword scan.
 *
 * The scan runs on statement text with `--` comment lines removed, because both
 * candidate files explain themselves in prose and a comment must never be
 * mistaken for DDL (or hide it).
 */
export function statementsOf(sql) {
  return String(sql)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Return the offending statement text for every destructive statement found. */
export function scanForDestructiveStatements(sql) {
  const findings = [];
  for (const statement of statementsOf(sql)) {
    for (const rule of DESTRUCTIVE) {
      if (rule.pattern.test(statement)) {
        findings.push(`${rule.label}: ${statement.replace(/\s+/g, " ").slice(0, 140)}`);
        break;
      }
    }
  }
  return findings;
}

/** Migration directory names that are directories, sorted. */
export function migrationDirectories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Names present in `candidate` but not in `baseline`, in candidate order. */
export function extraMigrations(baselineNames, candidateNames) {
  return candidateNames.filter((name) => !baselineNames.includes(name));
}

/** Names present in `baseline` but missing from `candidate` (a deletion, not an addition). */
export function missingMigrations(baselineNames, candidateNames) {
  return baselineNames.filter((name) => !candidateNames.includes(name));
}

/**
 * Compare an introspected catalog against declarative expectations.
 *
 * `snapshot` is `{ tables, columns, indexes, constraints }` as produced by
 * `snapshot()`. Pure: no database and no filesystem, which is what makes the
 * check itself testable — see scripts/__tests__/rehearse-candidate-migrations.test.mjs.
 */
export function evaluateSnapshot(snapshot, expectations = CANDIDATE_EXPECTATIONS) {
  const checks = [];
  const columnKey = (table, column) => `${table}.${column}`;
  const columns = new Map(snapshot.columns.map((row) => [columnKey(row.table_name, row.column_name), row]));
  const tables = new Set(snapshot.tables.map((row) => row.table_name));

  for (const expectation of expectations) {
    if (expectation.kind === "table") {
      const ok = tables.has(expectation.table);
      checks.push({
        name: `table ${expectation.table} exists`,
        ok,
        detail: ok ? "" : `tables present: ${[...tables].sort().join(", ") || "(none)"}`,
      });
    }
    if (expectation.kind === "column") {
      const row = columns.get(columnKey(expectation.table, expectation.column));
      if (!row) {
        checks.push({ name: `column ${expectation.table}.${expectation.column} exists`, ok: false, detail: "missing" });
        continue;
      }
      const problems = [];
      if (row.data_type !== expectation.type) problems.push(`type is ${row.data_type}, expected ${expectation.type}`);
      if (row.is_nullable !== expectation.nullable) {
        problems.push(`nullability is ${row.is_nullable}, expected ${expectation.nullable}`);
      }
      const actualDefault = row.column_default === null || row.column_default === undefined ? null : String(row.column_default);
      const expectedDefault = expectation.default === null ? null : String(expectation.default);
      // PostgreSQL reports a numeric default as `0` and a timestamp default as
      // `CURRENT_TIMESTAMP`; both are compared literally, with the only
      // tolerated variance being a ::text/::integer cast suffix the server may add.
      const normalise = (value) =>
        value === null ? null : value.replace(/::[a-z_ ]+(\[\])?$/i, "").replace(/\s+/g, " ").trim();
      if (normalise(actualDefault) !== normalise(expectedDefault)) {
        problems.push(`default is ${actualDefault === null ? "(none)" : actualDefault}, expected ${expectedDefault === null ? "(none)" : expectedDefault}`);
      }
      checks.push({
        name: `column ${expectation.table}.${expectation.column}`,
        ok: problems.length === 0,
        detail: problems.join("; "),
      });
    }
    if (expectation.kind === "index") {
      const candidates = snapshot.indexes.filter(
        (row) =>
          row.table_name === expectation.table &&
          (expectation.name ? row.index_name === expectation.name : true) &&
          (expectation.columns ? row.columns === expectation.columns : true),
      );
      if (candidates.length === 0) {
        const seen = snapshot.indexes
          .filter((row) => row.table_name === expectation.table)
          .map((row) => `${row.index_name}(${row.columns}) unique=${row.is_unique}`)
          .join(", ");
        checks.push({
          name: `index ${expectation.name ?? `${expectation.table}(${expectation.columns})`}`,
          ok: false,
          detail: `missing; indexes on ${expectation.table}: ${seen || "(none)"}`,
        });
        continue;
      }
      const row = candidates[0];
      const problems = [];
      if (expectation.columns && row.columns !== expectation.columns) {
        problems.push(`columns are ${row.columns}, expected ${expectation.columns}`);
      }
      if (expectation.unique !== undefined && row.is_unique !== expectation.unique) {
        problems.push(`unique is ${row.is_unique}, expected ${expectation.unique}`);
      }
      checks.push({
        name: `index ${row.index_name}(${row.columns})${row.is_unique ? " unique" : ""}`,
        ok: problems.length === 0,
        detail: problems.join("; "),
      });
    }
    if (expectation.kind === "constraint") {
      const candidates = snapshot.constraints.filter(
        (row) => row.table_name === expectation.table && (expectation.type ? row.contype === expectation.type : true),
      );
      if (candidates.length === 0) {
        checks.push({
          name: `constraint ${expectation.type} on ${expectation.table}`,
          ok: false,
          detail: `missing; constraints on ${expectation.table}: ${
            snapshot.constraints
              .filter((row) => row.table_name === expectation.table)
              .map((row) => `${row.conname}(${row.contype})`)
              .join(", ") || "(none)"
          }`,
        });
        continue;
      }
      const row = candidates[0];
      const missing = (expectation.definitionIncludes ?? []).filter((fragment) => !row.definition.includes(fragment));
      checks.push({
        name: `constraint ${row.conname}`,
        ok: missing.length === 0,
        detail: missing.length === 0 ? "" : `definition ${row.definition} lacks ${missing.join(" / ")}`,
      });
    }
  }
  return checks;
}

/** A stable, sorted text rendering of a catalog snapshot, for equality checks. */
export function canonicalInventory(snapshot) {
  const lines = [];
  for (const row of [...snapshot.tables].sort((a, b) => a.table_name.localeCompare(b.table_name))) {
    lines.push(`table ${row.table_name}`);
  }
  for (const row of [...snapshot.columns].sort((a, b) =>
    `${a.table_name}.${a.column_name}`.localeCompare(`${b.table_name}.${b.column_name}`),
  )) {
    lines.push(
      `column ${row.table_name}.${row.column_name} ${row.data_type}(${row.datetime_precision ?? "-"},${row.numeric_precision ?? "-"},${row.character_maximum_length ?? "-"}) null=${row.is_nullable} default=${row.column_default ?? "-"}`,
    );
  }
  for (const row of [...snapshot.indexes].sort((a, b) => `${a.table_name}.${a.index_name}`.localeCompare(`${b.table_name}.${b.index_name}`))) {
    lines.push(
      `index ${row.table_name}.${row.index_name} unique=${row.is_unique} primary=${row.is_primary} columns=${row.columns ?? "-"}`,
    );
  }
  for (const row of [...snapshot.constraints].sort((a, b) => `${a.table_name}.${a.conname}`.localeCompare(`${b.table_name}.${b.conname}`))) {
    lines.push(`constraint ${row.table_name}.${row.conname} type=${row.contype} definition=${row.definition}`);
  }
  return lines.join("\n");
}

// ── Process plumbing ───────────────────────────────────────────────────────

const state = { checks: [], blocked: [], notes: [], failed: false };

function pass(name, detail = "") {
  state.checks.push({ name, status: "PASS", detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail = "") {
  state.checks.push({ name, status: "FAIL", detail });
  state.failed = true;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

function blocked(name, detail = "") {
  state.checks.push({ name, status: "BLOCKED", detail });
  state.blocked.push(name);
  console.log(`BLOCKED ${name}${detail ? ` — ${detail}` : ""}`);
}

function note(message) {
  state.notes.push(message);
  console.log(`NOTE ${message}`);
}

function section(title) {
  console.log(`\n──── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
}

function run(command, args, { cwd, env = {}, timeout = 900000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status, signal: result.signal, error: result.error, output };
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "REDACTED";
    return url.toString();
  } catch {
    return "(unparsable url)";
  }
}

function psqlUrl(adminUrl, database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function parseArgs(argv) {
  const args = {
    candidateDir: "candidate",
    baselineDir: "gate/prisma/migrations",
    adminUrl: process.env.PG_ADMIN_URL ?? "",
    summaryFile: "",
    allowRemoteHost: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[index];
    };
    if (flag === "--candidate-dir") args.candidateDir = next();
    else if (flag === "--baseline-dir") args.baselineDir = next();
    else if (flag === "--admin-url") args.adminUrl = next();
    else if (flag === "--summary-file") args.summaryFile = next();
    else if (flag === "--allow-remote-host") args.allowRemoteHost = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  return args;
}

function psqlJson(url, sql, { database } = {}) {
  const target = database ? psqlUrl(url, database) : url;
  const result = run("psql", [target, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (result.status !== 0) {
    throw new Error(`psql failed (exit ${result.status}): ${result.output.trim().slice(0, 800)}`);
  }
  const text = result.output.trim();
  if (!text) return [];
  return JSON.parse(text);
}

function psqlScalar(url, sql) {
  const result = run("psql", [url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status}): ${result.output.trim().slice(0, 800)}`);
  return result.output.trim();
}

function psqlFile(url, file) {
  return run("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse", "-f", file]);
}

const SNAPSHOT_SQL = {
  tables: `SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name) t`,
  columns: `SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT table_name, column_name, data_type, is_nullable, column_default,
             datetime_precision, numeric_precision, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name, ordinal_position) t`,
  indexes: `SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT i.relname AS index_name, c.relname AS table_name, ix.indisunique AS is_unique,
             ix.indisprimary AS is_primary,
             (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
                FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum) AS columns
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class c ON c.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname <> '_prisma_migrations'
      ORDER BY i.relname) t`,
  constraints: `SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT conname, conrelid::regclass::text AS table_name, contype::text AS contype,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conrelid::regclass::text <> '_prisma_migrations'
      ORDER BY conname) t`,
};

function snapshot(url) {
  const result = {};
  for (const [key, sql] of Object.entries(SNAPSHOT_SQL)) {
    result[key] = psqlJson(url, sql);
  }
  return result;
}

function dropAndCreate(adminUrl, database) {
  psqlScalar(adminUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  psqlScalar(adminUrl, `CREATE DATABASE "${database}"`);
}

function prismaCli(candidateDir) {
  const local = join(candidateDir, "node_modules", ".bin", "prisma");
  if (existsSync(local)) return { command: local, prefix: [] };
  return { command: "npx", prefix: ["--no-install", "prisma"] };
}

/**
 * Run the Prisma CLI that belongs to the candidate tree.
 *
 * `cwd` and `cliDir` are separate on purpose: the failure control runs from a
 * scratch history directory that deliberately has no node_modules, but it must
 * still use the candidate's CLI so the two runs share one engine.
 */
function runPrisma(cwd, args, env, cliDir = cwd) {
  const { command, prefix } = prismaCli(cliDir);
  return run(command, [...prefix, ...args], { cwd, env });
}

function sanitise(log) {
  return String(log).replace(/\x1b\[[0-9;]*m/g, "");
}

function ledger(candidateDir, url) {
  const sql = `SELECT coalesce(json_agg(row_to_json(t)), '[]') FROM (
      SELECT migration_name, finished_at IS NOT NULL AS finished,
             rolled_back_at IS NOT NULL AS rolled_back, logs IS NOT NULL AS has_logs,
             started_at IS NOT NULL AS started_at_present
      FROM _prisma_migrations ORDER BY started_at) t`;
  return psqlJson(url, sql);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`);
    return 2;
  }

  const candidateDir = resolve(args.candidateDir);
  const baselineDir = resolve(args.baselineDir);
  const candidateMigrationsDir = join(candidateDir, "prisma", "migrations");

  section("Preconditions");

  if (!args.adminUrl) {
    blocked("an admin database URL was supplied", "pass --admin-url or set PG_ADMIN_URL");
  }
  let adminUrl = args.adminUrl;
  if (adminUrl) {
    let parsed;
    try {
      parsed = new URL(adminUrl);
    } catch {
      blocked("the admin URL parses", "the value is not a URL");
    }
    if (parsed) {
      const host = parsed.hostname;
      if (!["localhost", "127.0.0.1", "::1"].includes(host) && !args.allowRemoteHost) {
        blocked(
          "the target is a disposable local server",
          `host is ${host}; pass --allow-remote-host only for a deliberately disposable server`,
        );
      } else {
        pass("the target is a disposable local server", `${host}:${parsed.port || "5432"} database=${parsed.pathname.replace(/^\//, "")}`);
      }
      adminUrl = parsed.toString();
    }
  }

  for (const [label, dir] of [
    ["the candidate tree", candidateMigrationsDir],
    ["the baseline migration tree", baselineDir],
  ]) {
    if (existsSync(dir) && statSync(dir).isDirectory()) pass(`${label} exists`, dir);
    else blocked(`${label} exists`, `${dir} is not a directory`);
  }

  const psqlPresent = run("psql", ["--version"]);
  if (psqlPresent.status === 0) pass("psql is available", psqlPresent.output.trim());
  else blocked("psql is available", "install postgresql-client; without it nothing can be verified");

  if (state.blocked.length > 0) {
    console.log("\nRESULT: BLOCKED");
    writeSummary(args.summaryFile, "BLOCKED");
    return 2;
  }

  // ── Identity: the rehearsal must name exactly what it tested ─────────────
  section("Identity of the tree under rehearsal");

  const serverVersion = psqlScalar(adminUrl, "SELECT current_setting('server_version')");
  console.log(`postgres server_version = ${serverVersion}`);
  if (!/^18\./.test(serverVersion)) {
    console.log(`WARNING: expected PostgreSQL 18 (the production major version); this server reports ${serverVersion}`);
  }

  const candidateCommit = run("git", ["-C", candidateDir, "rev-parse", "HEAD"]).output.trim();
  const candidateSubject = run("git", ["-C", candidateDir, "log", "-1", "--format=%s"]).output.trim();
  console.log(`candidate commit   = ${candidateCommit || "(unknown — not a git checkout)"}`);
  console.log(`candidate subject  = ${candidateSubject || "(unknown)"}`);

  const candidateNames = migrationDirectories(candidateMigrationsDir);
  const baselineNames = migrationDirectories(baselineDir);
  const candidateManifest = migrationManifest(candidateMigrationsDir);
  const baselineManifest = migrationManifest(baselineDir);

  console.log(`migration directory = ${candidateMigrationsDir}`);
  console.log(`baseline count      = ${baselineNames.length} (manifest ${baselineManifest.hash})`);
  console.log(`candidate count     = ${candidateNames.length} (manifest ${candidateManifest.hash})`);

  const extras = extraMigrations(baselineNames, candidateNames);
  const removed = missingMigrations(baselineNames, candidateNames);
  console.log(`added by candidate  = ${extras.length ? extras.join(", ") : "(none)"}`);

  if (removed.length > 0) {
    fail("the candidate history only adds migrations", `missing versus baseline: ${removed.join(", ")}`);
  } else {
    pass("the candidate history only adds migrations", `0 baseline migrations removed`);
  }

  if (extras.length === 0) {
    blocked("the candidate adds migrations", "no difference from the baseline — nothing to rehearse");
    console.log("\nRESULT: BLOCKED");
    writeSummary(args.summaryFile, "BLOCKED");
    return 2;
  }

  const nodeVersion = process.version;
  const prismaVersionPath = join(candidateDir, "node_modules", "prisma", "package.json");
  const prismaVersion = existsSync(prismaVersionPath)
    ? JSON.parse(readFileSync(prismaVersionPath, "utf8")).version
    : "(not installed)";
  console.log(`node               = ${nodeVersion}`);
  console.log(`prisma CLI         = ${prismaVersion}`);

  // Static safety scan of the added SQL only. A rehearsal of an additive
  // migration is only meaningful if the migration is in fact additive.
  for (const name of extras) {
    const sql = readFileSync(join(candidateMigrationsDir, name, "migration.sql"), "utf8");
    const findings = scanForDestructiveStatements(sql);
    if (findings.length === 0) pass(`${name} contains no destructive statement`);
    else fail(`${name} contains no destructive statement`, findings.join(" | "));
    const sha = candidateManifest.entries.find((entry) => entry.name === name)?.sha256 ?? "(unknown)";
    console.log(`  ${name} sha256=${sha}`);
  }

  const prismaAvailable = runPrisma(candidateDir, ["--version"], {}).status === 0;
  if (prismaAvailable) pass("the candidate Prisma CLI runs", prismaVersion);
  else {
    blocked("the candidate Prisma CLI runs", "prisma --version failed; install dependencies in the candidate tree first");
    console.log("\nRESULT: BLOCKED");
    writeSummary(args.summaryFile, "BLOCKED");
    return 2;
  }

  const fullDb = "jata_rehearsal_full";
  const stepDb = "jata_rehearsal_sequential";
  const failDb = "jata_rehearsal_failure";
  const fullUrl = psqlUrl(adminUrl, fullDb);
  const stepUrl = psqlUrl(adminUrl, stepDb);
  const failUrl = psqlUrl(adminUrl, failDb);
  const env = { DATABASE_URL: fullUrl, AUTH_SECRET: process.env.AUTH_SECRET ?? "rehearsal-disposable-secret" };

  let driftReport = "";
  let failureControl = { attempted: false, detected: false, ledgerRecorded: false, statusExited: false };

  // ── 1. The whole history through Prisma ──────────────────────────────────
  section("1. The complete history applies with `prisma migrate deploy`");
  try {
    dropAndCreate(adminUrl, fullDb);
    pass("a disposable database was created", `${redactUrl(fullUrl)}`);
    const deploy = runPrisma(candidateDir, ["migrate", "deploy"], env);
    const plain = sanitise(deploy.output);
    console.log(plain.trim().split("\n").slice(0, 40).join("\n"));
    if (deploy.status !== 0) {
      fail("`prisma migrate deploy` exits 0", `exit ${deploy.status}: ${plain.trim().slice(-1200)}`);
    } else {
      pass("`prisma migrate deploy` exits 0", `exit 0`);
      const applied = (plain.match(/Applying migration/gi) ?? []).length;
      if (applied === candidateNames.length) pass(`the log names all ${candidateNames.length} migrations`, `${applied} applied`);
      else fail(`the log names all ${candidateNames.length} migrations`, `${applied} "Applying migration" lines`);
      for (const name of extras) {
        if (plain.includes(name)) pass(`the log names ${name}`);
        else fail(`the log names ${name}`, "the migration name does not appear in the deploy output");
      }
    }
  } catch (error) {
    fail("the complete history applies", error.message);
  }

  // ── 2. Ledger ────────────────────────────────────────────────────────────
  section("2. The migration ledger is complete");
  try {
    const rows = ledger(candidateDir, fullUrl);
    if (rows.length === candidateNames.length) pass(`ledger has ${candidateNames.length} rows`, `${rows.length}`);
    else fail(`ledger has ${candidateNames.length} rows`, `${rows.length}`);

    const unfinished = rows.filter((row) => !row.finished).map((row) => row.migration_name);
    const rolledBack = rows.filter((row) => row.rolled_back).map((row) => row.migration_name);
    const withLogs = rows.filter((row) => row.has_logs).map((row) => row.migration_name);
    const notStarted = rows.filter((row) => !row.started_at_present).map((row) => row.migration_name);
    if (unfinished.length === 0) pass("every ledger row is finished");
    else fail("every ledger row is finished", unfinished.join(", "));
    if (rolledBack.length === 0) pass("no ledger row is rolled back");
    else fail("no ledger row is rolled back", rolledBack.join(", "));
    if (withLogs.length === 0) pass("no ledger row carries error logs");
    else fail("no ledger row carries error logs", withLogs.join(", "));
    if (notStarted.length === 0) pass("every ledger row has a start time");
    else fail("every ledger row has a start time", notStarted.join(", "));

    const ledgerNames = rows.map((row) => row.migration_name).sort();
    const onDisk = [...candidateNames].sort();
    if (ledgerNames.join("|") === onDisk.join("|")) pass("the ledger names match the directories exactly");
    else
      fail(
        "the ledger names match the directories exactly",
        `only in ledger: ${ledgerNames.filter((name) => !onDisk.includes(name)).join(", ") || "-"}; only on disk: ${
          onDisk.filter((name) => !ledgerNames.includes(name)).join(", ") || "-"
        }`,
      );
  } catch (error) {
    fail("the migration ledger is readable", error.message);
  }

  // ── 3. Objects promised by the candidate migrations ─────────────────────
  section("3. Every object promised by the candidate migrations exists");
  let fullSnapshot = null;
  try {
    fullSnapshot = snapshot(fullUrl);
    for (const check of evaluateSnapshot(fullSnapshot)) {
      if (check.ok) pass(check.name, check.detail);
      else fail(check.name, check.detail);
    }
  } catch (error) {
    fail("the deployed catalog can be introspected", error.message);
  }

  // ── 4. Sequential psql application reaches the same catalog ─────────────
  section("4. Applying the same files with `psql -f` reaches the same catalog");
  try {
    dropAndCreate(adminUrl, stepDb);
    pass("a second disposable database was created", redactUrl(stepUrl));
    const ordered = [...candidateNames].sort();
    let applied = 0;
    for (const name of ordered) {
      const file = join(candidateMigrationsDir, name, "migration.sql");
      const result = psqlFile(stepUrl, file);
      if (result.status !== 0) {
        fail(`psql applies ${name}`, `exit ${result.status}: ${result.output.trim().slice(0, 600)}`);
        break;
      }
      applied += 1;
    }
    if (applied === ordered.length) pass(`psql applied all ${ordered.length} migrations in filename order`);
    const stepSnapshot = snapshot(stepUrl);
    if (!fullSnapshot) {
      blocked("catalog equivalence can be compared", "the migrate deploy catalog was not captured");
    } else {
      const left = canonicalInventory(fullSnapshot);
      const right = canonicalInventory(stepSnapshot);
      if (left === right) {
        pass("both application paths produce an identical catalog inventory", `${left.split("\n").length} inventory lines`);
      } else {
        const leftLines = left.split("\n");
        const rightLines = right.split("\n");
        const onlyLeft = leftLines.filter((line) => !rightLines.includes(line));
        const onlyRight = rightLines.filter((line) => !leftLines.includes(line));
        fail(
          "both application paths produce an identical catalog inventory",
          `only via migrate deploy: ${onlyLeft.slice(0, 6).join(" | ") || "-"}; only via psql: ${onlyRight.slice(0, 6).join(" | ") || "-"}`,
        );
      }
    }
  } catch (error) {
    fail("the sequential path can be rehearsed", error.message);
  }

  // ── 5. Idempotency ──────────────────────────────────────────────────────
  section("5. A second `migrate deploy` applies nothing");
  try {
    const again = runPrisma(candidateDir, ["migrate", "deploy"], env);
    const plain = sanitise(again.output);
    if (again.status !== 0) {
      fail("the second `prisma migrate deploy` exits 0", `exit ${again.status}: ${plain.trim().slice(-800)}`);
    } else if (/Applying migration/i.test(plain)) {
      fail("the second `prisma migrate deploy` applies nothing", "it applied migrations that were already applied");
    } else {
      pass("the second `prisma migrate deploy` applies nothing", "no pending migrations");
    }
    const rows = ledger(candidateDir, fullUrl);
    if (rows.length === candidateNames.length) pass("the ledger is unchanged by the second deployment", `${rows.length} rows`);
    else fail("the ledger is unchanged by the second deployment", `${rows.length} rows`);
  } catch (error) {
    fail("idempotency can be checked", error.message);
  }

  // ── 6. Live schema versus the candidate datamodel ───────────────────────
  section("6. The migrated catalog versus prisma/schema.prisma");
  try {
    const diff = runPrisma(
      candidateDir,
      ["migrate", "diff", "--from-schema-datasource", "prisma/schema.prisma", "--to-schema-datamodel", "prisma/schema.prisma", "--script", "--exit-code"],
      env,
    );
    const plain = sanitise(diff.output).trim();
    if (diff.status === 0) {
      pass("the migration history and the datamodel agree", "empty diff");
    } else if (diff.status === 2) {
      // Drift is a finding about the candidate, not a failure of the
      // rehearsal: the migrations applied exactly as written. It is reported
      // and recorded, never hidden.
      note(`the migration history and the datamodel do NOT agree — ${plain.split("\n").filter(Boolean).length} statement(s):`);
      console.log(plain);
      driftReport = plain;
    } else {
      blocked("`prisma migrate diff` runs", `exit ${diff.status}: ${plain.slice(0, 600)}`);
    }
  } catch (error) {
    blocked("`prisma migrate diff` runs", error.message);
  }

  // ── 7. A broken migration must fail, loudly and recordably ──────────────
  section("7. A deliberately broken migration must fail and be recorded");
  try {
    dropAndCreate(adminUrl, failDb);
    const scratchRoot = mkdtempSync(join(tmpdir(), "jata-failure-history-"));
    const scratchPrisma = join(scratchRoot, "prisma");
    const scratchMigrations = join(scratchPrisma, "migrations");
    mkdirSync(scratchMigrations, { recursive: true });
    cpSync(join(candidateDir, "prisma", "schema.prisma"), join(scratchPrisma, "schema.prisma"));
    const lock = join(candidateMigrationsDir, "migration_lock.toml");
    if (existsSync(lock)) cpSync(lock, join(scratchMigrations, "migration_lock.toml"));
    // Every real migration except the last one, then a control that cannot apply.
    for (const name of candidateNames.slice(0, -1)) {
      cpSync(join(candidateMigrationsDir, name), join(scratchMigrations, name), { recursive: true });
    }
    const control = "99999999999999_rehearsal_failure_control";
    mkdirSync(join(scratchMigrations, control), { recursive: true });
    writeFileSync(
      join(scratchMigrations, control, "migration.sql"),
      '-- Negative control: the table does not exist, so this statement must fail.\nALTER TABLE "NoSuchTableForRehearsal" ADD COLUMN "x" TEXT;\n',
    );

    const controlEnv = { DATABASE_URL: failUrl, AUTH_SECRET: env.AUTH_SECRET };
    const broken = runPrisma(
      scratchRoot,
      ["migrate", "deploy", "--schema", join(scratchPrisma, "schema.prisma")],
      controlEnv,
      candidateDir,
    );
    const brokenPlain = sanitise(broken.output);
    failureControl.attempted = true;
    console.log(brokenPlain.trim().split("\n").slice(-12).join("\n"));
    if (broken.status === 0) {
      fail("a broken migration makes `migrate deploy` exit non-zero", "it exited 0 — a failed migration would read as success");
    } else {
      pass("a broken migration makes `migrate deploy` exit non-zero", `exit ${broken.status}`);
      failureControl.detected = true;
    }

    const failedRows = ledger(candidateDir, failUrl);
    const controlRow = failedRows.find((row) => row.migration_name === control);
    if (!controlRow) {
      fail("the failed migration is recorded in the ledger", "no row for the control migration");
    } else if (controlRow.finished || !controlRow.has_logs) {
      fail(
        "the failed migration is recorded in the ledger",
        `finished=${controlRow.finished} has_logs=${controlRow.has_logs} — an unfinished row without logs is not diagnosable`,
      );
    } else {
      pass("the failed migration is recorded in the ledger", "unfinished row with error logs");
      failureControl.ledgerRecorded = true;
    }

    const status = runPrisma(
      scratchRoot,
      ["migrate", "status", "--schema", join(scratchPrisma, "schema.prisma")],
      controlEnv,
      candidateDir,
    );
    const statusPlain = sanitise(status.output);
    if (status.status === 0) {
      fail("`migrate status` exits non-zero after a failed migration");
    } else if (/failed/i.test(statusPlain)) {
      pass("`migrate status` reports the failure", `exit ${status.status}`);
      failureControl.statusExited = true;
    } else {
      fail("`migrate status` reports the failure", `exit ${status.status} but the output never says "failed"`);
    }

    if (
      failureControl.detected &&
      failureControl.ledgerRecorded &&
      failureControl.statusExited
    ) {
      pass("the failure control is complete", "non-zero deploy, recorded failure, non-zero status");
    }
    rmSync(scratchRoot, { recursive: true, force: true });
  } catch (error) {
    fail("the failure control can run", error.message);
  }

  // ── 8. The candidate still builds and tests ─────────────────────────────
  section("8. The candidate generates a client, typechecks and tests");
  try {
    const generate = runPrisma(candidateDir, ["generate"], env);
    if (generate.status !== 0) {
      fail("`prisma generate` succeeds", `exit ${generate.status}: ${sanitise(generate.output).trim().slice(-600)}`);
    } else if (!existsSync(join(candidateDir, "node_modules", ".prisma", "client", "index.js"))) {
      fail("the generated client exists", "node_modules/.prisma/client/index.js is missing after generate");
    } else {
      pass("`prisma generate` succeeds and writes the client");
    }
  } catch (error) {
    fail("`prisma generate` can run", error.message);
  }

  for (const [label, script] of [
    ["typecheck", "typecheck"],
    ["tests", "test"],
  ]) {
    try {
      const result = run("npm", ["run", script], { cwd: candidateDir, env, timeout: 900000 });
      const plain = sanitise(result.output);
      const tail = plain.trim().split("\n").slice(-25).join("\n");
      console.log(tail);
      if (result.status === 0) {
        if (script === "test") {
          const summary = plain.match(/^\s*Tests\s+(.+)$/m)?.[1]?.trim() ?? "(no summary line)";
          const failed = /(\d+)\s+failed/.exec(summary);
          const passed = /(\d+)\s+passed/.exec(summary);
          if (failed) fail("the candidate test suite passes", `${label}: ${summary}`);
          else if (!passed) fail("the candidate test suite ran", `no parsable test summary: ${summary}`);
          else pass("the candidate test suite passes", summary);
        } else {
          pass(`the candidate ${label} passes`, "exit 0");
        }
      } else {
        fail(`the candidate ${label} passes`, `exit ${result.status}`);
      }
    } catch (error) {
      fail(`the candidate ${label} can run`, error.message);
    }
  }

  // ── 9. The rehearsal was read-only ──────────────────────────────────────
  section("9. The rehearsal did not modify the candidate tree");
  try {
    const after = migrationManifest(candidateMigrationsDir);
    if (after.hash === candidateManifest.hash) pass("the candidate migrations are byte-identical after the rehearsal", after.hash);
    else fail("the candidate migrations are byte-identical after the rehearsal", `${candidateManifest.hash} -> ${after.hash}`);
    const dirty = run("git", ["-C", candidateDir, "status", "--porcelain=v1", "--", "prisma"]);
    if (dirty.status === 0 && dirty.output.trim() === "") pass("git reports no modification under prisma/");
    else note(`git reports changes under prisma/: ${dirty.output.trim().split("\n").slice(0, 5).join(" | ")}`);
  } catch (error) {
    note(`the read-only check could not complete: ${error.message}`);
  }

  const failedCount = state.checks.filter((check) => check.status === "FAIL").length;
  const blockedCount = state.checks.filter((check) => check.status === "BLOCKED").length;
  const verdict = failedCount > 0 ? "FAIL" : blockedCount > 0 ? "BLOCKED" : "PASS";
  section("Result");
  console.log(`${state.checks.filter((check) => check.status === "PASS").length} PASS, ${failedCount} FAIL, ${blockedCount} BLOCKED`);
  if (driftReport) console.log("FINDING: the candidate datamodel does not match its own migration history (see section 6)");
  console.log(`RESULT: ${verdict}`);
  writeSummary(args.summaryFile, verdict, { candidateCommit, candidateSubject, serverVersion, prismaVersion, candidateManifest, baselineManifest, extras, driftReport, failureControl });
  return verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;
}

function writeSummary(file, verdict, details = {}) {
  if (!file) return;
  const lines = [
    `## Candidate migration rehearsal — ${verdict}`,
    "",
    `- postgres: \`${details.serverVersion ?? "unknown"}\``,
    `- candidate commit: \`${details.candidateCommit || "unknown"}\` ${details.candidateSubject ? `— ${details.candidateSubject}` : ""}`,
    `- prisma CLI: \`${details.prismaVersion ?? "unknown"}\``,
    `- baseline manifest: \`${details.baselineManifest?.hash ?? "unknown"}\` (${details.baselineManifest?.names.length ?? "?"} migrations)`,
    `- candidate manifest: \`${details.candidateManifest?.hash ?? "unknown"}\` (${details.candidateManifest?.names.length ?? "?"} migrations)`,
    `- added: ${details.extras?.map((name) => `\`${name}\``).join(", ") || "(none)"}`,
    "",
    "| check | status | detail |",
    "| --- | --- | --- |",
    ...state.checks.map((check) => `| ${check.name} | ${check.status} | ${(check.detail || "").replace(/\|/g, "\\|").slice(0, 300)} |`),
  ];
  if (details.driftReport) {
    lines.push("", "### Finding: datamodel drift", "", "```sql", details.driftReport.slice(0, 4000), "```");
  }
  if (state.notes.length) {
    lines.push("", "### Notes", "", ...state.notes.map((text) => `- ${text}`));
  }
  lines.push("", `**${verdict}** — a disabled or unreachable target is BLOCKED, never PASS.`);
  try {
    writeFileSync(file, `${lines.join("\n")}\n`);
  } catch (error) {
    console.error(`could not write ${file}: ${error.message}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith("rehearse-candidate-migrations.mjs")) {
  // An uncaught exception is a rehearsal that could not finish, which is
  // BLOCKED — not a verdict about the candidate, and never a pass. It is
  // reported explicitly because a bare stack trace on exit code 1 is
  // indistinguishable from "a check failed".
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`BLOCKED: the rehearsal could not finish — ${error?.stack ?? error}`);
    console.log("::error::BLOCKED: the rehearsal could not finish; treat the candidate as NOT TESTED");
    console.log("RESULT: BLOCKED");
    process.exitCode = 2;
  }
}

export { ledger, parseArgs, psqlUrl, snapshot, writeSummary };
