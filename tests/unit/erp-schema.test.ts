/**
 * Schema and migration consistency for POS / ERP - PRO.
 *
 * The sandbox cannot run `prisma migrate deploy` (no database) and cannot run `prisma validate`
 * (no engine binary), so this test is the substitute: it reads the committed schema and SQL and
 * checks the properties the application actually depends on — additive-only migration, tenant
 * scoping, money in integer cents, and every unique index the code relies on.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261027000000_pos_erp_pro/migration.sql", "utf8");

const ERP_MODELS = [
  "ErpConfiguration",
  "ErpSubscription",
  "ErpEntitlement",
  "ErpSequence",
  "ErpAuditEvent",
  "ErpIdempotencyRecord",
  "ErpAccount",
  "ErpPeriod",
  "ErpJournal",
  "ErpJournalLine",
  "ErpInvoice",
  "ErpInvoiceLine",
  "ErpPayment",
  "ErpPaymentAllocation",
  "ErpCreditNote",
  "ErpExpense",
  "ErpSupplierBill",
  "ErpTaxRule",
  "ErpComplianceProfile",
  "ErpStoreOrder",
  "ErpStoreOrderItem",
  "ErpNotification",
  "ErpAutomationRule",
  "ErpAutomationRun",
  "ErpKycDocument",
  "MsgChannelConnection",
  "MsgSenderId",
  "MsgSenderIdEvent",
  "MsgContact",
  "MsgConsentRecord",
  "MsgSuppression",
  "MsgAudience",
  "MsgTemplate",
  "MsgCampaign",
  "MsgCampaignRecipient",
  "MsgMessageEvent",
  "MsgWallet",
  "MsgLedgerEntry",
];

function modelBody(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Model ${name} is missing from prisma/schema.prisma`);
  return match[1];
}

/** Strip SQL comments so a rollback note that mentions DROP TABLE is not read as a destructive statement. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

describe("schema", () => {
  it("declares every POS / ERP - PRO model", () => {
    for (const name of ERP_MODELS) {
      expect(schema).toContain(`model ${name} {`);
    }
  });

  it("keeps every ERP model tenant-scoped by businessId", () => {
    for (const name of ERP_MODELS) {
      const body = modelBody(name);
      expect(body, `${name} must carry businessId`).toMatch(/businessId\s+String/);
    }
  });

  it("stores money as integer cents, never floats", () => {
    const moneyFields = schema.match(/^\s+\w*Cents\s+\w+/gm) ?? [];
    expect(moneyFields.length).toBeGreaterThan(20);
    expect(moneyFields.every((line) => /Int\b/.test(line))).toBe(true);
    expect(schema).not.toMatch(/\w*Cents\s+Float/);
  });

  it("keeps the existing POS models untouched", () => {
    for (const name of ["PosConfiguration", "PosProduct", "PosSale", "PosInventoryItem", "PosSubscription"]) {
      expect(schema).toContain(`model ${name} {`);
    }
  });

  it("does not change any existing table's columns in the migration", () => {
    const sql = withoutComments(migration);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).not.toMatch(/TRUNCATE/i);
    // The only ALTERs are guarded foreign keys on tables this migration creates.
    const alteredTables = [...sql.matchAll(/ALTER TABLE\s+"(\w+)"/g)].map((match) => match[1]);
    expect(alteredTables.every((table) => ERP_MODELS.includes(table))).toBe(true);
    expect(sql).not.toMatch(/ADD COLUMN/i);
  });
});

describe("migration", () => {
  it("creates a table for every model, idempotently", () => {
    for (const name of ERP_MODELS) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS "${name}"`);
    }
  });

  it("creates the unique indexes the application's findUnique calls depend on", () => {
    const required = [
      "ErpConfiguration_businessId_key",
      "ErpConfiguration_storefrontSlug_key",
      "ErpSubscription_businessId_key",
      "ErpEntitlement_businessId_key",
      "ErpComplianceProfile_businessId_key",
      "ErpStoreOrder_publicToken_key",
      "ErpStoreOrder_businessId_orderNumber_key",
      "ErpStoreOrder_businessId_idempotencyKey_key",
      "MsgWallet_businessId_key",
      "MsgContact_businessId_phoneNormalized_key",
      "MsgCampaignRecipient_campaignId_phoneNormalized_key",
      "MsgMessageEvent_dedupeKey_key",
      "MsgChannelConnection_businessId_channel_key",
      "ErpAccount_businessId_code_key",
      "ErpSequence_businessId_key_key",
      "ErpInvoice_businessId_idempotencyKey_key",
      "ErpPayment_businessId_idempotencyKey_key",
      "ErpJournal_businessId_journalNumber_key",
    ];
    for (const index of required) {
      expect(migration, `missing ${index}`).toContain(`"${index}"`);
    }
  });

  it("cascades every tenant foreign key from Business", () => {
    const constraints = migration.match(/REFERENCES "Business"\("id"\) ON DELETE CASCADE/g) ?? [];
    expect(constraints.length).toBeGreaterThanOrEqual(ERP_MODELS.length - 4);
  });

  it("keeps the campaign test-send columns inside the new table definition", () => {
    // The old `MsgCampaign` ALTERs were folded into the CREATE TABLE, so the whole file is now
    // CREATE TABLE / CREATE INDEX / guarded foreign keys and nothing else.
    const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS "MsgCampaign"`);
    const create = migration.slice(start, migration.indexOf(");", start));
    expect(create).toContain(`"testSentAt" TIMESTAMP(3)`);
    expect(create).toContain(`"testSentTo" TEXT`);
  });

  it("contains no credentials or connection strings", () => {
    expect(migration).not.toMatch(/postgres(ql)?:\/\//i);
    expect(migration).not.toMatch(/password/i);
  });
});

describe("offline Prisma fallback", () => {
  const dbSource = readFileSync("lib/db.ts", "utf8");

  function camel(name: string): string {
    return name.charAt(0).toLowerCase() + name.slice(1);
  }

  it("stubs every model the ERP and messaging code touches", () => {
    // `npx prisma generate` cannot run in this sandbox, so lib/db.ts carries an explicit fallback
    // object. A model missing from it is a runtime 500 that TypeScript cannot see.
    const missing = ERP_MODELS.filter((name) => !dbSource.includes(`${camel(name)}:`));
    expect(missing).toEqual([]);
  });

  it("refuses writes in the fallback instead of pretending they succeeded", () => {
    const stub = dbSource.slice(dbSource.indexOf("const emptyModel"), dbSource.indexOf("$transaction"));
    for (const method of ["create", "update", "upsert", "delete"]) {
      expect(stub).toContain(`${method}: async () => { throw new Error("DB not available (fallback)"); }`);
    }
  });
});

describe("model references", () => {
  const schemaModels = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]);

  it("only calls Prisma models that exist in the schema", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk("lib/erp");
    walk("lib/messaging");

    const referenced = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:client|tx|db|prisma)\.([a-z][A-Za-z0-9]*)\s*\.\s*(?:find|create|update|upsert|delete|count|groupBy|aggregate)/g)) {
        referenced.add(match[1]);
      }
    }
    const unknown = [...referenced].filter((name) => !schemaModels.some((model) => model.charAt(0).toLowerCase() + model.slice(1) === name));
    expect(unknown).toEqual([]);
  });
});
