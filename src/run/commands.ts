/**
 * Shell commands for 「実行して」 / 「テストを実行して」. Built from the file's
 * language and the project's files only, never from an LLM's reply, so a voice
 * command can only ever run the user's own file or the project's own tests.
 */

const quote = (path: string) => `"${path.replace(/"/g, '\\"')}"`;

/** How to run one file, by VS Code language id; null when there is no single-file runner. */
export function fileRunCommand(languageId: string, path: string): string | null {
  switch (languageId) {
    case "python":
      return `python ${quote(path)}`;
    case "javascript":
      return `node ${quote(path)}`;
    case "typescript":
      return `npx tsx ${quote(path)}`;
    case "go":
      return `go run ${quote(path)}`;
    case "ruby":
      return `ruby ${quote(path)}`;
    case "php":
      return `php ${quote(path)}`;
    case "java":
      return `java ${quote(path)}`;
    case "shellscript":
      return `bash ${quote(path)}`;
    case "powershell":
      return `pwsh -File ${quote(path)}`;
    default:
      return null;
  }
}

export interface ProjectFiles {
  /** package.json's scripts.test, if any. */
  npmTestScript?: string;
  hasPytestConfig: boolean;
  hasPythonTests: boolean;
  hasGoMod: boolean;
  hasCargoToml: boolean;
}

/** How to run the project's tests; null when it is not clear. */
export function testRunCommand(project: ProjectFiles): string | null {
  // npm init's placeholder only prints an error
  if (project.npmTestScript && !/no test specified/.test(project.npmTestScript)) return "npm test";
  if (project.hasPytestConfig || project.hasPythonTests) return "python -m pytest";
  if (project.hasGoMod) return "go test ./...";
  if (project.hasCargoToml) return "cargo test";
  return null;
}

/** The request is about tests (テストを実行して), not the file itself. */
export function wantsTests(utterance: string): boolean {
  return /テスト|test/i.test(utterance);
}
