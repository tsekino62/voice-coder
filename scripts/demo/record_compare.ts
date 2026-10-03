/**
 * Records the comparison video in the user's own VS Code: the same recording
 * ("FizzBuzzを作って") spoken through the virtual cable to (1) VS Code's built-in
 * dictation into Copilot Chat (agent mode, sent with Enter) and (2) Voice Coder on
 * the same Copilot models, with a timer from the end of speech to the first code.
 *
 *   npm run compare:video
 *   npm run compare:video -- --wav test/audio/generate_1.wav --out demo/compare-vscode.mp4
 *
 * Needs: VB-CABLE as Windows' default recording device, GitHub Copilot signed in,
 * the Voice Coder extension installed, ffmpeg, SONIOX_API_KEY in .env.
 * Runs on a copy of --folder with an empty fizzbuzz.py; the folder itself is untouched.
 */
import "../loadEnv.js";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { PhaseResult } from "../../tools/compare/driver.js";
import { Captions, findFfmpeg, findWindowTitle, mediaDuration, sleep, startRecording, type Recording } from "./recording.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const DRIVER = join(ROOT, "tools", "compare");
const WINDOW_PART = "Extension Development Host";
const TAIL_CUT_S = 1;

const { values: opts } = parseArgs({
  options: {
    wav: { type: "string", default: join(ROOT, "test", "audio", "generate_1.wav") },
    utterance: { type: "string", default: "FizzBuzzを作って" },
    out: { type: "string", default: join(ROOT, "demo", "compare-vscode.mp4") },
    ffmpeg: { type: "string" },
  },
});

function buildDriver(): void {
  const result = spawnSync(
    "npx",
    ["esbuild", "tools/compare/driver.ts", "--bundle", "--platform=node", "--format=cjs", "--external:vscode", "--external:@picovoice/pvspeaker-node", "--external:@picovoice/pvrecorder-node", "--outfile=tools/compare/dist/driver.cjs", "--log-level=warning"],
    { cwd: ROOT, shell: true, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

function compose(ffmpeg: string, raw: string, out: string, results: PhaseResult[], recordStart: number, work: string): void {
  const t = (ms: number) => Math.max(0, (ms - recordStart) / 1000);
  const duration = (mediaDuration(ffmpeg, raw) ?? 0) - TAIL_CUT_S;
  const SUMMARY_S = 6;
  const end = duration + SUMMARY_S;
  const captions = new Captions(work);
  const titles: Record<PhaseResult["phase"], string> = {
    builtin: "① VS Code の音声入力（ディクテーション）→ Copilot チャット（エージェント）",
    voicecoder: "② Voice Coder（同じ Copilot のモデル）",
  };
  results.forEach((r, i) => {
    const from = i === 0 ? 0 : t(r.audioStart) - 3;
    const to = i + 1 < results.length ? t(results[i + 1].audioStart) - 3 : duration;
    captions.add(titles[r.phase], from, to, { y: "40", size: 34, x: "40" });
    captions.add(`音声: 「${opts.utterance}」`, t(r.audioStart), t(r.speechEnd) + 1.5, { y: "h-200", size: 52 });
    if (r.sentAt) captions.add("Enter で送信", t(r.sentAt), t(r.sentAt) + 2.5, { y: "h-320", size: 44 });
    if (r.firstEdit) captions.timer("話し終わり → コード", t(r.speechEnd), t(r.firstEdit), to, { y: "110", size: 40 });
  });
  const seconds = (r: PhaseResult) => (r.firstEdit ? `${((r.firstEdit - r.speechEnd) / 1000).toFixed(1)} 秒` : "—");
  const builtin = results.find((r) => r.phase === "builtin");
  const voiceCoder = results.find((r) => r.phase === "voicecoder");
  captions.add("話し終わりからコードが入るまで", duration, end, { y: "(h/2)-150", size: 48 });
  if (builtin) captions.add(`VS Code 音声入力 + Copilot: ${seconds(builtin)}`, duration, end, { y: "(h/2)-60", size: 56 });
  if (voiceCoder) captions.add(`Voice Coder: ${seconds(voiceCoder)}`, duration, end, { y: "(h/2)+30", size: 56, color: "yellow" });

  const inputs = ["-i", raw, ...results.flatMap(() => ["-i", opts.wav!])];
  const audio = results.map((r, i) => {
    const delay = Math.round(Math.max(0, r.audioStart - recordStart));
    return `[${i + 1}:a]adelay=${delay}|${delay}[a${i}]`;
  });
  const filter = [
    `[0:v]trim=0:${duration.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${SUMMARY_S},scale=1920:-2,${captions.filters.join(",")}[v]`,
    ...audio,
    `${results.map((_, i) => `[a${i}]`).join("")}amix=inputs=${results.length}:normalize=0,atrim=0:${end.toFixed(3)}[a]`,
  ].join(";");
  const filterScript = join(work, "filter.txt");
  writeFileSync(filterScript, filter, "utf8");
  const args = ["-y", ...inputs, "-/filter_complex", filterScript, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out];
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg (compose) failed:\n${result.stderr.slice(-3000)}`);
}

async function main(): Promise<void> {
  const ffmpeg = findFfmpeg(opts.ffmpeg);
  const sonioxKey = process.env.SONIOX_API_KEY;
  if (!sonioxKey) throw new Error("SONIOX_API_KEY is not set");
  buildDriver();

  // Inside a folder trusted once (trust carries over to subfolders), and new each run: VS Code will
  // not open a folder that another window already has open
  const folder = join(ROOT, "demo", "compare-workspace", "test_coder", "runs", new Date().toISOString().replace(/[:.]/g, "-"), "test_coder");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "fizzbuzz.py"), "");
  const work = mkdtempSync(join(tmpdir(), "voice-coder-compare-"));
  const resultPath = join(work, "result.json");
  const raw = join(work, "raw.mkv");
  const jobPath = join(DRIVER, "job.json");
  writeFileSync(jobPath, JSON.stringify({ action: "compare", out: resultPath, wav: resolve(opts.wav!), file: "fizzbuzz.py", sonioxKey, leadMs: 6000 }));

  let recording: Recording | undefined;
  try {
    spawn("code", ["--new-window", `--extensionDevelopmentPath=${DRIVER}`, folder], { shell: true, stdio: "ignore", detached: true }).unref();
    for (let waited = 0; waited < 60_000 && !recording; waited += 500) {
      if (findWindowTitle(WINDOW_PART)) {
        await sleep(2000); // the window settles (layout, extensions)
        recording = startRecording(ffmpeg, raw, WINDOW_PART);
        console.log("recording…");
      } else await sleep(500);
    }
    if (!recording) throw new Error("the comparison window did not open");
    for (let waited = 0; waited < 360_000 && !existsSync(resultPath); waited += 500) await sleep(500);
    await recording.stop();
  } finally {
    rmSync(jobPath, { force: true }); // holds the Soniox key
  }

  const result = JSON.parse(readFileSync(resultPath, "utf8")) as { results?: PhaseResult[]; error?: string };
  if (!result.results) {
    if (result.error?.includes("UNTRUSTED")) throw new Error(`VS Code でフォルダー ${folder} を一度開いて「信頼する」を選んでから、もう一度実行してください`);
    throw new Error(result.error ?? "no result");
  }
  for (const r of result.results) {
    const s = (ms?: number) => (ms ? `${((ms - r.speechEnd) / 1000).toFixed(2)} s` : "-");
    console.log(`${r.phase.padEnd(10)} sent ${s(r.sentAt)}  first edit ${s(r.firstEdit)}  last edit ${s(r.lastEdit)}`);
  }
  mkdirSync(dirname(opts.out!), { recursive: true });
  compose(ffmpeg, raw, opts.out!, result.results, recording!.startedAt, work);
  writeFileSync(opts.out!.replace(/\.mp4$/, ".json"), JSON.stringify(result.results.map((r) => ({ ...r, finalText: r.finalText })), null, 2));
  console.log(`wrote ${opts.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
