import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // `server-only` throws by design outside a Next.js server bundle. Stub it
      // so server-side modules can still be unit-tested in isolation.
      "server-only": resolve(__dirname, "src/lib/__tests__/stubs/server-only.ts"),
    },
  },
  test: {
    // Audit tests hit a real database and live in their own config.
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.audit.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
