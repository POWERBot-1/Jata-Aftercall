#!/usr/bin/env node
// Fail before a full suite run if install scripts skipped Prisma generation. This
// does not open a database connection, run migrations, or assert DB readiness.
//
// When @prisma/client is not installed (zero-dependency environments such as the
// migration-guard job, which deliberately runs with no node_modules), there is
// nothing to validate — log a notice and let the build continue. When it IS
// installed, validate it fail-closed: a missing or broken client blocks the build.
let client;
try {
  client = require('@prisma/client');
} catch (error) {
  console.log(`Prisma client preflight: @prisma/client not installed — nothing to validate (no database connection was checked).`);
  process.exit(0);
}

const { PrismaClient, Prisma } = client;
if (typeof PrismaClient !== 'function' || !Array.isArray(Prisma?.dmmf?.datamodel?.models) || Prisma.dmmf.datamodel.models.length === 0) {
  console.error('BLOCKED: generated Prisma Client is unavailable. Run npm ci, then bash scripts/lib/prisma-generate.sh; generation requires access to the official Prisma engine distribution. It does not require a database connection. See docs/agents/LOCAL_TEST_ENVIRONMENT.md.');
  process.exitCode = 1;
} else {
  console.log(`Prisma client preflight: generated metadata available (${Prisma.dmmf.datamodel.models.length} models). No database connection was checked.`);
}
