#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Production DB init migration gate (Option I, fresh)
# Behavior:
# - If DATABASE_URL not set → skip migrations (preview/offline), exit 0
# - If DATABASE_URL set → consult the migration target guard first
# - Guard refuses → exit 1 BEFORE prisma is invoked
# - Guard allows → run prisma migrate deploy, fail fast on error
# - No seed, no destructive SQL, no secret logging

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] DATABASE_URL not set — skipping migrations (preview/offline mode)"
  exit 0
fi

# The guard decides whether this environment is entitled to migrate this
# target. It runs before prisma and fails closed: on refusal, npx is never
# reached. See docs/MIGRATION_TARGET_GUARD.md.
echo "[migrate] checking migration target..."
if ! node scripts/lib/migration-target-guard.mjs check; then
  echo "[migrate] ERROR: migration target refused — aborting before prisma"
  exit 1
fi

echo "[migrate] DATABASE_URL set — running prisma migrate deploy..."

# Run migrate deploy, capture output without leaking the URL.
# Prisma reads DATABASE_URL from the environment; we never echo it.
#
# Command tracing stays off for the remainder of this script. A previous
# revision re-enabled `set -x` after the migration, which would have traced
# every later line — a latent credential-leak path in a script that holds
# DATABASE_URL.
set +x
if ! npx prisma migrate deploy; then
  echo "[migrate] ERROR: prisma migrate deploy failed — aborting build"
  echo "[migrate] Check DATABASE_URL connectivity and migration files"
  exit 1
fi

echo "[migrate] Migrations deployed successfully"
exit 0
