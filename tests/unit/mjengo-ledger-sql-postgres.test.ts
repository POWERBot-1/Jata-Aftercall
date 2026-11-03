/**
 * Ledger immutability, executed on a real PostgreSQL engine.
 *
 * This runs `prisma/migrations/20261127000001_ledger_immutability/migration.sql` verbatim against
 * PostgreSQL (the WASM build, @electric-sql/pglite) — the same parser, plpgsql runtime and trigger
 * machinery a server uses. It is NOT Neon, a managed server, or the pinned native Prisma engine, so
 * it is stronger evidence than a mock and weaker than the blocked `*-postgres` suites; the report
 * says exactly that.
 *
 * The suite is skipped (not silently passed) when pglite is not installed, and
 * `npm run test:mjengo:ledger-sql` installs nothing — see docs/MJENGO_OS_VERIFICATION_2026-11-02.md.
 *
 * The schema is the repository's own: the baseline migration, the POS/ERP PRO migration that
 * creates ErpJournal/ErpJournalLine/PlanConfig, and then the MJENGO OS migrations under test. No
 * table is hand-written for the test, so the trigger bodies meet the real column set — including
 * `ErpPeriod`, which `assertPeriodOpen` needs and a synthetic table would have missed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/20261127000001_ledger_immutability/migration.sql");
const planMigrationPath = path.join(process.cwd(), "prisma/migrations/20261127000000_mjengo_os_product/migration.sql");
const pgliteEntry = path.join(process.cwd(), "node_modules/@electric-sql/pglite/dist/index.js");
const available = existsSync(pgliteEntry);

const BASELINE = [
  "prisma/migrations/20250915000000_init/migration.sql",
  "prisma/migrations/20261027000000_pos_erp_pro/migration.sql",
];
const LEDGER_MIGRATION = "prisma/migrations/20261127000001_ledger_immutability/migration.sql";

/** A business row is required because ErpJournal.businessId is a foreign key to Business. */
async function seedBusiness(db: any, id = "bizA") {
  await db.query(
    `INSERT INTO "User" (id, email, "passwordHash", "createdAt", "updatedAt")
     VALUES ('userA', 'owner@example.test', 'x', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO "Business" (id, name, slug, category, "ownerId", "createdAt", "updatedAt")
     VALUES ($1, 'Test Business', $2, 'Hardware', 'userA', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, `slug-${id}`],
  );
}

async function freshDb() {
  // Resolved by path so the test does not need the package's types, and so a missing install
  // degrades to a skip instead of a build failure.
  const { PGlite } = await import(path.join(process.cwd(), "node_modules/@electric-sql/pglite/dist/index.js"));
  const db = new PGlite();
  for (const file of BASELINE) await db.exec(readFileSync(path.join(process.cwd(), file), "utf8"));
  await db.exec(readFileSync(path.join(process.cwd(), LEDGER_MIGRATION), "utf8"));
  await seedBusiness(db, "bizA");
  await seedBusiness(db, "bizB");
  return db;
}

async function postJournal(db: any, id: string, lines: Array<[string, number, number]>) {
  // Exactly the production order: create DRAFT, write lines, then seal POSTED.
  await db.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                  VALUES ($1, 'bizA', $2, NOW(), 'Test entry', 'DRAFT', NOW())`, [id, `JV-${id}`]);
  for (const [accountCode, debitCents, creditCents] of lines) {
    await db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                    VALUES ($1, 'bizA', $2, $3, $3, $4, $5)`, [`${id}-${accountCode}-${debitCents}`, id, accountCode, debitCents, creditCents]);
  }
  await db.query(`UPDATE "ErpJournal" SET status = 'POSTED', "postedAt" = NOW() WHERE id = $1`, [id]);
}

describe.skipIf(!available)("mjengo: ledger immutability on real PostgreSQL (wasm)", () => {
  it("accepts the production write order: DRAFT → lines → POSTED", async () => {
    const db = await freshDb();
    await postJournal(db, "j1", [["1100", 50_000, 0], ["4100", 0, 50_000]]);
    const { rows } = await db.query(`SELECT status FROM "ErpJournal" WHERE id = 'j1'`);
    expect(rows[0].status).toBe("POSTED");
    const lines = await db.query(`SELECT COUNT(*)::int AS n FROM "ErpJournalLine" WHERE "journalId" = 'j1'`);
    expect(lines.rows[0].n).toBe(2);
    await db.close();
  });

  it("refuses to insert a line into a POSTED journal", async () => {
    const db = await freshDb();
    await postJournal(db, "j1", [["1100", 100, 0], ["4100", 0, 100]]);
    await expect(
      db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                VALUES ('late', 'bizA', 'j1', '1100', '1100', 5, 0)`),
    ).rejects.toThrow(/immutable/);
    await db.close();
  });

  it("refuses to UPDATE or DELETE a line of a POSTED journal", async () => {
    const db = await freshDb();
    await postJournal(db, "j1", [["1100", 100, 0], ["4100", 0, 100]]);
    await expect(db.query(`UPDATE "ErpJournalLine" SET "debitCents" = 1 WHERE "journalId" = 'j1'`)).rejects.toThrow(/immutable/);
    await expect(db.query(`DELETE FROM "ErpJournalLine" WHERE "journalId" = 'j1'`)).rejects.toThrow(/immutable/);
    await db.close();
  });

  it("allows DRAFT lines to be edited, then seals them", async () => {
    const db = await freshDb();
    await db.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                    VALUES ('j2', 'bizA', 'JV-j2', NOW(), 'Draft', 'DRAFT', NOW())`);
    await db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                    VALUES ('l1', 'bizA', 'j2', '1100', '1100', 100, 0)`);
    await db.query(`UPDATE "ErpJournalLine" SET "debitCents" = 200 WHERE id = 'l1'`);
    await db.query(`DELETE FROM "ErpJournalLine" WHERE id = 'l1'`);
    await db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                    VALUES ('l2', 'bizA', 'j2', '1100', '1100', 100, 0)`);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "ErpJournalLine" WHERE "journalId" = 'j2'`);
    expect(rows[0].n).toBe(1);
    await db.close();
  });

  it("keeps a POSTED header immutable but allows the reversal marker", async () => {
    const db = await freshDb();
    await postJournal(db, "j1", [["1100", 100, 0], ["4100", 0, 100]]);
    // Identity fields cannot move.
    await expect(db.query(`UPDATE "ErpJournal" SET description = 'rewritten' WHERE id = 'j1'`)).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE "ErpJournal" SET "entryDate" = NOW() - INTERVAL '30 days' WHERE id = 'j1'`)).rejects.toThrow(/immutable/);
    await expect(db.query(`UPDATE "ErpJournal" SET "businessId" = 'bizB' WHERE id = 'j1'`)).rejects.toThrow(/immutable/);
    // POSTED cannot silently return to DRAFT.
    await expect(db.query(`UPDATE "ErpJournal" SET status = 'DRAFT' WHERE id = 'j1'`)).rejects.toThrow(/cannot return/);
    // The reversal marker is the one permitted write (reverseJournal sets reversedById).
    await db.query(`UPDATE "ErpJournal" SET "reversedById" = 'j9' WHERE id = 'j1'`);
    const { rows } = await db.query(`SELECT "reversedById" FROM "ErpJournal" WHERE id = 'j1'`);
    expect(rows[0].reversedById).toBe("j9");
    await db.close();
  });

  it("refuses to delete a POSTED journal or a DRAFT journal that still has lines", async () => {
    const db = await freshDb();
    await postJournal(db, "j1", [["1100", 100, 0], ["4100", 0, 100]]);
    await expect(db.query(`DELETE FROM "ErpJournal" WHERE id = 'j1'`)).rejects.toThrow(/cannot be deleted/);

    await db.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                    VALUES ('j3', 'bizA', 'JV-j3', NOW(), 'Draft with lines', 'DRAFT', NOW())`);
    await db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                    VALUES ('l3', 'bizA', 'j3', '1100', '1100', 100, 0)`);
    await expect(db.query(`DELETE FROM "ErpJournal" WHERE id = 'j3'`)).rejects.toThrow(/still has lines/);

    // An empty draft is disposable, which is what a discarded entry needs.
    await db.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                    VALUES ('j4', 'bizA', 'JV-j4', NOW(), 'Empty draft', 'DRAFT', NOW())`);
    await db.query(`DELETE FROM "ErpJournal" WHERE id = 'j4'`);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "ErpJournal" WHERE id = 'j4'`);
    expect(rows[0].n).toBe(0);
    await db.close();
  });

  it("rolls the whole transaction back when a line write is refused", async () => {
    const db = await freshDb();
    // Models postJournalTx failing mid-write: the journal row and its earlier lines must not survive.
    // `db.transaction` issues BEGIN, runs the callback, and ROLLBACKs when it throws — the client
    // must not be left in an aborted transaction block, which is itself a production hazard.
    await expect(
      db.transaction(async (tx: any) => {
        await tx.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                        VALUES ('j5', 'bizA', 'JV-j5', NOW(), 'Half-written', 'POSTED', NOW())`);
        // Refused by the trigger: a line cannot be written into an already-POSTED journal.
        await tx.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
                        VALUES ('l5', 'bizA', 'j5', '1100', '1100', 100, 0)`);
      }),
    ).rejects.toThrow(/immutable/);
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "ErpJournal" WHERE id = 'j5'`);
    expect(rows[0].n).toBe(0);
    await db.close();
  });

  it("flags empty and unbalanced posted journals and stays quiet for balanced ones", async () => {
    const db = await freshDb();
    // Balanced.
    await postJournal(db, "ok", [["1100", 100, 0], ["4100", 0, 100]]);
    // Unbalanced: seal a journal whose lines do not match.
    await postJournal(db, "bad", [["1100", 100, 0], ["4100", 0, 90]]);
    // Empty: sealed with no lines at all (must be written as DRAFT then sealed).
    await db.query(`INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
                    VALUES ('empty', 'bizA', 'JV-empty', NOW(), 'Sealed empty', 'DRAFT', NOW())`);
    await db.query(`UPDATE "ErpJournal" SET status = 'POSTED' WHERE id = 'empty'`);

    const { rows } = await db.query(`SELECT "journalId", "balanced", "empty", "lineCount" FROM "ErpJournalIntegrity" ORDER BY "journalId"`);
    const byId = new Map(rows.map((row: any) => [row.journalId, row]));
    expect(byId.get("ok")).toMatchObject({ balanced: true, empty: false, lineCount: 2 });
    expect(byId.get("bad")).toMatchObject({ balanced: false, empty: false, lineCount: 2 });
    expect(byId.get("empty")).toMatchObject({ balanced: false, empty: true, lineCount: 0 });

    const anomalies = await db.query(
      `SELECT COUNT(*)::int AS n FROM "ErpJournalIntegrity" WHERE "businessId" = 'bizA' AND ("balanced" = false OR "empty" = true)`,
    );
    expect(anomalies.rows[0].n).toBe(2);
    await db.close();
  });

  it("applies the MJENGO_OS plan migration twice without duplicating or rewriting other plans", async () => {
    const db = await freshDb();
    await db.query(`INSERT INTO "PlanConfig" (id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
                    VALUES ('p_pos', 'BUSINESS_POS', 'Business POS', 499, 30, true, NOW(), NOW()),
                           ('p_erp', 'ERP_PRO', 'JATA BOS PRO', 3000, 30, true, NOW(), NOW())
                    ON CONFLICT (key) DO NOTHING`);
    const sql = readFileSync(planMigrationPath, "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotent re-run, as a repeated deploy would
    const { rows } = await db.query(`SELECT key, "priceKES", "durationDays", "isActive" FROM "PlanConfig" ORDER BY key`);
    expect(rows).toEqual([
      { key: "BUSINESS_POS", priceKES: 499, durationDays: 30, isActive: true },
      { key: "ERP_PRO", priceKES: 3000, durationDays: 30, isActive: true },
      { key: "MJENGO_OS", priceKES: 2000, durationDays: 30, isActive: true },
    ]);
    await db.close();
  });

  it("does not let a later MJENGO_OS upsert touch another plan row", async () => {
    const db = await freshDb();
    await db.query(`INSERT INTO "PlanConfig" (id, key, name, "priceKES", "durationDays", "isActive", "createdAt", "updatedAt")
                    VALUES ('p_pos', 'BUSINESS_POS', 'Business POS', 499, 30, true, NOW(), NOW())
                    ON CONFLICT (key) DO NOTHING`);
    // The conflict path is keyed on 'MJENGO_OS'; a conflicting row can only be that row.
    await db.exec(readFileSync(planMigrationPath, "utf8"));
    await db.exec(readFileSync(planMigrationPath, "utf8"));
    const { rows } = await db.query(`SELECT "priceKES" FROM "PlanConfig" WHERE key = 'BUSINESS_POS'`);
    expect(rows[0].priceKES).toBe(499);
    await db.close();
  });
});

describe.skipIf(available)("mjengo: ledger immutability on real PostgreSQL (wasm)", () => {
  it("is skipped: @electric-sql/pglite is not installed in this environment", () => {
    // Recorded as NOT TESTED in the report; never reported as PASS.
    expect(available).toBe(false);
  });
});
