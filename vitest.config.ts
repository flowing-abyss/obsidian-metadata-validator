import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    alias: {
      obsidian: "obsidian-test-mocks/obsidian",
    },
    setupFiles: ["obsidian-test-mocks/setup"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "src/ui/**",      // UI layer — manual testing only
        "src/main.ts",    // lifecycle wiring — manual testing only
        "src/settings.ts",
        "**/*.test.ts",
        "**/__mocks__/**",
      ],
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
    },
  },
});
