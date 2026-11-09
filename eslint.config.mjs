import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist/",
    "node_modules/",
    ".agents/",
    ".claude/",
    "coverage/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `{}` is the identity of the intersections plugin types are built from
      // (`TContext & {}` is `TContext`); `object` or `unknown` would change them.
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowObjectTypes: "always" },
      ],
      // `_`-prefixed bindings are intentionally unused (destructuring to drop a key).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // Library code reports through the server's logger, not stray console calls.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // The CI helper scripts run on Node.
    files: [".github/scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    // The core never depends on a plugin: plugins build on the core's public
    // seams (docs/development/architecture.md, "Import boundaries").
    files: ["src/**/*.ts"],
    ignores: ["src/index.ts", "src/plugins/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/plugins/**"],
              message:
                "Core code doesn't import plugins; give the plugin a seam instead.",
            },
          ],
        },
      ],
    },
  },
]);
