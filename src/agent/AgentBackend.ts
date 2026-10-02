import type { Intent } from "../intent/types.js";

/** The code a command is about. Lines are 0-based, `endLine` inclusive. */
export interface AgentTarget {
  fileName: string;
  languageId: string;
  startLine: number;
  endLine: number;
  /** Text of lines startLine..endLine (empty for generate: the cursor, not a range). */
  code: string;
}

export interface AgentDiagnostic {
  /** 0-based. */
  line: number;
  message: string;
}

export interface AgentContext {
  /** What the user said. */
  utterance: string;
  /** The whole file, for reference. */
  documentText: string;
  /** Errors reported for the file (debug uses them). */
  diagnostics: AgentDiagnostic[];
  /** Aborted when the intent turned out to be wrong; stop and produce nothing more. */
  signal: AbortSignal;
}

/**
 * An LLM that carries out one command. Yields response text as it streams.
 * It never touches the editor: the extension applies the result, and only for
 * a dispatch that the final transcript confirmed.
 */
export interface AgentBackend {
  run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string>;
}
