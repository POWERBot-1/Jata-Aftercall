#!/usr/bin/env bash
# One fail-closed entry point for Prisma Client generation in install, CI, and build.
# Generation validates schema and downloads the platform engine; it never connects to PostgreSQL.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# Prisma validates every env() reference even though generate does not connect to a DB.
# Use a loopback-only placeholder when no real DATABASE_URL is configured; never print it.
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="postgresql://[redacted]@127.0.0.1:5432/prisma_generate?schema=public"
fi
if [[ -z "${DIRECT_URL:-}" ]]; then
  export DIRECT_URL="$DATABASE_URL"
fi

# Optional operator-supplied mirror is honored by Prisma; otherwise its official CDN is used.
echo "[prisma] Generating Prisma Client with Prisma 5.22.0"

# When dependencies are installed, use the verified local CLI and keep it in lockstep
# with the generated client. When they are not (e.g. the zero-dependency migration-guard
# job), fall back to `npx prisma generate` so the build gate still runs without
# application packages.
if [[ -x "$repo_root/node_modules/.bin/prisma" ]]; then
  expected="5.22.0"
  cli_version="$(node -p "require('./node_modules/prisma/package.json').version")"
  client_version="$(node -p "require('./node_modules/@prisma/client/package.json').version")"
  if [[ "$cli_version" != "$expected" || "$client_version" != "$expected" ]]; then
    echo "BLOCKED: Prisma CLI/client version mismatch (CLI=$cli_version, client=$client_version; expected=$expected)." >&2
    exit 1
  fi
  exec "$repo_root/node_modules/.bin/prisma" generate --schema "$repo_root/prisma/schema.prisma" "$@"
fi
exec npx prisma generate "$@"
