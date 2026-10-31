#!/usr/bin/env node
// Fail before a full suite run if install scripts skipped Prisma generation. This
// does not open a database connection, run migrations, or assert DB readiness.
try {
  const { PrismaClient, Prisma } = require('@prisma/client');
  if (typeof PrismaClient !== 'function' || !Array.isArray(Prisma?.dmmf?.datamodel?.models) || Prisma.dmmf.datamodel.models.length === 0) {
    throw new Error('generated model metadata is missing');
  }
  console.log(`Prisma client preflight: generated metadata available (${Prisma.dmmf.datamodel.models.length} models). No database connection was checked.`);
} catch (error) {
  console.error('BLOCKED: generated Prisma Client is unavailable. Run npm ci, then bash scripts/lib/prisma-generate.sh; generation requires access to the official Prisma engine distribution. It does not require a database connection. See docs/agents/LOCAL_TEST_ENVIRONMENT.md.');
  console.error(`Cause: ${error.message}`);
  process.exitCode = 1;
}
