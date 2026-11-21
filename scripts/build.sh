#!/usr/bin/env bash
set -euo pipefail

# JATA AFTERCALL — Isolated build gate (Option I, fresh)
# Production: DATABASE_URL present → migrate → generate (fail the build if generate fails) → next build
# Preview/offline: DATABASE_URL absent → skip migrate → generate with fallback → next build

echo "[build] Starting JATA AFTERCALL build gate (Option I)"

# A Vercel Preview must never inherit production database, payment or storage configuration.
if [ "${VERCEL_ENV:-}" = "preview" ] && [ -n "${VERCEL_URL:-}" ]; then
  echo "[build] Validating isolated Preview environment"
  node scripts/ci/check-preview-environment-isolation.mjs
fi

# `prisma generate` reads the datasource, and a declared-but-unset `directUrl` is a hard P1012. This
# defaults DIRECT_URL to DATABASE_URL when unset so no environment has to add a second variable to
# build; the guard in migrate.sh refuses the one case where that default would be unsafe.
# shellcheck source=scripts/lib/prisma-env.sh
. "$(dirname "$0")/lib/prisma-env.sh"

# Step 1: Migration gate (isolated)
if [ -n "${DATABASE_URL:-}" ]; then
  echo "[build] DATABASE_URL detected — invoking migration gate"
  bash scripts/migrate.sh
  # If migrate.sh fails, set -e will prevent next build
else
  echo "[build] DATABASE_URL not set — skipping migration gate (preview/offline)"
fi

# Step 2: Prisma generate
# Never continue with a stale, stub, or partially generated client. The wrapper supplies
# loopback-only datasource placeholders when DATABASE_URL is absent and performs no DB I/O.
echo "[build] Generating Prisma Client (fail-closed)..."
bash scripts/lib/prisma-generate.sh

# Verify the generated client can be loaded before Next.js compiles server bundles.
node scripts/test/check-prisma-client.cjs

# Explicit one-time synthetic fixture seed. This can run only on the owner-authorized PR125 Preview branch.
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${JATA_RUN_STAGING_ACCEPTANCE:-}" = "true" ]; then
  if [ "${VERCEL_GIT_COMMIT_REF:-}" != "remediation/owner-authorized-acceptance-v2-2026-11-16" ]; then
    echo "[build] Refusing PR125 fixture seed outside its pinned Preview branch."
    exit 1
  fi
  if [ "${JATA_ALLOW_FIXTURE_SEED:-}" != "true" ] || [ -z "${DEMO_FIXTURE_PASSWORD:-}" ]; then
    echo "[build] PR125 staging acceptance requires the explicit fixture-seed flag and one-time demo password."
    exit 1
  fi
  case "${PAYSTACK_PUBLIC_KEY:-}" in pk_test_*) ;; *) echo "[build] Refusing staging acceptance without a Paystack test public key."; exit 1 ;; esac
  case "${PAYSTACK_SECRET_KEY:-}" in sk_test_*) ;; *) echo "[build] Refusing staging acceptance without a Paystack test secret key."; exit 1 ;; esac
  echo "[build] Running the guarded synthetic fixture seed on the isolated Preview database."
  env -u ADMIN_EMAILS NODE_ENV=test npm run seed
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

# Run authenticated Neon + Paystack test-mode acceptance only when explicitly enabled for PR125 Preview.
if [ "${VERCEL_ENV:-}" = "preview" ] && [ "${JATA_RUN_STAGING_ACCEPTANCE:-}" = "true" ]; then
  node scripts/ci/run-pr125-staging-acceptance.mjs
fi

echo "[build] Build completed successfully"
