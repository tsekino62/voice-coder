import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // test/vscode runs inside VS Code (npm run test:vscode), not under vitest
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    setupFiles: ["scripts/loadEnv.ts"],
  },
});
