import type { Intent } from "../intent/types.js";
import type { AgentContext, AgentTarget } from "./AgentBackend.js";

export interface Prompt {
  system: string;
  user: string;
}

const SYSTEM = [
  "You are the backend of a Japanese voice-coding editor extension.",
  "The user's request was transcribed from speech, so expect filler words and small transcription errors.",
  "You have no tools. Answer from the code you are given.",
].join(" ");

function numbered(code: string, startLine: number): string {
  return code
    .split("\n")
    .map((line, i) => `${String(startLine + i + 1).padStart(4)}| ${line}`)
    .join("\n");
}

/** The request for one command, in the shape each action can apply. */
export function buildPrompt(intent: Intent, target: AgentTarget, context: AgentContext): Prompt {
  const where = `${target.fileName} (${target.languageId})`;
  switch (intent.kind) {
    case "generate":
      if (!target.fileName) {
        // No file open: the code becomes a new file
        return {
          system: SYSTEM,
          user: [
            `Request (spoken): ${context.utterance}`,
            "No file is open; the code will become a new file.",
            ...(context.workspaceFiles?.length ? ["Files in the workspace (use its language):", ...context.workspaceFiles.slice(0, 100).map((f) => `- ${f}`)] : []),
            "Use the language the user names; otherwise the workspace's main language; otherwise the most fitting one.",
            "Reply with exactly one fenced code block whose opening fence names the language (e.g. ```python), containing the whole file. No explanation.",
          ].join("\n"),
        };
      }
      return {
        system: SYSTEM,
        user: [
          `Request (spoken): ${context.utterance}`,
          `File: ${where}. The code will be inserted at line ${target.startLine + 1}.`,
          "Current file:",
          "```",
          numbered(context.documentText, 0),
          "```",
          `Reply with exactly one fenced code block in ${target.languageId} containing only the code to insert. No explanation.`,
        ].join("\n"),
      };
    case "explain":
      return {
        system: SYSTEM,
        user: [
          `Request (spoken): ${context.utterance}`,
          `Explain lines ${target.startLine + 1}-${target.endLine + 1} of ${where} in Japanese, briefly and concretely.`,
          "```",
          numbered(target.code, target.startLine),
          "```",
        ].join("\n"),
      };
    case "run":
      // Runs never reach an agent; the extension builds the command itself
      return { system: SYSTEM, user: context.utterance };
    case "refactor":
    case "create": {
      const what =
        intent.kind === "refactor"
          ? "Restructure the code as asked without changing its behaviour. If similar classes are to be merged, " +
            "move what they share into an abstract base class (in its own file if the project keeps one class per file) and make them extend it."
          : "Create the new file(s) asked for, following the project's language and conventions.";
      const lines =
        intent.range || target.startLine !== 0 || target.endLine !== context.documentText.split("\n").length - 1
          ? ` The user means lines ${target.startLine + 1}-${target.endLine + 1} of it.`
          : "";
      const files = [{ path: target.fileName, text: context.documentText }, ...(context.files ?? []).filter((f) => f.path !== target.fileName)];
      return {
        system: SYSTEM,
        user: [
          `Request (spoken): ${context.utterance}`,
          what,
          `Current file: ${where}.${lines}`,
          ...(context.workspaceFiles?.length ? ["Files in the workspace:", ...context.workspaceFiles.slice(0, 300).map((f) => `- ${f}`)] : []),
          "Open files:",
          ...files.flatMap((f) => [`=== ${f.path} ===`, "```", f.text, "```"]),
          "Reply only with the files to create or change. For each one, a line `=== <path relative to the workspace root> ===`",
          "followed by one fenced code block with the file's complete new content. Leave out files that do not change. No explanation.",
        ].join("\n"),
      };
    }
    case "debug": {
      const errors = context.diagnostics.length
        ? context.diagnostics.map((d) => `- line ${d.line + 1}: ${d.message}`).join("\n")
        : "- (the editor reports no errors; look for the bug the user means)";
      return {
        system: SYSTEM,
        user: [
          `Request (spoken): ${context.utterance}`,
          `Fix lines ${target.startLine + 1}-${target.endLine + 1} of ${where}. Errors reported by the editor:`,
          errors,
          "Code (line numbers are for reference only):",
          "```",
          numbered(target.code, target.startLine),
          "```",
          "Reply with exactly one fenced code block holding the corrected replacement for these lines, without line numbers. No explanation.",
        ].join("\n"),
      };
    }
  }
}

/** The body of the first fenced code block, or the whole reply when there is none. */
export function extractCodeBlock(reply: string): string {
  const match = /```[^\n]*\n([\s\S]*?)\n?```/.exec(reply);
  return match ? match[1] : reply.trim();
}

/** The language tag of the first fenced code block (```python → "python"), or "". */
export function extractCodeBlockLanguage(reply: string): string {
  return /```([^\n`]*)\n/.exec(reply)?.[1]?.trim() ?? "";
}

/** One file in an agent's reply to refactor / create: its complete new content. */
export interface FileEdit {
  path: string;
  content: string;
}

/** The `=== path ===` + fenced block pairs of a refactor / create reply. */
export function parseFileEdits(reply: string): FileEdit[] {
  const edits: FileEdit[] = [];
  for (const match of reply.matchAll(/^===\s*(.+?)\s*===[ \t]*\r?\n```[^\n]*\n([\s\S]*?)\n?```/gm)) {
    edits.push({ path: match[1].replace(/^`|`$/g, ""), content: match[2].endsWith("\n") ? match[2] : match[2] + "\n" });
  }
  return edits;
}

/**
 * A path the agent may write: relative, inside the workspace. Returns the
 * cleaned path, or null for anything absolute or climbing out with "..".
 */
export function safeRelativePath(path: string): string | null {
  const cleaned = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cleaned || cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned) || cleaned.split("/").some((part) => part === ".." || part === "")) return null;
  return cleaned;
}
