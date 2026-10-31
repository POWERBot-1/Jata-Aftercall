/** Isolated SQL migration rehearsal, with synthetic referral evidence only. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";
import { inspectReferralEvidenceDrift } from "@/lib/agents/referral-report-drift";
const schema = `report_version_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
describe.skipIf(!realPrismaConfigured)("referral report version migration on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY, "agentStatus" TEXT NOT NULL DEFAULT \'INACTIVE\'); CREATE TABLE "AgentReferralAttribution" ("id" TEXT PRIMARY KEY, "referrerApplicationId" TEXT NOT NULL, "source" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL)');
    await pool.query(readFileSync("prisma/migrations/20261115000000_agent_referral_report_snapshot/migration.sql", "utf8"));
    await pool.query(`INSERT INTO "AgentApplication" ("id", "agentStatus") VALUES ('agent', 'ACTIVE'), ('suspended-agent', 'SUSPENDED'); INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-01', 'DAILY', '2025-12-31 21:00:00', '2026-01-01 21:00:00', 3, 0)`);
    await pool.query(readFileSync("prisma/migrations/20261117000000_agent_referral_report_versions/migration.sql", "utf8"));
    // Existing member-bearing revisions are frozen, without new members or reconstructed history.
    await pool.query(`INSERT INTO "AgentReferralAttribution" VALUES ('old-evidence', 'agent', 'REGISTRATION', '2026-01-01 12:00:00'); INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-05', 'DAILY', '2025-12-31 21:00:00', '2026-01-01 21:00:00', 1, 0)`);
    const migration = readFileSync("prisma/migrations/20261119000000_agent_referral_evidence_immutability/migration.sql", "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query(migration); await client.query("ROLLBACK");
      expect((await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'AgentReferralReportSnapshot_immutable' AND tgrelid = '"AgentReferralReportSnapshot"'::regclass`)).rows[0].n).toBe(0);
      await client.query("BEGIN"); await client.query(migration); await client.query("COMMIT");
      await client.query(readFileSync("prisma/migrations/20261120000000_agent_referral_revision_write_fence/migration.sql", "utf8"));
    } finally { client.release(); }
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });
  it("does not invent a baseline for pre-migration count-only reports", async () => {
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportRevision" WHERE "periodKey"=$1', ['daily:2026-01-01'])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT "agentStatus" FROM "AgentApplication" ORDER BY "id"')).rows).toEqual([{ agentStatus: "ACTIVE" }, { agentStatus: "SUSPENDED" }]);
    expect((await pool.query('SELECT "registrationCount" FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-01"])).rows[0].registrationCount).toBe("3");
  });
  it("seals pre-existing and newly committed membership without backfilling", async () => {
    const insert = `INSERT INTO "AgentReferralReportMember" ("applicationId", "periodKey", "revision", "eventId", "source", "eventCreatedAt") VALUES ('agent', $1, 1, 'added-later', 'REGISTRATION', now())`;
    await expect(pool.query(insert, ['daily:2026-01-05'])).rejects.toThrow(/membership is sealed/);
    expect((await pool.query(`SELECT "eventId" FROM "AgentReferralReportMember" WHERE "periodKey" = 'daily:2026-01-05'`)).rows).toEqual([{ eventId: 'old-evidence' }]);
    await expect(pool.query(`INSERT INTO "AgentReferralReportRevisionWriteFence" VALUES ('agent', 'daily:2026-01-05', 1, pg_current_xact_id()::text)`)).rejects.toThrow(/cannot be inserted directly/);
  });
  it("captures baseline members atomically and rejects mismatched totals", async () => {
    await pool.query(`INSERT INTO "AgentReferralAttribution" VALUES ('e1', 'agent', 'REGISTRATION', '2026-01-02 12:00:00')`);
    await pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-02', 'DAILY', '2026-01-01 21:00:00', '2026-01-02 21:00:00', 1, 0)`);
    expect((await pool.query('SELECT "eventId", "source" FROM "AgentReferralReportMember" WHERE "periodKey"=$1', ["daily:2026-01-02"])).rows).toEqual([{ eventId: "e1", source: "REGISTRATION" }]);
    await expect(pool.query(`INSERT INTO "AgentReferralReportMember" VALUES ('agent', 'daily:2026-01-02', 1, 'late', 'REGISTRATION', now())`)).rejects.toThrow(/membership is sealed/);
    await expect(pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-03', 'DAILY', '2026-01-02 21:00:00', '2026-01-03 21:00:00', 1, 0)`)).rejects.toThrow(/baseline membership mismatch/);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentReferralReportSnapshot" WHERE "periodKey"=$1', ["daily:2026-01-03"])).rows[0].n).toBe(0);
    await expect(pool.query(`INSERT INTO "AgentReferralReportSnapshot" ("applicationId", "periodKey", "periodType", "startInclusive", "endExclusive", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-04', 'DAILY', '2026-01-03 21:00:00', '2026-01-04 21:00:00', 5001, 0)`)).rejects.toThrow(/exceeds membership limit/);
  });
  it("detects late, changed and removed evidence without changing the recorded report", async () => {
    const db = { async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const text = strings.reduce((sql, part, i) => sql + part + (i < values.length ? `$${i + 1}` : ""), "");
      return (await pool.query(text, values)).rows;
    } } as never;
    const inspect = () => inspectReferralEvidenceDrift(db, "agent", "daily:2026-01-02", 1);
    expect(await inspect()).toBe("MATCHED");
    expect(await inspectReferralEvidenceDrift(db, "agent", "daily:2026-01-01", 1)).toBe("LEGACY_UNVERIFIABLE");
    expect(await inspectReferralEvidenceDrift(db, "suspended-agent", "daily:2026-01-02", 1)).toBe("REPORT_NOT_FOUND");
    await pool.query(`INSERT INTO "AgentReferralAttribution" VALUES ('late-1', 'agent', 'REGISTRATION', '2026-01-02 13:00:00')`);
    expect(await inspect()).toBe("RECONCILIATION_REQUIRED");
    await pool.query(`DELETE FROM "AgentReferralAttribution" WHERE "id" = 'late-1'`);
    await pool.query(`UPDATE "AgentReferralAttribution" SET "source" = 'EXISTING_ACCOUNT' WHERE "id" = 'e1'`);
    expect(await inspect()).toBe("RECONCILIATION_REQUIRED");
    await pool.query(`DELETE FROM "AgentReferralAttribution" WHERE "id" = 'e1'`);
    expect(await inspect()).toBe("RECONCILIATION_REQUIRED");
    await pool.query(`INSERT INTO "AgentReferralAttribution" VALUES ('e1', 'agent', 'REGISTRATION', '2026-01-02 12:00:00')`);
    expect(await inspect()).toBe("MATCHED");
    expect((await pool.query(`SELECT "eventId" FROM "AgentReferralReportMember" WHERE "periodKey" = 'daily:2026-01-02' AND "revision" = 1`)).rows).toEqual([{ eventId: "e1" }]);
  });
  it("allows membership only inside the revision creation transaction, including savepoints", async () => {
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(`INSERT INTO "User" VALUES ('savepoint-actor')`);
      await writer.query(`INSERT INTO "AgentReferralReportRevision" ("applicationId", "periodKey", "revision", "kind", "actorId", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-05', 2, 'RECONCILED', 'savepoint-actor', 1, 0)`);
      await writer.query('SAVEPOINT nested');
      await writer.query(`INSERT INTO "AgentReferralReportMember" VALUES ('agent', 'daily:2026-01-05', 2, 'new-evidence', 'REGISTRATION', now())`);
      await writer.query('RELEASE SAVEPOINT nested');
      await writer.query('COMMIT');
    } finally { writer.release(); }
    await expect(pool.query(`INSERT INTO "AgentReferralReportMember" VALUES ('agent', 'daily:2026-01-05', 2, 'after-commit', 'REGISTRATION', now())`)).rejects.toThrow(/membership is sealed/);
    await expect(pool.query(`UPDATE "AgentReferralReportRevisionWriteFence" SET "transactionId" = pg_current_xact_id()::text WHERE "periodKey" = 'daily:2026-01-05' AND "revision" = 2`)).rejects.toThrow(/evidence is immutable/);
  });
  it("refuses a competing transaction trying to append to an uncommitted revision", async () => {
    const writer = await pool.connect(); const competitor = await pool.connect();
    try {
      await writer.query('BEGIN'); await writer.query(`INSERT INTO "User" VALUES ('concurrent-actor')`);
      await writer.query(`INSERT INTO "AgentReferralReportRevision" ("applicationId", "periodKey", "revision", "kind", "actorId", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-05', 3, 'RECONCILED', 'concurrent-actor', 1, 0)`);
      await writer.query(`INSERT INTO "AgentReferralReportMember" VALUES ('agent', 'daily:2026-01-05', 3, 'owned', 'REGISTRATION', now())`);
      const competingInsert = competitor.query(`INSERT INTO "AgentReferralReportMember" VALUES ('agent', 'daily:2026-01-05', 3, 'foreign', 'REGISTRATION', now())`);
      // Attach a handler immediately in case PostgreSQL rejects the invisible parent before commit.
      const outcome = competingInsert.then(() => 'unexpected success', (error: Error) => error.message);
      await writer.query('COMMIT');
      expect(await outcome).toMatch(/unavailable|sealed/);
      expect((await pool.query(`SELECT "eventId" FROM "AgentReferralReportMember" WHERE "periodKey" = 'daily:2026-01-05' AND "revision" = 3`)).rows).toEqual([{ eventId: 'owned' }]);
    } finally { writer.release(); competitor.release(); }
  });
  it("prevents ordinary revision, member and snapshot edits while allowing append-only revisions", async () => {
    const mutations = [
      `UPDATE "AgentReferralReportSnapshot" SET "registrationCount" = 999 WHERE "periodKey" = 'daily:2026-01-02'`,
      `DELETE FROM "AgentReferralReportSnapshot" WHERE "periodKey" = 'daily:2026-01-01'`,
      `UPDATE "AgentReferralReportRevision" SET "registrationCount" = 999 WHERE "periodKey" = 'daily:2026-01-02'`,
      `DELETE FROM "AgentReferralReportRevision" WHERE "periodKey" = 'daily:2026-01-02'`,
      `UPDATE "AgentReferralReportMember" SET "source" = 'EXISTING_ACCOUNT' WHERE "periodKey" = 'daily:2026-01-02'`,
      `DELETE FROM "AgentReferralReportMember" WHERE "periodKey" = 'daily:2026-01-02'`,
    ];
    for (const sql of mutations) await expect(pool.query(sql)).rejects.toThrow(/Referral report evidence is immutable/);
    await pool.query(`INSERT INTO "User" VALUES ('actor'); INSERT INTO "AgentReferralReportRevision" ("applicationId", "periodKey", "revision", "kind", "actorId", "registrationCount", "existingApplicationCount") VALUES ('agent', 'daily:2026-01-02', 2, 'RECONCILED', 'actor', 1, 0); INSERT INTO "AgentReferralReportMember" ("applicationId", "periodKey", "revision", "eventId", "source", "eventCreatedAt") VALUES ('agent', 'daily:2026-01-02', 2, 'e1', 'REGISTRATION', '2026-01-02 12:00:00')`);
    expect((await pool.query(`SELECT "revision" FROM "AgentReferralReportRevision" WHERE "periodKey" = 'daily:2026-01-02' ORDER BY "revision"`)).rows).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect((await pool.query(`SELECT "registrationCount" FROM "AgentReferralReportSnapshot" WHERE "periodKey" = 'daily:2026-01-01'`)).rows[0].registrationCount).toBe('3');
  });
});
