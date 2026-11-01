/** Synthetic disposable-schema checks only. Minimal User/Business rows are FK stubs, not login accounts, sessions, or grants; never points at production. */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createControlAuditEvent } from "@/lib/control/audit";
import type { ControlGrant } from "@/lib/control/access";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const schema = `control_test_${randomUUID().replace(/-/g, "")}`;
const require = createRequire(import.meta.url);
let pool: Pool;
let prisma: any;
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
    await pool.query('INSERT INTO "User" ("id") VALUES (\'fixture-actor\'); INSERT INTO "Business" ("id") VALUES (\'fixture-business\');');

    // Route authorization remains disabled by the pending owner-policy gate. This isolated Prisma
    // client is used only to exercise the actual audit helper against this disposable schema.
    const harness = process.env.PRISMA_WASM_HARNESS_DIR;
    if (harness) {
      const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
      const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
      const { Pool: AdapterPool } = require(path.join(harness, "node_modules", "pg"));
      prisma = new PrismaClient({ adapter: new PrismaPg(new AdapterPool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` })) });
    } else {
      const { PrismaClient } = require("@prisma/client");
      url.searchParams.set("schema", schema);
      prisma = new PrismaClient({ datasourceUrl: url.toString() });
    }
    await prisma.$connect();
  });
  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it("adds no privileged grants and protects persisted audit integrity", async () => {
    expect((await pool.query('SELECT COUNT(*)::int AS count FROM "ControlRoleGrant"')).rows[0].count).toBe(0);
    await pool.query(`INSERT INTO "ControlAuditEvent" ("id", "actorId", "actorRole", "action", "targetType", "targetId", "scopeBusinessId", "outcome") VALUES ('fixture-audit', 'fixture-actor', 'SUPPORT_ADMIN', 'FIXTURE_ACTION', 'BUSINESS', 'fixture-business', 'fixture-business', 'SUCCESS')`);
    await expect(pool.query('UPDATE "ControlAuditEvent" SET "outcome" = \'FAILED\' WHERE "id" = \'fixture-audit\'')).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM "ControlAuditEvent" WHERE "id" = \'fixture-audit\'')).rejects.toThrow(/append-only/);
    expect((await pool.query('SELECT "outcome" FROM "ControlAuditEvent" WHERE "id" = \'fixture-audit\'')).rows[0].outcome).toBe("SUCCESS");
  });

  it("persists an event through the application audit helper and protects that row", async () => {
    // Synthetic audit attribution only: no capability is listed, no ControlRoleGrant is inserted,
    // and no protected route or pending-policy gate is bypassed.
    const grant: ControlGrant = {
      id: "memory-only-audit-context", role: "SUPPORT_ADMIN", permissionKeys: [], scopeBusinessId: "fixture-business",
    };
    const created = await prisma.$transaction((tx: any) => createControlAuditEvent(tx, {
      actorId: "fixture-actor", grant, action: "BUSINESS_SUSPEND", targetType: "BUSINESS",
      targetId: "fixture-business", scopeBusinessId: "fixture-business", outcome: "SUCCESS",
      reason: "Synthetic audit-helper integration fixture",
      beforeState: { status: "ACTIVE", credentials: { apiToken: "must-be-redacted" } },
      afterState: { status: "SUSPENDED" },
      metadata: { fixture: true, correlationNote: "request from isolated test", apiKey: "must-be-redacted" },
      correlationId: "control-audit:fixture-1",
    }));

    expect(created.actorId).toBe("fixture-actor");
    expect(created.actorRole).toBe("SUPPORT_ADMIN");
    expect(created.action).toBe("BUSINESS_SUSPEND");
    expect(created.targetType).toBe("BUSINESS");
    expect(created.targetId).toBe("fixture-business");
    expect(created.scopeBusinessId).toBe("fixture-business");
    expect(created.outcome).toBe("SUCCESS");
    expect(created.reason).toBe("Synthetic audit-helper integration fixture");
    expect(created.beforeState).toEqual({ status: "ACTIVE", credentials: "[REDACTED]" });
    expect(created.afterState).toEqual({ status: "SUSPENDED" });
    expect(created.metadata).toEqual({ fixture: true, correlationNote: "request from isolated test", apiKey: "[REDACTED]" });
    expect(created.correlationId).toBe("control-audit:fixture-1");
    expect(created.createdAt).toBeInstanceOf(Date);

    const persisted = await prisma.controlAuditEvent.findUnique({ where: { id: created.id } });
    expect(persisted).toMatchObject({
      id: created.id, actorId: "fixture-actor", actorRole: "SUPPORT_ADMIN", action: "BUSINESS_SUSPEND",
      targetType: "BUSINESS", targetId: "fixture-business", scopeBusinessId: "fixture-business",
      outcome: "SUCCESS", correlationId: "control-audit:fixture-1",
      beforeState: { status: "ACTIVE", credentials: "[REDACTED]" },
      afterState: { status: "SUSPENDED" },
    });
    await expect(pool.query('UPDATE "ControlAuditEvent" SET "outcome" = \'FAILED\' WHERE "id" = $1', [created.id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM "ControlAuditEvent" WHERE "id" = $1', [created.id])).rejects.toThrow(/append-only/);
    expect((await pool.query('SELECT "outcome" FROM "ControlAuditEvent" WHERE "id" = $1', [created.id])).rows[0].outcome).toBe("SUCCESS");
  });

  it("rolls back an application-helper event when its surrounding transaction aborts", async () => {
    const grant: ControlGrant = {
      id: "memory-only-audit-context", role: "SUPPORT_ADMIN", permissionKeys: [], scopeBusinessId: "fixture-business",
    };
    let id = "";
    await expect(prisma.$transaction(async (tx: any) => {
      const created = await createControlAuditEvent(tx, {
        actorId: "fixture-actor", grant, action: "BUSINESS_SUSPEND", targetType: "BUSINESS",
        targetId: "fixture-business", scopeBusinessId: "fixture-business", outcome: "SUCCESS",
        correlationId: "control-audit:rollback-fixture",
      });
      id = created.id;
      throw new Error("synthetic surrounding transaction rollback");
    })).rejects.toThrow("synthetic surrounding transaction rollback");
    expect(id).not.toBe("");
    expect((await pool.query('SELECT "id" FROM "ControlAuditEvent" WHERE "id" = $1', [id])).rows).toHaveLength(0);
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
