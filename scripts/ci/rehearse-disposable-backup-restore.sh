#!/usr/bin/env bash
set -Eeuo pipefail

# Full logical backup/restore rehearsal for disposable PostgreSQL only.
# This does not test Neon PITR, provider snapshots, or production recovery.
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PG_ADMIN_URL:?PG_ADMIN_URL is required}"

DUMP_FILE="${RUNNER_TEMP:-/tmp}/jata-recovery.dump"
SOURCE_SCHEMA="${RUNNER_TEMP:-/tmp}/jata-source-schema.sql"
RESTORED_SCHEMA="${RUNNER_TEMP:-/tmp}/jata-restored-schema.sql"
SOURCE_COUNTS="${RUNNER_TEMP:-/tmp}/jata-source-counts.txt"
RESTORED_COUNTS="${RUNNER_TEMP:-/tmp}/jata-restored-counts.txt"
COUNT_SQL="${RUNNER_TEMP:-/tmp}/jata-row-counts.sql"

fail() { echo "::error::$1"; exit 1; }
cleanup() {
  rm -f "$DUMP_FILE" "$SOURCE_SCHEMA" "$RESTORED_SCHEMA" "$COUNT_SQL"
  psql "$PG_ADMIN_URL" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS jata_recovery_restore WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Refuse anything except the named disposable database on loopback. Do not print URLs.
node - <<'NODE'
const source = new URL(process.env.DATABASE_URL);
const admin = new URL(process.env.PG_ADMIN_URL);
const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
if (!loopback.has(source.hostname) || !loopback.has(admin.hostname)) throw new Error("BLOCKED: backup rehearsal requires loopback PostgreSQL only");
if (decodeURIComponent(source.pathname.slice(1)) !== "jata_recovery") throw new Error("BLOCKED: source database must be exactly jata_recovery");
if (source.hostname !== admin.hostname || source.port !== admin.port) throw new Error("BLOCKED: source/admin endpoints differ");
if (decodeURIComponent(admin.pathname.slice(1)) !== "postgres") throw new Error("BLOCKED: admin connection must target postgres database");
NODE

command -v pg_dump >/dev/null || fail "pg_dump is unavailable"
command -v pg_restore >/dev/null || fail "pg_restore is unavailable"
command -v psql >/dev/null || fail "psql is unavailable"
PG_SOURCE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.search="";u.hash="";process.stdout.write(u.toString())')"

echo "PASS: source and admin targets are loopback disposable PostgreSQL"
pg_dump --version
pg_restore --version

# Capture complete schema + data, including migration ledger and synthetic financial fixtures.
pg_dump "$PG_SOURCE_URL" --format=custom --no-owner --no-privileges --file="$DUMP_FILE"
test -s "$DUMP_FILE" || fail "pg_dump produced an empty backup"
pg_restore --list "$DUMP_FILE" >/dev/null || fail "backup archive is unreadable"
echo "PASS: complete custom-format logical backup created and archive list verified"

# Restore into a new database, never over the source.
psql "$PG_ADMIN_URL" -X -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS jata_recovery_restore WITH (FORCE)"
psql "$PG_ADMIN_URL" -X -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE jata_recovery_restore"
RESTORE_URL="$(node -e 'const u=new URL(process.env.DATABASE_URL);u.pathname="/jata_recovery_restore";u.search="";u.hash="";process.stdout.write(u.toString())')"
pg_restore --exit-on-error --single-transaction --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_URL" "$DUMP_FILE"
echo "PASS: backup restored into a separate empty database"

# Compare schema definitions after restore. PostgreSQL 18 emits a random psql
# restrict token in each dump. Ignore dump comments and those random wrapper lines.
pg_dump "$PG_SOURCE_URL" --schema-only --no-owner --no-privileges --no-comments --file="$SOURCE_SCHEMA"
pg_dump "$RESTORE_URL" --schema-only --no-owner --no-privileges --no-comments --file="$RESTORED_SCHEMA"
sed -i '/^\\restrict /d; /^\\unrestrict /d; /^--/d' "$SOURCE_SCHEMA" "$RESTORED_SCHEMA"
if ! diff -u "$SOURCE_SCHEMA" "$RESTORED_SCHEMA" > "${RUNNER_TEMP:-/tmp}/jata-schema-diff.txt"; then
  sed -n '1,160p' "${RUNNER_TEMP:-/tmp}/jata-schema-diff.txt"
  fail "restored schema differs from source schema"
fi
echo "PASS: normalized source and restored schema dumps match"

# Generate exact row-count queries for every user table in every non-system schema.
psql "$PG_SOURCE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' -c "
SELECT format('SELECT %L, count(*)::bigint FROM %I.%I;', schemaname, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename;
" > "$COUNT_SQL"
test -s "$COUNT_SQL" || fail "no user tables found for row-count comparison"
psql "$PG_SOURCE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' -f "$COUNT_SQL" | sort > "$SOURCE_COUNTS"
psql "$RESTORE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' -f "$COUNT_SQL" | sort > "$RESTORED_COUNTS"
diff -u "$SOURCE_COUNTS" "$RESTORED_COUNTS" || fail "one or more restored table row counts differ"
TABLES="$(wc -l < "$SOURCE_COUNTS" | tr -d ' ')"
test "$TABLES" -gt 0 || fail "row-count comparison produced no table results"
echo "PASS: row counts match across all $TABLES user tables"

# The migration ledger must survive exactly, not merely be recreated by migrate deploy.
HAS_LEDGER="$(psql "$PG_SOURCE_URL" -X -v ON_ERROR_STOP=1 -At -c "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")"
if [ "$HAS_LEDGER" = "t" ]; then
  SOURCE_LEDGER="$(psql "$PG_SOURCE_URL" -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*)::text || ':' || (count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))::text FROM public._prisma_migrations")"
  RESTORED_LEDGER="$(psql "$RESTORE_URL" -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*)::text || ':' || (count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))::text FROM public._prisma_migrations")"
  [ "$SOURCE_LEDGER" = "$RESTORED_LEDGER" ] || fail "migration ledger differs after restore"
  echo "PASS: migration ledger rows and completed-state counts match"
fi

echo "RESULT: PASS — disposable full-database backup/restore, schema and row-count comparison"
