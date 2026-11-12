#!/usr/bin/env node
/**
 * MJENGO OS / ERP ledger verification on a real PostgreSQL engine.
 *
 * WHAT THIS IS
 *   PostgreSQL 18.6 compiled to WebAssembly (@electric-sql/pglite), running in-process. It applies
 *   the repository's own migration chain — the same files `prisma migrate deploy` would run — and
 *   then exercises the ledger invariants with real SQL, real plpgsql triggers, real foreign keys
 *   and real transaction rollback.
 *
 * WHAT THIS IS NOT
 *   Not Neon, not a managed server, not the pinned native Prisma query engine, and not the
 *   application's Prisma client path. The `*-postgres` integration suites (`npm run test:db:erp`)
 *   remain BLOCKED here: they need PRISMA_TEST_DATABASE_URL plus a generated native/WASM Prisma
 *   client, and prisma download hosts are unreachable in this sandbox. Both facts are stated in
 *   docs/MJENGO_OS_VERIFICATION_2026-11-02.md; neither is reported as PASS.
 *
 * USAGE
 *   npm run verify:mjengo:pg          → human log + JSON summary on stdout
 *   exits 0 only when every check passes.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "prisma/migrations";
const checks = [];
const record = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
};

async function expectReject(label, promise, pattern) {
  try {
    await promise;
    return record(label, false, "statement was accepted but should have been refused");
  } catch (error) {
    const message = String(error?.message ?? error);
    const matches = pattern ? new RegExp(pattern, "i").test(message) : true;
    return record(label, matches, matches ? message.slice(0, 160) : `wrong refusal: ${message.slice(0, 160)}`);
  }
}

const db = new PGlite();
const server = await db.query("select version()");
console.log(`engine: ${server.rows[0].version}\n`);

// ── 1. Migration deployment + status ────────────────────────────────────────────────────────────
const present = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const history = [];
let migrationFailure = null;
for (const name of present) {
  const started = process.hrtime.bigint();
  try {
    await db.exec(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
    history.push({ name, ok: true, ms: Number(process.hrtime.bigint() - started) / 1e6 });
  } catch (error) {
    history.push({ name, ok: false, error: String(error?.message ?? error).slice(0, 400) });
    migrationFailure = { name, error: String(error?.message ?? error).slice(0, 400) };
    break;
  }
}
record(
  "migrate deploy: every migration in prisma/migrations applies in order",
  !migrationFailure,
  migrationFailure ? `${migrationFailure.name}: ${migrationFailure.error}` : `${history.length}/${present.length} applied`,
);

const mjengoMigrations = present.filter((name) => name.startsWith("20261127"));
const EXPECTED_MJENGO_MIGRATIONS = [
  "20261127000000_mjengo_os_product",
  "20261127000001_ledger_immutability",
  "20261127000002_ledger_line_integrity",
];
record(
  "migration status: every MJENGO OS migration is in the chain and applied",
  EXPECTED_MJENGO_MIGRATIONS.every(
    (name) => mjengoMigrations.includes(name) && history.some((entry) => entry.ok && entry.name === name),
  ),
  mjengoMigrations.join(", "),
);

const objects = await db.query(`
  SELECT
    (SELECT COUNT(*)::int FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
    (SELECT COUNT(*)::int FROM information_schema.views WHERE table_name = 'ErpJournalIntegrity') AS views,
    (SELECT COUNT(*)::int FROM pg_constraint WHERE conname = 'ErpJournalLine_journalId_fkey') AS line_fk
`);
record(
  "migration status: ledger triggers, integrity view and the line foreign key exist after deploy",
  objects.rows[0].triggers >= 3 && objects.rows[0].views === 1 && objects.rows[0].line_fk === 1,
  `${objects.rows[0].triggers} triggers, ${objects.rows[0].views} integrity view, ${objects.rows[0].line_fk} line FK`,
);

// The FK is added NOT VALID on purpose: new writes are enforced, historic rows are not scanned.
// Report the real state instead of implying the constraint validated the data.
const fkState = await db.query(
  `SELECT convalidated FROM pg_constraint WHERE conname = 'ErpJournalLine_journalId_fkey'`,
);
record(
  "foreign key state: ErpJournalLine_journalId_fkey is present and NOT VALID (new writes enforced, historic rows unscanned)",
  fkState.rows[0]?.convalidated === false,
  `convalidated = ${fkState.rows[0]?.convalidated}`,
);
const orphans = await db.query(
  `SELECT COUNT(*)::int AS n FROM "ErpJournalLine" l
   LEFT JOIN "ErpJournal" j ON j.id = l."journalId" WHERE j.id IS NULL`,
);
record(
  "orphan inventory: pre-existing orphaned lines counted (none can exist in a fresh database)",
  orphans.rows[0].n === 0,
  `${orphans.rows[0].n} orphaned line(s) — on a deployed database this number must be 0 before VALIDATE CONSTRAINT`,
);

// ── 2. Commercial rows: 499 / 2000 / 3000 stay distinct ─────────────────────────────────────────
await db.query(`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('u_owner', 'owner@example.test', 'x', NOW()) ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ('u_other', 'other@example.test', 'x', NOW()) ON CONFLICT DO NOTHING`);
for (const [id, owner] of [["bizA", "u_owner"], ["bizB", "u_other"]]) {
  await db.query(
    `INSERT INTO "Business" (id, name, slug, category, "ownerId", "updatedAt")
     VALUES ($1, 'Business ' || $1, 'slug-' || $1, 'Hardware', $2, NOW()) ON CONFLICT DO NOTHING`,
    [id, owner],
  );
}
await db.query(
  `INSERT INTO "PlanConfig" (id, key, name, "priceKES", "durationDays", "isActive", "updatedAt")
   VALUES ('p_pos', 'BUSINESS_POS', 'Business POS', 499, 30, true, NOW()),
          ('p_erp', 'ERP_PRO', 'JATA BOS PRO', 3000, 30, true, NOW())`,
);
await db.exec(readFileSync(join(MIGRATIONS, "20261127000000_mjengo_os_product/migration.sql"), "utf8"));
const plans = await db.query(`SELECT key, "priceKES", "durationDays" FROM "PlanConfig" ORDER BY "priceKES"`);
const planMap = Object.fromEntries(plans.rows.map((row) => [row.key, row]));
record(
  "pricing: BUSINESS_POS is KES 499 / 30 days",
  planMap.BUSINESS_POS?.priceKES === 499 && planMap.BUSINESS_POS?.durationDays === 30,
  JSON.stringify(planMap.BUSINESS_POS),
);
record(
  "pricing: MJENGO_OS is KES 2,000 / 30 days",
  planMap.MJENGO_OS?.priceKES === 2000 && planMap.MJENGO_OS?.durationDays === 30,
  JSON.stringify(planMap.MJENGO_OS),
);
record(
  "pricing: ERP_PRO is untouched at KES 3,000 / 30 days",
  planMap.ERP_PRO?.priceKES === 3000 && planMap.ERP_PRO?.durationDays === 30,
  JSON.stringify(planMap.ERP_PRO),
);

// ── 3. Journal posting: DRAFT → lines → POSTED ─────────────────────────────────────────────────
let journalSeq = 0;
async function postJournal(businessId, lines, { seal = true, description = "Verification entry" } = {}) {
  const id = `j_${++journalSeq}`;
  await db.query(
    `INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
     VALUES ($1, $2, $3, NOW(), $4, 'DRAFT', NOW())`,
    [id, businessId, `JV-${id}`, description],
  );
  let index = 0;
  for (const [accountCode, debitCents, creditCents] of lines) {
    await db.query(
      `INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
       VALUES ($1, $2, $3, $4, $4, $5, $6)`,
      [`${id}_l${++index}`, businessId, id, accountCode, debitCents, creditCents],
    );
  }
  if (seal) await db.query(`UPDATE "ErpJournal" SET status = 'POSTED', "postedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [id]);
  return id;
}

const balanced = await postJournal("bizA", [["1100", 50_000, 0], ["4100", 0, 50_000]]);
const posted = await db.query(`SELECT status FROM "ErpJournal" WHERE id = $1`, [balanced]);
const lineCount = await db.query(`SELECT COUNT(*)::int n FROM "ErpJournalLine" WHERE "journalId" = $1`, [balanced]);
record("lifecycle: DRAFT → lines → POSTED commits with both lines", posted.rows[0].status === "POSTED" && lineCount.rows[0].n === 2, `${posted.rows[0].status}, ${lineCount.rows[0].n} lines`);

// ── 4. Direct SQL mutation attempts on a POSTED journal ─────────────────────────────────────────
await expectReject(
  "immutability: INSERT a line into a POSTED journal is refused",
  db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
            VALUES ('late_line', 'bizA', $1, '1100', '1100', 1, 0)`, [balanced]),
  "immutable",
);
await expectReject(
  "immutability: UPDATE a posted line amount is refused",
  db.query(`UPDATE "ErpJournalLine" SET "debitCents" = 1 WHERE "journalId" = $1`, [balanced]),
  "immutable",
);
await expectReject(
  "immutability: DELETE a posted line is refused",
  db.query(`DELETE FROM "ErpJournalLine" WHERE "journalId" = $1`, [balanced]),
  "immutable",
);
await expectReject(
  "immutability: rewriting the description of a POSTED journal is refused",
  db.query(`UPDATE "ErpJournal" SET description = 'rewritten' WHERE id = $1`, [balanced]),
  "immutable",
);
await expectReject(
  "immutability: re-dating a POSTED journal is refused",
  db.query(`UPDATE "ErpJournal" SET "entryDate" = NOW() - INTERVAL '40 days' WHERE id = $1`, [balanced]),
  "immutable",
);
await expectReject(
  "immutability: moving a POSTED journal to another tenant is refused",
  db.query(`UPDATE "ErpJournal" SET "businessId" = 'bizB' WHERE id = $1`, [balanced]),
  "immutable",
);
await expectReject(
  "lifecycle: POSTED → DRAFT is refused",
  db.query(`UPDATE "ErpJournal" SET status = 'DRAFT' WHERE id = $1`, [balanced]),
  "cannot return",
);
await expectReject(
  "immutability: deleting a POSTED journal is refused",
  db.query(`DELETE FROM "ErpJournal" WHERE id = $1`, [balanced]),
  "cannot be deleted",
);

// ── 5. Reversal: compensating journal, then the marker on the original ─────────────────────────
const reversalId = await postJournal(
  "bizA",
  [["4100", 50_000, 0], ["1100", 0, 50_000]],
  { description: `Reversal of JV-${balanced}` },
);
await db.query(`UPDATE "ErpJournal" SET "reversedById" = $1, "updatedAt" = NOW() WHERE id = $2`, [reversalId, balanced]);
const reversalState = await db.query(
  `SELECT j."reversedById", r.status AS reversal_status, r."reversalOfId"
   FROM "ErpJournal" j JOIN "ErpJournal" r ON r.id = j."reversedById" WHERE j.id = $1`,
  [balanced],
);
record(
  "lifecycle: REVERSED marker is the one permitted write on a POSTED journal",
  reversalState.rows[0]?.reversedById === reversalId && reversalState.rows[0]?.reversal_status === "POSTED",
  `original.reversedById = ${reversalId}`,
);
// The database deliberately ALLOWS rewriting reversedById: it is the designated mutable column, and
// a trigger cannot tell a legitimate first reversal from a second one. Double reversal is therefore
// an APPLICATION invariant (reverseJournal's ALREADY_REVERSED check). Recorded as such — asserting
// it here as a database guarantee would be false.
const markerOverwrite = await db.query(
  `UPDATE "ErpJournal" SET "reversedById" = 'j_other', "updatedAt" = NOW() WHERE id = $1`,
  [balanced],
);
record(
  "database-enforced vs application-enforced: reversedById IS overwritable in the database (double reversal is blocked in lib/erp/accounting.ts, not by a trigger)",
  markerOverwrite.rowCount === 1,
  `UPDATE affected ${markerOverwrite.rowCount} row — application guard, not a DB constraint`,
);
await db.query(`UPDATE "ErpJournal" SET "reversedById" = $1, "updatedAt" = NOW() WHERE id = $2`, [reversalId, balanced]);

// ── 6. Empty / unbalanced / orphaned ──────────────────────────────────────────────────────────
const emptyId = await postJournal("bizA", [], { description: "Sealed with no lines" });
const unbalancedId = await postJournal("bizA", [["1100", 100, 0], ["4100", 0, 90]]);
const integrity = await db.query(`SELECT "journalId", "balanced", "empty", "lineCount" FROM "ErpJournalIntegrity"`);
const byId = Object.fromEntries(integrity.rows.map((row) => [row.journalId, row]));
record("integrity: a balanced posted journal is not flagged", byId[balanced]?.balanced === true && byId[balanced]?.empty === false, JSON.stringify(byId[balanced]));
record("integrity: an empty posted journal is flagged empty", byId[emptyId]?.empty === true, JSON.stringify(byId[emptyId]));
record("integrity: an unbalanced posted journal is flagged unbalanced", byId[unbalancedId]?.balanced === false, JSON.stringify(byId[unbalancedId]));
await expectReject(
  "integrity: a line cannot be orphaned — the foreign key refuses a missing journal",
  db.query(`INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
            VALUES ('orphan', 'bizA', 'does_not_exist', '1100', '1100', 1, 0)`),
  "foreign key|violates",
);

// ── 6b. VALIDATE CONSTRAINT after repair ─────────────────────────────────────────────────────
// The migration ships NOT VALID; this proves the documented validation step actually succeeds once
// the data is clean, so the runbook is executable rather than aspirational.
let validated = false;
try {
  await db.exec(`ALTER TABLE "ErpJournalLine" VALIDATE CONSTRAINT "ErpJournalLine_journalId_fkey";`);
  const after = await db.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'ErpJournalLine_journalId_fkey'`);
  validated = after.rows[0]?.convalidated === true;
} catch (error) {
  record("foreign key validation: VALIDATE CONSTRAINT succeeds on clean data", false, String(error?.message ?? error).slice(0, 200));
}
if (validated) {
  record(
    "foreign key validation: VALIDATE CONSTRAINT succeeds on clean data and flips convalidated to true",
    true,
    "convalidated = true after the documented repair-then-validate step",
  );
}

// ── 7. Rollback / atomicity ───────────────────────────────────────────────────────────────────
await expectReject(
  "atomicity: a refused line write rolls the whole journal transaction back",
  db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, status, "updatedAt")
       VALUES ('j_half', 'bizA', 'JV-j_half', NOW(), 'Half written', 'POSTED', NOW())`,
    );
    await tx.query(
      `INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId", "debitCents", "creditCents")
       VALUES ('j_half_l1', 'bizA', 'j_half', '1100', '1100', 100, 0)`,
    );
  }),
  "immutable",
);
const half = await db.query(`SELECT COUNT(*)::int n FROM "ErpJournal" WHERE id = 'j_half'`);
record("atomicity: nothing from the failed transaction survives", half.rows[0].n === 0, `${half.rows[0].n} rows`);

// ── 8. Tenant isolation at the data boundary ─────────────────────────────────────────────────
const otherTenant = await postJournal("bizB", [["1100", 10, 0], ["4100", 0, 10]]);
const scoped = await db.query(`SELECT id FROM "ErpJournal" WHERE "businessId" = 'bizA' AND id = $1`, [otherTenant]);
record("tenancy: a tenant-scoped read cannot see another tenant's journal", scoped.rows.length === 0, `${scoped.rows.length} rows for bizA`);
const own = await db.query(`SELECT id FROM "ErpJournal" WHERE "businessId" = 'bizB' AND id = $1`, [otherTenant]);
record("tenancy: the owning tenant can read its own journal", own.rows.length === 1, `${own.rows.length} row`);

// ── 9. Product separation (existing POS subscriber gains nothing) ─────────────────────────────
await db.query(
  `INSERT INTO "PosSubscription" (id, "businessId", "userId", "planId", "planKey", status, "updatedAt")
   VALUES ('sub_pos', 'bizA', 'u_owner', 'p_pos', 'BUSINESS_POS', 'ACTIVE', NOW())`,
).catch((error) => record("separation: POS subscription row insertable", false, String(error.message).slice(0, 160)));
const erpPro = await db.query(
  `INSERT INTO "ErpProSubscription" (id, "businessId", "userId", "planId", "planKey", status, "updatedAt")
   VALUES ('sub_erp_pro', 'bizA', 'u_owner', 'p_erp', 'ERP_PRO', 'ACTIVE', NOW())
   RETURNING status`,
);
const mjengoEntitlement = await db.query(
  `SELECT status, "packageKey" FROM "MjengoEntitlement" WHERE "businessId" = 'bizA'`,
);
const posEntitlement = await db.query(
  `SELECT status FROM "PosEntitlement" WHERE "businessId" = 'bizA'`,
);
record(
  "separation: an ACTIVE BUSINESS_POS subscription creates no MJENGO_OS entitlement",
  mjengoEntitlement.rows.length === 0,
  `ERP PRO rows: ${erpPro.rows.length}; MJENGO rows for bizA: ${mjengoEntitlement.rows.length}; POS entitlement rows: ${posEntitlement.rows.length}`,
);

// ── Summary ──────────────────────────────────────────────────────────────────────────────────
await db.close();
const failed = checks.filter((check) => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nfailed checks:");
  for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
}
console.log(`\n${JSON.stringify({ engine: server.rows[0].version, migrations: present.length, checks }, null, 1)}`);
process.exit(failed.length ? 1 : 0);
