/** Isolated SQL migration rehearsal, with synthetic referral evidence only. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";
const schema = `report_version_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
describe.skipIf(!realPrismaConfigured)("referral report version migration on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentReferralAttribution" ("id" TEXT PRIMARY KEY, "referrerApplicationId" TEXT NOT NULL, "source" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL)');
    await pool.query(readFileSync("prisma/migrations/20261115000000_agent_referral_report_snapshot/migration.sql", "utf8"));
    await pool.query(`INSERT INTO "AgentApplication" VALUES ('agent'); INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-01', 'DAILY', '2025-12-31 21:00:00', '2026-01-01 21:00:00', 3, 0)`);
    await pool.query(readFileSync("prisma/migrations/20261117000000_agent_referral_report_versions/migration.sql", "utf8"));
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });
  it("does not invent a baseline for pre-migration count-only reports", async () => {
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportRevision"')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT "registrationCount" FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-01"])).rows[0].registrationCount).toBe("3");
  });
  it("captures baseline members atomically and rejects mismatched totals", async () => {
    await pool.query(`INSERT INTO "AgentReferralAttribution" VALUES ('e1', 'agent', 'REGISTRATION', '2026-01-02 12:00:00')`);
    await pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-02', 'DAILY', '2026-01-01 21:00:00', '2026-01-02 21:00:00', 1, 0)`);
    expect((await pool.query('SELECT "eventId", "source" FROM "AgentReferralReportMember" WHERE "periodKey"=$1', ["daily:2026-01-02"])).rows).toEqual([{ eventId: "e1", source: "REGISTRATION" }]);
    await expect(pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-03', 'DAILY', '2026-01-02 21:00:00', '2026-01-03 21:00:00', 1, 0)`)).rejects.toThrow(/baseline membership mismatch/);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-03"])).rows[0].n).toBe(0);
    await expect(pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-04', 'DAILY', '2026-01-03 21:00:00', '2026-01-04 21:00:00', 5001, 0)`)).rejects.toThrow(/exceeds membership limit/);
  });
});
