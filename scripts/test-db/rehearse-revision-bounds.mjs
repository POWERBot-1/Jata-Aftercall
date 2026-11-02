#!/usr/bin/env node
/**
 * Migration rehearsal for prisma/migrations/20261127000000_agent_referral_report_bounded_pages
 * on a DISPOSABLE loopback PostgreSQL (embedded, started and removed by this script). It never reads
 * DATABASE_URL or DIRECT_URL and never connects to production. Fixtures are synthetic.
 *
 * Proves, at SQL level:
 *   R1  forward migration applies cleanly on the committed history; cap is 50,000 in the function
 *   R2  rollback REFUSES while any revision holds more than 5,000 members, and leaves the database unchanged
 *   R3  compatibility: existing rows (5,000-member revision, small revisions) are byte-identical after forward
 *       and after rollback; rollback succeeds when no revision exceeds 5,000 members
 *   R4  after rollback the 5,001 baseline is refused again; forward again restores 50,000
 *   R5  immutability triggers still block UPDATE and DELETE of revision evidence after the migration
 *   R6  the exact cap boundary: 50,000 passes the limit check (then refused for mismatch), 50,001 refused by the limit
 *
 * Output: JSON report at the path in REPORT (default docs/agents/evidence/migration-20261127/rehearsal-report.json).
 *   node scripts/test-db/rehearse-revision-bounds.mjs
 */
import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
process.chdir(root);
const require = createRequire(join(root, "package.json"));
const HOST = "127.0.0.1";
const PORT = Number(process.env.JATA_DB_REHEARSAL_PORT || 55434);
const ADMIN = "jata_rehearsal_admin";
const FORWARD_DIR = "20261127000000_agent_referral_report_bounded_pages";
const ROLLBACK_SQL = join(root, "docs/agents/migrations/20261127000000-bounded-pages-rollback.sql");
const REPORT = resolve(root, process.env.REPORT || "docs/agents/evidence/migration-20261127/rehearsal-report.json");

const prep = spawnSync("bash", [join(root, "scripts/test-db/prepare-wasm-harness.sh")], { stdio: "inherit" });
if (prep.status !== 0) { console.error("harness preparation failed"); process.exit(1); }
const harness = join(root, "node_modules", ".jata-wasm-harness");
const harnessRequire = createRequire(join(harness, "package.json"));
const EmbeddedPostgres = (await import(pathToFileURL(harnessRequire.resolve("embedded-postgres")).href)).default;
const pg = require("pg");

const password = randomBytes(18).toString("hex");
const dataDir = mkdtempSync(join(tmpdir(), "jata-pg-rehearsal-"));
const pgServer = new EmbeddedPostgres({ databaseDir: join(dataDir, "data"), user: ADMIN, password, port: PORT, persistent: false, onLog: () => {}, onError: () => {} });

const results = [];
const record = (id, ok, detail = {}) => { results.push({ id, ok, ...detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${JSON.stringify(detail).slice(0, 300)}`); };
const migrationDirs = readdirSync(join(root, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const readMigration = (d) => readFileSync(join(root, "prisma/migrations", d, "migration.sql"), "utf8");
const mem = () => Math.round(process.memoryUsage().rss / 1048576);

async function connect(database) {
  const client = new pg.Client({ host: HOST, port: PORT, user: ADMIN, password, database });
  await client.connect();
  return client;
}
async function applyAll(client, dirs) { for (const d of dirs) await client.query(readMigration(d)); }
async function fnSource(client) {
  const r = await client.query(`SELECT pg_get_functiondef('"agent_referral_report_record_baseline"'::regproc) AS def`);
  return r.rows[0].def;
}
const capOf = (def) => (def.match(/> (\d+) THEN/) || [])[1] ? Number((def.match(/> (\d+) THEN/))[1]) : null;
// Create a synthetic active agent with `count` REGISTRATION attributions in one daily window, then the snapshot (baseline).
async function seedAgent(client, tag, count, { start = Date.UTC(2020, 0, 1, 21), periodKey = "daily:2020-01-01" } = {}) {
  const app = `app-${tag}`;
  await client.query(`INSERT INTO "User" (id,email,"passwordHash",role,"updatedAt") VALUES ($1,$2,'x','CUSTOMER',now())`, [`u-${tag}`, `${tag}@rehearsal.invalid`]);
  await client.query(`INSERT INTO "AgentApplication" (id,"userId",\"fullName\",\"phoneE164\",status,\"agentStatus\",\"privacyAcknowledgedAt\",\"updatedAt\") VALUES ($1,$2,'Synthetic','+254700000001','PENDING','ACTIVE',now(),now())`, [app, `u-${tag}`]);
  await client.query(`INSERT INTO "AgentReferralLink" (id,"referrerApplicationId","tokenHash","expiresAt") VALUES ($1,$2,$3,now() + interval '365 days')`, [`l-${tag}`, app, `h-${tag}`]);
  // Referred users and applications in set-based batches, then attributions.
  await client.query(`INSERT INTO "User" (id,email,"passwordHash",role,"updatedAt")
    SELECT 'ru-${tag}-' || g, 'r-${tag}-' || g || '@rehearsal.invalid', 'x', 'CUSTOMER', now() FROM generate_series(1, $1) g`, [count]);
  await client.query(`INSERT INTO "AgentApplication" (id,"userId",\"fullName\",\"phoneE164\",status,\"agentStatus\",\"privacyAcknowledgedAt\",\"updatedAt\")
    SELECT 'ra-${tag}-' || g, 'ru-${tag}-' || g, 'Synthetic', '+2548' || lpad(g::text, 8, '0'), 'PENDING', 'INACTIVE', now(), now() FROM generate_series(1, $1) g`, [count]);
  await client.query(`INSERT INTO "AgentReferralAttribution" (id,"referrerApplicationId","referredApplicationId","linkId","consentedAt",source,"createdAt")
    SELECT 'att-${tag}-' || g, $1, 'ra-${tag}-' || g, $2, to_timestamp($3 / 1000.0), 'REGISTRATION', to_timestamp(($3 + 60000 + g) / 1000.0) FROM generate_series(1, $4) g`, [app, `l-${tag}`, start, count]);
  const t0 = Date.now();
  const m0 = mem();
  await client.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId","periodKey","periodType","startInclusive","endExclusive","registrationCount","existingApplicationCount")
    VALUES ($1,$2,'DAILY',to_timestamp($3 / 1000.0),to_timestamp(($3 + 86400000) / 1000.0),$4,0)`, [app, periodKey, start, count]);
  return { app, periodKey, ms: Date.now() - t0, memMB: [m0, mem()] };
}
const counts = async (client, app, periodKey) => (await client.query(`SELECT (SELECT count(*) FROM "AgentReferralReportMember" WHERE "applicationId"=$1 AND "periodKey"=$2) AS members, (SELECT count(*) FROM "AgentReferralReportRevision" WHERE "applicationId"=$1 AND "periodKey"=$2) AS revisions`, [app, periodKey])).rows[0];
// Byte-level fingerprint of existing evidence, to prove that a migration neither rewrites nor drops rows.
async function fingerprint(client) {
  const h = createHash("sha256");
  for (const q of [
    `SELECT "applicationId","periodKey","revision","eventId","source","eventCreatedAt"::text FROM "AgentReferralReportMember" ORDER BY 1,2,3,4`,
    `SELECT "applicationId","periodKey","revision","kind","registrationCount"::text,"existingApplicationCount"::text,"addedCount","removedCount","changedCount","createdAt"::text FROM "AgentReferralReportRevision" ORDER BY 1,2,3`,
  ]) h.update(JSON.stringify((await client.query(q)).rows));
  return h.digest("hex");
}
async function tryRollback(client) {
  const sql = readFileSync(ROLLBACK_SQL, "utf8");
  try { await client.query(sql); return { ok: true }; }
  catch (e) { await client.query("ROLLBACK").catch(() => {}); return { ok: false, error: String(e.message).slice(0, 200) }; }
}

let exitCode = 1;
let serverVersion = "unknown";
try {
  await pgServer.initialise();
  await pgServer.start();

  // ---------- Database A: full forward history ----------
  await pgServer.createDatabase("jata_rehearsal_fwd_test");
  const a = await connect("jata_rehearsal_fwd_test");
  const t0 = Date.now();
  await applyAll(a, migrationDirs);
  const fwdDef = await fnSource(a);
  record("R1 forward migration applies on the committed history", capOf(fwdDef) === 50000, { migrations: migrationDirs.length, applyMs: Date.now() - t0, cap: capOf(fwdDef) });

  const x1 = await seedAgent(a, "x1", 5000);
  const x2 = await seedAgent(a, "x2", 5001);
  record("R6a the 5,000 and 5,001 baselines are accepted under the 50,000 cap", (await counts(a, x1.app, x1.periodKey)).members === "5000" && (await counts(a, x2.app, x2.periodKey)).members === "5001", { x1: await counts(a, x1.app, x1.periodKey), x2: await counts(a, x2.app, x2.periodKey) });

  const fpBefore = await fingerprint(a);
  const rb1 = await tryRollback(a);
  const defAfterRefused = await fnSource(a);
  record("R2 rollback is refused while a revision exceeds 5,000 members", rb1.ok === false && /more than 5,000/.test(rb1.error || "") && capOf(defAfterRefused) === 50000, { rollback: rb1, cap: capOf(defAfterRefused) });
  record("R2b refused rollback leaves every evidence row unchanged", (await fingerprint(a)) === fpBefore);

  // R5: immutability after the migration
  let updRefused = false, delRefused = false;
  try { await a.query(`UPDATE "AgentReferralReportMember" SET "source"='EXISTING_ACCOUNT' WHERE "applicationId"=$1`, [x1.app]); } catch (e) { updRefused = /immutable/.test(e.message); }
  try { await a.query(`DELETE FROM "AgentReferralReportRevision" WHERE "applicationId"=$1`, [x1.app]); } catch (e) { delRefused = /immutable/.test(e.message); }
  record("R5 evidence UPDATE and DELETE remain refused after the migration", updRefused && delRefused, { updRefused, delRefused });

  // R6b: boundary
  let limitAt50001 = false, mismatchAt50000 = false;
  try { await seedSnapshotOnly(a, "cap-over", 50001); } catch (e) { limitAt50001 = /membership limit/.test(e.message); }
  try { await seedSnapshotOnly(a, "cap-at", 50000); } catch (e) { mismatchAt50000 = /membership mismatch/.test(e.message); }
  record("R6b 50,001 is refused by the limit; 50,000 passes the limit and is refused only for membership mismatch", limitAt50001 && mismatchAt50000, { limitAt50001, mismatchAt50000 });
  await a.end();

  // ---------- Database B: compatibility with existing data, rollback success, forward again ----------
  await pgServer.createDatabase("jata_rehearsal_compat_test");
  const b = await connect("jata_rehearsal_compat_test");
  const pre = migrationDirs.filter((d) => d !== FORWARD_DIR);
  await applyAll(b, pre);
  const bSmall = await seedAgent(b, "b5000", 5000);
  const bSmall2 = await seedAgent(b, "bsmall", 3, { periodKey: "daily:2020-01-02", start: Date.UTC(2020, 0, 2, 21) });
  const beforeForward = await fingerprint(b);
  const beforeCap = capOf(await fnSource(b));
  await b.query(readMigration(FORWARD_DIR));
  const afterForwardCap = capOf(await fnSource(b));
  const afterForward = await fingerprint(b);
  record("R3a existing evidence is unchanged by the forward migration", beforeForward === afterForward && beforeCap === 5000 && afterForwardCap === 50000, { beforeCap, afterForwardCap });
  const rbOk = await tryRollback(b);
  const afterRollbackCap = capOf(await fnSource(b));
  record("R3b rollback succeeds when no revision exceeds 5,000 members, and restores the 5,000 cap", rbOk.ok && afterRollbackCap === 5000, { rollback: rbOk, cap: afterRollbackCap });
  record("R3c existing evidence is unchanged by the rollback", (await fingerprint(b)) === beforeForward);
  let refused5001 = false;
  try { await seedAgent(b, "b5001", 5001, { periodKey: "daily:2020-01-03", start: Date.UTC(2020, 0, 3, 21) }); } catch (e) { refused5001 = /membership limit/.test(e.message); }
  record("R4a after rollback, a 5,001 baseline is refused again", refused5001);
  await b.query(readMigration(FORWARD_DIR));
  record("R4b forward migration can be re-applied after rollback (idempotent function replace)", capOf(await fnSource(b)) === 50000 && (await fingerprint(b)) === beforeForward);
  serverVersion = (await b.query("SHOW server_version")).rows[0].server_version;
  await b.end();

  exitCode = results.every((r) => r.ok) ? 0 : 1;
  const report = {
    generatedAt: new Date().toISOString(),
    engine: "embedded-postgres from node_modules/.jata-wasm-harness, loopback, disposable, SQL-level",
    postgres: serverVersion,
    migrationsApplied: migrationDirs.length,
    results,
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    rollbackLimit: "Rollback is refused once any revision holds more than 5,000 members. Evidence rows cannot be deleted (immutability triggers), so after the first reconciled or baseline revision above 5,000 members the rollback can no longer be applied without owner-approved data handling.",
  };
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(`REHEARSAL: ${report.passed}/${report.total} passed; report ${REPORT}`);
} catch (err) {
  console.error("REHEARSAL aborted:", String(err?.message || err).slice(0, 400));
  exitCode = 1;
} finally {
  try { await pgServer.stop(); } catch { /* already stopped */ }
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(exitCode);

async function seedSnapshotOnly(client, tag, counts) {
  const suffix = tag;
  await client.query(`INSERT INTO "User" (id,email,"passwordHash",role,"updatedAt") VALUES ($1,$2,'x','CUSTOMER',now())`, [`u-${suffix}`, `${suffix}@rehearsal.invalid`]);
  await client.query(`INSERT INTO "AgentApplication" (id,"userId",\"fullName\",\"phoneE164\",status,\"agentStatus\",\"privacyAcknowledgedAt\",\"updatedAt\") VALUES ($1,$2,'Synthetic','+254700000009','PENDING','ACTIVE',now(),now())`, [`app-${suffix}`, `u-${suffix}`]);
  await client.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId","periodKey","periodType","startInclusive","endExclusive","registrationCount","existingApplicationCount")
    VALUES ($1,'daily:2021-01-01','DAILY',now(),now() + interval '1 day',$2,0)`, [`app-${suffix}`, counts]);
}
