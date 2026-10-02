import { describe, expect, it } from "vitest";
import { parseIntent } from "../../src/intent/parser.js";
import { IntentSpeculator, type Dispatch, type IntentReader, type Resolution } from "../../src/intent/speculator.js";
import { ScriptedBackend, type ScriptStep } from "./scriptedBackend.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The regex parser, answered after a delay chosen per text (a stand-in for jev). */
function slowReader(delays: Record<string, number>, fail: string[] = []): IntentReader {
  return async (text) => {
    await sleep(delays[text] ?? 10);
    if (fail.includes(text)) throw new Error("classifier down");
    return parseIntent(text);
  };
}

async function run(script: ScriptStep[], reader: IntentReader, settleMs = 200) {
  const backend = new ScriptedBackend(script);
  const dispatches: Dispatch[] = [];
  const resolutions: Resolution[] = [];
  new IntentSpeculator(backend, { onIntent: (d) => dispatches.push(d), onResolved: (r) => resolutions.push(r) }, reader);
  await backend.start();
  await sleep(settleMs);
  return { dispatches, resolutions };
}

describe("speculation with an asynchronous intent reader", () => {
  it("dispatches once the read answers, timed from when it answered", async () => {
    const { dispatches, resolutions } = await run(
      [
        { partial: "デバッグ", atMs: 300 },
        { final: "デバッグして。", atMs: 1300 },
      ],
      slowReader({ デバッグ: 40, "デバッグして。": 40 }),
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].atMs).toBeGreaterThanOrEqual(330);
    expect(resolutions[0].dispatch).toBe(dispatches[0]);
    expect(resolutions[0].finalAtMs).toBe(1300);
    expect(resolutions[0].resolvedAtMs).toBeGreaterThanOrEqual(1330);
  });

  it("drops an answer for an older partial that arrives after a newer one", async () => {
    const { dispatches } = await run(
      [
        { partial: "作って", atMs: 100 },
        { partial: "作って、あ、やっぱり説明", atMs: 200 },
        { final: "作って、あ、やっぱり説明して。", atMs: 900 },
      ],
      // The first partial's answer (generate) comes back last
      slowReader({ 作って: 80, "作って、あ、やっぱり説明": 10, "作って、あ、やっぱり説明して。": 10 }),
    );
    expect(dispatches.map((d) => d.intent.kind)).toEqual(["explain"]);
    expect(dispatches[0].signal.aborted).toBe(false);
  });

  it("ignores partial answers that arrive after the final", async () => {
    const { dispatches, resolutions } = await run(
      [
        { partial: "FizzBuzzを作っ", atMs: 100 },
        { final: "FizzBuzzを作って。", atMs: 200 },
      ],
      slowReader({ FizzBuzzを作っ: 100, "FizzBuzzを作って。": 10 }),
    );
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].speculative).toBe(false);
    expect(resolutions[0].dispatch).toBe(dispatches[0]);
  });

  it("falls back to keywords when the read of a final fails, and shrugs off a failed partial", async () => {
    const { dispatches, resolutions } = await run(
      [
        { partial: "デバッグ", atMs: 100 },
        { final: "デバッグして。", atMs: 500 },
      ],
      slowReader({}, ["デバッグ", "デバッグして。"]),
    );
    expect(dispatches.map((d) => [d.intent.kind, d.speculative])).toEqual([["debug", false]]);
    expect(resolutions[0].intent?.kind).toBe("debug");
  });

  it("resolves finals in order even when the second one is read first", async () => {
    const { resolutions } = await run(
      [
        { final: "デバッグして。", atMs: 100 },
        { final: "FizzBuzzを作って。", atMs: 200 },
      ],
      slowReader({ "デバッグして。": 80, "FizzBuzzを作って。": 5 }),
    );
    expect(resolutions.map((r) => r.intent?.kind)).toEqual(["debug", "generate"]);
  });
});
