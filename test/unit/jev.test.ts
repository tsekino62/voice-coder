import { describe, expect, it } from "vitest";
import { JevIntentReader } from "../../src/intent/jev.js";
import { ALL_TAKES } from "../../src/eval/takes.js";

/** A fetch that answers /v1/systemone with the given choice and probabilities. */
function jevFetch(choice: string, probabilities: Record<string, number>) {
  const bodies: Array<Record<string, unknown>> = [];
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const answers = { kind: { type: "choice", choice, confidence: 0.9, probabilities } };
    return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 100, output_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fakeFetch, bodies };
}

describe("JevIntentReader", () => {
  it("asks one choice question and keeps the regex line range", async () => {
    const { fakeFetch, bodies } = jevFetch("explain", { generate: 0, explain: 0.97, debug: 0.02, none: 0.01 });
    const reader = new JevIntentReader({ apiKey: "test", fetch: fakeFetch });
    const intent = await reader.read("十行目から二十行目を解説して");
    expect(intent).toEqual({ kind: "explain", range: { from: 10, to: 20 }, terms: [] });
    expect(bodies[0]).toMatchObject({ model: "jev-latest", state: "十行目から二十行目を解説して", questions: { kind: { type: "choice" } } });
    expect(Object.keys((bodies[0].questions as { kind: { criteria: object } }).kind.criteria)).toEqual(["generate", "explain", "debug", "refactor", "create", "none"]);
    expect(reader.calls[0]).toMatchObject({ choice: "explain", probability: 0.97 });
  });

  it("reads 'none' and low-probability answers as no command yet", async () => {
    const none = new JevIntentReader({ apiKey: "test", fetch: jevFetch("none", { generate: 0.1, explain: 0, debug: 0, none: 0.9 }).fakeFetch });
    expect(await none.read("FizzBuzzを")).toBeNull();
    const unsure = new JevIntentReader({ apiKey: "test", fetch: jevFetch("debug", { generate: 0.3, explain: 0.2, debug: 0.4, none: 0.1 }).fakeFetch });
    expect(await unsure.read("なんか変")).toBeNull();
  });

  it("raises an API error", async () => {
    const failing = async () => new Response(JSON.stringify({ error: "bad key" }), { status: 401, headers: { "content-type": "application/json" } });
    const reader = new JevIntentReader({ apiKey: "test", fetch: failing });
    await expect(reader.read("デバッグして")).rejects.toThrow();
  });
});

// About 30 short requests, a fraction of a cent; runs only with a key
describe.skipIf(!process.env.TYPESAFE_API_KEY)("JevIntentReader against the real API", () => {
  it("reads the intent of all 30 take texts, with and without keywords", async () => {
    const reader = new JevIntentReader();
    const wrong: string[] = [];
    for (const take of ALL_TAKES) {
      const intent = await reader.read(take.text);
      if (intent?.kind !== take.kind || (take.range && intent?.range?.from !== take.range.from)) wrong.push(`${take.text} → ${intent?.kind}`);
    }
    expect(wrong).toEqual([]);
  }, 60_000);
});
