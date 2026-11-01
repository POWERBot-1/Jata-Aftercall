/** Synthetic disposable-schema checks only. Never points at production or seeds a privileged account. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const schema = `control_test_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
const migration = readFileSync("prisma/migrations/20261126000000_control_plane_foundation/migration.sql", "utf8");

describe.skipIf(!realPrismaConfigured)("control-plane migration on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) {
      throw new Error("Disposable loopback JATA test database required");
    }
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);');
    await pool.query(migration);
    await pool.query('INSERT INTO "User" ("id") VALUES (\'fixture-actor\'), (\'fixture-subject\'); INSERT INTO "Business" ("id") VALUES (\'fixture-business\');');
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it("adds no privileged grants and protects audit and grant integrity", async () => {
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "ControlRoleGrant"')).rows[0].count).toBe(0);
    await pool.query(`INSERT INTO "ControlRoleGrant" ("id", "userId", "role", "permissionKeys", "scopeBusinessId", "createdById", "reason") VALUES ('fixture-grant', 'fixture-subject', 'SUPPORT_ADMIN', ARRAY['businesses.read'], 'fixture-business', 'fixture-actor', 'Synthetic fixture grant')`);
    await expect(pool.query('UPDATE "ControlRoleGrant" SET "permissionKeys" = ARRAY[\'businesses.suspend\'] WHERE "id" = \'fixture-grant\'')).rejects.toThrow(/only be revoked once/);
    await pool.query('UPDATE "ControlRoleGrant" SET "revokedAt" = CURRENT_TIMESTAMP, "revocationReason" = \'fixture revocation\' WHERE "id" = \'fixture-grant\'');
    await expect(pool.query('UPDATE "ControlRoleGrant" SET "revocationReason" = \'second edit\' WHERE "id" = \'fixture-grant\'')).rejects.toThrow(/only be revoked once/);
    await expect(pool.query('DELETE FROM "ControlRoleGrant" WHERE "id" = \'fixture-grant\'')).rejects.toThrow(/append-only/);

    await pool.query(`INSERT INTO "ControlAuditEvent" ("id", "actorId", "actorRole", "action", "targetType", "targetId", "scopeBusinessId", "outcome") VALUES ('fixture-audit', 'fixture-actor', 'SUPPORT_ADMIN', 'FIXTURE_ACTION', 'BUSINESS', 'fixture-business', 'fixture-business', 'SUCCESS')`);
    await expect(pool.query('UPDATE "ControlAuditEvent" SET "outcome" = \'FAILED\' WHERE "id" = \'fixture-audit\'')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM "ControlAuditEvent" WHERE "id" = \'fixture-audit\'')).rejects.toThrow(/append-only/);
    expect((await pool.query('SELECT "outcome" FROM "ControlAuditEvent" WHERE "id" = \'fixture-audit\'')).rows[0].outcome).toBe("SUCCESS");
  });

  it("can roll back DDL in an isolated scratch schema and then cleanly reapply", async () => {
    const scratch = `${schema}_rollback`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${scratch}"`);
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);');
      await client.query(migration);
      await client.query("ROLLBACK");
      expect((await client.query("SELECT to_regclass($1) AS table_name", [`${scratch}.\"ControlAuditEvent\"`])).rows[0].table_name).toBeNull();
      await client.query("BEGIN");
      await client.query(`SET LOCAL search_path TO "${scratch}"`);
      await client.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY); CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);');
      await client.query(migration);
      await client.query("COMMIT");
      expect((await client.query("SELECT to_regclass($1) AS table_name", [`${scratch}.\"ControlAuditEvent\"`])).rows[0].table_name).not.toBeNull();
    } finally {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`);
      client.release();
    }
  });
});
