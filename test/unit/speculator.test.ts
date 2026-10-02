import { describe, expect, it } from "vitest";
import { IntentSpeculator, type Dispatch, type Resolution } from "../../src/intent/speculator.js";
import { ScriptedBackend, type ScriptStep } from "./scriptedBackend.js";

async function run(script: ScriptStep[]) {
  const backend = new ScriptedBackend(script);
  const dispatches: Dispatch[] = [];
  const resolutions: Resolution[] = [];
  new IntentSpeculator(backend, {
    onIntent: (dispatch) => dispatches.push(dispatch),
    onResolved: (resolution) => resolutions.push(resolution),
  });
  await backend.start();
  return { dispatches, resolutions };
}

describe("speculative dispatch", () => {
  it("match: fires on the partial and keeps that work when the final agrees", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "FizzBuzz", atMs: 400 },
      { partial: "FizzBuzzを作っ", atMs: 700 },
      { partial: "FizzBuzzを作って", atMs: 900 },
      { final: "FizzBuzzを作って。", atMs: 1900 },
    ]);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]).toMatchObject({ speculative: true, atMs: 700, intent: { kind: "generate", terms: ["fizzbuzz"] } });
    expect(dispatches[0].signal.aborted).toBe(false);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].dispatch).toBe(dispatches[0]);
    expect(resolutions[0].aborted).toEqual([]);
  });

  it("mismatch: aborts the speculative work and dispatches the final's intent", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "10行目を解説", atMs: 600 },
      { final: "10行目から20行目を解説して。", atMs: 1800 },
    ]);
    expect(dispatches).toHaveLength(2);
    expect(dispatches[0].signal.aborted).toBe(true);
    expect(dispatches[1]).toMatchObject({ speculative: false, atMs: 1800, intent: { kind: "explain", range: { from: 10, to: 20 } } });
    expect(dispatches[1].signal.aborted).toBe(false);
    expect(resolutions[0].dispatch).toBe(dispatches[1]);
    expect(resolutions[0].aborted).toEqual([dispatches[0]]);
  });

  it("restatement 「作って、あ、やっぱり説明して」 ends as explain", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "作って", atMs: 500 },
      { partial: "作って、あ、やっぱり", atMs: 1100 },
      { partial: "作って、あ、やっぱり説明", atMs: 1600 },
      { final: "作って、あ、やっぱり説明して。", atMs: 2600 },
    ]);
    expect(dispatches.map((d) => [d.intent.kind, d.signal.aborted])).toEqual([
      ["generate", true],
      ["explain", false],
    ]);
    expect(resolutions[0].intent?.kind).toBe("explain");
    expect(resolutions[0].dispatch).toBe(dispatches[1]);
  });

  it("restatement that only shows up in the final is caught there", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "作って", atMs: 500 },
      { final: "作って、あ、やっぱり説明して。", atMs: 2600 },
    ]);
    expect(dispatches.map((d) => [d.intent.kind, d.speculative, d.signal.aborted])).toEqual([
      ["generate", true, true],
      ["explain", false, false],
    ]);
    expect(resolutions[0].intent?.kind).toBe("explain");
  });

  it("aborts without a new dispatch when the final holds no command", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "デバッグ", atMs: 300 },
      { final: "デバッグじゃなくて、えーと", atMs: 1500 },
    ]);
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].signal.aborted).toBe(true);
    expect(resolutions[0]).toMatchObject({ intent: null, dispatch: null });
  });

  it("handles consecutive utterances independently", async () => {
    const { dispatches, resolutions } = await run([
      { partial: "デバッグ", atMs: 300 },
      { final: "デバッグして。", atMs: 1300 },
      { partial: "FizzBuzzを作っ", atMs: 3000 },
      { final: "FizzBuzzを作って。", atMs: 4000 },
    ]);
    expect(dispatches.map((d) => [d.intent.kind, d.speculative, d.signal.aborted])).toEqual([
      ["debug", true, false],
      ["generate", true, false],
    ]);
    expect(resolutions.map((r) => r.intent?.kind)).toEqual(["debug", "generate"]);
  });
});
