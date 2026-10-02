// Downloads VS Code (cached in .vscode-test/) and runs test/vscode inside it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const root = resolve(__dirname, "..", "..");
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "out", "test", "vscode", "index.cjs"),
    launchArgs: [
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--user-data-dir",
      mkdtempSync(join(tmpdir(), "voice-coder-test-")),
    ],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
