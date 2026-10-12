/**
 * Real Prisma clients for the database-backed suite. Nothing here is a mock.
 *
 * - PRISMA_TEST_DATABASE_URL: an ISOLATED PostgreSQL database that has been migrated. Never production.
 * - Engine selection:
 *   - default: the repo's `@prisma/client` (native query engine). Requires `prisma generate` with the pinned engines.
 *   - PRISMA_WASM_HARNESS_DIR: a test-only harness directory holding a driverAdapters client generated from the same
 *     schema, using Prisma's own query engine compiled to WebAssembly (`query_engine_bg.postgresql.wasm`) with
 *     `@prisma/adapter-pg`. Used when the native engine binaries cannot be downloaded. It is the same Prisma query
 *     engine, not a mock, but it is NOT the pinned native-engine path, and the report must say which engine ran.
 */
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const PRISMA_TEST_DATABASE_URL = process.env.PRISMA_TEST_DATABASE_URL || "";
export const realPrismaConfigured = Boolean(PRISMA_TEST_DATABASE_URL);
export const prismaEngineLabel = process.env.PRISMA_WASM_HARNESS_DIR ? "wasm-query-engine+adapter-pg" : "native-query-engine";

export function makeRealPrisma(): any {
  if (!realPrismaConfigured) throw new Error("PRISMA_TEST_DATABASE_URL is not set");
  const harness = process.env.PRISMA_WASM_HARNESS_DIR;
  if (harness) {
    const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
    const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
    const { Pool } = require(path.join(harness, "node_modules", "pg"));
    return new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: PRISMA_TEST_DATABASE_URL })) });
  }
  const { PrismaClient } = require("@prisma/client");
  return new PrismaClient({ datasourceUrl: PRISMA_TEST_DATABASE_URL });
}

/** The shared client handed to app modules through vi.mock("@/lib/db"). Created lazily. */
let shared: any = null;
export function sharedPrisma(): any {
  if (!realPrismaConfigured) return null; // suites are skipped when no database is configured
  if (!shared) shared = makeRealPrisma();
  return shared;
}
