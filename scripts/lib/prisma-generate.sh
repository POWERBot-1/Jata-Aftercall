#!/usr/bin/env bash
# `prisma generate` with the directUrl default applied.
#
# `prisma/schema.prisma` now declares `directUrl = env("DIRECT_URL")`, and a declared-but-unset
# variable is a hard P1012. Every place that generates the client must therefore supply a sane
# DIRECT_URL — CI jobs, the npm postinstall, and the build gate. Routing them all through this one
# wrapper is what makes "an unset DIRECT_URL cannot cause P1012" true by construction instead of by
# remembering to add a variable in nine places.
#
# It does NOT weaken the pooled-connection guard: that lives in scripts/migrate.sh and refuses to
# migrate over PgBouncer. Generate only needs the schema to parse.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/prisma-env.sh
. "$here/prisma-env.sh"

exec npx prisma generate "$@"
