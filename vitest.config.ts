import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Use the automatic JSX runtime (as Next.js does) so component render tests do not need `import React`.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Component render tests use JSX, so they live in `*.test.tsx` and are collected here too.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.spec.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
