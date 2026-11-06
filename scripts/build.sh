#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Isolated build gate
# Preserve the existing production migration gate; Prisma generation itself never connects to PostgreSQL.
echo "[build] Starting JATA AFTERCALL build gate"

# Keep DATABASE_URL/DIRECT_URL semantics identical to the migration path.
source scripts/lib/prisma-env.sh

# Keep the established migration behaviour unchanged.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[build] DATABASE_URL detected — invoking migration gate"
  bash scripts/migrate.sh
else
  echo "[build] DATABASE_URL not set — skipping migration gate (preview/offline)"
fi

# Always use the pinned local CLI and fail if native generation or client preflight fails.
echo "[build] Generating Prisma Client (fail-closed)"
bash scripts/lib/prisma-generate.sh
node scripts/test/check-prisma-client.cjs

echo "[build] Running next build (webpack)"
npx next build --webpack
echo "[build] Build completed successfully"
