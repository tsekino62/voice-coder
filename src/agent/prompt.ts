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
