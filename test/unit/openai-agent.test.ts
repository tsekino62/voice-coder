import { describe, expect, it } from "vitest";
import type { AgentContext, AgentTarget } from "../../src/agent/AgentBackend.js";
import { OpenAIAgentBackend } from "../../src/agent/OpenAIAgentBackend.js";
import { parseIntent } from "../../src/intent/parser.js";

const target: AgentTarget = { fileName: "a.ts", languageId: "typescript", startLine: 0, endLine: 0, code: "" };
const context = (signal: AbortSignal): AgentContext => ({ utterance: "FizzBuzzを作って", documentText: "", diagnostics: [], signal });

/** A fetch that answers the Responses API with server-sent events, one per `delayMs`. */
function sseFetch(events: object[], delayMs = 0) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const signal = init?.signal;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const event of events) {
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (signal?.aborted) {
            controller.error(new DOMException("aborted", "AbortError"));
            return;
          }
          controller.enqueue(encoder.encode(`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { fakeFetch, requests };
}

const delta = (text: string, i: number) => ({ type: "response.output_text.delta", delta: text, item_id: "m", output_index: 0, content_index: 0, sequence_number: i, logprobs: [] });

describe("OpenAIAgentBackend", () => {
  it("streams output text deltas and sends the prompt as instructions + input", async () => {
    const { fakeFetch, requests } = sseFetch([delta("```ts\n", 1), delta("fizzBuzz()\n```", 2), { type: "response.completed", sequence_number: 3, response: {} }]);
    const backend = new OpenAIAgentBackend({ apiKey: "test", model: "gpt-test", fetch: fakeFetch });
    const chunks: string[] = [];
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context(new AbortController().signal))) chunks.push(text);

    expect(chunks.join("")).toBe("```ts\nfizzBuzz()\n```");
    expect(requests[0].url).toMatch(/\/responses$/);
    expect(requests[0].body).toMatchObject({ model: "gpt-test", stream: true, store: false });
    expect(requests[0].body.instructions).toMatch(/voice-coding/);
    expect(requests[0].body.input).toMatch(/FizzBuzzを作って/);
  });

  it("stops quietly when the signal aborts mid-stream", async () => {
    const { fakeFetch } = sseFetch(Array.from({ length: 20 }, (_, i) => delta(`chunk${i} `, i)), 20);
    const backend = new OpenAIAgentBackend({ apiKey: "test", fetch: fakeFetch });
    const controller = new AbortController();
    const chunks: string[] = [];
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context(controller.signal))) {
      chunks.push(text);
      if (chunks.length === 3) controller.abort();
    }
    expect(chunks).toHaveLength(3);
  });

  it("raises an API error", async () => {
    const { fakeFetch } = sseFetch([{ type: "error", code: "server_error", message: "boom", param: null, sequence_number: 1 }]);
    const backend = new OpenAIAgentBackend({ apiKey: "test", fetch: fakeFetch });
    await expect(async () => {
      for await (const _ of backend.run(parseIntent("デバッグして")!, target, context(new AbortController().signal))) void _;
    }).rejects.toThrow(/boom/);
  });
});

// Costs a few hundred tokens; runs only when a key is configured
describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAIAgentBackend against the real API", () => {
  it("generates code for a spoken request", async () => {
    const backend = new OpenAIAgentBackend({ model: process.env.VOICE_CODER_OPENAI_MODEL });
    let reply = "";
    for await (const text of backend.run(parseIntent("FizzBuzzを作って")!, target, context(new AbortController().signal))) reply += text;
    expect(reply).toMatch(/```/);
  }, 60_000);
});
