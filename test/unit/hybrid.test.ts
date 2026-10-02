import { describe, expect, it } from "vitest";
import { hybridReader } from "../../src/intent/hybrid.js";
import type { Intent } from "../../src/intent/types.js";

describe("hybridReader", () => {
  const remoteIntent: Intent = { kind: "debug", range: null, terms: [] };

  it("answers from keywords synchronously, without asking the remote reader", () => {
    const asked: string[] = [];
    const read = hybridReader(async (text) => (asked.push(text), remoteIntent));
    const intent = read("10行目から20行目を解説して");
    expect(intent).not.toBeInstanceOf(Promise);
    expect(intent).toMatchObject({ kind: "explain", range: { from: 10, to: 20 } });
    expect(asked).toEqual([]);
  });

  it("asks the remote reader when no keyword matches", async () => {
    const asked: string[] = [];
    const read = hybridReader(async (text) => (asked.push(text), remoteIntent));
    await expect(read("テストが通らないんだけど")).resolves.toEqual(remoteIntent);
    expect(asked).toEqual(["テストが通らないんだけど"]);
  });
});
