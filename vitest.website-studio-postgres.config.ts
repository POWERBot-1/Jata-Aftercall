import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "tests/integration/website-studio-tenant-postgres.test.ts",
      "tests/integration/website-studio-multisite-api.test.ts",
      // Public per-site rendering contract: default route, secondary route, legacy
      // fallback and tenant isolation against a real migrated database.
      "tests/integration/storefront-per-site-publication-postgres.test.ts",
      // The publication state machine driven through the real publish/unpublish routes.
      "tests/integration/studio-publication-state-machine-postgres.test.ts",
    ],
    globals: false,
    setupFiles: ["tests/helpers/server-only-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
