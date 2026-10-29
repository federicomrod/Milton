import { defineConfig } from "vitest/config";

// Pure TypeScript helpers only (API client, queue, invite parsing, theme).
// Screens are checked by type-check, lint and running the app in Expo Go.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
