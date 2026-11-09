import { defineConfig } from "vitest/config";

import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Fixture apps import the framework by its package name, as real apps do.
    alias: {
      "pumice.js": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    // Each fixture app owns a `Server` whose routes register through module
    // side effects, so test files must not share a module graph.
    isolate: true,
  },
});
