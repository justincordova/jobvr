import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["../core/src/testing/global-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
