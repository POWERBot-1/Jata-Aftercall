/**
 * Loyalty 2.0 — schema ⇄ migration parity.
 *
 * `prisma migrate diff` needs the schema-engine binary, which cannot be downloaded in this
 * workspace, so the equivalence between `prisma/schema.prisma` and the hand-written migration is
 * asserted here instead — the same technique the Business Hub migration is held to. Every points
 * model, column, nullability, default, unique index, index and foreign key declared in the schema
 * must exist in the SQL with the SQL type Prisma would emit.
 *
 * If this test and the SQL ever disagree, the migration is wrong — not the test.
 *
 * The stamp-card tables are deliberately NOT in the model list below. This migration creates new
 * tables and nothing else; the test proves that by asserting the complete set of tables and
 * ALTERed tables it touches.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migrationDir = path.join(root, "prisma/migrations/20261129000000_loyalty_points_rewards");
const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf8");

const POINTS_MODELS = [
  "LoyaltyPointsProgramme",
  "LoyaltyPointsEligibleItem",
  "LoyaltyPointsAccount",
  "LoyaltyPointsLedger",
  "LoyaltyReward",
  "LoyaltyRewardRedemption",
];

const POINTS_ENUMS: Record<string, string[]> = {
  PointsTransactionType: ["EARNED", "REDEEMED", "EXPIRED", "REVERSED", "MANUAL_ADJUSTMENT"],
  PointsDirection: ["CREDIT", "DEBIT"],
  PointsSource: [
    "OWNER_VERIFIED",
    "PAYMENT_PROVIDER",
    "CUSTOMER_REDEMPTION",
    "SYSTEM_EXPIRY",
    "OWNER_ADJUSTMENT",
    "REVERSAL",
  ],
  RewardKind: ["FIXED_POINTS", "DISCOUNT", "PRODUCT", "SERVICE"],
  RedemptionStatus: ["PENDING", "FULFILLED", "CANCELLED"],
};

/** Prisma scalar → the SQL type Prisma emits for PostgreSQL. */
const SQL_TYPE: Record<string, string> = {
  String: "TEXT",
  Int: "INTEGER",
  Float: "DOUBLE PRECISION",
  Boolean: "BOOLEAN",
  DateTime: "TIMESTAMP(3)",
};

type Field = {
  name: string;
  type: string;
  optional: boolean;
  isRelation: boolean;
  unique: boolean;
  relationFields?: string[];
  relationTo?: string;
  default?: string | null;
};

function modelBody(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `model ${name} is missing from schema.prisma`).toBeTruthy();
  return match![1];
}

function parseFields(name: string): Field[] {
  // Types that are models rather than scalars, so a relation column is not mistaken for a scalar.
  const known = new Set([
    ...POINTS_MODELS,
    "Business",
    "LoyaltyCard",
    "User",
    "Product",
    "Service",
  ]);
  const fields: Field[] = [];
  for (const raw of modelBody(name).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@") || line.startsWith("///")) continue;
    const match = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
    if (!match) continue;
    const [, fieldName, type, list, optional, rest] = match;
    if (rest.includes("@relation(")) {
      const fieldsAttr = rest.match(/fields:\s*\[([^\]]+)\]/);
      fields.push({
        name: fieldName,
        type,
        optional: Boolean(optional),
        isRelation: true,
        unique: false,
        relationFields: fieldsAttr ? fieldsAttr[1].split(",").map((entry) => entry.trim()) : [],
        relationTo: type,
      });
      continue;
    }
    if (list) continue; // back-relation collection, not a column
    if (known.has(type) && !SQL_TYPE[type]) continue; // relation scalar without an inline @relation
    fields.push({
      name: fieldName,
      type,
      optional: Boolean(optional),
      isRelation: false,
      unique: /@unique\b/.test(rest),
      default: /@default\(cuid\(\)\)/.test(rest)
        ? "cuid()"
        : /@default\(now\(\)\)/.test(rest)
          ? "now()"
          : rest.match(/@default\(([^)]*)\)/)?.[1] ?? null,
    });
  }
  return fields;
}

function blockAttributes(name: string, kind: "unique" | "index"): string[][] {
  return [...modelBody(name).matchAll(new RegExp(`@@${kind}\\(\\[([^\\]]+)\\]\\)`, "g"))].map((match) =>
    match[1].split(",").map((entry) => entry.trim()),
  );
}

function createTable(table: string): string {
  const match = sql.match(new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`));
  expect(match, `CREATE TABLE "${table}" is missing from the migration`).toBeTruthy();
  return match![1];
}

function columns(table: string): Map<string, { type: string; notNull: boolean; hasDefault: boolean; default: string | null }> {
  const body = createTable(table);
  const found = new Map<string, { type: string; notNull: boolean; hasDefault: boolean; default: string | null }>();
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    const defaultMatch = line.match(/\s+DEFAULT\s+(.*)$/);
    const withoutDefault = line.replace(/\s+DEFAULT\s+.*$/, "");
    const match = withoutDefault.match(/^"(\w+)"\s+(.+?)( NOT NULL)?$/);
    if (!match) continue; // table-level constraints start with CONSTRAINT/PRIMARY/UNIQUE
    found.set(match[1], {
      type: match[2].trim(),
      notNull: Boolean(match[3]),
      hasDefault: Boolean(defaultMatch),
      default: defaultMatch ? defaultMatch[1].trim() : null,
    });
  }
  return found;
}

function indexes(): { table: string; columns: string[]; unique: boolean }[] {
  return [...sql.matchAll(/CREATE (UNIQUE )?INDEX "[\w]+" ON "(\w+)"\(([^)]*)\);/g)].map((match) => ({
    table: match[2],
    columns: match[3].split(",").map((entry) => entry.trim().replace(/"/g, "")),
    unique: Boolean(match[1]),
  }));
}

/** The SQL default Prisma emits for a schema `@default(...)`. */
function expectedDefault(field: Field): string | null {
  if (!field.default) return null;
  if (field.default === "now()") return "CURRENT_TIMESTAMP";
  if (field.default === "cuid()") return null; // generated in the client, not in SQL
  if (field.default === "true" || field.default === "false") return field.default; // Prisma emits `DEFAULT false` lowercase
  if (field.default === "autoincrement()") return "nextval"; // not used by these models
  if (/^-?\d+(\.\d+)?$/.test(field.default)) return field.default; // numeric, unquoted
  // A string default is written `"ACTIVE"` in the schema and `'ACTIVE'` in SQL; an enum default is
  // written bare in the schema and quoted in SQL. Both arrive as the quoted form.
  return `'${field.default.replace(/^"|"$/g, "")}'`;
}

describe("points schema ⇄ migration parity", () => {
  it("creates every points table", () => {
    for (const model of POINTS_MODELS) {
      expect(sql, model).toContain(`CREATE TABLE "${model}" (`);
    }
  });

  it("creates all five enums with exactly the values the ledger and rewards rely on", () => {
    for (const [name, values] of Object.entries(POINTS_ENUMS)) {
      const match = sql.match(new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([^)]*)\\)`));
      expect(match, name).toBeTruthy();
      expect(match![1].split(",").map((entry) => entry.trim().replace(/'/g, ""))).toEqual(values);
    }
  });

  it("gives every scalar column the SQL type Prisma would emit", () => {
    for (const model of POINTS_MODELS) {
      const table = columns(model);
      for (const field of parseFields(model)) {
        if (field.isRelation) continue;
        const column = table.get(field.name);
        expect(column, `${model}.${field.name} is missing from the migration`).toBeTruthy();
        const expected = SQL_TYPE[field.type] ?? `"${field.type}"`;
        expect(column!.type.toUpperCase(), `${model}.${field.name}`).toBe(expected.toUpperCase());
      }
    }
  });

  it("matches nullability to the schema, so no required column can be written NULL", () => {
    for (const model of POINTS_MODELS) {
      const table = columns(model);
      for (const field of parseFields(model)) {
        if (field.isRelation) continue;
        const column = table.get(field.name)!;
        if (field.optional) {
          expect(column.notNull, `${model}.${field.name} is optional in the schema`).toBe(false);
        } else {
          expect(column.notNull, `${model}.${field.name} is required in the schema`).toBe(true);
        }
      }
    }
  });

  it("carries the defaults the balance maths depends on", () => {
    for (const model of POINTS_MODELS) {
      const table = columns(model);
      for (const field of parseFields(model)) {
        if (field.isRelation) continue;
        const column = table.get(field.name)!;
        const expected = expectedDefault(field);
        if (expected === null) {
          // `@default(cuid())` is filled by the client; a column with no SQL default is only
          // acceptable for those, for `@updatedAt` (which Prisma fills) and for id/createdAt.
          continue;
        }
        expect(column.default, `${model}.${field.name} default`).toBe(expected);
      }
    }
    // The two defaults the product cannot do without: a programme is OFF and has no rate until
    // an owner sets one, and a wallet starts empty.
    expect(columns("LoyaltyPointsProgramme").get("isActive")?.default).toBe("false");
    expect(columns("LoyaltyPointsProgramme").get("kesPerPoint")?.hasDefault).toBe(false);
    expect(columns("LoyaltyPointsProgramme").get("kesPerPoint")?.notNull).toBe(false);
    expect(columns("LoyaltyPointsAccount").get("availablePoints")?.default).toBe("0");
    expect(columns("LoyaltyPointsLedger").get("type")?.notNull).toBe(true);
  });

  it("creates every unique constraint the duplicate guarantees depend on", () => {
    for (const model of POINTS_MODELS) {
      const uniques = indexes().filter((index) => index.table === model && index.unique).map((index) => index.columns);
      for (const field of parseFields(model).filter((entry) => entry.unique)) {
        const present = uniques.some((cols) => cols.length === 1 && cols[0] === field.name);
        expect(present, `${model}.${field.name} @unique`).toBe(true);
      }
      for (const combo of blockAttributes(model, "unique")) {
        const present = uniques.some((cols) => cols.join(",") === combo.join(","));
        expect(present, `${model} @@unique([${combo.join(", ")}])`).toBe(true);
      }
    }

    // The four guards the whole design rests on.
    const uniqueOn = (table: string, cols: string[]) =>
      indexes().some((index) => index.table === table && index.unique && index.columns.join(",") === cols.join(","));
    expect(uniqueOn("LoyaltyPointsLedger", ["businessId", "idempotencyKey"])).toBe(true);
    expect(uniqueOn("LoyaltyPointsLedger", ["reference"])).toBe(true);
    expect(uniqueOn("LoyaltyRewardRedemption", ["businessId", "idempotencyKey"])).toBe(true);
    expect(uniqueOn("LoyaltyPointsAccount", ["cardId"])).toBe(true);
    expect(uniqueOn("LoyaltyPointsProgramme", ["businessId"])).toBe(true);
    expect(uniqueOn("LoyaltyReward", ["businessId", "title"])).toBe(true);
  });

  it("creates every index the tenant-scoped queries filter on", () => {
    for (const model of POINTS_MODELS) {
      const created = indexes().filter((index) => index.table === model).map((index) => index.columns.join(","));
      for (const combo of blockAttributes(model, "index")) {
        expect(created, `${model} @@index([${combo.join(", ")}])`).toContain(combo.join(","));
      }
    }
  });

  it("creates a cascading foreign key for every relation except the reversal, which keeps its own history", () => {
    for (const model of POINTS_MODELS) {
      for (const field of parseFields(model).filter((entry) => entry.isRelation)) {
        // A back-relation collection has no column of its own; only the owning side gets a key.
        if (!field.relationFields?.length) continue;
        const column = field.relationFields[0];
        const setNull = model === "LoyaltyPointsLedger" && column === "reversalOfId";
        const pattern = new RegExp(
          `ALTER TABLE "${model}" ADD CONSTRAINT "[\\w]+" FOREIGN KEY \\("${column}"\\) REFERENCES "${field.relationTo}"\\("id"\\) ON DELETE ${setNull ? "SET NULL" : "CASCADE"} ON UPDATE CASCADE;`,
        );
        expect(sql, `${model}.${column} → ${field.relationTo}`).toMatch(pattern);
      }
    }
  });

  it("touches no table that is not part of the points programme", () => {
    const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...POINTS_MODELS].sort());
    // Every ALTER TABLE targets a table this migration created: nothing existing is altered, so
    // the stamp-card tables are left exactly as they are.
    const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    for (const table of altered) expect(POINTS_MODELS, table).toContain(table);
  });

  it("does not touch a stamp-card table anywhere in the file", () => {
    for (const table of ["LoyaltyProgram", "LoyaltyCard", "LoyaltyStampEvent", "LoyaltyRedemption"]) {
      // `LoyaltyCard` appears only as the target of a foreign key FROM a points table, which is
      // expected; nothing here alters it.
      const creating = new RegExp(`CREATE TABLE "${table}"`);
      const altering = new RegExp(`ALTER TABLE "${table}"`);
      expect(sql, `${table} must not be created by this migration`).not.toMatch(creating);
      expect(sql, `${table} must not be altered by this migration`).not.toMatch(altering);
    }
  });

  it("is additive only — no destructive statement anywhere in the file", () => {
    const upper = sql.toUpperCase();
    for (const forbidden of ["DROP ", "TRUNCATE", "ALTER COLUMN", "DELETE FROM", 'UPDATE "']) {
      expect(upper, forbidden).not.toContain(forbidden);
    }
  });

  it("documents its rollback outside the SQL, where the migration guard allows it", () => {
    expect(sql).toContain("docs/business-hub/LOYALTY_POINTS_IMPLEMENTATION.md");
    const doc = readFileSync(path.join(root, "docs/business-hub/LOYALTY_POINTS_IMPLEMENTATION.md"), "utf8");
    expect(doc).toContain("DROP TABLE");
    for (const model of POINTS_MODELS) {
      expect(doc, `${model} rollback`).toContain(`DROP TABLE "${model}"`);
    }
  });
});
