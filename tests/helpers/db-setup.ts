/**
 * Setup for the database-only vitest configuration (vitest.db.config.ts). Nothing here runs in the
 * default unit configuration.
 *
 * lib/db.ts creates its own client through a CommonJS `require("@prisma/client")`, which vitest's
 * module alias does not intercept. Without this file, that path would build the default client,
 * which has no engine in this sandbox. Setting `globalThis.__prisma` (the hook lib/db.ts already
 * honours) points every app module at the same real, migrated test database client that the suites
 * use. It only runs when PRISMA_TEST_DATABASE_URL is set.
 */
import { realPrismaConfigured, sharedPrisma } from "./prisma-client";

if (realPrismaConfigured) {
  const g = globalThis as { __prisma?: unknown };
  if (!g.__prisma) g.__prisma = sharedPrisma();
}
