#!/usr/bin/env bash
# Test-only: generates the driverAdapters Prisma client used by the database-backed suite when the
# native query-engine / schema-engine binaries cannot be downloaded (sandbox TLS policy).
#
# What it does:
#   * generates the client from tests/db/prisma/schema.wasm-test.prisma (a copy of the production
#     schema with previewFeatures = ["driverAdapters"] and a harness output path). The production
#     schema and the pinned production client are NOT changed.
#   * the query engine that runs is Prisma's own engine compiled to WebAssembly, shipped inside the
#     npm package @prisma/client (runtime/query_engine_bg.postgresql.wasm), used via @prisma/adapter-pg.
#   * the native-engine env vars point at a clearly labelled placeholder file. Nothing is downloaded,
#     no mirror is used, and TLS verification is untouched. The placeholder is never executed by the
#     WASM client.
#
# Output: node_modules/.jata-wasm-harness/{generated,node_modules,placeholder}
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
harness="$root/node_modules/.jata-wasm-harness"
placeholder_dir="$harness/placeholder"
placeholder="$placeholder_dir/libquery_engine-placeholder.so.node"

mkdir -p "$placeholder_dir"
ln -sfn "$root/node_modules" "$harness/node_modules"
printf '%s\n' \
  "PLACEHOLDER — NOT A PRISMA ENGINE." \
  "Written by scripts/test-db/prepare-wasm-harness.sh so that prisma generate does not attempt a download." \
  "The WASM driver-adapter client never loads this file." > "$placeholder"

# Generation needs the schema to parse; the datasource URLs are never connected to.
export DATABASE_URL="${DATABASE_URL:-postgresql://placeholder@127.0.0.1:5432/placeholder}"
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
export PRISMA_QUERY_ENGINE_LIBRARY="$placeholder"
export PRISMA_SCHEMA_ENGINE_BINARY="$placeholder"
export PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
export PRISMA_GENERATE_SKIP_AUTOINSTALL=1

cd "$root"
npx prisma generate --schema tests/db/prisma/schema.wasm-test.prisma
test -f "$harness/generated/wasm.js" || { echo "harness generation produced no wasm.js" >&2; exit 1; }
echo "WASM harness ready: $harness/generated/wasm.js"

# Node loader for the WASM engine. Prisma's shipped loaders target edge runtimes (workerd, edge-light)
# and resolve `import('./query_engine_bg.wasm')` to undefined under Node. This loader reads the SAME
# WebAssembly file that ships in @prisma/client and compiles it with WebAssembly.compile. It is test
# harness code only; nothing in lib/ or the production client changes.
cat > "$harness/generated/node-wasm-loader.mjs" <<'LOADER'
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const bytes = await readFile(join(here, "query_engine_bg.wasm"));
const compiled = await WebAssembly.compile(bytes);
export default Promise.resolve({ default: compiled });
LOADER
node -e '
const fs = require("fs");
const p = process.argv[1];
const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
pkg.imports["#wasm-engine-loader"].default = "./node-wasm-loader.mjs";
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
' "$harness/generated/package.json"
echo "Node WASM loader installed into $harness/generated"
