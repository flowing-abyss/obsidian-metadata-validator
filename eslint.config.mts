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
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: ["Bases", "DataView", "Obsidian"],
          acronyms: ["JS", "TS", "API", "JSON", "YAML", "CSS", "HTML", "URL"],
        },
      ],
    },
  },
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
      "dev-vault-manifests/**",
      "dist",
      "esbuild.config.mjs",
      "eslint.config.js",
      "version-bump.mjs",
      "versions.json",
      "main.js",
      "vitest.config.ts",
      "src/**/*.test.ts",
      "src/**/__tests__/**",
      "src/__mocks__/**",
      ".forge/**",
      ".pi/**",
    ],
  }
);
