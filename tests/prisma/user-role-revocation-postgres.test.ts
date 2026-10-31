/** The trigger is rehearsed only in a random schema on an explicitly disposable local database. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const schema = `role_revoke_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;

describe.skipIf(!realPrismaConfigured)("role change session revocation migration", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "role" TEXT NOT NULL, "sessionVersion" INTEGER NOT NULL DEFAULT 0, "name" TEXT)');
    await pool.query(readFileSync("prisma/migrations/20261124000000_user_role_session_revocation/migration.sql", "utf8"));
    await pool.query(`INSERT INTO "User" ("id", "role") VALUES ('u', 'ADMIN')`);
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });
  it("advances the version on demotion and again if the role is restored", async () => {
    expect((await pool.query(`UPDATE "User" SET "role"='CUSTOMER' WHERE "id"='u' RETURNING "sessionVersion"`)).rows[0].sessionVersion).toBe(1);
    expect((await pool.query(`UPDATE "User" SET "role"='ADMIN' WHERE "id"='u' RETURNING "sessionVersion"`)).rows[0].sessionVersion).toBe(2);
  });
  it("preserves explicit increments and ordinary updates, and refuses version rollback", async () => {
    expect((await pool.query(`UPDATE "User" SET "name"='test' WHERE "id"='u' RETURNING "sessionVersion"`)).rows[0].sessionVersion).toBe(2);
    expect((await pool.query(`UPDATE "User" SET "role"='CUSTOMER', "sessionVersion"="sessionVersion"+1 WHERE "id"='u' RETURNING "sessionVersion"`)).rows[0].sessionVersion).toBe(3);
    await expect(pool.query(`UPDATE "User" SET "sessionVersion"=0 WHERE "id"='u'`)).rejects.toThrow(/cannot decrease/);
    await expect(pool.query(`UPDATE "User" SET "role"='ADMIN', "sessionVersion"=0 WHERE "id"='u'`)).rejects.toThrow(/cannot decrease/);
    expect((await pool.query(`SELECT "role", "sessionVersion" FROM "User" WHERE "id"='u'`)).rows[0]).toEqual({ role: "CUSTOMER", sessionVersion: 3 });
  });
  it("rolls the role and revocation back together on transaction failure", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      expect((await client.query(`UPDATE "User" SET "role"='ADMIN' WHERE "id"='u' RETURNING "sessionVersion"`)).rows[0].sessionVersion).toBe(4);
      await client.query("ROLLBACK");
    } finally { client.release(); }
    expect((await pool.query(`SELECT "role", "sessionVersion" FROM "User" WHERE "id"='u'`)).rows[0]).toEqual({ role: "CUSTOMER", sessionVersion: 3 });
  });
  it("fails closed rather than wrapping a saturated version", async () => {
    await pool.query(`UPDATE "User" SET "sessionVersion"=2147483647 WHERE "id"='u'`);
    await expect(pool.query(`UPDATE "User" SET "role"='ADMIN' WHERE "id"='u'`)).rejects.toThrow(/out of range/);
    expect((await pool.query(`SELECT "role", "sessionVersion" FROM "User" WHERE "id"='u'`)).rows[0]).toEqual({ role: "CUSTOMER", sessionVersion: 2147483647 });
  });

});
