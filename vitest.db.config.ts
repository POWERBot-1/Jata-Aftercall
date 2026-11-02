import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Database-backed suite configuration. Used only by scripts/test-db/run-db-suite.mjs, which starts a
 * disposable loopback PostgreSQL and sets PRISMA_TEST_DATABASE_URL. The default vitest.config.ts is
 * unchanged.
 *
 * When PRISMA_WASM_HARNESS_DIR is set, `@prisma/client` resolves to the driverAdapters client that
 * prepare-wasm-harness.sh generated (Prisma's query engine compiled to WebAssembly + @prisma/adapter-pg).
 * The native engine cannot be downloaded in the sandbox, and the report labels which engine ran.
 */
const harness = process.env.PRISMA_WASM_HARNESS_DIR;

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/prisma/**/*.test.ts", "tests/db/**/*.test.ts"],
    globals: false,
    // Shared database: run files one at a time so fixtures and resets cannot interleave.
    fileParallelism: false,
    // Routes lib/db.ts to the same real test client (see tests/helpers/db-setup.ts).
    setupFiles: ["tests/helpers/db-setup.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      ...(harness ? { "@prisma/client": path.join(harness, "generated", "wasm.js") } : {}),
    },
  },
});
