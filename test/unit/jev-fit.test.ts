import { describe, expect, it } from "vitest";
import { IntentSpeculator, type Dispatch } from "../../src/intent/speculator.js";
import { ScriptedBackend } from "./scriptedBackend.js";

// jev (typesafe.ai) is not implemented. It classifies input into a schema and
// returns typed values, so a jev backend would hand over the intent itself on
// the final. This checks that such a backend fits SttBackend and that its
// typed intent is used as is.
describe("a backend that returns typed intents (jev-shaped)", () => {
  it("uses the backend's intent instead of parsing the text", async () => {
    const backend = new ScriptedBackend([
      { partial: "作って", atMs: 400 },
      { final: "", intent: { kind: "explain", range: { from: 3, to: 4 }, terms: [] }, atMs: 900 },
    ]);
    const dispatches: Dispatch[] = [];
    new IntentSpeculator(backend, { onIntent: (d) => dispatches.push(d) });
    await backend.start();
    expect(dispatches.map((d) => [d.intent.kind, d.signal.aborted])).toEqual([
      ["generate", true],
      ["explain", false],
    ]);
    expect(dispatches[1].intent.range).toEqual({ from: 3, to: 4 });
  });

  it("treats an explicit null intent as no command", async () => {
    const backend = new ScriptedBackend([{ final: "デバッグして", intent: null, atMs: 900 }]);
    const dispatches: Dispatch[] = [];
    new IntentSpeculator(backend, { onIntent: (d) => dispatches.push(d) });
    await backend.start();
    expect(dispatches).toEqual([]);
  });
});
