#!/usr/bin/env bash
# One fail-closed entry point for Prisma Client generation in install, CI, and build.
# Generation validates schema and downloads the platform engine; it never connects to PostgreSQL.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

expected="5.22.0"
cli_version="$(node -p "require('./node_modules/prisma/package.json').version")"
client_version="$(node -p "require('./node_modules/@prisma/client/package.json').version")"
if [[ "$cli_version" != "$expected" || "$client_version" != "$expected" ]]; then
  echo "BLOCKED: Prisma CLI/client version mismatch (CLI=$cli_version, client=$client_version; expected=$expected)." >&2
  exit 1
fi

# prisma generate parses datasource env() declarations but does not connect to PostgreSQL.
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="postgresql://prisma_generate:prisma_generate@127.0.0.1:5432/prisma_generate?schema=public"
fi
if [[ -z "${DIRECT_URL:-}" ]]; then
  export DIRECT_URL="$DATABASE_URL"
fi

echo "[prisma] Generating Prisma Client with Prisma $expected"
if [[ ! -x "$repo_root/node_modules/.bin/prisma" ]]; then
  echo "BLOCKED: local Prisma CLI is missing. Run npm ci with devDependencies enabled." >&2
  exit 1
fi
exec "$repo_root/node_modules/.bin/prisma" generate --schema "$repo_root/prisma/schema.prisma" "$@"
