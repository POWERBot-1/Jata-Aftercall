/**
 * Business Hub — schema ⇄ migration parity.
 *
 * `prisma migrate diff` needs the schema-engine binary, which cannot be downloaded in this
 * workspace, so the equivalence between `prisma/schema.prisma` and the hand-written migration is
 * asserted here instead: every hub model, column, nullability, unique index, index and foreign key
 * declared in the schema must exist in the SQL, with the SQL type Prisma would emit.
 *
 * If this test and the SQL ever disagree, the migration is wrong — not the test.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const migrationDir = path.join(root, "prisma/migrations/20261128000000_business_hub_conversion");
const sql = readFileSync(path.join(migrationDir, "migration.sql"), "utf8");

const HUB_MODELS = [
  "OrderRequest",
  "OrderRequestItem",
  "CustomerEnquiry",
  "Promotion",
  "LoyaltyProgram",
  "LoyaltyCard",
  "LoyaltyStampEvent",
  "LoyaltyRedemption",
  "BusinessHubActivity",
];

const HUB_ENUMS: Record<string, string[]> = {
  OrderRequestStatus: ["NEW", "REVIEWING", "CONFIRMED", "DECLINED", "COMPLETED", "CANCELLED"],
  CustomerEnquiryStatus: ["NEW", "REVIEWING", "CONTACTED", "CLOSED", "DECLINED"],
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
  id: boolean;
  relationFields?: string[];
  relationTo?: string;
};

function modelBody(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match, `model ${name} is missing from schema.prisma`).toBeTruthy();
  return match![1];
}

function parseFields(name: string): Field[] {
  const known = new Set([...HUB_MODELS, "Business", "Product", "User", "LoyaltyProgram", "LoyaltyCard", "OrderRequest"]);
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
        id: false,
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
      id: /@id\b/.test(rest),
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

function columns(table: string): Map<string, { type: string; notNull: boolean }> {
  const body = createTable(table);
  const found = new Map<string, { type: string; notNull: boolean }>();
  for (const raw of body.split("\n")) {
    // Strip the trailing comma and any DEFAULT clause first, so NOT NULL stays adjacent to the
    // type it qualifies: Prisma emits `"col" TYPE NOT NULL DEFAULT '…',`.
    const line = raw.trim().replace(/,$/, "").replace(/\s+DEFAULT\s+.*$/, "");
    const match = line.match(/^"(\w+)"\s+(.+?)( NOT NULL)?$/);
    if (!match) continue; // table-level constraints start with CONSTRAINT/PRIMARY/UNIQUE
    found.set(match[1], { type: match[2].trim(), notNull: Boolean(match[3]) });
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

function tableConstraints(table: string): string[] {
  return [...createTable(table).matchAll(/CONSTRAINT[^\n]+|UNIQUE \([^\n]+\)|PRIMARY KEY \([^\n]+\)/g)].map((match) => match[0]);
}

describe("hub schema ⇄ migration parity", () => {
  it("creates every hub table", () => {
    for (const model of HUB_MODELS) {
      expect(sql, model).toContain(`CREATE TABLE "${model}" (`);
    }
  });

  it("creates both enums with exactly the documented values", () => {
    for (const [name, values] of Object.entries(HUB_ENUMS)) {
      const match = sql.match(new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([^)]*)\\)`));
      expect(match, name).toBeTruthy();
      expect(match![1].split(",").map((entry) => entry.trim().replace(/'/g, ""))).toEqual(values);
    }
  });

  it("gives every scalar column the SQL type Prisma would emit", () => {
    for (const model of HUB_MODELS) {
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
    for (const model of HUB_MODELS) {
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

  it("creates every unique constraint the duplicate guarantees depend on", () => {
    for (const model of HUB_MODELS) {
      const uniques = indexes().filter((index) => index.table === model && index.unique).map((index) => index.columns);
      const inline = tableConstraints(model).filter((constraint) => constraint.startsWith("UNIQUE"));

      for (const field of parseFields(model).filter((entry) => entry.unique)) {
        const present = uniques.some((cols) => cols.length === 1 && cols[0] === field.name) ||
          inline.some((constraint) => constraint === `UNIQUE ("${field.name}")`);
        expect(present, `${model}.${field.name} @unique`).toBe(true);
      }

      for (const combo of blockAttributes(model, "unique")) {
        const present = uniques.some((cols) => cols.join(",") === combo.join(",")) ||
          inline.some((constraint) => constraint === `UNIQUE (${combo.map((entry) => `"${entry}"`).join(", ")})`);
        expect(present, `${model} @@unique([${combo.join(", ")}])`).toBe(true);
      }
    }
  });

  it("creates every index the tenant-scoped queries filter on", () => {
    for (const model of HUB_MODELS) {
      const created = indexes().filter((index) => index.table === model).map((index) => index.columns.join(","));
      for (const combo of blockAttributes(model, "index")) {
        expect(created, `${model} @@index([${combo.join(", ")}])`).toContain(combo.join(","));
      }
    }
  });

  it("creates a cascading foreign key for every relation", () => {
    for (const model of HUB_MODELS) {
      for (const field of parseFields(model).filter((entry) => entry.isRelation)) {
        const pattern = new RegExp(
          `ALTER TABLE "${model}" ADD CONSTRAINT "[\\w]+" FOREIGN KEY \\("${field.relationFields![0]}"\\) REFERENCES "${field.relationTo}"\\("id"\\) ON DELETE CASCADE ON UPDATE CASCADE;`,
        );
        expect(sql, `${model}.${field.relationFields![0]} → ${field.relationTo}`).toMatch(pattern);
      }
    }
  });

  it("touches no table that is not part of the hub", () => {
    const created = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([...HUB_MODELS].sort());
    const altered = [...sql.matchAll(/ALTER TABLE "(\w+)"/g)].map((match) => match[1]);
    for (const table of altered) expect(HUB_MODELS, table).toContain(table);
  });

  it("is additive only — no destructive statement anywhere in the file", () => {
    const upper = sql.toUpperCase();
    for (const forbidden of ["DROP ", "TRUNCATE", "ALTER COLUMN", "DELETE FROM", 'UPDATE "']) {
      expect(upper, forbidden).not.toContain(forbidden);
    }
  });

  it("documents its rollback outside the SQL, where the migration guard allows it", () => {
    expect(sql).toContain("docs/business-hub/BUSINESS_HUB_IMPLEMENTATION.md");
    expect(readFileSync(path.join(root, "docs/business-hub/BUSINESS_HUB_IMPLEMENTATION.md"), "utf8")).toContain("DROP TABLE");
  });
});
