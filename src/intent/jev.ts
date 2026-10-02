import { TypeSafeClient } from "@typesafe-ai/sdk";
import { normalizeText, parseLineRange, parseTerms } from "./parser.js";
import type { Intent, IntentKind } from "./types.js";

const KIND_CRITERIA = {
  generate: "The speaker asks to write, create, implement or generate new code.",
  explain: "The speaker asks to explain or describe what existing code does.",
  debug:
    "The speaker asks to find or fix a bug or an error, or reports that the code misbehaves " +
    "(tests fail, wrong values, exceptions, crashes, hangs, unexpected results). Reporting such a problem is a request to debug it.",
  refactor:
    "The speaker asks to restructure existing code without changing what it does: refactor, rename, extract, split, " +
    "or merge similar classes into a shared abstract base class.",
  create: "The speaker asks to add a new file (a new module, class file or config file).",
  none: "No complete request yet: filler words, an unfinished sentence, or something else.",
} as const;

const INSTRUCTIONS =
  "This is a Japanese speech transcript, possibly cut off mid-sentence, of a programmer talking to a code editor. " +
  "Which request does it make? If the speaker corrects themselves (e.g. 作って、あ、やっぱり説明して), the last request counts.";

export interface JevOptions {
  apiKey?: string;
  model?: string;
  /** Below this probability for the winning kind, the transcript reads as no command yet. */
  minProbability?: number;
  /** For tests: stands in for the network. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface JevCall {
  text: string;
  ms: number;
  choice: string;
  probability: number;
}

/**
 * Reads the command kind with jev (typesafe.ai) instead of keywords: one
 * Choice question per transcript. Line ranges and identifiers still come
 * from the regex parser, since jev answers choices, not spans of text.
 */
export class JevIntentReader {
  private readonly client: TypeSafeClient;
  /** Every call made, for latency reporting. */
  readonly calls: JevCall[] = [];

  constructor(private readonly options: JevOptions = {}) {
    this.client = new TypeSafeClient({
      apiKey: options.apiKey ?? process.env.TYPESAFE_API_KEY,
      fetch: options.fetch,
      // A partial is stale within a second; a retry would only answer an old question
      retry: { maxRetries: 0 },
      timeout: 5000,
    });
  }

  readonly read = async (text: string): Promise<Intent | null> => {
    if (!text.trim()) return null;
    const started = performance.now();
    const response = await this.client.systemOne({
      model: this.options.model ?? "jev-latest",
      state: text,
      questions: { kind: { type: "choice", instructions: INSTRUCTIONS, criteria: KIND_CRITERIA } },
    });
    const answer = response.answers.kind;
    const probability = answer.probabilities[answer.choice] ?? 0;
    this.calls.push({ text, ms: performance.now() - started, choice: answer.choice, probability });
    if (answer.choice === "none" || probability < (this.options.minProbability ?? 0.5)) return null;

    const normalized = normalizeText(text);
    return {
      kind: answer.choice as IntentKind,
      range: parseLineRange(normalized),
      terms: parseTerms(normalized),
    };
  };
}

