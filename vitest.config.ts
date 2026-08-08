import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // The automatic runtime, matching tsconfig's "jsx": "preserve" + Next's own
  // transform. Without it esbuild emits React.createElement and every render
  // test fails on an undefined React.
  esbuild: { jsx: "automatic" },
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
    // .tsx picks up the component render tests, which use react-dom/server and
    // so need no DOM — the node environment is enough.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["src/**/*.audit.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
