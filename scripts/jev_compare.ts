/**
 * How the command is read from transcripts: keywords only (regex), jev only, or
 * keywords first and jev for the rest (hybrid). Each take is streamed through
 * Soniox once and all three readers hear the identical partials and finals.
 * Runs the keyword takes and the paraphrase takes (no keyword) and writes docs/JEV.md.
 * Reads SONIOX_API_KEY and TYPESAFE_API_KEY from the environment.
 *
 *   npm run jev:compare                # 2 rounds
 *   npm run jev:compare -- --rounds 1
 */
import "./loadEnv.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapLimit, runTakeModes, type TakeResult } from "../src/eval/runTake.js";
import { PARAPHRASE_TAKES, TAKES, type Take } from "../src/eval/takes.js";
import { hybridReader } from "../src/intent/hybrid.js";
import { JevIntentReader } from "../src/intent/jev.js";
import { parseIntent } from "../src/intent/parser.js";

const ROOT = join(import.meta.dirname, "..");
const MAX_ENDPOINT_DELAY_MS = 1000;
const MODES = ["regex", "jev", "hybrid"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABEL: Record<Mode, string> = { regex: "正規表現のみ（jev off）", jev: "jev のみ（jev on）", hybrid: "ハイブリッド" };
const SETS = [
  { name: "キーワードあり", takes: TAKES },
  { name: "キーワードなし", takes: PARAPHRASE_TAKES },
];

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

const ms = (value: number | null | undefined) => (value === null || value === undefined || Number.isNaN(value) ? "-" : `${Math.round(value)}`);
const stat = (values: number[]) => (values.length ? `${ms(quantile(values, 0.5))} / ${ms(Math.max(...values))}` : "-");
const correct = (r: TakeResult, take: Take) => r.intent?.kind === take.kind;
const rangeOk = (r: TakeResult, take: Take) => r.intent?.range?.from === take.range?.from && r.intent?.range?.to === take.range?.to;
const kindText = (r: TakeResult) => `${r.intent?.kind ?? "なし"}${r.intent?.range ? ` ${r.intent.range.from}-${r.intent.range.to}` : ""}`;

interface Row {
  set: string;
  take: Take;
  round: number;
  result: Record<Mode, TakeResult>;
}

function summaryTable(rows: Row[]): string {
  const ranged = rows.filter((row) => row.take.range);
  const lines = MODES.map((mode) => {
    const hits = rows.filter((row) => correct(row.result[mode], row.take));
    const fire = hits.map((row) => row.result[mode].intentAfterEndMs).filter((v): v is number => v !== null);
    const resolved = hits.map((row) => row.result[mode].resolvedAfterEndMs).filter((v): v is number => v !== null);
    const speculative = hits.filter((row) => row.result[mode].speculativeHit).length;
    return `| ${MODE_LABEL[mode]} | ${hits.length}/${rows.length} | ${ranged.filter((row) => rangeOk(row.result[mode], row.take)).length}/${ranged.length} | ${stat(fire)} | ${stat(resolved)} | ${speculative}/${hits.length} |`;
  });
  return ["| モード | 意図の正解 | 行範囲 | 意図発火 | 意図確定 | partial で当たった数 |", "|---|---|---|---|---|---|", ...lines].join("\n");
}

function render(rows: Row[], jev: JevIntentReader, hybridJev: JevIntentReader, rounds: number, when: string): string {
  const sections = SETS.map(({ name }) => {
    const setRows = rows.filter((row) => row.set === name);
    const final = setRows.map((row) => row.result.regex.finalAfterEndMs).filter((v): v is number => v !== null);
    return `### ${name}（${setRows.length} 発話）\n\n${summaryTable(setRows)}\n\n発話終了 → final（全モード共通）: ${stat(final)} ms`;
  });
  const detail = rows.map((row) => {
    const { regex, jev: j, hybrid } = row.result;
    const cell = (r: TakeResult) => `${correct(r, row.take) ? "" : "✗ "}${kindText(r)} ${ms(r.intentAfterEndMs)}`;
    return `| ${row.take.file} | ${row.round} | ${regex.text} | ${cell(regex)} | ${cell(j)} | ${cell(hybrid)} |`;
  });
  const callStats = (reader: JevIntentReader) => {
    const callMs = reader.calls.map((c) => c.ms);
    return `${callMs.length} 回（1 回 中央値 ${ms(quantile(callMs, 0.5))} ms / 90 パーセンタイル ${ms(quantile(callMs, 0.9))} ms）`;
  };

  return `# 意図の読み取り: 正規表現 / jev / ハイブリッド

計測日時: ${when}
条件: Soniox \`stt-rt-v5\`（\`max_endpoint_delay_ms=${MAX_ENDPOINT_DELAY_MS}\`）に \`test/audio/\` の 30 本
（キーワードあり 15 本、キーワードなし 15 本）を実時間ペースで流し、${rounds} 周した。
1 本の音声ストリームに 3 つの先読み制御をつなぎ、3 モードがまったく同じ partial / final を受け取るようにした。

- **正規表現のみ**: キーワードで読む（従来の既定）。
- **jev のみ**: すべての partial / final を jev（\`jev-latest\`、Choice 1 問）で読む。
- **ハイブリッド**: キーワードで読めればそのまま、読めないときだけ jev に聞く。
- 行範囲はどのモードも正規表現で読む。
- **意図発火**: 最終的に採用された意図の処理を始めた時点（発話終了から、ms。負は話し終わる前）。
- **意図確定**: final の文字列から意図を読み終えた時点。
- 時間は「中央値 / 最大値」で、意図を正しく読めた発話だけで集計した。

\`npm run jev:compare\` で再計測できる。

## 集計

${sections.join("\n\n")}

jev の呼び出し: jev のみ ${callStats(jev)}、ハイブリッド ${callStats(hybridJev)}

## 発話別

各セルは「読んだ意図 発火時刻(ms)」。✗ は誤り。

| file | 周 | 認識結果 | 正規表現 | jev | ハイブリッド |
|---|---|---|---|---|---|
${detail.join("\n")}
`;
}

async function main(): Promise<void> {
  const soniox = process.env.SONIOX_API_KEY;
  if (!soniox) throw new Error("SONIOX_API_KEY is not set");
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not set");
  const args = process.argv.slice(2);
  const rounds = args.includes("--rounds") ? Number(args[args.indexOf("--rounds") + 1]) : 2;

  // Separate readers so each mode's jev calls are counted on their own
  const jev = new JevIntentReader();
  const hybridJev = new JevIntentReader();
  await Promise.all([jev.read("ウォームアップ"), hybridJev.read("ウォームアップ")]); // connection setup out of the first take
  jev.calls.length = hybridJev.calls.length = 0;
  const readers = { regex: parseIntent, jev: jev.read, hybrid: hybridReader(hybridJev.read) };

  const rows: Row[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (const { name, takes } of SETS) {
      const results = await mapLimit(takes, 3, (take) =>
        runTakeModes(join(ROOT, "test", "audio", take.file), take.file, { apiKey: soniox, maxEndpointDelayMs: MAX_ENDPOINT_DELAY_MS }, readers),
      );
      results.forEach((result, i) => {
        rows.push({ set: name, take: takes[i], round, result });
        const cell = (mode: Mode) => `${correct(result[mode], takes[i]) ? " " : "✗"}${ms(result[mode].intentAfterEndMs).padStart(5)}`;
        console.log(`${round} ${takes[i].file.padEnd(20)} regex${cell("regex")}  jev${cell("jev")}  hybrid${cell("hybrid")}  ${result.regex.text}`);
      });
    }
  }
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  writeFileSync(join(ROOT, "docs", "JEV.md"), render(rows, jev, hybridJev, rounds, when));
  console.log("wrote docs/JEV.md");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
