#!/usr/bin/env bash
# Local-only helper: obtain a real Chromium for the browser acceptance journeys.
# NOT part of the product, the build, or CI. Both hosts this needs are reachable from the
# sandbox (npm registry); Chrome's own CDN and deb.debian.org are not, so the Amazon Linux
# layer that ships with @sparticuz/chromium supplies the NSS/NSPR libraries.
set -euo pipefail
DEST="${1:-/home/user/chromeenv}"
mkdir -p "$DEST"
[ -d "$DEST/node_modules/@sparticuz/chromium" ] || (cd "$DEST" && npm init -y >/dev/null 2>&1 && npm install --no-audit --no-fund @sparticuz/chromium@153.0.0 >/dev/null)
cd "$DEST"
node -e '
const c = require("@sparticuz/chromium").default;
c.executablePath().then((p) => console.log(p)).catch((e) => { console.error(e); process.exit(1); });
' >/dev/null
LAYER_PKG="$DEST/node_modules/@sparticuz/chromium"
node -e '
const fs = require("fs"), zlib = require("zlib");
const pkg = process.argv[1];
fs.writeFileSync("/tmp/al2023.tar", zlib.brotliDecompressSync(fs.readFileSync(pkg + "/bin/al2023.tar.br")));
' "$LAYER_PKG"
rm -rf /tmp/al2023 && mkdir -p /tmp/al2023 && tar -xf /tmp/al2023.tar -C /tmp/al2023
LD_LIBRARY_PATH=/tmp/al2023/lib /tmp/chromium --version
