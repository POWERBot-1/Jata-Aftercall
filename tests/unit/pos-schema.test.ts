/**
 * Schema, migration and data-layer consistency (§5, §53, §54)
 *
 * `prisma validate` needs the engine binary, so this test does the checking instead: every model
 * the POS data layer touches exists in the schema, every POS table is tenant-scoped and created by
 * the migration, every migration column matches a schema field, money is stored as whole shillings,
 * and the offline Prisma stub covers every POS model so a build without a database still succeeds.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
// The POS schema is the original business_pos migration plus the authorized additive follow-ups.
// New POS tables or columns must be added as a new migration AND listed here, so the guard keeps
// proving that the migrations create exactly what the schema declares.
const POS_MIGRATIONS = [
  "20261003000000_business_pos",
  "20261005020000_pos_sale_refund_integrity",
  "20261005030000_pos_fractional_quantities",
];
const migration = POS_MIGRATIONS.map((dir) => readFileSync(path.join(root, "prisma/migrations", dir, "migration.sql"), "utf8")).join("\n");
const storeSource = readFileSync(path.join(root, "lib/pos/store.ts"), "utf8");
const dbSource = readFileSync(path.join(root, "lib/db.ts"), "utf8");

type Model = { name: string; body: string; fields: Map<string, string> };

function models(): Model[] {
  const found: Model[] = [];
  const pattern = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(schema)) !== null) {
    const [, name, body] = match;
    const fields = new Map<string, string>();
    for (const raw of body.split("\n")) {
      const line = raw.split("//")[0].trim();
      if (!line || line.startsWith("@@")) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      fields.set(parts[0], parts[1]);
    }
    found.push({ name, body, fields });
  }
  return found;
}

const all = models();
const posModels = all.filter((model) => model.name.startsWith("Pos"));

/** The Prisma model name a `prisma.posSale` style accessor refers to. */
function modelNameFromAccessor(accessor: string): string {
  return accessor.charAt(0).toUpperCase() + accessor.slice(1);
}

function tableColumns(table: string): Map<string, string> {
  const columns = new Map<string, string>();
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS "${table}" (`);
  if (start >= 0) {
    const end = migration.indexOf("\n);", start);
    const block = migration.slice(start, end);
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      const match = /^"(\w+)"\s+([A-Z]+(?:\(\d+\))*)(.*)$/.exec(line.replace(/,$/, ""));
      if (!match) continue;
      columns.set(match[1], `${match[2]} ${match[3]}`.trim());
    }
  }
  // Columns added later by an additive migration are part of the table too (§80).
  for (const add of migration.matchAll(new RegExp(`ALTER TABLE "${table}"\\s+ADD COLUMN(?: IF NOT EXISTS)? "([\\w]+)"\\s+([A-Z]+(?:\\(\\d+\\))*)([^;\\n]*)`, "g"))) {
    columns.set(add[1], `${add[2]} ${add[3]}`.trim());
  }
  return columns;
}

describe("the POS data model is tenant-scoped by construction (§5)", () => {
  // The receipt sequence is a tenant-scoped counter: a plain unique `businessId` column, no
  // relation, by design — the same shape the stock room's sequence must have (§32).
  const RELATIONLESS = new Set(["PosReceiptSequence"]);

  it("gives every POS model a businessId and an index on it", () => {
    expect(posModels.length).toBeGreaterThanOrEqual(21);
    for (const model of posModels) {
      expect(model.fields.has("businessId"), `${model.name}.businessId`).toBe(true);
      // Optional only where a template outlives the business it was saved from (onDelete: SetNull).
      expect(["String", "String?"], `${model.name}.businessId type`).toContain(model.fields.get("businessId"));
      expect(model.body, `${model.name} index`).toContain("@@index([businessId");
      if (RELATIONLESS.has(model.name)) continue;
      // Cascade everywhere, except a saved template which outlives the business it came from.
      expect(model.body, `${model.name} relation`).toMatch(/references: \[id\], onDelete: (Cascade|SetNull)/);
    }
  });

  it("keeps uniqueness inside a tenant, never across tenants (§5, §32)", () => {
    const sale = posModels.find((model) => model.name === "PosSale")!;
    expect(sale.body).toContain("@@unique([businessId, receiptNumber])");
    const version = posModels.find((model) => model.name === "PosConfigurationVersion")!;
    expect(version.body).toContain("@@unique([businessId, version])");
    // One configuration, one subscription and one entitlement per business (§44, §45).
    for (const name of ["PosConfiguration", "PosSubscription", "PosEntitlement"]) {
      const model = posModels.find((entry) => entry.name === name)!;
      expect(model.body, name).toMatch(/businessId\s+String\s+@unique/);
    }
  });

  it("stores money as whole Kenyan shillings (§31, §57)", () => {
    let checked = 0;
    for (const model of posModels) {
      for (const [field, type] of model.fields) {
        if (!field.endsWith("KES")) continue;
        checked += 1;
        expect(type.replace("?", ""), `${model.name}.${field}`).toBe("Int");
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("keeps the two credit ledgers in one table separated by party type (§30)", () => {
    const entry = posModels.find((model) => model.name === "PosCreditEntry")!;
    expect(entry.fields.get("partyType")).toBe("String");
    expect(entry.body).toContain("CUSTOMER | SUPPLIER");
    expect(entry.body).toContain("@@index([businessId, partyType, partyId])");
  });

  it("records a reason and an actor on every stock movement (§33, §37)", () => {
    const movement = posModels.find((model) => model.name === "PosInventoryMovement")!;
    for (const field of ["reason", "delta", "quantity", "createdById", "refType", "refId"]) {
      expect(movement.fields.has(field), field).toBe(true);
    }
    const audit = posModels.find((model) => model.name === "PosAuditEvent")!;
    for (const field of ["actorId", "actorName", "action", "targetType", "targetId", "metadata"]) {
      expect(audit.fields.has(field), field).toBe(true);
    }
  });

  it("keeps a sale's own record of what was sold, so history survives later edits (§48, §54)", () => {
    const item = posModels.find((model) => model.name === "PosSaleItem")!;
    for (const field of ["name", "unitKey", "quantity", "unitPriceKES", "totalKES"]) {
      expect(item.fields.has(field), field).toBe(true);
    }
    const sale = posModels.find((model) => model.name === "PosSale")!;
    expect(sale.fields.has("configurationVersion")).toBe(true);
    expect(sale.fields.has("refundedKES")).toBe(true);
  });

  it("records the refund split and the per-line returns, so a refund can never be paid twice (§30, §54)", () => {
    const sale = posModels.find((model) => model.name === "PosSale")!;
    expect(sale.fields.get("creditRefundedKES"), "PosSale.creditRefundedKES").toBe("Int");
    const item = posModels.find((model) => model.name === "PosSaleItem")!;
    expect(item.fields.get("returnedQty"), "PosSaleItem.returnedQty").toBe("Float");
  });

  it("keeps one per-business receipt sequence row so concurrent sales get unique numbers (§32)", () => {
    const sequence = posModels.find((model) => model.name === "PosReceiptSequence")!;
    expect(sequence, "PosReceiptSequence model").toBeTruthy();
    expect(sequence.body).toMatch(/businessId\s+String\s+@unique/);
    expect(sequence.fields.get("nextValue")).toBe("Int");
  });

  it("stores measurable quantities as three-decimal floats, never truncated ints (§13, §14)", () => {
    for (const name of ["PosSaleItem", "PosInventoryItem", "PosInventoryMovement", "PosOrderItem", "PosPurchaseItem"]) {
      const model = posModels.find((entry) => entry.name === name)!;
      expect(model.fields.get("quantity"), `${name}.quantity`).toBe("Float");
    }
    expect(posModels.find((model) => model.name === "PosInventoryMovement")!.fields.get("delta")).toBe("Float");
    expect(posModels.find((model) => model.name === "PosPurchaseItem")!.fields.get("receivedQty")).toBe("Float");
  });

  it("uses one generic asset record instead of a table per trade (§18, §52)", () => {
    const asset = posModels.find((model) => model.name === "PosCustomerAsset")!;
    expect(asset).toBeTruthy();
    expect(asset.fields.get("label")).toBe("String");
    expect(asset.fields.get("identifier")).toBe("String?");
    // No per-industry tables were added.
    for (const forbidden of ["PosVehicle", "PosProperty", "PosPet", "PosHarvest", "PosJobCard", "PosRecipe"]) {
      expect(schema, forbidden).not.toContain(`model ${forbidden} {`);
    }
  });
});

describe("the migration creates exactly what the schema declares (§80)", () => {
  it("creates a table for every POS model, with matching columns", () => {
    for (const model of posModels) {
      const columns = tableColumns(model.name);
      expect(columns.size, `${model.name} table`).toBeGreaterThan(0);
      for (const [field, type] of model.fields) {
        // Relation fields are Prisma-level only; the scalar side is a column.
        const typeName = type.replace("[]", "").replace("?", "");
        const isRelation = all.some((other) => other.name === typeName);
        if (isRelation) continue; // relation fields are Prisma-level; the scalar side is the column
        expect(columns.has(field), `${model.name}.${field} column`).toBe(true);
      }
      for (const column of columns.keys()) {
        expect(model.fields.has(column), `${model.name} unexpected column ${column}`).toBe(true);
      }
    }
  });

  it("declares the same nullability and defaults as the schema", () => {
    for (const model of posModels) {
      const columns = tableColumns(model.name);
      for (const [field, type] of model.fields) {
        const column = columns.get(field);
        if (!column) continue;
        const optional = type.endsWith("?");
        expect(column.includes("NOT NULL"), `${model.name}.${field} nullability`).toBe(!optional);
      }
    }
    // Channel attribution keeps the engine's spelling (§28, §70).
    expect(migration).toContain(`"channel" TEXT NOT NULL DEFAULT 'walk_in'`);
    // A stock location uses "" for "the business's own stock room" so the unique pair holds (§16).
    expect(schema).toContain('branchId     String     @default("")');
  });

  it("creates the indexes and foreign keys the schema asks for", () => {
    for (const model of posModels) {
      const indexes = [...model.body.matchAll(/@@index\(\[([^\]]+)\]\)/g)].map((match) => match[1].split(",").map((part) => part.trim()));
      for (const columns of indexes) {
        const name = `${model.name}_${columns.join("_")}_idx`;
        expect(migration, name).toContain(`CREATE INDEX IF NOT EXISTS "${name}"`);
      }
      const uniques = [...model.body.matchAll(/@@unique\(\[([^\]]+)\]\)/g)].map((match) => match[1].split(",").map((part) => part.trim()));
      for (const columns of uniques) {
        const name = `${model.name}_${columns.join("_")}_key`;
        expect(migration, name).toContain(`"${name}" UNIQUE`);
      }
      const relations = [...model.body.matchAll(/@relation\(fields: \[(\w+)\], references: \[(\w+)\]/g)];
      for (const relation of relations) {
        expect(migration, `${model.name}.${relation[1]} fkey`).toContain(`"${model.name}_${relation[1]}_fkey"`);
      }
    }
  });
});

describe("the data layer only touches models that exist (§53)", () => {
  it("every prisma accessor in the POS store maps to a schema model", () => {
    const accessors = new Set<string>();
    for (const match of storeSource.matchAll(/(?:client|prisma|tx|model)\.(pos\w+)\./g)) accessors.add(match[1]);
    for (const match of storeSource.matchAll(/\b(pos[A-Z]\w+)\.findMany/g)) accessors.add(match[1]);
    expect(accessors.size).toBeGreaterThanOrEqual(15);
    for (const expected of ["posSale", "posProduct", "posCustomer", "posSupplier", "posInventoryMovement", "posCreditEntry", "posOrder", "posExpense", "posPurchase", "posPayment"]) {
      expect(accessors, expected).toContain(expected);
    }
    const names = new Set(all.map((model) => model.name));
    for (const accessor of accessors) {
      expect(names.has(modelNameFromAccessor(accessor)), `${accessor} → model`).toBe(true);
    }
  });

  it("the offline stub covers every POS model, so a build without a database still works", () => {
    for (const model of posModels) {
      const accessor = model.name.charAt(0).toLowerCase() + model.name.slice(1);
      expect(dbSource, `${accessor} stub`).toContain(`${accessor}: {`);
    }
    // The stub refuses writes and answers reads with nothing, exactly like the other models.
    expect(dbSource).toContain('throw new Error("DB not available")');
  });
});

describe("no speculative complexity was added (§53, §80)", () => {
  it("adds no new Prisma enums and changes no existing model's columns", () => {
    const enums = [...schema.matchAll(/^enum (\w+) \{/gm)].map((match) => match[1]);
    expect(enums.filter((name) => name.startsWith("Pos"))).toEqual([]);
    // The migration never alters a table that already existed.
    expect(migration).not.toMatch(/ALTER TABLE "(?!Pos)/);
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("DELETE FROM");
  });

  it("keeps the POS's own subscription instead of reusing the platform one (§45, §80)", () => {
    expect(schema).toContain("model PosSubscription {");
    const subscription = all.find((model) => model.name === "Subscription")!;
    expect(subscription.body).not.toContain("pos");
  });
});
