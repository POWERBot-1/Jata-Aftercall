import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261202000000_mjengo_isolated_entitlements/migration.sql", "utf8");
const erpEntitlement = readFileSync("lib/erp/entitlement.ts", "utf8");
const mjengoEntitlement = readFileSync("lib/mjengo/entitlement.ts", "utf8");

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

  it("routes each product only through its own active storage", () => {
    expect(erpEntitlement).toContain("client.erpProSubscription");
    expect(erpEntitlement).toContain("client.erpProEntitlement");
    expect(erpEntitlement).not.toContain("client.erpSubscription");
    expect(erpEntitlement).not.toContain("client.erpEntitlement");
    expect(mjengoEntitlement).toContain("prisma as any).mjengoSubscription");
    expect(mjengoEntitlement).toContain("prisma as any).mjengoEntitlement");
  });

  it("creates four dedicated product tables without deleting or rewriting legacy rows", () => {
    for (const table of ["ErpProSubscription", "ErpProEntitlement", "MjengoSubscription", "MjengoEntitlement"]) {
      // Re-runnable like every ERP migration (scripts/erp/migration-verify.sh re-applies it).
      expect(migration).toContain('CREATE TABLE IF NOT EXISTS "' + table + '"');
      // ...but never silently adopts a same-named table of another shape: the shape guard names
      // every table and aborts the deploy before the backfill.
      expect(migration).toContain('"' + table + '":[');
    }
    const guard = migration.indexOf("product isolation: existing table");
    expect(guard, "shape guard present").toBeGreaterThan(-1);
    expect(guard, "shape guard runs before any backfill").toBeLessThan(migration.indexOf("INSERT INTO"));
    expect(migration).toMatch(/RAISE EXCEPTION 'product isolation: existing table "%" lacks column/);
    expect(migration).toMatch(/RAISE EXCEPTION 'product isolation: existing table "%" has no unique index on "businessId"/);
    // Foreign keys are added only when absent, so a re-run does not fail on a duplicate constraint.
    expect(migration).not.toMatch(/^ALTER TABLE/m);
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("TRUNCATE");
    expect(migration).not.toContain("DELETE FROM");
    expect(migration).not.toContain('UPDATE "ErpSubscription"');
    expect(migration).not.toContain('UPDATE "ErpEntitlement"');
  });

  it("backfills legacy ERP PRO and MJENGO rows only into their matching product tables", () => {
    expect(migration).toContain('FROM "ErpSubscription" s\nWHERE s."planKey" = \'ERP_PRO\'');
    expect(migration).toContain('FROM "ErpEntitlement" e\nWHERE e."packageKey" = \'ERP_PRO\'');
    expect(migration).toContain('FROM "ErpSubscription" s\nWHERE s."planKey" = \'MJENGO_OS\'');
    expect(migration).toContain('FROM "ErpEntitlement" e\nWHERE e."packageKey" = \'MJENGO_OS\'');
    expect(migration.match(/ON CONFLICT \("businessId"\) DO NOTHING/g)?.length).toBe(4);
  });

  it("keeps all four isolated models available in the offline Prisma fallback", () => {
    const db = readFileSync("lib/db.ts", "utf8");
    expect(db).toContain("erpProSubscription: emptyModel()");
    expect(db).toContain("erpProEntitlement: emptyModel()");
    expect(db).toContain("mjengoSubscription: emptyModel()");
    expect(db).toContain("mjengoEntitlement: emptyModel()");
  });
});
