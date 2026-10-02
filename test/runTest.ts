// Downloads VS Code (cached in .vscode-test/) and runs test/vscode inside it.
import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const root = resolve(__dirname, "..", "..");
  // Keys from a local .env reach the extension host through the inherited environment
  const envFile = join(root, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  // A throwaway copy of the fixture project, so file creation never touches the repo
  const workspace = mkdtempSync(join(tmpdir(), "voice-coder-ws-"));
  cpSync(join(root, "test", "fixtures", "workspace"), workspace, { recursive: true });
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "out", "test", "vscode", "index.cjs"),
    launchArgs: [
      workspace,
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
