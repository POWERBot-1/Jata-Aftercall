#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Production DB init migration gate (Option I, fresh)
# Behavior:
# - If DATABASE_URL not set → skip migrations (preview/offline)
# - If DATABASE_URL set → run prisma migrate deploy, fail fast on error
# - No seed, no destructive, no secret logging

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[migrate] DATABASE_URL not set — skipping migrations (preview/offline mode)"
  exit 0
fi

echo "[migrate] DATABASE_URL set — running prisma migrate deploy..."

# Run migrate deploy, capture output without leaking URL
# Prisma reads DATABASE_URL from env, we don't echo it
set +x
if ! npx prisma migrate deploy; then
  echo "[migrate] ERROR: prisma migrate deploy failed — aborting build"
  echo "[migrate] Check DATABASE_URL connectivity and migration files"
  exit 1
fi
set -x

echo "[migrate] Migrations deployed successfully"
exit 0
