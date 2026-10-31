/** Isolated synthetic schema only: no real payments, provider calls or approved policy. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const schema = `ledger_test_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
const insert = `INSERT INTO "AgentCommissionLedgerEntry" ("id", "paymentId", "agentApplicationId", "entryType", "currency", "amountMinor", "sourceEventId", "originalEntryId", "policyVersion", "policySnapshot") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`;
const entry = (id: string, kind: string, amount: string, original: string | null, extra: Partial<{ payment: string; agent: string; source: string; currency: string; version: string; snapshot: string }> = {}) => [id, extra.payment || "payment-1", extra.agent || "agent-1", kind, extra.currency || "KES", amount, extra.source || `event-${id}`, original, extra.version || "fixture-v1", extra.snapshot || '{"testOnly":true}'];

describe.skipIf(!realPrismaConfigured)("commission ledger constraints on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "Payment" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY);');
    await pool.query(readFileSync("prisma/migrations/20261111000000_agent_commission_ledger/migration.sql", "utf8"));
    await pool.query(`INSERT INTO "Payment" VALUES ('payment-1'), ('payment-2'), ('payment-3'), ('payment-4'); INSERT INTO "AgentApplication" VALUES ('agent-1'), ('agent-2');`);
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });

  it("rolls back a failed migration transaction and reapplies in a disposable schema", async () => {
    const scratch = `${schema}_ddl`;
    const client = await pool.connect();
    const migration = readFileSync("prisma/migrations/20261111000000_agent_commission_ledger/migration.sql", "utf8");
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${scratch}"`);
      await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query('CREATE TABLE "Payment" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY)');
      await client.query(migration);
      await client.query("ROLLBACK");
      expect((await client.query("SELECT to_regnamespace($1) AS namespace", [scratch])).rows[0].namespace).toBeNull();
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA "${scratch}"`);
      await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query('CREATE TABLE "Payment" ("id" TEXT PRIMARY KEY); CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY)');
      await client.query(migration);
      await client.query("COMMIT");
      expect((await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`${scratch}.\"AgentCommissionLedgerEntry\"`])).rows[0].present).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
      client.release();
    }
  });
  it("enforces idempotent sources, accrual uniqueness and immutable history", async () => {
    await pool.query(insert, entry("a1", "ACCRUAL", "100", null));
    await expect(pool.query(insert, entry("a2", "ACCRUAL", "100", null))).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(insert, entry("a3", "ACCRUAL", "100", null, { payment: "payment-2", source: "event-a1" }))).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query('UPDATE "AgentCommissionLedgerEntry" SET "amountMinor" = 1 WHERE "id" = $1', ["a1"])).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM "AgentCommissionLedgerEntry" WHERE "id" = $1', ["a1"])).rejects.toThrow(/immutable/);
    expect((await pool.query('SELECT "amountMinor" FROM "AgentCommissionLedgerEntry" WHERE "id" = $1', ["a1"])).rows[0].amountMinor).toBe("100");
  });
  it("rejects invalid money, mismatched reversals and cumulative over-reversal", async () => {
    await expect(pool.query(insert, entry("bad-sign", "ACCRUAL", "-1", null, { payment: "payment-2" }))).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(insert, entry("bad-currency", "ACCRUAL", "1", null, { payment: "payment-2", currency: "USD" }))).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(insert, entry("wrong-agent", "REVERSAL", "-1", "a1", { agent: "agent-2" }))).rejects.toThrow(/does not match/);
    await expect(pool.query(insert, entry("wrong-policy", "REVERSAL", "-1", "a1", { version: "other" }))).rejects.toThrow(/does not match/);
    await expect(pool.query(insert, entry("missing", "REVERSAL", "-1", "missing"))).rejects.toThrow(/does not match/);
    await pool.query(insert, entry("partial", "REVERSAL", "-40", "a1"));
    await expect(pool.query(insert, entry("excess", "REVERSAL", "-61", "a1"))).rejects.toThrow(/exceeds/);
  });
  it("fails closed for reversal transactions with fixed snapshots", async () => {
    for (const isolation of ["REPEATABLE READ", "SERIALIZABLE"]) {
      const client = await pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        await expect(client.query(insert, entry(`fixed-${isolation}`, "REVERSAL", "-1", "a1"))).rejects.toThrow(/requires READ COMMITTED/);
        await client.query("ROLLBACK");
      } finally { client.release(); }
    }
  });
  it.each(["COMMIT", "ROLLBACK"] as const)("waits for an in-flight reversal and handles its %s", async (finish) => {
    const payment = finish === "COMMIT" ? "payment-3" : "payment-4";
    const original = `held-${finish}`;
    await pool.query(insert, entry(original, "ACCRUAL", "100", null, { payment }));
    const first = await pool.connect();
    const second = await pool.connect();
    let pending: Promise<{ ok: boolean; error?: unknown }> | undefined;
    try {
      await first.query("BEGIN");
      await first.query(insert, entry(`first-${finish}`, "REVERSAL", "-60", original, { payment }));
      const pid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      pending = second.query(insert, entry(`second-${finish}`, "REVERSAL", "-60", original, { payment }))
        .then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
      // Verify the second statement actually waited before resolving the first transaction.
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const state = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
        waiting = state.rows[0]?.wait_event_type === "Lock";
        if (!waiting) await pool.query("SELECT pg_sleep(0.02)");
      }
      expect(waiting).toBe(true);
      await first.query(finish);
      const outcome = await pending;
      expect(outcome.ok).toBe(finish === "ROLLBACK");
      if (finish === "COMMIT") expect(String(outcome.error)).toContain("exceeds");
      const total = await pool.query('SELECT SUM("amountMinor") AS total FROM "AgentCommissionLedgerEntry" WHERE "originalEntryId" = $1', [original]);
      expect(total.rows[0].total).toBe("-60");
    } finally {
      await first.query("ROLLBACK");
      if (pending) await pending;
      first.release();
      second.release();
    }
  });
  it("serializes concurrent partial reversals so their sum cannot exceed the accrual", async () => {
    await pool.query(insert, entry("race-base", "ACCRUAL", "100", null, { payment: "payment-2" }));
    const results = await Promise.allSettled([
      pool.query(insert, entry("race-1", "REVERSAL", "-60", "race-base", { payment: "payment-2" })),
      pool.query(insert, entry("race-2", "REVERSAL", "-60", "race-base", { payment: "payment-2" })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const total = await pool.query('SELECT SUM("amountMinor") AS total FROM "AgentCommissionLedgerEntry" WHERE "originalEntryId" = $1', ["race-base"]);
    expect(total.rows[0].total).toBe("-60");
  });
});
