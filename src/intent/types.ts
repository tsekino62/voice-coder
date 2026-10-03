/**
 * generate: write code at the cursor. explain: describe code. debug: fix a problem.
 * refactor: restructure existing code (possibly across files), e.g. merge similar classes into an abstract class.
 * create: add a new file.
 * run: run the current file or the project's tests.
 */
export type IntentKind = "generate" | "explain" | "debug" | "refactor" | "create" | "run";

export interface LineRange {
  from: number;
  to: number;
}

export interface Intent {
  kind: IntentKind;
  /** Lines the command is about, or null when none were named. */
  range: LineRange | null;
  /** Identifiers named in the command (lower-case, spaces closed up), e.g. ["fizzbuzz"]. */
  terms: string[];
}
