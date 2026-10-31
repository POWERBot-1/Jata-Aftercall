/** SQL primitives tested on an isolated local schema. No sender, provider or recipient is contacted. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";
import { claimAdminNotification, finishAdminNotificationClaim, markExpiredAdminNotificationClaimsUnknown } from "@/lib/agents/admin-notification-claims";

const schema = `claim_test_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
const previous = process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED;
// Exercise the exact tagged SQL against PostgreSQL; this adapter does not emulate SQL semantics.
const db = {
  async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.reduce((s, part, index) => s + part + (index < values.length ? `$${index + 1}` : ""), "");
    return (await pool.query(text, values)).rows;
  },
  async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.reduce((s, part, index) => s + part + (index < values.length ? `$${index + 1}` : ""), "");
    return (await pool.query(text, values)).rowCount;
  },
} as never;
const key = (digit: string) => digit.repeat(64);
describe.skipIf(!realPrismaConfigured)("notification claims on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "AgentAdminNotificationEvent" ("applicationId" TEXT PRIMARY KEY)');
    for (const name of ["20261112000000_agent_notification_outbox_plan", "20261113000000_agent_notification_claim_state"]) await pool.query(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));
    await pool.query(`INSERT INTO "AgentAdminNotificationEvent" VALUES ('app'); INSERT INTO "AgentAdminNotificationPlan" ("applicationId", "recipientKeyVersion") VALUES ('app', 'fixture');`);
    await pool.query('INSERT INTO "AgentAdminNotificationDelivery" ("applicationId", "recipientKey") VALUES ($1,$2),($1,$3)', ["app", key("a"), key("b")]);
    process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = "true";
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = previous;
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
  });
  it.skipIf(!process.env.PRISMA_WASM_HARNESS_DIR)("executes the claim and completion SQL through the Prisma WASM adapter", async () => {
    const require = createRequire(import.meta.url);
    const harness = process.env.PRISMA_WASM_HARNESS_DIR!;
    const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
    const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
    const { Pool: AdapterPool } = require(path.join(harness, "node_modules", "pg"));
    const prisma = new PrismaClient({ adapter: new PrismaPg(new AdapterPool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` })) });
    try {
      const claim = await claimAdminNotification(prisma);
      expect(claim).not.toBeNull();
      expect(await finishAdminNotificationClaim(prisma, claim!, "UNKNOWN")).toBe(true);
    } finally {
      await prisma.$disconnect();
      await pool.query('DELETE FROM "AgentAdminNotificationClaimState"');
    }
  });
  it("atomically limits concurrent claims and prevents stale token completion", async () => {
    const claims = (await Promise.all(Array.from({ length: 8 }, () => claimAdminNotification(db)))).filter((c) => c !== null);
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map((c) => c.recipientKey)).size).toBe(2);
    expect(await finishAdminNotificationClaim(db, { ...claims[0], claimToken: "stale" }, "ACCEPTED")).toBe(false);
    expect(await finishAdminNotificationClaim(db, claims[0], "ACCEPTED")).toBe(true);
    expect(await finishAdminNotificationClaim(db, claims[0], "UNKNOWN")).toBe(false);
    expect(await finishAdminNotificationClaim(db, claims[1], "UNKNOWN")).toBe(true);
    expect(await claimAdminNotification(db)).toBeNull();
    const states = (await pool.query('SELECT "state" FROM "AgentAdminNotificationClaimState" ORDER BY "state"')).rows.map((r) => r.state);
    expect(states).toEqual(["ACCEPTED", "UNKNOWN"]);
  });
  it("retries only explicit safe rejections, bounds attempts and dead-letters", async () => {
    await pool.query('DELETE FROM "AgentAdminNotificationClaimState"');
    const first = (await claimAdminNotification(db))!;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const current = attempt === 1 ? first : (await claimAdminNotification(db))!;
      expect(current.attempts).toBe(attempt);
      expect(await finishAdminNotificationClaim(db, current, "SAFE_TRANSIENT_REJECTION")).toBe(true);
      const row = (await pool.query('SELECT "state", "nextAttemptAt", "nextAttemptAt" > clock_timestamp() AS future FROM "AgentAdminNotificationClaimState" WHERE "recipientKey"=$1', [first.recipientKey])).rows[0];
      expect(row.state).toBe(attempt < 5 ? "RETRY" : "DEAD");
      if (attempt < 5) {
        expect(row.future).toBe(true);
        // Keep the second item in UNKNOWN so this test's forced due retry is deterministic.
        if (attempt === 1) { const other = (await claimAdminNotification(db))!; await finishAdminNotificationClaim(db, other, "UNKNOWN"); }
        await pool.query('UPDATE "AgentAdminNotificationClaimState" SET "nextAttemptAt"=clock_timestamp() - INTERVAL \'1 second\' WHERE "recipientKey"=$1', [first.recipientKey]);
      }
    }
    expect(await claimAdminNotification(db)).toBeNull();
  });
  it("moves expired leases to UNKNOWN, never automatic retry, and rejects stale completion", async () => {
    await pool.query('DELETE FROM "AgentAdminNotificationClaimState"');
    const claimed = (await claimAdminNotification(db))!;
    const other = (await claimAdminNotification(db))!;
    await finishAdminNotificationClaim(db, other, "SAFE_PERMANENT_REJECTION");
    await pool.query('UPDATE "AgentAdminNotificationClaimState" SET "leaseUntil"=clock_timestamp() - INTERVAL \'1 second\' WHERE "recipientKey"=$1', [claimed.recipientKey]);
    expect(await finishAdminNotificationClaim(db, claimed, "ACCEPTED")).toBe(false);
    expect(await markExpiredAdminNotificationClaimsUnknown(db)).toBe(1);
    expect(await claimAdminNotification(db)).toBeNull();
    expect((await pool.query('SELECT "state" FROM "AgentAdminNotificationClaimState" WHERE "recipientKey"=$1', [claimed.recipientKey])).rows[0].state).toBe("UNKNOWN");
  });
});
