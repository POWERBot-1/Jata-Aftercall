import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261112090000_mjengo_isolated_entitlements/migration.sql", "utf8");

describe("independent ERP PRO and MJENGO OS storage", () => {
  it("declares tenant-scoped independent models for both products", () => {
    expect(schema).toContain("erpProSubscription      ErpProSubscription?");
    expect(schema).toContain("erpProEntitlement       ErpProEntitlement?");
    expect(schema).toContain("mjengoSubscription      MjengoSubscription?");
    expect(schema).toContain("mjengoEntitlement       MjengoEntitlement?");
    for (const model of ["ErpProSubscription", "ErpProEntitlement", "MjengoSubscription", "MjengoEntitlement"]) {
      expect(schema).toMatch(new RegExp("model " + model + " \\{[\\s\\S]*?businessId\\s+String\\s+@unique"));
    }
  });

  it("creates four dedicated product tables without deleting or rewriting legacy rows", () => {
    for (const table of ["ErpProSubscription", "ErpProEntitlement", "MjengoSubscription", "MjengoEntitlement"]) {
      expect(migration).toContain('CREATE TABLE "' + table + '"');
    }
    expect(migration).not.toMatch(/DROP\\s+(TABLE|COLUMN)|TRUNCATE|DELETE\\s+FROM/i);
    expect(migration).not.toMatch(/UPDATE\\s+"(ErpSubscription|ErpEntitlement|PosSubscription|PosEntitlement)"/i);
  });

  it("backfills legacy ERP PRO and MJENGO rows only into their matching product tables", () => {
    expect(migration).toMatch(/FROM "ErpSubscription" s\\s+WHERE s\\."planKey" = 'ERP_PRO'/);
    expect(migration).toMatch(/FROM "ErpEntitlement" e\\s+WHERE e\\."packageKey" = 'ERP_PRO'/);
    expect(migration).toMatch(/FROM "ErpSubscription" s\\s+WHERE s\\."planKey" = 'MJENGO_OS'/);
    expect(migration).toMatch(/FROM "ErpEntitlement" e\\s+WHERE e\\."packageKey" = 'MJENGO_OS'/);
    expect(migration.match(/ON CONFLICT \\("businessId"\\) DO NOTHING/g)?.length).toBe(4);
  });

  it("keeps all four isolated models available in the offline Prisma fallback", () => {
    const db = readFileSync("lib/db.ts", "utf8");
    expect(db).toContain("erpProSubscription: emptyModel()");
    expect(db).toContain("erpProEntitlement: emptyModel()");
    expect(db).toContain("mjengoSubscription: emptyModel()");
    expect(db).toContain("mjengoEntitlement: emptyModel()");
  });
});
