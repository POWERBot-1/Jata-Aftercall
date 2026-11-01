/** Additive MediaAsset object-identity migration on an isolated disposable PostgreSQL schema. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const schema = `media_storage_${randomUUID().replace(/-/g, "")}`;
let pool: Pool | undefined;

describe.skipIf(!realPrismaConfigured)("media object identity migration on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) {
      throw new Error("Disposable loopback JATA database required");
    }
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "MediaAsset" ("id" TEXT PRIMARY KEY, "businessId" TEXT NOT NULL, "url" TEXT NOT NULL)');
    await pool.query('INSERT INTO "MediaAsset" ("id", "businessId", "url") VALUES ($1,$2,$3)', [
      "legacy-asset", "business-a", "https://images.example.test/legacy.jpg",
    ]);
    const migration = readFileSync("prisma/migrations/20261125000000_media_storage_identity/migration.sql", "utf8");
    await pool.query(migration);
    await pool.query(migration); // additive IF NOT EXISTS operations remain safely repeatable
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it("preserves legacy references as null and stores new tenant object identity", async () => {
    const legacy = await pool!.query('SELECT "storageProvider", "storageKey" FROM "MediaAsset" WHERE "id" = $1', ["legacy-asset"]);
    expect(legacy.rows[0]).toEqual({ storageProvider: null, storageKey: null });

    await pool!.query(
      'INSERT INTO "MediaAsset" ("id", "businessId", "url", "storageProvider", "storageKey") VALUES ($1,$2,$3,$4,$5)',
      ["new-asset", "business-a", "https://cdn.example.test/tenants/business-a/image-original/a.jpg", "cloudflare-r2", "tenants/business-a/image-original/a.jpg"],
    );
    const stored = await pool!.query('SELECT "businessId", "storageProvider", "storageKey" FROM "MediaAsset" WHERE "id" = $1', ["new-asset"]);
    expect(stored.rows[0]).toEqual({ businessId: "business-a", storageProvider: "cloudflare-r2", storageKey: "tenants/business-a/image-original/a.jpg" });
  });
});
