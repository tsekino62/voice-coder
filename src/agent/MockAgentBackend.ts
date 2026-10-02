import type { Intent } from "../intent/types.js";
import type { AgentBackend, AgentContext, AgentTarget } from "./AgentBackend.js";

export type MockResponder = (intent: Intent, target: AgentTarget, context: AgentContext) => string;

export interface MockRun {
  intent: Intent;
  target: AgentTarget;
  context: AgentContext;
  /** Chunks handed out before the run ended. */
  yielded: string[];
  finished: boolean;
  aborted: boolean;
}

const FIZZBUZZ = [
  "```typescript",
  "function fizzBuzz(n: number): string[] {",
  "  const out: string[] = [];",
  "  for (let i = 1; i <= n; i++) {",
  '    out.push(i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : String(i));',
  "  }",
  "  return out;",
  "}",
  "```",
].join("\n");

export const defaultResponder: MockResponder = (intent, target) => {
  switch (intent.kind) {
    case "generate":
      return FIZZBUZZ;
    case "explain":
      return `${target.startLine + 1}〜${target.endLine + 1} 行目の説明（モック）: この範囲は ${target.code.split("\n").length} 行のコードです。`;
    case "debug":
      return "```\n" + target.code + "\n```";
    case "refactor":
    case "create":
      // Changes nothing: a test that needs file edits gives its own responder
      return "";
  }
};

/**
 * Stand-in for an LLM when ANTHROPIC_API_KEY is not set: streams a canned
 * reply in chunks with a delay, stops at abort, and records every run.
 */
export class MockAgentBackend implements AgentBackend {
  readonly runs: MockRun[] = [];

  constructor(
    private readonly respond: MockResponder = defaultResponder,
    private readonly chunkChars = 16,
    private readonly chunkDelayMs = 10,
  ) {}

  async *run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string> {
    const run: MockRun = { intent, target, context, yielded: [], finished: false, aborted: false };
    this.runs.push(run);
    const reply = this.respond(intent, target, context);
    for (let i = 0; i < reply.length; i += this.chunkChars) {
      await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
      if (context.signal.aborted) {
        run.aborted = true;
        return;
      }
      const chunk = reply.slice(i, i + this.chunkChars);
      run.yielded.push(chunk);
      yield chunk;
    }
    run.finished = true;
  }
}
