import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapLimit, runTake, type TakeResult } from "../../src/eval/runTake.js";
import { TAKES } from "../../src/eval/takes.js";

const apiKey = process.env.SONIOX_API_KEY;
const audioPath = (file: string) => join(import.meta.dirname, "..", "audio", file);
const audioReady = TAKES.every((take) => existsSync(audioPath(take.file)));

describe.skipIf(!apiKey || !audioReady)("Soniox, 15 synthesized takes at real-time pace", () => {
  let results: TakeResult[] = [];

  it("streams every take", async () => {
    results = await mapLimit(TAKES, 3, (take) =>
      runTake(audioPath(take.file), take.file, { apiKey: apiKey!, maxEndpointDelayMs: 1000 }),
    );
    expect(results).toHaveLength(15);
  }, 120_000);

  it("reads the intent of all 15", () => {
    const wrong = results.filter((r, i) => r.intent?.kind !== TAKES[i].kind).map((r) => `${r.file}: ${r.text}`);
    expect(wrong).toEqual([]);
  });

  it("reads lines 10-20 in all 5 explain takes", () => {
    const withRange = TAKES.map((take, i) => ({ take, result: results[i] })).filter(({ take }) => take.range);
    expect(withRange).toHaveLength(5);
    for (const { take, result } of withRange) expect(result.intent?.range, `${take.file}: ${result.text}`).toEqual(take.range);
  });
});
