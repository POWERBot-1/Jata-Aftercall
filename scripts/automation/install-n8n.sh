#!/usr/bin/env bash
# Install/verify the reviewed n8n version without changing npm/system TLS policy.
set -euo pipefail
EXPECTED_N8N_VERSION="${EXPECTED_N8N_VERSION:-2.35.7}"

if command -v n8n >/dev/null 2>&1; then
  actual="$(n8n --version)"
  printf 'n8n already installed: %s (%s)\n' "$actual" "$(command -v n8n)"
  if [[ "$actual" != "$EXPECTED_N8N_VERSION" ]]; then
    echo "BLOCKED: installed n8n version differs from pinned $EXPECTED_N8N_VERSION; review upgrade/downgrade explicitly." >&2
    exit 2
  fi
else
  echo "Installing n8n@$EXPECTED_N8N_VERSION via npm with default TLS verification..."
  npm install --global "n8n@$EXPECTED_N8N_VERSION"
fi

command -v n8n
actual="$(n8n --version)"
printf 'Verified n8n version: %s\n' "$actual"
[[ "$actual" == "$EXPECTED_N8N_VERSION" ]]
