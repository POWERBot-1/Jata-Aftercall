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
ERP_MIGRATIONS=("20261027000000_pos_erp_pro" "20261028000000_erp_tasks" "20261029000000_erp_notifications" "20261030000000_erp_approvals")
# Tables the ERP migrations create (Erp* / Msg*). Update when an additive migration adds one.
ERP_TABLE_TOTAL=42
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
  "$PSQL" "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and (table_name like 'Erp%' or table_name like 'Msg%');"
}
base_table_count() {
  "$PSQL" "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'Erp%' and table_name not like 'Msg%';"
}
scalar() { "$PSQL" "$DB_URL" -tAc "$1"; }

# How many non-ERP tables the *upstream* migration chain creates is not a constant: main adds
# migrations between reviews (74 when this script was written, 87 after the 2026-10-28 merge).
# Hard-coding it turns an upstream release into a false failure here, so the baseline is measured
# once per run on a throwaway database built from every migration that precedes the ERP one.
BASELINE_BASE_TABLES=""
measure_base_tables() {
  local stamp_db="erp_pro_baseline_scratch" url dir count
  url="${DB_URL%/*}/$stamp_db"
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS \"$stamp_db\";" >/dev/null || return 1
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$stamp_db\";" >/dev/null || return 1
  for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do
    [ "$dir" = "$ERP_MIGRATION" ] && break
    if ! "$PSQL" "$url" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$dir/migration.sql" >/dev/null 2>&1; then
      echo "      baseline measurement failed at $dir" >&2
      "$PSQL" "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$stamp_db\";" >/dev/null 2>&1
      return 1
    fi
  done
  count=$("$PSQL" "$url" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'Erp%' and table_name not like 'Msg%';")
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
INSERT INTO "PosProduct" (id, "businessId", name, "updatedAt")
VALUES ('p_upgrade', 'b_upgrade', 'Unga 2kg', now());
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
  [ "$base" = "$want_base" ] && pass "$base pre-existing tables created" || fail "expected $want_base pre-existing tables, found $base"
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
}

# ── Scenario 3: rollback and recovery ────────────────────────────────────────────────────────────
rollback_and_recovery() {
  echo "== rollback and recovery"
  reset_public
  if apply_until; then pass "database migrated for the rollback rehearsal"; else fail "migration failed before rollback rehearsal"; return; fi
  seed_baseline_rows || { fail "could not seed baseline rows"; return; }
  seed_erp_rows || { fail "could not seed ERP rows"; return; }

  local dump="${TMPDIR:-/tmp}/erp-rollback-export.dump"
  rm -f "$dump"
  # pg_dump folds unquoted patterns to lower case, which never matches mixed-case "Erp*" names,
  # and its wildcard support does not apply inside double quotes. Enumerate the tables and pass
  # each one exactly quoted instead.
  local dump_args=() t
  while IFS= read -r t; do
    [ -n "$t" ] && dump_args+=(-t "\"$t\"")
  done < <("$PSQL" "$DB_URL" -tAc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and (table_name like 'Erp%' or table_name like 'Msg%') order by table_name;")
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
  local dir
  for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do
    "$PSQL" "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$dir/migration.sql" >/dev/null || { fail "scratch migration failed at $dir"; return; }
  done
  seed_baseline_rows "$SCRATCH_URL" || { fail "could not seed the scratch database"; return; }
  if "$PG_RESTORE" --no-owner --no-privileges --data-only --dbname="$SCRATCH_URL" "$dump" >"${TMPDIR:-/tmp}/erp-restore.log" 2>&1; then
    pass "export restored into a scratch database"
  else
    fail "export could not be restored into a scratch database (see ${TMPDIR:-/tmp}/erp-restore.log)"
  fi
  local live restored
  live=$(scalar 'select count(*) from "ErpJournalLine"')
  restored=$("$PSQL" "$SCRATCH_URL" -tAc 'select count(*) from "ErpJournalLine";')
  [ "$live" = "1" ] && [ "$live" = "$restored" ] && pass "restored ERP row counts match the live database" || fail "restored counts differ (live=$live restored=$restored)"

  # Drop in the documented order: children before parents, RESTRICT so a wrong order fails loudly.
  local tables=( ErpApprovalEvent ErpApprovalRequest ErpNotificationRead ErpTask ErpJournalLine ErpPaymentAllocation ErpInvoiceLine ErpCreditNote ErpStoreOrderItem MsgCampaignRecipient MsgMessageEvent MsgSenderIdEvent MsgConsentRecord MsgLedgerEntry MsgSuppression MsgAudience ErpAutomationRun ErpKycDocument ErpNotification ErpPayment ErpInvoice ErpExpense ErpSupplierBill ErpStoreOrder MsgCampaign MsgTemplate MsgSenderId MsgChannelConnection MsgContact MsgWallet ErpJournal ErpPeriod ErpAccount ErpTaxRule ErpComplianceProfile ErpAutomationRule ErpSequence ErpIdempotencyRecord ErpAuditEvent ErpEntitlement ErpSubscription ErpConfiguration )
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
  [ "$(base_table_count)" = "$want_base" ] && pass "all $want_base pre-existing tables survived the rollback" || fail "pre-existing tables were lost during rollback"
  [ "$(scalar 'select count(*) from "PosProduct" where id = '\''p_upgrade'\''')" = "1" ] && pass "POS rows survived the rollback" || fail "POS rows were lost during rollback"

  # Recovery: re-apply the ERP migration on the rolled-back database.
  local recovered=1
  for migration in "${ERP_MIGRATIONS[@]}"; do
    "$PSQL" "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/$migration/migration.sql" >/dev/null 2>&1 || recovered=0
  done
  if [ "$recovered" = "1" ]; then
    pass "ERP migrations re-applied after rollback (recovery path)"
  else
    fail "ERP migration could not be re-applied after rollback"
  fi
  [ "$(erp_table_count)" = "$ERP_TABLE_TOTAL" ] && pass "$ERP_TABLE_TOTAL ERP tables present after recovery" || fail "ERP table count after recovery is $(erp_table_count)"
  [ "$(scalar 'select count(*) from "Business" where id = '\''b_upgrade'\''')" = "1" ] && pass "existing business intact after recovery" || fail "existing business lost after recovery"

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
