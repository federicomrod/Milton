import { defineConfig } from "vitest/config";
import path from "path";

// Real-Postgres integration tests for the fixed-cost data layer. They start a
// disposable local server (see tests/pg/harness.ts); they never read hosted
// connection settings. Run: npm run test:pg
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/pg/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
