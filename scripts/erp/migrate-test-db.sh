#!/usr/bin/env bash
# Apply the committed Prisma migrations to a *disposable* PostgreSQL database with psql.
#
# Why this exists: `prisma migrate deploy` needs the native schema-engine binary, which the build
# sandbox cannot download (binaries.prisma.sh is blocked). Worse, with an unusable engine path the
# CLI exits 0 without applying anything, so a green exit code is not evidence. This script runs the
# exact SQL that `migrate deploy` would run, in the same order, with ON_ERROR_STOP so a failure is a
# failure.
#
# It is a verification tool, not a replacement for `prisma migrate deploy` in production: it does
# not write `_prisma_migrations`, so a database migrated this way must be reset before Prisma's
# migration engine is used against it.
#
# Usage:
#   DATABASE_URL=postgresql://user@127.0.0.1:5432/db bash scripts/erp/migrate-test-db.sh [--reset] [--up-to <migration_dir>]
#
#   --reset    drop and recreate the `public` schema first (a clean database)
#   --up-to    stop before the named migration directory, to reproduce an older release
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="$ROOT/prisma/migrations"
PSQL="${PSQL:-psql}"
RESET="no"
UP_TO=""

while [ $# -gt 0 ]; do
  case "$1" in
    --reset) RESET="yes"; shift ;;
    --up-to) UP_TO="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required (point it at a disposable database, never production)" >&2
  exit 2
fi

# psql does not understand the Prisma-only `?schema=` query parameter.
URL="${DATABASE_URL%\?*}"
if ! command -v "$PSQL" >/dev/null 2>&1; then
  echo "psql not found on PATH; set PSQL=/path/to/psql" >&2
  exit 2
fi

if [ "$RESET" = "yes" ]; then
  "$PSQL" "$URL" -v ON_ERROR_STOP=1 -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  echo "[migrate-test-db] public schema reset"
fi

applied=0
for dir in $(ls -1 "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}_' | sort); do
  if [ -n "$UP_TO" ] && [ "$dir" = "$UP_TO" ]; then
    echo "[migrate-test-db] stopping before $dir as requested"
    break
  fi
  file="$MIGRATIONS_DIR/$dir/migration.sql"
  if [ ! -f "$file" ]; then
    echo "[migrate-test-db] MISSING migration.sql in $dir" >&2
    exit 1
  fi
  echo "[migrate-test-db] applying $dir"
  "$PSQL" "$URL" -v ON_ERROR_STOP=1 -q -f "$file"
  applied=$((applied + 1))
done

tables=$("$PSQL" "$URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")
echo "[migrate-test-db] applied $applied migration(s); $tables tables in public"
