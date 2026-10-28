#!/usr/bin/env bash
# Sourced by scripts/build.sh and scripts/migrate.sh. Never executed on its own.
#
# `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`. A referenced-but-unset variable is
# a hard Prisma failure (P1012) in every environment that runs `generate`/`migrate` — including CI and
# developer machines, which have no pooler and therefore no second URL to supply.
#
# So: default DIRECT_URL to DATABASE_URL when it is unset.
#
# That default is safe because `scripts/lib/direct-url-guard.mjs` refuses the only case where it would
# be wrong: a pooled DATABASE_URL (Neon's PgBouncer endpoint) with no genuinely direct DIRECT_URL. In
# that case the build fails closed, before Prisma runs, with a message naming the fix — instead of
# failing later with P1002 or leaving a migration half-applied (P3009).
#
# Nothing here echoes either URL.

if [ -n "${DATABASE_URL:-}" ] && [ -z "${DIRECT_URL:-}" ]; then
  export DIRECT_URL="$DATABASE_URL"
  export JATA_DIRECT_URL_DEFAULTED=1
fi
