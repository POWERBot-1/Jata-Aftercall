#!/usr/bin/env bash
# Every Prisma CLI invocation in CI and in the build goes through here.
#
# `prisma/schema.prisma` declares `directUrl = env("DIRECT_URL")`. Prisma validates the datasource
# whenever it loads the schema — so `validate`, `generate`, `migrate`, `migrate status`, `migrate
# diff` and `db execute` ALL fail with P1012 when the variable is unset, even though only Migrate
# ever uses the direct connection.
#
# Sourcing prisma-env.sh here means no workflow, script or developer has to add a second variable to
# work. It does not weaken the pooled-connection guard: `scripts/migrate.sh` still refuses to migrate
# through a pooler before this is ever reached.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/lib/prisma-env.sh
. "$here/prisma-env.sh"

exec npx prisma "$@"
