import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["package.json"],
    rules: {
      "depend/ban-dependencies": "off",
    },
  },
  {
    ignores: [
      "node_modules",
      "coverage/**",
      "test-vault/**",
      "dist",
      "esbuild.config.mjs",
      "eslint.config.js",
      "version-bump.mjs",
      "versions.json",
      "main.js",
      "vitest.config.ts",
      "src/**/*.test.ts",
      "src/__mocks__/**",
    ],
  }
);
