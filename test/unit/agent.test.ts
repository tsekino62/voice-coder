import { describe, expect, it } from "vitest";
import type { AgentContext, AgentTarget } from "../../src/agent/AgentBackend.js";
import { MockAgentBackend } from "../../src/agent/MockAgentBackend.js";
import { buildPrompt, extractCodeBlock } from "../../src/agent/prompt.js";
import { parseIntent } from "../../src/intent/parser.js";

const target: AgentTarget = { fileName: "a.ts", languageId: "typescript", startLine: 9, endLine: 19, code: "x\ny" };
const context = (signal = new AbortController().signal): AgentContext => ({
  utterance: "デバッグして",
  documentText: "a\nb",
  diagnostics: [{ line: 10, message: "Type 'string' is not assignable" }],
  signal,
});

describe("prompt", () => {
  it("puts the diagnostics and 1-based line numbers into the debug prompt", () => {
    const { user } = buildPrompt(parseIntent("デバッグして")!, target, context());
    expect(user).toContain("line 11: Type 'string' is not assignable");
    expect(user).toContain("lines 10-20");
    expect(user).toContain("  10| x");
  });

  it("asks explain for prose and generate for a code block", () => {
    expect(buildPrompt(parseIntent("10行目から20行目を解説して")!, target, context()).user).toMatch(/Explain lines 10-20/);
    expect(buildPrompt(parseIntent("FizzBuzzを作って")!, target, context()).user).toMatch(/exactly one fenced code block/);
  });

  it("extracts the first fenced block, or takes the reply as is", () => {
    expect(extractCodeBlock("here:\n```ts\nconst a = 1;\nconst b = 2;\n```\nbye")).toBe("const a = 1;\nconst b = 2;");
    expect(extractCodeBlock("  const a = 1;  ")).toBe("const a = 1;");
  });
});

describe("MockAgentBackend", () => {
  it("streams the reply in chunks and stops at abort", async () => {
    const mock = new MockAgentBackend(() => "x".repeat(100), 10, 5);
    const controller = new AbortController();
    const got: string[] = [];
    for await (const chunk of mock.run(parseIntent("FizzBuzzを作って")!, target, context(controller.signal))) {
      got.push(chunk);
      if (got.length === 3) controller.abort();
    }
    expect(got).toHaveLength(3);
    expect(mock.runs[0]).toMatchObject({ aborted: true, finished: false });
  });
});
