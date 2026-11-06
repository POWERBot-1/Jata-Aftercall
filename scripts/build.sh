#!/usr/bin/env bash
set -euo pipefail

echo "[build] Starting JATA AFTERCALL build gate"

# Production migrations remain an explicit separate gate; a build must never migrate.
if [[ -n "${DATABASE_URL:-}" && "${RUN_MIGRATIONS_DURING_BUILD:-}" == "true" ]]; then
  echo "BLOCKED: migrations are not part of the build. Run the approved migration workflow separately." >&2
  exit 1
fi

echo "[build] Generating Prisma Client (fail-closed)"
bash scripts/lib/prisma-generate.sh
node scripts/test/check-prisma-client.cjs

echo "[build] Running Next.js production build"
npx next build --webpack
echo "[build] Build completed successfully"
