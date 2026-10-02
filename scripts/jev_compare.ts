/**
 * Intent reading with jev on vs off, on the same Soniox streams: each take is
 * streamed once and both readers (regex = off, jev = on) hear the identical
 * partials and finals. Writes docs/JEV.md.
 * Reads SONIOX_API_KEY and TYPESAFE_API_KEY from the environment.
 *
 *   npm run jev:compare                # 2 rounds of the 15 takes
 *   npm run jev:compare -- --rounds 1
 */
import "./loadEnv.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapLimit, runTakeModes, type TakeResult } from "../src/eval/runTake.js";
import { TAKES, type Take } from "../src/eval/takes.js";
import { JevIntentReader } from "../src/intent/jev.js";
import { parseIntent } from "../src/intent/parser.js";

const ROOT = join(import.meta.dirname, "..");
const MAX_ENDPOINT_DELAY_MS = 1000;
const MODES = ["off", "on"] as const;
type Mode = (typeof MODES)[number];

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

const ms = (value: number | null | undefined) => (value === null || value === undefined ? "-" : `${Math.round(value)}`);
const stat = (values: number[]) => `${ms(quantile(values, 0.5))} / ${ms(Math.max(...values))}`;
const defined = (values: Array<number | null>) => values.filter((v): v is number => v !== null);
const correct = (r: TakeResult, take: Take) => r.intent?.kind === take.kind;
const rangeOk = (r: TakeResult, take: Take) => r.intent?.range?.from === take.range?.from && r.intent?.range?.to === take.range?.to;

interface Row {
  take: Take;
  round: number;
  result: Record<Mode, TakeResult>;
}

function render(rows: Row[], jev: JevIntentReader, rounds: number, when: string): string {
  const summary = MODES.map((mode) => {
    const results = rows.map((row) => row.result[mode]);
    const ranged = rows.filter((row) => row.take.range);
    return `| ${mode === "on" ? "jev on" : "jev off（正規表現）"} | ${stat(defined(results.map((r) => r.intentAfterEndMs)))} | ${stat(defined(results.map((r) => r.resolvedAfterEndMs)))} | ${rows.filter((row) => correct(row.result[mode], row.take)).length}/${rows.length} | ${ranged.filter((row) => rangeOk(row.result[mode], row.take)).length}/${ranged.length} | ${results.filter((r) => r.speculativeHit).length}/${rows.length} | ${results.reduce((n, r) => n + r.abortedDispatches, 0)} |`;
  });
  const lead = rows.map((row) => {
    const { on, off } = row.result;
    return on.intentAfterEndMs !== null && off.intentAfterEndMs !== null ? on.intentAfterEndMs - off.intentAfterEndMs : null;
  });
  const leads = defined(lead);
  const callMs = jev.calls.map((c) => c.ms);
  const final = defined(rows.map((row) => row.result.off.finalAfterEndMs));
  const detail = rows.map((row, i) => {
    const { on, off } = row.result;
    const kind = (r: TakeResult) => `${r.intent?.kind ?? "-"}${r.intent?.range ? ` ${r.intent.range.from}-${r.intent.range.to}` : ""}`;
    return `| ${row.take.file} | ${row.round} | ${off.text} | ${kind(off)} | ${kind(on)} | ${ms(off.intentAfterEndMs)} | ${ms(on.intentAfterEndMs)} | ${ms(lead[i])} | ${ms(off.finalAfterEndMs)} | ${ms(on.resolvedAfterEndMs)} |`;
  });

  return `# jev on / off の速さ比べ

計測日時: ${when}
条件: Soniox \`stt-rt-v5\`（\`max_endpoint_delay_ms=${MAX_ENDPOINT_DELAY_MS}\`）に \`test/audio/\` の 15 本を実時間ペースで流し、${rounds} 周した（計 ${rows.length} 発話）。
1 本の音声ストリームに 2 つの先読み制御をつなぎ、off（正規表現）と on（jev \`jev-latest\` の Choice 1 問）が
まったく同じ partial / final を受け取るようにした。行範囲は両方とも正規表現で読む（jev は選択肢を返すだけで文字列を抜き出さない）。
\`npm run jev:compare\` で再計測できる。

- **意図発火**: 最終的に採用された意図の処理を始めた時点（発話終了から。負は話し終わる前）。
- **意図確定**: final の文字列から意図を読み終えた時点。off は final と同時、on は final のあと jev の応答を待つ。
- 値は「中央値 / 最大値」（ms）。

## 集計

| モード | 意図発火 | 意図確定 | 意図の正解 | 行範囲 | partial で当たった数 | 中断した先読み |
|---|---|---|---|---|---|---|
${summary.join("\n")}

- 発話終了 → final（両モード共通）: ${stat(final)} ms
- 意図発火の差（on − off、負なら on が早い）: 中央値 ${ms(quantile(leads, 0.5))} ms、最小 ${ms(Math.min(...leads))} ms、最大 ${ms(Math.max(...leads))} ms
- jev の呼び出し: ${callMs.length} 回、1 回あたり 中央値 ${ms(quantile(callMs, 0.5))} ms / 90 パーセンタイル ${ms(quantile(callMs, 0.9))} ms / 最大 ${ms(Math.max(...callMs))} ms

## 発話別

| file | 周 | 認識結果 | off の意図 | on の意図 | off 発火 | on 発火 | 差 | final | on 確定 |
|---|---|---|---|---|---|---|---|---|---|
${detail.join("\n")}
`;
}

async function main(): Promise<void> {
  const soniox = process.env.SONIOX_API_KEY;
  if (!soniox) throw new Error("SONIOX_API_KEY is not set");
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not set");
  const args = process.argv.slice(2);
  const rounds = args.includes("--rounds") ? Number(args[args.indexOf("--rounds") + 1]) : 2;

  const jev = new JevIntentReader();
  await jev.read("ウォームアップ"); // keep connection setup out of the first take
  jev.calls.length = 0;

  const rows: Row[] = [];
  for (let round = 1; round <= rounds; round++) {
    const results = await mapLimit(TAKES, 3, (take) =>
      runTakeModes(join(ROOT, "test", "audio", take.file), take.file, { apiKey: soniox, maxEndpointDelayMs: MAX_ENDPOINT_DELAY_MS }, { off: parseIntent, on: jev.read }),
    );
    results.forEach((result, i) => rows.push({ take: TAKES[i], round, result }));
    for (const [i, r] of results.entries()) {
      console.log(`${round} ${TAKES[i].file.padEnd(16)} off ${ms(r.off.intentAfterEndMs).padStart(5)}  on ${ms(r.on.intentAfterEndMs).padStart(5)}  ${r.off.text}`);
    }
  }
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  writeFileSync(join(ROOT, "docs", "JEV.md"), render(rows, jev, rounds, when));
  console.log("wrote docs/JEV.md");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
