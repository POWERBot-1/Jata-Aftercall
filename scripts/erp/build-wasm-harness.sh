#!/usr/bin/env bash
# Build a test-only Prisma client that runs on Prisma's WASM query engine + @prisma/adapter-pg.
#
# Why: `prisma generate` needs to copy (and, when missing, download) the native query engine from
# binaries.prisma.sh. Some sandboxes cannot reach that host, so `prisma generate` fails and no
# database-backed test can run at all. Prisma ships the same query engine compiled to WebAssembly
# in @prisma/client/runtime/query_engine_bg.postgresql.wasm, and a driver adapter can drive
# PostgreSQL through `pg`. This script wires those together in a directory outside Git.
#
# This is a *verification harness*, not a production path:
#   - the schema copy adds `previewFeatures = ["driverAdapters"]` (driver adapters are preview in
#     Prisma 5.x), so it is not byte-identical to prisma/schema.prisma;
#   - it is generated against the committed schema, models and fields are identical;
#   - the loader shim replaces the bundler-only `import('...wasm?module')` with a file read.
# CI uses the normal native engine instead (`prisma generate` + `prisma migrate deploy`).
#
# Usage:
#   bash scripts/erp/build-wasm-harness.sh [harness-dir]
#   PRISMA_TEST_DATABASE_URL=... PRISMA_WASM_HARNESS_DIR=<harness-dir> npx vitest run tests/integration/erp-pro-postgres.test.ts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS="${1:-$ROOT/node_modules/.erp-wasm-harness}"
ENGINE_STUB_DIR="${TMPDIR:-/tmp}/erp-prisma-engine-stubs"
PRISMA_VERSION="$(node -p "require('$ROOT/node_modules/prisma/package.json').version")"
SCHEMA_WASM_VERSION="$(node -p "require('$ROOT/node_modules/@prisma/engines-version/package.json').version" 2>/dev/null || true)"

mkdir -p "$HARNESS" "$ENGINE_STUB_DIR/generated"

echo "[harness] installing adapter packages into $HARNESS"
npm install --prefix "$HARNESS" --no-save --no-audit --no-fund "@prisma/adapter-pg@$PRISMA_VERSION" "pg@8.11.5" >/dev/null

# The generator reads the schema through prisma-schema-wasm. Newer CLI builds resolve it from
# node_modules; install it as a dev-only aid when absent.
if [ ! -d "$ROOT/node_modules/@prisma/prisma-schema-wasm" ] && [ -n "$SCHEMA_WASM_VERSION" ]; then
  echo "[harness] installing @prisma/prisma-schema-wasm@$SCHEMA_WASM_VERSION"
  npm install --prefix "$ROOT" --no-save --no-audit --no-fund "@prisma/prisma-schema-wasm@$SCHEMA_WASM_VERSION" >/dev/null
fi

# `prisma generate` without --no-engine insists on a native engine file. Point it at empty stubs:
# the file is copied but never loaded, because the client is constructed with a driver adapter.
engine_stub="$ENGINE_STUB_DIR/engine-stub"
: > "$engine_stub"
chmod +x "$engine_stub"

echo "[harness] writing schema copy with driverAdapters preview"
node - "$ROOT" "$HARNESS" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [root, harness] = process.argv.slice(2);
const source = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const generator = 'generator client {\n  provider = "prisma-client-js"\n}';
if (!source.includes(generator)) throw new Error("unexpected generator block in prisma/schema.prisma");
const replaced = source.replace(generator, [
  "generator client {",
  '  provider        = "prisma-client-js"',
  '  previewFeatures = ["driverAdapters"]',
  `  output          = "${path.join(harness, "generated").replace(/\\/g, "\\\\")}"`,
  "}",
].join("\n"));
fs.writeFileSync(path.join(harness, "schema.prisma"), replaced);
NODE

echo "[harness] generating client"
(
  cd "$ROOT"
  PRISMA_SCHEMA_ENGINE_BINARY="$engine_stub" \
  PRISMA_QUERY_ENGINE_LIBRARY="$engine_stub" \
  PRISMA_CLI_QUERY_ENGINE_TYPE=library \
  npx prisma generate --schema "$HARNESS/schema.prisma" >/dev/null
)

echo "[harness] patching the wasm loader for plain Node"
cat > "$HARNESS/generated/wasm-worker-loader.mjs" <<'JS'
// Test-harness shim. Prisma's generated client expects a bundler-specific loader
// (`import('./query_engine_bg.wasm?module')`), which plain Node cannot resolve. This module
// provides the same shape from disk: a promise resolving to a namespace whose `default` is the
// compiled WebAssembly module. The engine itself is Prisma's own query_engine_bg.wasm.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("./query_engine_bg.wasm", import.meta.url));
const compiled = new WebAssembly.Module(readFileSync(file));
export default Promise.resolve({ default: compiled });
JS
cp "$HARNESS/generated/wasm-worker-loader.mjs" "$HARNESS/generated/wasm-edge-light-loader.mjs"

MODELS="$(node - "$ROOT" "$HARNESS" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [root, harness] = process.argv.slice(2);
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]).length;
const generated = fs.readFileSync(path.join(harness, "generated/index.d.ts"), "utf8");
console.log(`${models} ${generated.length}`);
NODE
)"
echo "[harness] done: $HARNESS"
echo "[harness] schema models / index.d.ts bytes: $MODELS"
echo "[harness] run with PRISMA_WASM_HARNESS_DIR=$HARNESS and PRISMA_TEST_DATABASE_URL set"
