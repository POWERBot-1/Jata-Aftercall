import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261112090000_mjengo_isolated_entitlements/migration.sql", "utf8");

describe("MJENGO independent storage", () => {
  it("declares tenant-scoped subscription and entitlement models with independent uniqueness", () => {
    expect(schema).toContain("mjengoSubscription      MjengoSubscription?");
    expect(schema).toContain("mjengoEntitlement       MjengoEntitlement?");
    expect(schema).toMatch(/model MjengoSubscription \{[\s\S]*?businessId\s+String\s+@unique/);
    expect(schema).toMatch(/model MjengoEntitlement \{[\s\S]*?businessId\s+String\s+@unique/);
  });

  it("creates dedicated MJENGO tables and moves only legacy MJENGO rows", () => {
    expect(migration).toContain('CREATE TABLE "MjengoSubscription"');
    expect(migration).toContain('CREATE TABLE "MjengoEntitlement"');
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE/i);
    expect(migration).toContain('DELETE FROM "ErpSubscription" WHERE "planKey" = \'MJENGO_OS\'');
    expect(migration).toContain('DELETE FROM "ErpEntitlement" WHERE "packageKey" = \'MJENGO_OS\'');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"(PosSubscription|PosEntitlement)"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"ErpSubscription"\s+WHERE\s+"planKey"\s*<>/i);
  });

  it("backfills only legacy MJENGO records and excludes ERP_PRO", () => {
    expect(migration).toMatch(/FROM "ErpSubscription" s\s+WHERE s\."planKey" = 'MJENGO_OS'/);
    expect(migration).toMatch(/FROM "ErpEntitlement" e\s+WHERE e\."packageKey" = 'MJENGO_OS'/);
    expect(migration).toContain('ON CONFLICT ("businessId") DO NOTHING');
  });

  it("keeps both MJENGO models available in the offline Prisma fallback", () => {
    const db = readFileSync("lib/db.ts", "utf8");
    expect(db).toContain("mjengoSubscription: emptyModel()");
    expect(db).toContain("mjengoEntitlement: emptyModel()");
  });
});
