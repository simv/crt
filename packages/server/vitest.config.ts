import { defineConfig } from "vitest/config";

// Unit tests only; Playwright owns e2e/**/*.spec.ts (npm run e2e).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PRD-zero N-34: a temp CRT home per worker (test/helpers/setup.ts).
    setupFiles: ["test/helpers/setup.ts"],
  },
});
