#!/usr/bin/env bash
# Local-only verification harness. NOT part of the product build, CI, or a deployment.
#
# This sandbox cannot reach binaries.prisma.sh, so the native Prisma query engine cannot be
# downloaded. Everything below runs the SAME code against a real PostgreSQL database; the
# only substitution is Prisma's own query engine compiled to WebAssembly (plus the pg
# driver adapter), which is what tests/helpers/prisma-client.ts already does for the
# database suites. It is not a mock, and it is never enabled outside this script.
#
# Usage:  bash scripts/dev/local-verify-env.sh [dbname]
# Then:   source /tmp/jata-local.env
set -euo pipefail
DB="jata_e2e"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VENV=/tmp/pgv
PGBIN="$VENV/lib/python3.11/site-packages/pgserver/pginstall/bin"
URL="postgresql://jata:jata@127.0.0.1:5432/$DB?schema=public"

[ -d "$VENV" ] || (cd /tmp && python3 -m venv pgv && ./pgv/bin/pip install -q pgserver)
if ! "$PGBIN/psql" -h 127.0.0.1 -p 5432 -U postgres -tAc "select 1" >/dev/null 2>&1; then
  rm -rf /tmp/pgdata-local
  "$PGBIN/initdb" -D /tmp/pgdata-local -U postgres --auth=trust >/dev/null
  "$PGBIN/pg_ctl" -D /tmp/pgdata-local -o "-p 5432 -k /tmp -c listen_addresses=127.0.0.1" -l /tmp/pg-local.log start >/dev/null
  sleep 2
  "$PGBIN/psql" -h 127.0.0.1 -p 5432 -U postgres -c "CREATE ROLE jata LOGIN SUPERUSER PASSWORD 'jata';" >/dev/null
fi
# A deterministic run starts from an empty database: dropping it is what makes the replay
# below meaningful. Local disposable database only — never point this at anything else.
"$PGBIN/dropdb" -h 127.0.0.1 -p 5432 -U postgres --if-exists "$DB" >/dev/null 2>&1 || true
"$PGBIN/createdb" -h 127.0.0.1 -p 5432 -U postgres -O jata "$DB"

# Replay the committed migration history from empty, exactly as the release evidence needs.
FAILED=""
for dir in $(ls "$ROOT/prisma/migrations" | grep -v migration_lock); do
  "$PGBIN/psql" -h 127.0.0.1 -p 5432 -U jata -d "$DB" -v ON_ERROR_STOP=1 -q \
    -f "$ROOT/prisma/migrations/$dir/migration.sql" >/dev/null 2>&1 || FAILED="$FAILED $dir"
done
[ -z "$FAILED" ] || { echo "MIGRATION REPLAY FAILED:$FAILED" >&2; exit 1; }

cd "$ROOT"
bash scripts/erp/build-wasm-harness.sh >/dev/null
cat > /tmp/jata-local.env <<EOF
export JATA_LOCAL_WASM_DATABASE=1
export JATA_LOCAL_WASM_HARNESS=$ROOT/node_modules/.erp-wasm-harness
export DATABASE_URL="$URL"
export DIRECT_URL="$URL"
export PRISMA_TEST_DATABASE_URL="$URL"
export PRISMA_WASM_HARNESS_DIR=$ROOT/node_modules/.erp-wasm-harness
export PRISMA_QUERY_ENGINE_LIBRARY=/usr/bin/true
export PRISMA_SCHEMA_ENGINE_BINARY=/usr/bin/true
export NODE_ENV=test
export JATA_ALLOW_FIXTURE_SEED=true
export AUTH_SECRET=interactive-business-e2e-test-secret
export NEXTAUTH_SECRET=interactive-business-e2e-test-secret
export STUDIO_BROWSER_TEST_WRITE=1
export CHROME_PATH=/tmp/chromium
export LD_LIBRARY_PATH=/tmp/al2023/lib
EOF
cat > /tmp/jata-local-shim.js <<'SHIM'
// Injected into the generated client AFTER any build/regenerate. Local verification only.
if (process.env["JATA_LOCAL_WASM_DATABASE"] === "1") {
  const base = String(process.env["JATA_LOCAL_WASM_HARNESS"] || "").replace(/\/+$/, "");
  const wasm = require(base + "/generated/wasm.js");
  const { PrismaPg } = require(base + "/node_modules/@prisma/adapter-pg");
  const { Pool } = require(base + "/node_modules/pg");
  class PrismaClient extends wasm.PrismaClient {
    constructor(options = {}) { const { datasources, datasourceUrl, ...rest } = options || {};
      super({ ...rest, adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) }); }
  }
  module.exports = Object.assign({}, wasm, { PrismaClient });
  return;
}
SHIM
echo "apply shim with: bash scripts/dev/local-verify-env.sh --shim (after every build)"

echo "ready: source /tmp/jata-local.env"

# Apply the local Prisma engine shim to the generated client. Run AFTER any build or
# `prisma generate`, because both rewrite it.
if [ "${APPLY_SHIM:-0}" = "1" ]; then
  python3 - "$ROOT/node_modules/.prisma/client/index.js" <<'PYSHIM'
import sys
path = sys.argv[1]
s = open(path).read()
shim = open("/tmp/jata-local-shim.js").read()
if "JATA_LOCAL_WASM_DATABASE" not in s:
    open(path, "w").write(shim + s)
print("shim applied")
PYSHIM
fi
