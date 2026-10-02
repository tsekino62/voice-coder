import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapLimit, runTakeModes, type TakeResult } from "../../src/eval/runTake.js";
import { TAKES } from "../../src/eval/takes.js";
import { JevIntentReader } from "../../src/intent/jev.js";
import { parseIntent } from "../../src/intent/parser.js";

const apiKey = process.env.SONIOX_API_KEY;
const audioPath = (file: string) => join(import.meta.dirname, "..", "audio", file);
const audioReady = TAKES.every((take) => existsSync(audioPath(take.file)));

describe.skipIf(!apiKey || !audioReady)("Soniox, 15 synthesized takes at real-time pace", () => {
  let results: TakeResult[] = [];
  let jevResults: TakeResult[] = [];
  // jev listens to the same streams when its key is there
  const jev = process.env.TYPESAFE_API_KEY ? new JevIntentReader() : undefined;

  it("streams every take", async () => {
    const both = await mapLimit(TAKES, 3, (take) =>
      runTakeModes(audioPath(take.file), take.file, { apiKey: apiKey!, maxEndpointDelayMs: 1000 }, { regex: parseIntent, jev: jev?.read ?? parseIntent }),
    );
    results = both.map((r) => r.regex);
    jevResults = both.map((r) => r.jev);
    expect(results).toHaveLength(15);
  }, 120_000);

  it.skipIf(!jev)("reads the intent of all 15 and lines 10-20 with jev on as well", () => {
    const wrong = jevResults.filter((r, i) => r.intent?.kind !== TAKES[i].kind || (TAKES[i].range && r.intent?.range?.from !== 10)).map((r) => `${r.file}: ${r.text}`);
    expect(wrong).toEqual([]);
  });

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
