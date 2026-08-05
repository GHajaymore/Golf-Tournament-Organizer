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
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
