import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["test/setup.ts"],
    include: ["plugins/*/src/__tests__/**/*.test.ts"],
  },
});
