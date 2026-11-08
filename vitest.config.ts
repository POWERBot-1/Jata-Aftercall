import { defineConfig } from "vitest/config";
import path from "path";

// The isolated PostgreSQL Website Studio suites must exercise real Studio provisioning and tenant guards.
// Keep the legacy in-memory mock setup out of that dedicated run.
const websiteStudioPostgresTests = process.env.WEBSITE_STUDIO_POSTGRES_TESTS === "1";

export default defineConfig({
  // Use the automatic JSX runtime (as Next.js does) so component render tests do not need `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Component render tests use JSX, so they live in `*.test.tsx` and are collected here too.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.spec.ts"],
    globals: false,
    // These two suites use real PostgreSQL and must not inherit the legacy in-memory Studio mocks.
    // The dedicated postgres config opts in with WEBSITE_STUDIO_POSTGRES_TESTS=1.
    exclude: websiteStudioPostgresTests ? [] : [
      "tests/integration/website-studio-tenant-postgres.test.ts",
      "tests/integration/website-studio-multisite-api.test.ts",
    ],
    setupFiles: websiteStudioPostgresTests
      ? ["tests/helpers/server-only-setup.ts"]
      : ["tests/helpers/website-studio-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
