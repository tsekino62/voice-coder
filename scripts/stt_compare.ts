/**
 * Speech recognition for voice commands: Soniox (what the extension uses) vs
 * OpenAI's realtime and file transcription (the kind of recognition behind
 * Codex's dictation; which model Codex uses is not published).
 * Every service hears the same 30 takes at real-time pace with the same
 * vocabulary, push-to-talk released 300 ms after the end of speech, and the
 * same hybrid reader (keywords, then jev) reads the command. Writes docs/STT_COMPARE.md.
 *
 *   npm run stt:compare                # 2 rounds
 *   npm run stt:compare -- --rounds 1
 */
import "./loadEnv.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapLimit } from "../src/eval/runTake.js";
import { characterErrorRate, comparable, runPushToTalk, type PushToTalkResult, type TimedBackend } from "../src/eval/sttCompare.js";
import { ALL_TAKES, PARAPHRASE_TAKES, type Take } from "../src/eval/takes.js";
import type { WavFileSource } from "../src/audio/source.js";
import { hybridReader } from "../src/intent/hybrid.js";
import { JevIntentReader } from "../src/intent/jev.js";
import { parseIntent } from "../src/intent/parser.js";
import { OpenAIFileBackend } from "../src/stt/OpenAIFileBackend.js";
import { OpenAIRealtimeBackend } from "../src/stt/OpenAIRealtimeBackend.js";
import { SonioxBackend } from "../src/stt/SonioxBackend.js";

const ROOT = join(import.meta.dirname, "..");
const RELEASE_MS = 300;

const SERVICES: Array<{ key: string; label: string; make: (source: WavFileSource) => TimedBackend }> = [
  { key: "soniox", label: "Soniox stt-rt-v5（ストリーミング、現行）", make: (s) => new SonioxBackend(s, { apiKey: process.env.SONIOX_API_KEY!, maxEndpointDelayMs: 1000 }) },
  { key: "live", label: "OpenAI gpt-live-transcribe（ストリーミング）", make: (s) => new OpenAIRealtimeBackend(s) },
  { key: "live-min", label: "OpenAI gpt-live-transcribe delay=minimal", make: (s) => new OpenAIRealtimeBackend(s, { delay: "minimal" }) },
  { key: "file", label: "OpenAI gpt-transcribe（録音後に一括、ディクテーション型）", make: (s) => new OpenAIFileBackend(s) },
];

interface Row {
  take: Take;
  round: number;
  results: Record<string, PushToTalkResult>;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}
const ms = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "-" : `${Math.round(v)}`);
const stat = (values: number[]) => (values.length ? `${ms(quantile(values, 0.5))} / ${ms(Math.max(...values))}` : "-");
const pct = (n: number, d: number) => `${n}/${d}`;
const intentOk = (r: PushToTalkResult, take: Take) => r.intent?.kind === take.kind;
const rangeOk = (r: PushToTalkResult, take: Take) => r.intent?.range?.from === take.range?.from && r.intent?.range?.to === take.range?.to;
const termOk = (r: PushToTalkResult, take: Take) => !/fizzbuzz/i.test(take.text) || comparable(r.text).includes("fizzbuzz");

function table(rows: Row[]): string {
  const ranged = rows.filter((row) => row.take.range);
  const named = rows.filter((row) => /fizzbuzz/i.test(row.take.text));
  const lines = SERVICES.map(({ key, label }) => {
    const results = rows.map((row) => row.results[key]);
    const ok = rows.filter((row) => intentOk(row.results[key], row.take));
    const values = (pick: (r: PushToTalkResult) => number | null) => ok.map((row) => pick(row.results[key])).filter((v): v is number => v !== null);
    const cer = quantile(results.map((r, i) => characterErrorRate(rows[i].take.text, r.text)), 0.5);
    const errors = results.filter((r) => r.error).length;
    return `| ${label} | ${pct(ok.length, rows.length)} | ${pct(ranged.filter((row) => rangeOk(row.results[key], row.take)).length, ranged.length)} | ${pct(named.filter((row) => termOk(row.results[key], row.take)).length, named.length)} | ${(cer * 100).toFixed(1)}% | ${stat(values((r) => r.intentAfterEndMs))} | ${stat(values((r) => r.finalAfterEndMs))} | ${stat(values((r) => r.resolvedAfterEndMs))} | ${errors} |`;
  });
  return [
    "| サービス | 意図の正解 | 行範囲 | FizzBuzz 表記 | 文字誤り率（中央値） | 意図発火 | final | 意図確定 | エラー |",
    "|---|---|---|---|---|---|---|---|---|",
    ...lines,
  ].join("\n");
}

function render(rows: Row[], rounds: number, when: string): string {
  const sets = [
    { name: "全 30 本", rows },
    { name: "キーワードあり 15 本", rows: rows.filter((row) => !PARAPHRASE_TAKES.includes(row.take)) },
    { name: "キーワードなし 15 本", rows: rows.filter((row) => PARAPHRASE_TAKES.includes(row.take)) },
  ];
  const detail = rows.map((row) => {
    const cells = SERVICES.map(({ key }) => {
      const r = row.results[key];
      const mark = intentOk(r, row.take) ? "" : "✗ ";
      return `${mark}${r.error ? `エラー: ${r.error.slice(0, 40)}` : r.text || "（なし）"} (${ms(r.finalAfterEndMs)})`;
    });
    return `| ${row.take.file} | ${row.round} | ${row.take.text} | ${cells.join(" | ")} |`;
  });
  return `# 音声認識の比較: Soniox と OpenAI（Codex のディクテーション相当）

計測日時: ${when}

Codex アプリのディクテーションは外部から操作できず、使っているモデルも公開されていないため、OpenAI の音声認識 API
（ストリーミングの \`gpt-live-transcribe\` と、録音後に一括で書き起こす \`gpt-transcribe\`）で代わりに測った。
「Codex のディクテーションそのもの」ではなく「OpenAI の音声認識」との比較である。

条件:
- \`test/audio/\` の 30 本（キーワードあり 15、なし 15、ElevenLabs 合成音声）を各サービスに実時間ペースで流し、${rounds} 周した。
- push-to-talk として、発話終了の ${RELEASE_MS} ms 後にキーを離した扱いで音声を止める（Soniox は終了フレーム、
  OpenAI realtime は \`input_audio_buffer.commit\`、gpt-transcribe はその時点までの録音をアップロード）。
- 語彙は全サービス同じ（FizzBuzz / async / await / リファクタ / デバッグ。Soniox は \`context.terms\`、OpenAI は \`keywords\`）。言語は日本語指定。
- 意図はどのサービスでも同じハイブリッド方式（キーワード → 読めなければ jev）で読む。
- 時間は発話終了からの ms（中央値 / 最大値）で、意図を正しく読めた発話だけで集計。発話終了は音量から推定。
- **意図発火**: 処理を始めた時点（partial の先読みを含む）。**final**: 確定した書き起こしが届いた時点。
  **意図確定**: final から意図を読み終えた時点。
- 文字誤り率は読み上げ文との比較（全角半角・漢数字・句読点・空白をそろえてから）。

${sets.map((set) => `## ${set.name}\n\n${table(set.rows)}`).join("\n\n")}

## 発話別

各セルは認識結果と final までの ms。✗ は意図を誤ったもの。

| file | 周 | 読み上げ文 | ${SERVICES.map((s) => s.key).join(" | ")} |
|---|---|---|${SERVICES.map(() => "---").join("|")}|
${detail.join("\n")}
`;
}

async function main(): Promise<void> {
  for (const key of ["SONIOX_API_KEY", "OPENAI_API_KEY"]) if (!process.env[key]) throw new Error(`${key} is not set`);
  const args = process.argv.slice(2);
  const rounds = args.includes("--rounds") ? Number(args[args.indexOf("--rounds") + 1]) : 2;
  const reader = process.env.TYPESAFE_API_KEY ? hybridReader(new JevIntentReader().read) : parseIntent;

  const rows: Row[] = [];
  for (let round = 1; round <= rounds; round++) {
    const results = await mapLimit(ALL_TAKES, 2, async (take) => {
      const path = join(ROOT, "test", "audio", take.file);
      // Every service hears the take at the same moment
      const each = await Promise.all(SERVICES.map((s) => runPushToTalk(path, s.make, reader, RELEASE_MS)));
      return Object.fromEntries(SERVICES.map((s, i) => [s.key, each[i]]));
    });
    results.forEach((r, i) => {
      rows.push({ take: ALL_TAKES[i], round, results: r });
      const line = SERVICES.map(({ key }) => `${key} ${intentOk(r[key], ALL_TAKES[i]) ? " " : "✗"}${ms(r[key].finalAfterEndMs).padStart(5)}`).join("  ");
      console.log(`${round} ${ALL_TAKES[i].file.padEnd(20)} ${line}`);
    });
  }
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  writeFileSync(join(ROOT, "docs", "STT_COMPARE.md"), render(rows, rounds, when));
  console.log("wrote docs/STT_COMPARE.md");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
