export type IntentKind = "generate" | "explain" | "debug";

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
