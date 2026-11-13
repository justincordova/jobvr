import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/testing/global-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
