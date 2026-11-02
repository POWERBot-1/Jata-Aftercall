#!/usr/bin/env node
/**
 * Runs the database-backed Autopilot suite against a DISPOSABLE PostgreSQL 18 that this script
 * starts on loopback, migrates with the committed migrations, and stops again.
 *
 *   node scripts/test-db/run-db-suite.mjs [vitest file paths...]
 *
 * Safety (fail closed):
 *   - Never reads DATABASE_URL / DIRECT_URL. Never connects anywhere except 127.0.0.1.
 *   - The database name must end in `_test`. The data directory lives under the OS temp dir and is
 *     deleted afterwards. The superuser password is random per run and is not written to disk or
 *     logged.
 *   - No production credentials, customer data or live payment/messaging services are touched.
 *   - Engine: the WASM driver-adapter client (see prepare-wasm-harness.sh). Reports say so.
 *
 * Migrations are applied as plain SQL in lexical order. `prisma migrate` needs the native
 * schema-engine binary, which cannot be downloaded in this sandbox; the SQL itself is the committed
 * migration history, unchanged.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(new URL("../..", import.meta.url).pathname);
process.chdir(root);
const require = createRequire(join(root, "package.json"));

const HOST = "127.0.0.1";
const PORT = Number(process.env.JATA_DB_TEST_PORT || 55433);
const DB_NAME = "jata_autopilot_db_test";
const ADMIN = "jata_test_admin";

if (HOST !== "127.0.0.1" || !DB_NAME.endsWith("_test")) {
  console.error("Refusing: the database target must be loopback and named *_test.");
  process.exit(2);
}

const prep = spawnSync("bash", [join(root, "scripts/test-db/prepare-wasm-harness.sh")], { stdio: "inherit" });
if (prep.status !== 0) {
  console.error("WASM harness preparation failed; no database was started.");
  process.exit(prep.status ?? 1);
}
const harness = join(root, "node_modules", ".jata-wasm-harness");

const EmbeddedPostgres = (await import("embedded-postgres")).default;
const pg = require("pg");

const password = randomBytes(18).toString("hex");
const dataDir = mkdtempSync(join(tmpdir(), "jata-pg-autopilot-"));
const pgServer = new EmbeddedPostgres({
  databaseDir: join(dataDir, "data"),
  user: ADMIN,
  password,
  port: PORT,
  persistent: false,
  onLog: () => {},
  onError: () => {},
});

let exitCode = 1;
const summary = { engine: "wasm-query-engine+adapter-pg", postgres: null, migrations: { applied: 0, total: 0 }, vitest: null };
try {
  await pgServer.initialise();
  await pgServer.start();
  await pgServer.createDatabase(DB_NAME);
  const admin = new pg.Client({ host: HOST, port: PORT, user: ADMIN, password, database: DB_NAME });
  await admin.connect();
  const v = await admin.query("select current_setting('server_version') v");
  summary.postgres = `PostgreSQL ${v.rows[0].v} (embedded-postgres, loopback ${HOST}:${PORT}, db ${DB_NAME})`;

  const migDir = join(root, "prisma", "migrations");
  const dirs = readdirSync(migDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  summary.migrations.total = dirs.length;
  for (const d of dirs) {
    const f = join(migDir, d, "migration.sql");
    if (!existsSync(f)) throw new Error(`migration ${d} has no migration.sql`);
    await admin.query(readFileSync(f, "utf8"));
    summary.migrations.applied += 1;
  }
  await admin.end();

  const url = `postgresql://${ADMIN}:${encodeURIComponent(password)}@${HOST}:${PORT}/${DB_NAME}`;
  const files = process.argv.slice(2);
  const args = ["vitest", "run", "--reporter=verbose", "--config", "vitest.db.config.ts", ...files];
  const env = {
    ...process.env,
    PRISMA_TEST_DATABASE_URL: url,
    PRISMA_WASM_HARNESS_DIR: harness,
    NODE_ENV: "test",
  };
  // Keep the app's own DATABASE_URL from leaking into the run.
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  const run = spawnSync("npx", args, { stdio: "inherit", env });
  summary.vitest = { exitCode: run.status };
  exitCode = run.status ?? 1;
} catch (err) {
  console.error("DB suite failed before/while running:", String(err?.message || err).slice(0, 400));
  exitCode = 1;
} finally {
  try {
    await pgServer.stop();
  } catch {
    /* already stopped */
  }
  rmSync(dataDir, { recursive: true, force: true });
  console.log("DB_SUITE_SUMMARY " + JSON.stringify(summary));
}
process.exit(exitCode);
