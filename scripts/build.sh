#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Isolated build gate (Option I, fresh)
# Production: DATABASE_URL present → migrate → generate → next build (fail if migrate fails)
# Preview/offline: DATABASE_URL absent → skip migrate → generate with fallback → next build

echo "[build] Starting JATA AFTERCALL build gate (Option I)"

# Step 1: Migration gate (isolated)
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[build] DATABASE_URL detected — invoking migration gate"
  bash scripts/migrate.sh
  # If migrate.sh fails, set -e will prevent next build
else
  echo "[build] DATABASE_URL not set — skipping migration gate (preview/offline)"
fi

# Step 2: Prisma generate
echo "[build] Running prisma generate..."
if [ -n "${DATABASE_URL:-}" ]; then
  npx prisma generate
else
  if ! npx prisma generate; then
    echo "[build] prisma generate failed (offline) — continuing with fallback"
  fi
fi

# Step 3: Next.js build
echo "[build] Running next build..."
npx next build

echo "[build] Build completed successfully"
