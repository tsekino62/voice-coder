import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { AgentContext, AgentTarget } from "../../src/agent/AgentBackend.js";
import { MockAgentBackend } from "../../src/agent/MockAgentBackend.js";
import { parseIntent } from "../../src/intent/parser.js";
import { AutoAgentBackend, CopilotAgentBackend } from "../../src/extension/agents.js";
import { sleep } from "./helpers.js";

const target: AgentTarget = { fileName: "a.py", languageId: "python", startLine: 0, endLine: 0, code: "" };
const context = (signal = new AbortController().signal): AgentContext => ({ utterance: "FizzBuzzを作って", documentText: "", diagnostics: [], signal });

/** A stand-in for a Copilot chat model: streams its chunks, notes the request and cancellation. */
function fakeModel(family: string, chunks: string[]) {
  const seen = { prompts: [] as string[], cancelled: false };
  const model = {
    id: `copilot-${family}`,
    name: `Fake ${family}`,
    vendor: "copilot",
    family,
    version: "1",
    maxInputTokens: 100_000,
    countTokens: async () => 1,
    sendRequest: async (messages: vscode.LanguageModelChatMessage[], _options: unknown, token: vscode.CancellationToken) => {
      seen.prompts.push(messages.map((m) => m.content.map((p) => (p as vscode.LanguageModelTextPart).value).join("")).join("\n"));
      token.onCancellationRequested(() => (seen.cancelled = true));
      return {
        text: (async function* () {
          for (const chunk of chunks) {
            await sleep(20);
            if (token.isCancellationRequested) return;
            yield chunk;
          }
        })(),
      };
    },
  } as unknown as vscode.LanguageModelChat;
  return { model, seen };
}

describe("Copilot models through the Language Model API", () => {
  it("streams the reply and sends the instructions with the request", async () => {
    const { model, seen } = fakeModel("gpt-x", ["```python\n", "print(1)\n```"]);
    const backend = new CopilotAgentBackend({ select: async () => [model] });
    let reply = "";
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context())) reply += text;
    assert.equal(reply, "```python\nprint(1)\n```");
    assert.match(seen.prompts[0], /voice-coding editor extension/);
    assert.match(seen.prompts[0], /FizzBuzzを作って/);
  });

  it("uses the configured family and cancels the request on abort", async () => {
    const a = fakeModel("a", ["A"]);
    const b = fakeModel("b", ["1", "2", "3", "4", "5"]);
    const backend = new CopilotAgentBackend({ family: "b", select: async () => [a.model, b.model] });
    const controller = new AbortController();
    const got: string[] = [];
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context(controller.signal))) {
      got.push(text);
      if (got.length === 2) controller.abort();
    }
    assert.deepEqual(got, ["1", "2"]);
    assert.equal(a.seen.prompts.length, 0);
    assert.equal(b.seen.cancelled, true);
  });

  it("prefers Copilot's Auto over its small utility models when none is configured", async () => {
    const mini = fakeModel("gpt-4o-mini", ["mini"]);
    const utility = fakeModel("copilot-utility", ["utility"]);
    const auto = fakeModel("claude-fable-5.1", ["auto"]);
    (auto.model as { name: string }).name = "Auto";
    const backend = new CopilotAgentBackend({ select: async () => [mini.model, utility.model, auto.model] });
    let reply = "";
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context())) reply += text;
    assert.equal(reply, "auto");
  });

  it("says so when there is no Copilot", async () => {
    const backend = new CopilotAgentBackend({ select: async () => [] });
    await assert.rejects(async () => {
      for await (const _ of backend.run(parseIntent("FizzBuzzを作って")!, target, context())) void _;
    }, /Copilot/);
  });
});

describe("agent 'auto'", () => {
  const run = async (backend: AutoAgentBackend) => {
    let reply = "";
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context())) reply += text;
    return reply;
  };

  it("prefers Copilot when VS Code offers it", async () => {
    const { model } = fakeModel("gpt-x", ["from copilot"]);
    const openai = new MockAgentBackend(() => "from openai");
    const auto = new AutoAgentBackend(() => new CopilotAgentBackend({ select: async () => [model] }), () => openai, async () => [model]);
    assert.equal(await run(auto), "from copilot");
  });

  it("falls back to OpenAI without Copilot, and explains when there is neither", async () => {
    const openai = new MockAgentBackend(() => "from openai");
    assert.equal(await run(new AutoAgentBackend(() => openai, () => openai, async () => [])), "from openai");
    await assert.rejects(() => run(new AutoAgentBackend(() => openai, undefined, async () => [])), /Copilot|OPENAI_API_KEY/);
  });
});
