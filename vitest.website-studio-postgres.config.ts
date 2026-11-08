import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "tests/integration/website-studio-tenant-postgres.test.ts",
      "tests/integration/website-studio-multisite-api.test.ts",
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
