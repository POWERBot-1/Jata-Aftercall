#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Isolated build gate (Option I, fresh)
# Production: DATABASE_URL present → migrate → generate (fail the build if generate fails) → next build
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
# When DATABASE_URL is configured, generate failure is a production build gate.
# Do not continue into a stub client in that case.
echo "[build] Running prisma generate..."
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[build] DATABASE_URL detected — prisma generate failure fails the build"
  npx prisma generate
else
  if ! npx prisma generate; then
    echo "[build] prisma generate failed (offline) — continuing with fallback"
  fi
fi

# Step 3: Next.js build
# `--webpack` is deliberate for the Next 16 stage: Turbopack (the 16 default) does not emit
# app-build-manifest.json / react-loadable-manifest.json, names chunks by hash only, and extracts
# no .next/static/css, which the release verification stack depends on (bundle evidence, the
# storefront Motion mini-chunk check, the #418 throw diagnostic). Keeping one variable changed —
# the framework and its vendored React — is what makes this upgrade reviewable. Turbopack adoption
# is a separate follow-up with its own re-baselining; see RELEASE_REPORT_2026-10-13.md §N.
echo "[build] Running next build (webpack)..."
npx next build --webpack

echo "[build] Build completed successfully"
