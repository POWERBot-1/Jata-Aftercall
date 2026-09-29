import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Use the automatic JSX runtime (as Next.js does) so component render tests do not need `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
