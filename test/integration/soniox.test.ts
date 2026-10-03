import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapLimit, runTakeModes, type TakeResult } from "../../src/eval/runTake.js";
import { EN_TAKES, PARAPHRASE_TAKES, TAKES } from "../../src/eval/takes.js";
import { hybridReader } from "../../src/intent/hybrid.js";
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

describe.skipIf(!apiKey || !process.env.TYPESAFE_API_KEY || !PARAPHRASE_TAKES.every((t) => existsSync(audioPath(t.file))))(
  "Soniox, 15 takes without keywords, hybrid reader",
  () => {
    it("reads every intent and every line range that keywords alone miss", async () => {
      const jev = new JevIntentReader();
      const results = await mapLimit(PARAPHRASE_TAKES, 3, (take) =>
        runTakeModes(audioPath(take.file), take.file, { apiKey: apiKey!, maxEndpointDelayMs: 1000 }, { regex: parseIntent, hybrid: hybridReader(jev.read) }),
      );
      expect(results.filter((r, i) => r.regex.intent?.kind === PARAPHRASE_TAKES[i].kind)).toHaveLength(0);
      const wrong = results
        .filter((r, i) => {
          const take = PARAPHRASE_TAKES[i];
          return r.hybrid.intent?.kind !== take.kind || (take.range && r.hybrid.intent?.range?.from !== take.range.from);
        })
        .map((r) => `${r.hybrid.file}: ${r.hybrid.text} → ${r.hybrid.intent?.kind}`);
      expect(wrong).toEqual([]);
    }, 120_000);
  },
);

describe.skipIf(!apiKey || !EN_TAKES.every((t) => existsSync(audioPath(t.file))))("Soniox, English takes (ja + en language hints)", () => {
  it("reads every English command and its line range", async () => {
    const jev = process.env.TYPESAFE_API_KEY ? new JevIntentReader() : undefined;
    const reader = jev ? hybridReader(jev.read) : parseIntent;
    const results = await mapLimit(EN_TAKES, 3, (take) =>
      runTakeModes(audioPath(take.file), take.file, { apiKey: apiKey!, maxEndpointDelayMs: 1000 }, { reader }),
    );
    const wrong = results
      .map((r, i) => ({ r: r.reader, take: EN_TAKES[i] }))
      .filter(({ r, take }) => r.intent?.kind !== take.kind || (take.range && r.intent?.range?.from !== take.range.from))
      .map(({ r, take }) => `${take.file}: "${r.text}" → ${r.intent?.kind}`);
    expect(wrong).toEqual([]);
  }, 120_000);
});
