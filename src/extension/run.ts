import { dirname } from "node:path";
import * as vscode from "vscode";
import { fileRunCommand, testRunCommand, wantsTests } from "../run/commands.js";
import { t } from "./messages.js";

const TERMINAL_NAME = "Voice Coder";

/**
 * 「実行して」: run the current file, or the project's tests for 「テストを実行して」,
 * in a terminal named Voice Coder so the command and its output are in plain sight.
 */
export async function runInTerminal(document: vscode.TextDocument | undefined, utterance: string): Promise<{ command?: string; error?: string }> {
  const folder = (document && vscode.workspace.getWorkspaceFolder(document.uri)) ?? vscode.workspace.workspaceFolders?.[0];
  let command: string | null;
  let cwd: string | undefined;
  if (wantsTests(utterance)) {
    if (!folder) return { error: t("testsNeedFolder") };
    command = testRunCommand(await projectFiles(folder.uri));
    if (!command) return { error: t("testsUnknown") };
    cwd = folder.uri.fsPath;
  } else {
    if (!document) return { error: t("runOpenFile") };
    if (document.isUntitled) return { error: t("runSaveFirst") };
    command = fileRunCommand(document.languageId, document.uri.fsPath);
    if (!command) return { error: t("runUnknownLanguage", document.languageId) };
    // Run what is on screen, not the last saved copy
    if (document.isDirty && !(await document.save())) return { error: t("saveFailed") };
    cwd = folder?.uri.fsPath ?? dirname(document.uri.fsPath);
  }
  const terminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME && t.exitStatus === undefined) ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  terminal.show(true);
  terminal.sendText(command);
  return { command };
}

async function projectFiles(root: vscode.Uri) {
  const exists = async (name: string) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, name));
      return true;
    } catch {
      return false;
    }
  };
  let npmTestScript: string | undefined;
  try {
    const pkg = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, "package.json"))));
    npmTestScript = pkg?.scripts?.test;
  } catch {
    // no package.json
  }
  const pythonTests = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "**/{test_*.py,*_test.py}"), "**/node_modules/**", 1);
  return {
    npmTestScript,
    hasPytestConfig: (await exists("pytest.ini")) || (await exists("pyproject.toml")) || (await exists("setup.cfg")),
    hasPythonTests: pythonTests.length > 0,
    hasGoMod: await exists("go.mod"),
    hasCargoToml: await exists("Cargo.toml"),
  };
}
