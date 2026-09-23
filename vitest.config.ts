import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Unit tests for the pure libs (parsers, codec). Playwright owns e2e/ — keep
// the two suites disjoint (vitest only picks up src/**/*.test.ts).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
