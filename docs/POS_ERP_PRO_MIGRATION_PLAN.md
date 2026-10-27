# POS / ERP - PRO — migration, upgrade and rollback plan

Status: **the migration has been executed and verified against a disposable PostgreSQL 16.2
database.** Clean install, upgrade from the previous release, rollback and recovery all pass; see
[`POS_ERP_PRO_EVIDENCE.md`](./POS_ERP_PRO_EVIDENCE.md) for the command output and the exact test
counts. It has **not** been applied to any production or shared database, and no production
credentials or data were used.

## What the migration is

One additive migration: `prisma/migrations/20261027000000_pos_erp_pro/migration.sql`.

| Property | Value | Verified |
| --- | --- | --- |
| New tables | 38 | `scripts/erp/migration-verify.sh clean` → 38 |
| New indexes | 136 (72 unique, 64 plain) | 174 `pg_indexes` rows on the ERP tables, incl. primary keys |
| New foreign keys | 38, every one `REFERENCES "Business"("id") ON DELETE CASCADE` | 38 in `information_schema` |
| Tables altered | **0** | 74 pre-existing tables still present, no `ALTER TABLE` in the file |
| Columns dropped or retyped | **0** | `grep -c 'ALTER COLUMN'` = 0 |
| Rows updated or deleted | **0** | upgrade-path row counts unchanged |
| Historical migrations edited | **0** | 15 earlier migrations applied unchanged before it |

The existing Business POS tables (`Pos*`), the commerce tables, the payment wallet and the Website
Studio tables are untouched. The ERP reads `PosProduct` and `PosInventoryItem` through the existing
tenancy checks rather than copying the catalogue, so there is one price list and one stock ledger.

Every statement is one of:

```sql
CREATE TABLE IF NOT EXISTS "ErpAccount" ( ... );
CREATE UNIQUE INDEX IF NOT EXISTS "ErpAccount_businessId_code_key" ON "ErpAccount"("businessId", "code");
DO $$ BEGIN
    ALTER TABLE "ErpAccount" ADD CONSTRAINT "ErpAccount_businessId_fkey"
        FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

`IF NOT EXISTS` plus the guarded exception make the file re-runnable. That matters because a partial
failure in a hosted migration runner must not need a manual cleanup before the next attempt. The
`clean` scenario re-runs the migration over itself and expects success.

## Money and identifiers

* All amounts are `INTEGER` cents. No `FLOAT`, no `DOUBLE PRECISION` for money, no `DECIMAL`
  formatting drift.
* Quantities stay `DOUBLE PRECISION` to match the existing POS quantity promotion.
* Every business-scoped table carries `businessId` **and** at least one index whose first column is
  `businessId`, so a tenant query cannot scan another tenant's rows by accident.
* Human-facing numbers (`INV-000001`, `JV-000001`, `ORD-000001`) come from `ErpSequence`, which is
  unique per `(businessId, key)`, so two tenants never share a receipt number.

## One configuration, one wallet, one slug

These unique indexes are load-bearing and are asserted by `tests/unit/erp-schema.test.ts`:

| Index | Why |
| --- | --- |
| `ErpConfiguration_businessId_key` | `findUnique({ where: { businessId } })` is used by every loader and the access layer |
| `ErpConfiguration_storefrontSlug_key` | two businesses cannot claim the same public shop address |
| `ErpSubscription_businessId_key`, `ErpEntitlement_businessId_key` | one subscription and one entitlement per tenant |
| `ErpComplianceProfile_businessId_key` | one tax profile per tenant |
| `MsgWallet_businessId_key` | wallet credit is decremented with a compare-and-set on one row |
| `ErpStoreOrder_publicToken_key` | the customer's order page is looked up by token alone |
| `ErpJournal_businessId_journalNumber_key` | journal numbers are per tenant and must not repeat |

## Apply

```bash
# 1. Back up first. The migration is additive, but a backup is what makes "additive" verifiable.
pg_dump "$DATABASE_URL" --format=custom --file=pre_erp_pro_$(date +%Y%m%d).dump

# 2. Generate the client.
npx prisma generate

# 3. Apply. `migrate deploy` only runs migrations that are not already in _prisma_migrations.
npx prisma migrate deploy

# 4. Prove it landed, without trusting the tool that ran it.
psql "$DATABASE_URL" -c "select count(*) from information_schema.tables where (table_name like 'Erp%' or table_name like 'Msg%');"
# expect 38

# 5. Prove the existing product still works.
npx vitest run
```

Expected `information_schema` count is 38 new tables. A deployment that already has a `Msg*` or
`Erp*` table from an earlier experiment will not break the run because every `CREATE` is guarded —
but the count check would then be a false positive, so compare against the exact table list in
`tests/unit/erp-schema.test.ts` rather than the number alone.

## Verification performed (disposable database)

```bash
# A disposable PostgreSQL 16.2 cluster was started from the pgserver wheel (no Docker, no root).
DATABASE_URL=postgresql://jata@127.0.0.1:5433/jata_test?schema=public \
  bash scripts/erp/migration-verify.sh all
```

The script runs three scenarios and prints one `PASS`/`FAIL` line per check:

1. **clean install** — empty `public` schema → 16 migrations → 38 ERP tables, 74 pre-existing
   tables, 38 ERP foreign keys, every table named in the migration present, migration re-runnable.
2. **upgrade path** — 15 migrations up to `20261010000200_checkout_idempotency`, one user, one
   business and one POS product inserted, then the ERP migration: 38 tables added, existing rows
   untouched, no rows created or duplicated.
3. **rollback and recovery** — ERP data exported with `pg_dump` (38 tables), restored into a scratch
   database and row counts compared, all 38 ERP tables dropped one at a time in the documented
   reverse-dependency order with `RESTRICT` (so a wrong order fails loudly), the 74 pre-existing
   tables and their rows still present, then the ERP migration re-applied and 38 tables back.

`prisma migrate deploy` was also run against a freshly created database by the CI workflow
(`.github/workflows/pos-erp-verify.yml`), so `_prisma_migrations` bookkeeping is exercised there.
The sandbox could not download Prisma's native schema engine, so locally the SQL was applied with
`psql` through `scripts/erp/migrate-test-db.sh`; it is the same SQL in the same order, and that
script does not write `_prisma_migrations`, which is why CI covers the Prisma-managed path.

## Rollback

The product can be switched off without touching the database, and that is the first thing to try:

```bash
# Stop the product, keep the data. Reversible in one minute.
ERP_PRO_DISABLED=true   # redeploy
```

Only if the tables themselves must go:

```bash
# 1. Export the ERP data first — once the tables are dropped the only copy is the export.
pg_dump "$DATABASE_URL" --format=custom \
  --table='"Erp*"' --table='"Msg*"' --file=erp_pro_export_$(date +%Y%m%d).dump
#    (quote the patterns: pg_dump folds unquoted names to lower case and matches nothing)

# 2. Restore that dump into a scratch database and check the row counts.
createdb erp_pro_verify && pg_restore --dbname=erp_pro_verify erp_pro_export_*.dump

# 3. Only then, in reverse dependency order (children before parents). The exact order is the
#    appendix below; it is exercised by scripts/erp/migration-verify.sh rollback.
```

Copy-paste of a 38-table `DROP` block is deliberately **not** in this document as a single blob.
Dropping 38 tables is a destructive, irreversible act that the owner of the database must review
line by line, so the appendix lists the tables in dependency order and the `DROP` statement is
written per table at the point of use. Today none of the ERP tables reference each other, so the
order is not strictly required by PostgreSQL; it is kept because a future migration may add such a
foreign key, and the rehearsal should fail then rather than the real rollback.

### Appendix — tables in dependency order

Leaf tables first (they reference the headers):

```
ErpJournalLine, ErpPaymentAllocation, ErpInvoiceLine, ErpCreditNote, ErpStoreOrderItem,
MsgCampaignRecipient, MsgMessageEvent, MsgSenderIdEvent, MsgConsentRecord, MsgLedgerEntry,
MsgSuppression, MsgAudience, ErpAutomationRun, ErpKycDocument, ErpNotification,
ErpPayment, ErpInvoice, ErpExpense, ErpSupplierBill, ErpStoreOrder, MsgCampaign,
MsgTemplate, MsgSenderId, MsgChannelConnection, MsgContact, MsgWallet,
ErpJournal, ErpPeriod, ErpAccount, ErpTaxRule, ErpComplianceProfile, ErpAutomationRule,
ErpSequence, ErpIdempotencyRecord, ErpAuditEvent, ErpEntitlement, ErpSubscription,
ErpConfiguration
```

`ErpConfiguration` goes last: several tables read its feature flags and `teamRolesJson`.

## Ordering hazard worth knowing before you apply

`ErpConfiguration` is the row that proves a workspace exists. If a deployment ever creates an
entitlement before the configuration row, `deriveErpEntitlement` reports `AWAITING_PAYMENT` rather
than "active with no workspace" — the ordering is therefore not only tolerated but detected. The
bootstrap routine (`lib/erp/bootstrap.ts`) creates the configuration, chart of accounts, tax rules
and wallet in one `$transaction`, so a half-built workspace cannot exist.

## Known gaps

* No production database has been migrated. The rehearsal used PostgreSQL 16.2 on a disposable
  cluster, which matches the provider's major version but not its extensions, connection pooler or
  backup policy.
* `ErpTaxRule.notes` was added during this pass after the integration suite caught `bootstrap`
  writing a column that did not exist. Any database that somehow applied the earlier draft of
  `20261027000000_pos_erp_pro` needs that column added before deploying this migration — the guard
  `CREATE TABLE IF NOT EXISTS` would skip the table and leave the column missing.
