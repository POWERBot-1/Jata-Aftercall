#!/usr/bin/env bash
# Verify the POS / ERP - PRO migration against a *disposable* PostgreSQL database.
#
# Three scenarios, each on its own database state:
#   1. clean install   — no tables at all, apply the full migration chain
#   2. upgrade path    — apply everything up to the last release migration, seed existing POS rows,
#                        then apply the ERP migration and prove the existing data is untouched
#   3. rollback        — export the ERP tables, restore them into a scratch database, drop the ERP
#                        tables in the documented (reverse dependency) order, prove the POS tables
#                        and rows survive, then re-apply the migration and prove recovery
#
# This script talks to PostgreSQL directly with psql. It exists because `prisma migrate deploy`
# needs the native schema-engine binary, which some sandboxes cannot download — and because the
# CLI can exit 0 without applying anything when that binary is unusable. A migration test that
# trusts the tool it is testing is not a test.
#
# Usage:
#   DATABASE_URL=postgresql://user@127.0.0.1:5432/erp_verify \
#     bash scripts/erp/migration-verify.sh clean
#     ... upgrade | rollback | all
#
# Required: psql, pg_dump, pg_restore on PATH (set PSQL / PG_DUMP / PG_RESTORE to override) and a
# throwaway database. The script refuses to run against a database whose name does not look
# disposable unless ALLOW_NON_TEST_DATABASE=1 is set.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/prisma/migrations"
ERP_MIGRATION="20261027000000_pos_erp_pro"
# Every migration this product owns, in order. The upgrade path stops before the first one and
# applies the rest; the rollback scenario drops what all of them create.
ERP_MIGRATIONS=("20261027000000_pos_erp_pro" "20261028000000_erp_tasks" "20261029000000_erp_notifications" "20261030000000_erp_approvals" "20261031000000_erp_approval_consumption" "20261032000000_erp_procurement" "20261033000000_erp_requisitions")
# Product-owned ERP, messaging and MJENGO tables. Update when an additive migration adds one.
ERP_TABLE_TOTAL=52
LAST_RELEASE_MIGRATION="20261010000200_checkout_idempotency"
PSQL="${PSQL:-psql}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL_BIN_DIR="$(dirname "$(command -v "$PSQL" 2>/dev/null || echo /nonexistent/psql)")"

SCENARIO="${1:-all}"
FAILURES=0

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILURES=$((FAILURES + 1)); }

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi
# psql does not understand Prisma's `?schema=` parameter.
DB_URL="${DATABASE_URL%%\?*}"
DB_NAME="$(basename "${DB_URL##*/}")"
case "$DB_NAME" in
  *test*|*verify*|*scratch*|*tmp*|postgres) ;;
  *)
    if [ "${ALLOW_NON_TEST_DATABASE:-0}" != "1" ]; then
      echo "refusing to run: database '$DB_NAME' does not look disposable." >&2
      echo "use a database whose name contains test/verify/scratch, or set ALLOW_NON_TEST_DATABASE=1" >&2
      exit 2
    fi
    ;;
esac
# Keep NOTICE chatter from the older, idempotent migrations out of the report.
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
ADMIN_URL="${DB_URL%\/*}/postgres"
SCRATCH_DB="erp_pro_verify_scratch"
SCRATCH_URL="${DB_URL%\/*}/$SCRATCH_DB"

psql_run() { "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }

reset_public() {
  psql_run -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
}

apply_until() { # apply_until [stop-before-dir]
  local stop="${1:-}"
  local applied=0 dir
  for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do
    if [ -n "$stop" ] && [ "$dir" = "$stop" ]; then
      echo "      stopped before $dir ($applied applied)"
      return 0
    fi
    "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$dir/migration.sql" >/dev/null || return 1
    applied=$((applied + 1))
  done
  echo "      applied $applied migration(s)"
}

erp_table_count() {
  "$PSQL" "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and (table_name like 'Erp%' or table_name like 'Msg%' or table_name like 'Mjengo%');"
}
base_table_count() {
  "$PSQL" "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'Erp%' and table_name not like 'Msg%' and table_name not like 'Mjengo%';"
}
scalar() { "$PSQL" "$DB_URL" -tAc "$1"; }

# Measure non-ERP tables from the entire migration chain in an independent scratch database.
# Applying ERP migrations too permits later non-ERP migrations to depend on them, while the
# filtered count still requires rollback to preserve every POS and agent-owned table.
BASELINE_BASE_TABLES=""
measure_base_tables() {
  local stamp_db="erp_pro_baseline_scratch" url dir count
  url="${DB_URL%/*}/$stamp_db"
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$stamp_db\";" >/dev/null || return 1
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$stamp_db\";" >/dev/null || return 1
  for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do

    if ! "$PSQL" "$url" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$dir/migration.sql" >/dev/null 2>&1; then
      echo "      baseline measurement failed at $dir" >&2
      "$PSQL" "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$stamp_db\";" >/dev/null 2>&1
      return 1
    fi
  done
  count=$("$PSQL" "$url" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'Erp%' and table_name not like 'Msg%' and table_name not like 'Mjengo%';")
  "$PSQL" "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$stamp_db\";" >/dev/null 2>&1
  echo "$count"
}
baseline_base_tables() {
  if [ -z "$BASELINE_BASE_TABLES" ]; then
    BASELINE_BASE_TABLES="$(measure_base_tables)" || BASELINE_BASE_TABLES=""
    case "$BASELINE_BASE_TABLES" in
      ''|*[!0-9]*) fail "could not measure the pre-existing table baseline"; BASELINE_BASE_TABLES="?" ;;
    esac
  fi
  echo "$BASELINE_BASE_TABLES"
}

# Every ERP row references a Business, so the parent rows have to exist in the target database
# before a data-only restore can succeed.
seed_baseline_rows() {
  local url="${1:-$DB_URL}"
  "$PSQL" "$url" -v ON_ERROR_STOP=1 -q <<'SQL'
INSERT INTO "User" (id, email, "passwordHash", "updatedAt")
VALUES ('u_upgrade', 'upgrade-path@example.test', 'not-a-real-login', now());
INSERT INTO "Business" (id, "ownerId", slug, name, category, "updatedAt")
VALUES ('b_upgrade', 'u_upgrade', 'upgrade-path-biz', 'Upgrade Path Biz', 'retail', now());
INSERT INTO "PosProduct" (id, "businessId", name, category, "updatedAt")
VALUES ('p_upgrade', 'b_upgrade', 'Unga 2kg', 'Existing legacy category', now());
SQL
}

seed_erp_rows() {
  psql_run <<'SQL'
INSERT INTO "ErpConfiguration" (id, "businessId", "storefrontSlug", "updatedAt")
VALUES ('cfg_rollback', 'b_upgrade', 'upgrade-path-shop', now());
INSERT INTO "ErpAccount" (id, "businessId", code, name, type, "updatedAt")
VALUES ('acct_rollback', 'b_upgrade', '1000', 'Cash on hand', 'ASSET', now());
INSERT INTO "MsgWallet" (id, "businessId", "updatedAt")
VALUES ('wallet_rollback', 'b_upgrade', now());
INSERT INTO "ErpJournal" (id, "businessId", "journalNumber", "entryDate", description, "updatedAt")
VALUES ('jr_rollback', 'b_upgrade', 'JV-000001', now(), 'Rollback probe journal', now());
INSERT INTO "ErpJournalLine" (id, "businessId", "journalId", "accountCode", "accountId")
VALUES ('jl_rollback', 'b_upgrade', 'jr_rollback', '1000', 'acct_rollback');
SQL
}

# ── Scenario 1: clean install ────────────────────────────────────────────────────────────────────
clean_install() {
  echo "== clean install"
  reset_public
  if apply_until; then pass "all migrations applied on an empty database"; else fail "migration chain failed on an empty database"; return; fi
  local erp base
  erp=$(erp_table_count); base=$(base_table_count)
  [ "$erp" = "$ERP_TABLE_TOTAL" ] && pass "$erp ERP tables created" || fail "expected $ERP_TABLE_TOTAL ERP tables, found $erp"
  local want_base
  want_base=$(baseline_base_tables)
  [ "$base" = "$want_base" ] && pass "$base non-ERP tables created" || fail "expected $want_base pre-existing tables, found $base"
  local fks missing
  fks=$(scalar "select count(*) from information_schema.table_constraints tc join information_schema.tables t on t.table_name=tc.table_name and t.table_schema=tc.table_schema where tc.constraint_type='FOREIGN KEY' and t.table_schema='public' and (t.table_name like 'Erp%' or t.table_name like 'Msg%');")
  [ "$fks" -ge "$ERP_TABLE_TOTAL" ] && pass "$fks foreign keys on ERP tables" || fail "expected at least $ERP_TABLE_TOTAL ERP foreign keys, found $fks"
  local named="" migration name
  for migration in "${ERP_MIGRATIONS[@]}"; do
    for name in $(grep -o 'CREATE TABLE IF NOT EXISTS "[A-Za-z]*"' "$MIGRATIONS_DIR/$migration/migration.sql" | sed 's/.*"\([A-Za-z]*\)"/\1/'); do
      named="$named,('$name')"
    done
  done
  named=${named#,}
  missing=$(psql_run -tAc "select count(*) from (select v as t from (values $named) x(v) where v not in (select table_name from information_schema.tables where table_schema='public'));")
  [ "$missing" = "0" ] && pass "every table named in the ERP migration exists" || fail "$missing table(s) named in the ERP migration are missing"
  # The migration must be re-runnable: a partial failure in a hosted runner must not block a retry.
  local idempotent=1
  for migration in "${ERP_MIGRATIONS[@]}"; do
    "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$migration/migration.sql" >/dev/null 2>&1 || idempotent=0
  done
  [ "$idempotent" = "1" ] && pass "ERP migrations are idempotent (re-ran over themselves without error)" || fail "an ERP migration is not re-runnable"
}

# ── Scenario 2: supported upgrade path ───────────────────────────────────────────────────────────
upgrade_path() {
  echo "== upgrade path ($LAST_RELEASE_MIGRATION -> $ERP_MIGRATION)"
  reset_public
  if apply_until "$ERP_MIGRATION"; then pass "previous release migrations applied"; else fail "previous release migrations failed"; return; fi
  seed_baseline_rows || { fail "could not seed pre-upgrade POS rows"; return; }
  local users businesses products
  users=$(scalar 'select count(*) from "User"'); businesses=$(scalar 'select count(*) from "Business"'); products=$(scalar 'select count(*) from "PosProduct"')
  [ "$users$businesses$products" = "111" ] && pass "pre-upgrade POS rows seeded (1 user, 1 business, 1 product)" || fail "seed counts wrong: $users/$businesses/$products"
  local migration apply_failed=0
  for migration in "${ERP_MIGRATIONS[@]}"; do
    "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$migration/migration.sql" >/dev/null || apply_failed=1
  done
  if [ "$apply_failed" = "0" ]; then
    pass "ERP migrations applied over a populated previous release"
  else
    fail "an ERP migration failed over a populated previous release"; return
  fi
  [ "$(erp_table_count)" = "$ERP_TABLE_TOTAL" ] && pass "$ERP_TABLE_TOTAL ERP tables added by the upgrade" || fail "ERP table count after upgrade is $(erp_table_count)"
  [ "$(scalar 'select count(*) from "Business" where id = '\''b_upgrade'\''')" = "1" ] && pass "existing business survived the upgrade" || fail "existing business was lost"
  [ "$(scalar 'select count(*) from "PosProduct" where id = '\''p_upgrade'\''')" = "1" ] && pass "existing POS product survived the upgrade" || fail "existing POS product was lost"
  [ "$(scalar 'select count(*) from "User"')" = "1" ] && pass "no rows were created or duplicated by the migration" || fail "row counts changed during the migration"
  # Apply later POS migrations over a genuinely pre-existing product and photo reference.
  psql_run -f "$MIGRATIONS_DIR/20261101000000_pos_category_images/migration.sql" >/dev/null || { fail "category image migration failed during upgrade"; return; }
  psql_run <<'SQL' || { fail "could not seed legacy category photo"; return; }
INSERT INTO "PosCategoryImage" (id, "businessId", category, "imageUrl", "updatedAt")
VALUES ('photo_upgrade', 'b_upgrade', 'Existing legacy category', 'https://example.invalid/legacy.png', now());
SQL
  psql_run -f "$MIGRATIONS_DIR/20261102000000_pos_report_snapshots/migration.sql" >/dev/null || { fail "report snapshot migration failed during upgrade"; return; }
  psql_run -f "$MIGRATIONS_DIR/20261103000000_pos_categories/migration.sql" >/dev/null || { fail "independent category migration failed during upgrade"; return; }
  [ "$(scalar "select count(*) from \"PosCategory\" where \"businessId\" = 'b_upgrade' and name = 'Existing legacy category'")" = "1" ] && pass "legacy product and image backfilled to one category" || fail "legacy category was not backfilled"
  [ "$(scalar "select count(*) from \"PosProduct\" where id = 'p_upgrade' and category = 'Existing legacy category'")" = "1" ] && pass "legacy product category preserved" || fail "legacy product category changed"
  [ "$(scalar "select count(*) from \"PosCategoryImage\" where id = 'photo_upgrade' and category = 'Existing legacy category'")" = "1" ] && pass "legacy category image preserved" || fail "legacy category image changed"

}

# ── Scenario 3: rollback and recovery ────────────────────────────────────────────────────────────
rollback_and_recovery() {
  echo "== rollback and recovery"
  reset_public
  if apply_until; then pass "database migrated for the rollback rehearsal"; else fail "migration failed before rollback rehearsal"; return; fi
  seed_baseline_rows || { fail "could not seed baseline rows"; return; }
  seed_erp_rows || { fail "could not seed ERP rows"; return; }
  psql_run <<'SQL' || { fail "could not seed POS category image"; return; }
INSERT INTO "PosCategory" (id, "businessId", name, "updatedAt")
VALUES ('category_rollback', 'b_upgrade', 'Produce', now());
INSERT INTO "PosCategoryImage" (id, "businessId", category, "imageUrl", "updatedAt")
VALUES ('photo_rollback', 'b_upgrade', 'Produce', 'https://example.invalid/photo.png', now());
SQL

  local dump="${TMPDIR:-/tmp}/erp-rollback-export.dump"
  rm -f "$dump"
  # pg_dump folds unquoted patterns to lower case, which never matches mixed-case "Erp*" names,
  # and its wildcard support does not apply inside double quotes. Enumerate the tables and pass
  # each one exactly quoted instead.
  local dump_args=() t
  while IFS= read -r t; do
    [ -n "$t" ] && dump_args+=(-t "\"$t\"")
  done < <("$PSQL" "$DB_URL" -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and (table_name like 'Erp%' or table_name like 'Msg%' or table_name like 'Mjengo%') order by table_name;")
  if [ "${#dump_args[@]}" -lt $((ERP_TABLE_TOTAL * 2)) ]; then # 2 arguments per table (-t and name)
    fail "could not enumerate the ERP tables for export (${#dump_args[@]} arguments)"; return
  fi
  if "$PG_DUMP" "$DB_URL" --format=custom --data-only "${dump_args[@]}" --file="$dump" >/dev/null 2>&1; then
    pass "ERP data exported to $(basename "$dump") ($((${#dump_args[@]} / 2)) tables)"
  else
    fail "ERP data export failed"; return
  fi

  # Restore into a scratch database that has the same schema, then compare row counts.
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" -c "CREATE DATABASE $SCRATCH_DB" || { fail "could not create scratch database"; return; }
  # Replaying the committed migrations reproduces the schema on an empty database. Two things are
  # made explicit here because a CI step may export them globally:
  #   - `-v ON_ERROR_STOP=1` is passed per statement (already the default set at startup below), so a
  #     single failing file cannot leave a half-built schema that looks restored;
  #   - the scratch connection must not inherit a statement timeout shorter than the migration chain.
  local dir
  for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do
    if ! "$PSQL" "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q \
        -c 'SET statement_timeout = 0;' \
        -f "$MIGRATIONS_DIR/$dir/migration.sql" >/tmp/erp-scratch-migrate.log 2>&1; then
      fail "scratch migration failed at $dir"
      # Print AND annotate the cause. Step logs are not always reachable to reviewers, and a bare
      # filename is not a diagnosis.
      echo "--- scratch migration output ($dir) ---"
      tail -20 /tmp/erp-scratch-migrate.log || true
      echo "::error title=ERP_SCRATCH_MIGRATION_FAILED::${dir}: $(tail -c 700 /tmp/erp-scratch-migrate.log | tr '\n' ' ' | sed 's/%/%25/g')"
      return
    fi
  done
  pass "scratch database rebuilt from $(ls -1 "$MIGRATIONS_DIR" | grep -cE '^[0-9]{14}_') committed migrations"
  seed_baseline_rows "$SCRATCH_URL" || { fail "could not seed the scratch database"; return; }
  # `--disable-triggers` is required and is not a loosened assertion:
  #   pg_restore loads tables in dump order, and the line guard's SELECT ... FROM "ErpJournal" ran
  #   before the journal header existed -> "relation ErpJournal does not exist". Worse, replaying
  #   child rows through the immutability guard tests the guard against an inconsistent intermediate
  #   state rather than against the customer's data. The restore's purpose is to prove the EXPORT is
  #   complete and reloadable; the guards are proven separately, on proper data, by the ledger suites
  #   in tests/unit/mjengo-ledger-sql-postgres.test.ts (11 tests).
  if "$PG_RESTORE" --no-owner --no-privileges --data-only --disable-triggers --dbname="$SCRATCH_URL" "$dump" >"${TMPDIR:-/tmp}/erp-restore.log" 2>&1; then
    pass "export restored into a scratch database"
  else
    fail "export could not be restored into a scratch database (see ${TMPDIR:-/tmp}/erp-restore.log)"
    echo "--- pg_restore output ---"
    tail -25 "${TMPDIR:-/tmp}/erp-restore.log" || true
    echo "::error title=ERP_RESTORE_FAILED::$(tail -c 700 "${TMPDIR:-/tmp}/erp-restore.log" | tr '\n' ' ' | sed 's/%/%25/g')"
  fi
  local live restored
  live=$(scalar 'select count(*) from "ErpJournalLine"')
  restored=$("$PSQL" "$SCRATCH_URL" -tAc 'select count(*) from "ErpJournalLine";')
  [ "$live" = "1" ] && [ "$live" = "$restored" ] && pass "restored ERP row counts match the live database" || fail "restored counts differ (live=$live restored=$restored)"

  # Drop in the documented order: children before parents, RESTRICT so a wrong order fails loudly.
  #
  # TWO schema objects make a plain DROP TABLE impossible, and neither is a dependency-ordering bug:
  #
  #   1. `20261127000001_ledger_immutability` installs a BEFORE DELETE row trigger
  #      (`ErpJournal_delete_guard`) that raises restrict_violation for any POSTED/REVERSED journal.
  #      Ordering cannot satisfy it: dropping the children first is precisely what leaves a journal
  #      "still has lines" at the moment of the drop.
  #   2. `ErpJournalIntegrity` is a VIEW over ErpJournal/ErpJournalLine, not a table, so it is absent
  #      from the drop list and keeps the base table pinned even without the trigger.
  #
  # Both are financial safeguards that the rehearsal must remove deliberately, in the open. Removing a
  # trigger does not bypass any CHECK/UNIQUE/FOREIGN KEY constraint: every remaining constraint is
  # still enforced by the drops below, which is what keeps a wrong dependency order failing loudly.
  # Prove the safeguards are actually present before removing them; otherwise this rehearsal could
  # pass while asserting nothing about the ledger protections.
  local guards
  guards=$("$PSQL" "$DB_URL" -tAc "select count(*) from pg_trigger where tgname in ('ErpJournal_delete_guard','ErpJournal_immutable','ErpJournalLine_immutable') and not tgisinternal")
  [ "$guards" = "3" ] && pass "ledger immutability, line and delete guards present before rollback" || fail "expected 3 ledger guards, found $guards"
  [ -n "$("$PSQL" "$DB_URL" -tAc "select 1 from pg_views where viewname = 'ErpJournalIntegrity'")" ] && pass "ErpJournalIntegrity integrity view present before rollback" || fail "ErpJournalIntegrity view missing before rollback"

  # The FUNCTIONS must be dropped too, not just the triggers. 20261127000001 opens with a plain
  # `CREATE FUNCTION` (no IF NOT EXISTS), so the recovery path re-runs that file and fails with
  # "function ... already exists with same argument types" if the functions survived.
  if ! "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q \
      -c 'DROP VIEW IF EXISTS "ErpJournalIntegrity";' \
      -c 'DROP TRIGGER IF EXISTS "ErpJournalLine_immutable" ON "ErpJournalLine";' \
      -c 'DROP TRIGGER IF EXISTS "ErpJournal_delete_guard" ON "ErpJournal";' \
      -c 'DROP TRIGGER IF EXISTS "ErpJournal_immutable" ON "ErpJournal";' \
      -c 'DROP FUNCTION IF EXISTS erp_journal_line_guard();' \
      -c 'DROP FUNCTION IF EXISTS erp_journal_guard();' \
      -c 'DROP FUNCTION IF EXISTS erp_journal_delete_guard();'; then
    fail "could not remove the ledger guards and integrity view"
    return
  fi

  local tables=( ErpRequisitionLine ErpRequisition ErpGoodsReceiptLine ErpGoodsReceipt ErpPurchaseOrderLine ErpPurchaseOrder ErpApprovalEvent ErpApprovalRequest ErpNotificationRead ErpTask ErpJournalLine ErpPaymentAllocation ErpInvoiceLine ErpCreditNote ErpStoreOrderItem MsgCampaignRecipient MsgMessageEvent MsgSenderIdEvent MsgConsentRecord MsgLedgerEntry MsgSuppression MsgAudience ErpAutomationRun ErpKycDocument ErpNotification ErpPayment ErpInvoice ErpExpense ErpSupplierBill ErpStoreOrder MsgCampaign MsgTemplate MsgSenderId MsgChannelConnection MsgContact MsgWallet ErpJournal ErpPeriod ErpAccount ErpTaxRule ErpComplianceProfile ErpAutomationRule ErpSequence ErpIdempotencyRecord ErpAuditEvent MjengoEntitlement MjengoSubscription ErpProEntitlement ErpProSubscription ErpEntitlement ErpSubscription ErpConfiguration )
  local dropped=0 t
  for t in "${tables[@]}"; do
    if "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q -c "DROP TABLE \"$t\";" >/dev/null 2>&1; then
      dropped=$((dropped + 1))
    else
      fail "could not drop $t in the documented order"
    fi
  done
  [ "$dropped" = "$ERP_TABLE_TOTAL" ] && pass "all $ERP_TABLE_TOTAL ERP tables dropped in documented reverse-dependency order" || fail "dropped $dropped of $ERP_TABLE_TOTAL ERP tables"
  [ "$(erp_table_count)" = "0" ] && pass "no ERP tables remain after rollback" || fail "ERP tables remain after rollback"
  local want_base
  want_base=$(baseline_base_tables)
  [ "$(base_table_count)" = "$want_base" ] && pass "all $want_base non-ERP tables survived the rollback" || fail "non-ERP tables were lost during rollback"
  [ "$(scalar 'select count(*) from "PosProduct" where id = '\''p_upgrade'\''')" = "1" ] && pass "POS rows survived the rollback" || fail "POS rows were lost during rollback"
  [ "$(scalar 'select count(*) from "PosCategoryImage" where id = '\''photo_rollback'\''')" = "1" ] && pass "POS category image survived ERP rollback" || fail "POS category image was lost during ERP rollback"
  [ "$(scalar 'select count(*) from "PosCategory" where id = '\''category_rollback'\''')" = "1" ] && pass "POS category survived ERP rollback" || fail "POS category was lost during ERP rollback"

  # Recovery: re-apply the ERP migrations on the rolled-back database, then the ledger migrations that
  # own the guards and the integrity view removed above. Without the latter the recovery would restore
  # tables but leave the financial safeguards off, which is exactly the state that must never exist.
  # The trigger bodies protect DRAFT journals by design: a DRAFT journal accepts new lines and may
  # be posted (verified on PostgreSQL). A POSTED/REVERSED journal accepts nothing, so replaying the
  # guards over one would abort the recovery. The rehearsal therefore asserts the precondition it
  # relies on instead of assuming it: if a sealed journal is present the recovery FAILS loudly and
  # says why, rather than silently skipping the guards.
  local sealed
  sealed=$("$PSQL" "$DB_URL" -tAc "select count(*) from \"ErpJournal\" where status in ('POSTED','REVERSED')")
  [ "${sealed:-0}" = "0" ] \
    && pass "recovery precondition: no sealed journals in the fixture (guards can be re-installed)" \
    || fail "recovery precondition violated: $sealed sealed journals present; the guard replay would abort"

  local recovered=1
  for migration in "${ERP_MIGRATIONS[@]}" "20261127000001_ledger_immutability" "20261127000002_ledger_line_integrity"; do
    if ! "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q\
        -c 'SET statement_timeout = 0;'\
        -f "$MIGRATIONS_DIR/$migration/migration.sql" >/tmp/erp-recovery.log 2>&1; then
      recovered=0
      echo "--- recovery migration failed ($migration) ---"
      tail -20 /tmp/erp-recovery.log || true
      echo "::error title=ERP_RECOVERY_FAILED::${migration}: $(tail -c 700 /tmp/erp-recovery.log | tr '\n' ' ' | sed 's/%/%25/g')"
    fi
  done
  if [ "$recovered" = "1" ]; then
    pass "ERP migrations re-applied after rollback (recovery path)"
  else
    fail "ERP migration could not be re-applied after rollback"
  fi
  [ "$(erp_table_count)" = "$ERP_TABLE_TOTAL" ] && pass "$ERP_TABLE_TOTAL ERP tables present after recovery" || fail "ERP table count after recovery is $(erp_table_count)"
  [ "$(scalar 'select count(*) from "Business" where id = '\''b_upgrade'\''')" = "1" ] && pass "existing business intact after recovery" || fail "existing business lost after recovery"
  # The recovery path must restore the financial safeguards, not just the tables.
  local guards_after
  guards_after=$("$PSQL" "$DB_URL" -tAc "select count(*) from pg_trigger where tgname in ('ErpJournal_delete_guard','ErpJournal_immutable','ErpJournalLine_immutable') and not tgisinternal")
  [ "$guards_after" = "3" ] && pass "ledger guards restored after recovery" || fail "ledger guards missing after recovery ($guards_after of 3)"
  [ -n "$("$PSQL" "$DB_URL" -tAc "select 1 from pg_views where viewname = 'ErpJournalIntegrity'")" ] && pass "ErpJournalIntegrity view restored after recovery" || fail "ErpJournalIntegrity view missing after recovery"
  local line_fk
  line_fk=$("$PSQL" "$DB_URL" -tAc "select count(*) from pg_constraint where contype = 'f' and conrelid = '\"ErpJournalLine\"'::regclass and confrelid = '\"ErpJournal\"'::regclass")
  [ "${line_fk:-0}" -ge 1 ] && pass "ErpJournalLine -> ErpJournal reference restored after recovery" || fail "journal line reference missing after recovery"

  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
  rm -f "$dump"
}

case "$SCENARIO" in
  clean) clean_install ;;
  upgrade) upgrade_path ;;
  rollback) rollback_and_recovery ;;
  all) clean_install; upgrade_path; rollback_and_recovery ;;
  *) echo "unknown scenario '$SCENARIO' (clean|upgrade|rollback|all)" >&2; exit 2 ;;
esac

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "RESULT: PASS (all migration scenarios)"
  exit 0
fi
echo "RESULT: FAIL ($FAILURES check(s) failed)"
exit 1
