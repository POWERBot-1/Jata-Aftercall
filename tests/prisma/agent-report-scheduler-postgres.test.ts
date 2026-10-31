/** Disposable schema; no provider, recipient, scheduler or production database is contacted. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";
import { processReferralReportBatch, reportScheduleStart } from "@/lib/agents/referral-report-scheduler";
import { recoverStaleReferralReportRuns, runReferralReportBatch } from "@/lib/agents/referral-report-scheduler-run";

const schema = `report_schedule_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
let prisma: any;
const start = reportScheduleStart("2026-01-01")!;
const now = new Date("2026-01-03T21:30:00.000Z"); // Nairobi Jan 4: three completed days.
describe.skipIf(!realPrismaConfigured)("durable report scheduler cursor on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY, "status" TEXT NOT NULL, "agentStatus" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT '2025-12-01'); CREATE TABLE "AgentReferralAttribution" ("id" TEXT PRIMARY KEY, "referrerApplicationId" TEXT NOT NULL, "source" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL)`);
    for (const name of ["20261115000000_agent_referral_report_snapshot", "20261116000000_agent_referral_report_schedule", "20261117000000_agent_referral_report_versions", "20261118000000_agent_referral_schedule_runs"]) await pool.query(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));
    await pool.query(`INSERT INTO "AgentApplication" ("id", "status", "agentStatus") SELECT 'agent-' || lpad(i::text, 3, '0'), 'PENDING', 'ACTIVE' FROM generate_series(1,25) i; INSERT INTO "AgentApplication" ("id", "status", "agentStatus") VALUES ('suspended', 'PENDING', 'SUSPENDED'); INSERT INTO "AgentApplication" VALUES ('future-agent', 'PENDING', 'ACTIVE', '2026-12-01');`);
    await pool.query('INSERT INTO "AgentReferralAttribution" VALUES ($1, $2, $3, $4)', ["event-1", "agent-001", "REGISTRATION", new Date("2026-01-01T12:00:00Z")]);
    const require = createRequire(import.meta.url); const harness = process.env.PRISMA_WASM_HARNESS_DIR;
    if (harness) {
      const { PrismaClient } = require(path.join(harness, "generated", "wasm.js")); const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg")); const { Pool: AdapterPool } = require(path.join(harness, "node_modules", "pg"));
      prisma = new PrismaClient({ adapter: new PrismaPg(new AdapterPool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` })) });
    } else {
      const { PrismaClient } = require("@prisma/client"); url.searchParams.set("schema", schema); prisma = new PrismaClient({ datasourceUrl: url.toString() });
    }
  });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });
  it("rehearses transactional upgrade rollback and reapply without losing an existing cursor", async () => {
    const scratch = `${schema}_upgrade`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${scratch}"`);
      await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query(readFileSync("prisma/migrations/20261116000000_agent_referral_report_schedule/migration.sql", "utf8"));
      await client.query(`INSERT INTO "AgentReferralReportSchedule" ("periodType", "configuredStart", "periodStart", "lastApplicationId") VALUES ('DAILY', '2026-01-01', '2026-01-03', 'agent-020')`);
      await client.query("COMMIT");
      await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query(readFileSync("prisma/migrations/20261118000000_agent_referral_schedule_runs/migration.sql", "utf8")); await client.query("ROLLBACK");
      expect((await client.query("SELECT to_regclass($1) AS table", [`${scratch}.\"AgentReferralReportScheduleRun\"`])).rows[0].table).toBeNull();
      expect((await client.query(`SELECT "lastApplicationId" FROM "${scratch}"."AgentReferralReportSchedule"`)).rows[0].lastApplicationId).toBe("agent-020");
      await client.query("BEGIN"); await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query(readFileSync("prisma/migrations/20261118000000_agent_referral_schedule_runs/migration.sql", "utf8")); await client.query("COMMIT");
      expect((await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`${scratch}.\"AgentReferralReportScheduleRun\"`])).rows[0].present).toBe(true);
      expect((await client.query(`SELECT "lastApplicationId" FROM "${scratch}"."AgentReferralReportSchedule"`)).rows[0].lastApplicationId).toBe("agent-020");
    } finally { await client.query("ROLLBACK"); await client.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`); client.release(); }
  });
  it("serializes workers, resumes missed days in bounded pages, and rolls back failures", async () => {
    const run = () => prisma.$transaction((tx: typeof prisma) => processReferralReportBatch(tx, "DAILY", start, now), { timeout: 20000 });
    const result = await Promise.all([run(), run()]);
    expect(result.map((x: { status: string }) => x.status).sort()).toEqual(["BATCH", "PERIOD_COMPLETE"]);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-01"])).rows[0].n).toBe(25);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportRevision" WHERE "periodKey"=$1 AND "kind"=$2', ["daily:2026-01-01", "BASELINE"])).rows[0].n).toBe(25);
    expect((await pool.query('SELECT "registrationCount" FROM "AgentReferralReportSnapshot" WHERE "applicationId"=$1 AND "periodKey"=$2', ["agent-001", "daily:2026-01-01"])).rows[0].registrationCount).toBe("1");
    await expect(prisma.$transaction(async (tx: typeof prisma) => { await processReferralReportBatch(tx, "DAILY", start, now); throw new Error("synthetic rollback"); })).rejects.toThrow("synthetic rollback");
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-02"])).rows[0].n).toBe(0);
    for (let i = 0; i < 4; i++) await run();
    expect((await run()).status).toBe("CAUGHT_UP");
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot"')).rows[0].n).toBe(75);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "applicationId" IN ($1,$2)', ["suspended", "future-agent"])).rows[0].n).toBe(0);
    await expect(prisma.$transaction((tx: typeof prisma) => processReferralReportBatch(tx, "DAILY", reportScheduleStart("2026-02-01")!, new Date("2026-04-01")))).rejects.toThrow("SCHEDULE_START_CHANGED");
  });
  it("records committed success and failed retries without claiming failed work completed", async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot"')).rows[0].n;
    const ok = await runReferralReportBatch(prisma, "DAILY", start, now);
    expect(ok.status).toBe("CAUGHT_UP");
    const successful = (await pool.query('SELECT "status", "periodType", "periodKey", "result", "processed", "finishedAt" FROM "AgentReferralReportScheduleRun" WHERE "status"=$1', ["SUCCEEDED"])).rows;
    expect(successful).toHaveLength(1); expect(successful[0]).toMatchObject({ status: "SUCCEEDED", periodType: "DAILY", result: "CAUGHT_UP", processed: 0 }); expect(successful[0].finishedAt).not.toBeNull();
    await expect(runReferralReportBatch(prisma, "DAILY", reportScheduleStart("2026-02-01")!, new Date("2026-04-01"))).rejects.toThrow("SCHEDULE_START_CHANGED");
    const failed = (await pool.query('SELECT "status", "failureCode", "finishedAt" FROM "AgentReferralReportScheduleRun" WHERE "status"=$1', ["FAILED"])).rows;
    expect(failed).toHaveLength(1); expect(failed[0].failureCode).toBe("SCHEDULE_START_CHANGED"); expect(failed[0].finishedAt).not.toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot"')).rows[0].n).toBe(before);
    await expect(pool.query(`INSERT INTO "AgentReferralReportScheduleRun" ("id", "periodType", "status", "finishedAt") VALUES ('bad', 'DAILY', 'SUCCEEDED', now())`)).rejects.toMatchObject({ code: "23514" });
  });
  it("records a failed batch, rolls back partial work, then safely resumes", async () => {
    await pool.query(`CREATE FUNCTION fail_synthetic_report() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fail_synthetic_report BEFORE INSERT ON "AgentReferralReportSnapshot" FOR EACH ROW WHEN (NEW."periodKey" = 'daily:2026-01-04') EXECUTE FUNCTION fail_synthetic_report()`);
    const later = new Date("2026-01-04T21:30:00Z");
    try { await expect(runReferralReportBatch(prisma, "DAILY", start, later)).rejects.toThrow(); }
    finally { await pool.query('DROP TRIGGER fail_synthetic_report ON "AgentReferralReportSnapshot"; DROP FUNCTION fail_synthetic_report()'); }
    const failed = (await pool.query('SELECT "status", "failureCode" FROM "AgentReferralReportScheduleRun" WHERE "failureCode"=$1', ["BATCH_FAILED"])).rows;
    expect(failed).toEqual([{ status: "FAILED", failureCode: "BATCH_FAILED" }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-04"])).rows[0].n).toBe(0);
    expect((await runReferralReportBatch(prisma, "DAILY", start, later)).status).toBe("BATCH");
    expect((await runReferralReportBatch(prisma, "DAILY", start, later)).status).toBe("PERIOD_COMPLETE");
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-04"])).rows[0].n).toBe(25);
  });
  it("times out a blocked cursor and records failure without advancing it", async () => {
    const lock = await pool.connect();
    const before = (await pool.query('SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType"=$1', ["DAILY"])).rows[0];
    try {
      await lock.query("BEGIN");
      await lock.query('SELECT "periodType" FROM "AgentReferralReportSchedule" WHERE "periodType"=$1 FOR UPDATE', ["DAILY"]);
      await expect(runReferralReportBatch(prisma, "DAILY", start, new Date("2026-01-05T21:30:00Z"))).rejects.toThrow();
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    const after = (await pool.query('SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType"=$1', ["DAILY"])).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportScheduleRun" WHERE "status"=$1 AND "failureCode"=$2', ["FAILED", "BATCH_FAILED"])).rows[0].n).toBeGreaterThanOrEqual(1);
  }, 30000);
  it("recovers abandoned runs in bounded pages while skipping active row locks", async () => {
    await pool.query(`INSERT INTO "AgentReferralReportScheduleRun" ("id", "periodType", "status", "startedAt") SELECT 'stale-' || i, 'DAILY', 'RUNNING', clock_timestamp() - interval '3 minutes' FROM generate_series(1, 52) i`);
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query(`SELECT "id" FROM "AgentReferralReportScheduleRun" WHERE "id" = 'stale-1' FOR UPDATE`);
      const counts = await Promise.all([recoverStaleReferralReportRuns(prisma), recoverStaleReferralReportRuns(prisma)]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(51);
      expect((await pool.query(`SELECT "status" FROM "AgentReferralReportScheduleRun" WHERE "id" = 'stale-1'`)).rows[0].status).toBe("RUNNING");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
    expect(await recoverStaleReferralReportRuns(prisma)).toBe(1);
    expect(await recoverStaleReferralReportRuns(prisma)).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "AgentReferralReportScheduleRun" WHERE "id" LIKE 'stale-%' AND "status" = 'FAILED' AND "failureCode" = 'BATCH_FAILED'`)).rows[0].n).toBe(52);
    expect((await runReferralReportBatch(prisma, "DAILY", start, new Date("2026-01-05T21:30:00Z"))).status).toBe("BATCH");
  });
  it("recovers a run after its database worker connection is terminated and rolls back the cursor", async () => {
    const before = (await pool.query(`SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType" = 'DAILY'`)).rows[0];
    await pool.query(`INSERT INTO "AgentReferralReportScheduleRun" ("id", "periodType", "status", "startedAt") VALUES ('crashed-worker', 'DAILY', 'RUNNING', clock_timestamp() - interval '3 minutes')`);
    const worker = await pool.connect();
    try {
      const pid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await worker.query('BEGIN');
      await worker.query(`SELECT "id" FROM "AgentReferralReportScheduleRun" WHERE "id" = 'crashed-worker' FOR UPDATE`);
      await worker.query(`UPDATE "AgentReferralReportSchedule" SET "lastApplicationId" = 'uncommitted-marker' WHERE "periodType" = 'DAILY'`);
      const terminated = new Promise<Error>((resolve) => worker.once('error', resolve));
      expect((await pool.query('SELECT pg_terminate_backend($1) AS stopped', [pid])).rows[0].stopped).toBe(true);
      expect(await terminated).toMatchObject({ code: '57P01' });
    } finally { worker.release(true); }
    expect(await recoverStaleReferralReportRuns(prisma)).toBe(1);
    expect((await pool.query(`SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType" = 'DAILY'`)).rows[0]).toEqual(before);
    expect((await pool.query(`SELECT "status", "failureCode" FROM "AgentReferralReportScheduleRun" WHERE "id" = 'crashed-worker'`)).rows[0]).toEqual({ status: 'FAILED', failureCode: 'BATCH_FAILED' });
  });
  it("fences a delayed worker if recovery wins before its transaction starts", async () => {
    const before = (await pool.query(`SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType" = 'DAILY'`)).rows[0];
    const delayed = {
      $executeRaw: prisma.$executeRaw.bind(prisma),
      $transaction: async (fn: unknown, options: unknown) => {
        await pool.query(`UPDATE "AgentReferralReportScheduleRun" SET "startedAt" = clock_timestamp() - interval '3 minutes' WHERE "status" = 'RUNNING'`);
        expect(await recoverStaleReferralReportRuns(prisma)).toBe(1);
        return prisma.$transaction(fn, options);
      },
    };
    await expect(runReferralReportBatch(delayed as typeof prisma, "DAILY", start, new Date("2026-01-06T21:30:00Z"))).rejects.toThrow("SCHEDULE_RUN_CHANGED");
    expect((await pool.query(`SELECT "periodStart", "lastApplicationId" FROM "AgentReferralReportSchedule" WHERE "periodType" = 'DAILY'`)).rows[0]).toEqual(before);
  });
  it("catches up complete Nairobi months without duplicating daily snapshots", async () => {
    const later = new Date("2026-03-01T22:00:00Z");
    const run = () => prisma.$transaction((tx: typeof prisma) => processReferralReportBatch(tx, "MONTHLY", start, later));
    for (let i = 0; i < 4; i++) await run();
    expect((await run()).status).toBe("CAUGHT_UP");
    const rows = (await pool.query('SELECT "periodKey", count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodType"=$1 GROUP BY "periodKey" ORDER BY "periodKey"', ["MONTHLY"])).rows;
    expect(rows).toEqual([{ periodKey: "monthly:2026-01", n: 25 }, { periodKey: "monthly:2026-02", n: 25 }]);
  });
});
