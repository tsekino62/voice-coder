/**
 * Streams the 15 takes through Soniox at real-time pace and writes
 * docs/LATENCY.md. Reads SONIOX_API_KEY from the environment.
 *
 *   npm run latency
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mapLimit, runTake, type TakeResult } from "../src/eval/runTake.js";
import { TAKES } from "../src/eval/takes.js";
import { DEFAULT_TERMS } from "../src/stt/SonioxBackend.js";

const ROOT = join(import.meta.dirname, "..");
const MAX_ENDPOINT_DELAY_MS = 1000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const ms = (value: number | null) => (value === null ? "-" : `${Math.round(value)}`);

function render(results: TakeResult[], when: string): string {
  const intent = results.map((r) => r.intentAfterEndMs).filter((v): v is number => v !== null);
  const final = results.map((r) => r.finalAfterEndMs).filter((v): v is number => v !== null);
  const hits = results.filter((r) => r.speculativeHit).length;
  const correct = results.filter((r, i) => r.intent?.kind === TAKES[i].kind).length;
  const rows = results.map((r, i) => {
    const take = TAKES[i];
    const range = r.intent?.range ? `${r.intent.range.from}-${r.intent.range.to}` : "";
    return `| ${take.file} | ${take.text} | ${r.text} | ${r.intent?.kind ?? "-"} ${range} | ${ms(r.intentAfterEndMs)} | ${ms(r.finalAfterEndMs)} | ${r.speculativeHit ? "partial" : "final"} |`;
  });
  return `# 発話終了から意図発火・final までの時間

計測日時: ${when}
条件: Soniox \`stt-rt-v5\`、\`max_endpoint_delay_ms=${MAX_ENDPOINT_DELAY_MS}\`、\`context.terms\` = ${DEFAULT_TERMS.join(" / ")}。
\`test/audio/\` の ElevenLabs 合成音声 ${results.length} 本を実時間ペースで流した（同時に最大 3 本）。\`npm run latency\` で再計測できる。

- **発話終了**: WAV の音量から求めた発話の終わり（stt_probe と同じ方法）。
- **意図発火**: 最終的に採用された意図の処理を始めた時点。partial で当たった場合は partial の時点、
  外れて final でやり直した場合は final の時点。負の値は話し終わる前に発火したことを表す。
- **final**: Soniox の \`<end>\` で発話が確定した時点。

## 集計

| 指標 | 中央値 (ms) | 最大値 (ms) |
|---|---|---|
| 発話終了 → 意図発火 | ${ms(median(intent))} | ${ms(Math.max(...intent))} |
| 発話終了 → final | ${ms(median(final))} | ${ms(Math.max(...final))} |

意図の正解 ${correct}/${results.length}、partial での発火がそのまま採用された本数 ${hits}/${results.length}。

## テイク別

| file | 読み上げ文 | 認識結果 | 意図 | 意図発火 (ms) | final (ms) | 採用 |
|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

async function main(): Promise<void> {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) throw new Error("SONIOX_API_KEY is not set");
  const results = await mapLimit(TAKES, 3, (take) =>
    runTake(join(ROOT, "test", "audio", take.file), take.file, { apiKey, maxEndpointDelayMs: MAX_ENDPOINT_DELAY_MS }),
  );
  for (const r of results) console.log(`${r.file.padEnd(16)} ${ms(r.intentAfterEndMs).padStart(6)} ${ms(r.finalAfterEndMs).padStart(6)}  ${r.text}`);
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  writeFileSync(join(ROOT, "docs", "LATENCY.md"), render(results, when));
  console.log("wrote docs/LATENCY.md");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
