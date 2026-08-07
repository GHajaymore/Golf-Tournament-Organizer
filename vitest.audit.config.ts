import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * The audit suite: end-to-end checks against a real database.
 *
 * Separate from the default config because these write real rows and need a
 * live DATABASE_URL. Keeping them out of `npm test` means the fast suite stays
 * hermetic and nobody's CI quietly starts depending on a database.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "server-only": resolve(__dirname, "src/lib/__tests__/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["src/**/*.audit.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
