/**
 * Records the demo video: a VS Code window on a copy of a folder (default
 * D:\work\test_coder), driven by test/demo/demo.ts, captured with ffmpeg; then
 * the spoken test recordings and captions are laid over it at the moments they played.
 *
 *   npm run build && npm run demo
 *   npm run demo -- --folder D:\work\test_coder --out demo\voice-coder-demo.mp4
 *
 * Needs ffmpeg (winget install Gyan.FFmpeg) and the keys in .env (SONIOX / OPENAI / TYPESAFE).
 * The folder itself is never touched: the demo runs on a copy.
 */
import "../loadEnv.js";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runTests } from "@vscode/test-electron";
import type { TimelineEntry } from "../../test/demo/demo.js";

const ROOT = resolve(import.meta.dirname, "..", "..");
const WINDOW_TITLE = "Voice Coder Demo";
const FONT = "C\\:/Windows/Fonts/YuGothB.ttc";

const { values: opts } = parseArgs({
  options: {
    folder: { type: "string", default: "D:\\work\\test_coder" },
    out: { type: "string" },
    ffmpeg: { type: "string" },
    lang: { type: "string", default: "ja" },
  },
});

function findFfmpeg(): string {
  if (opts.ffmpeg) return opts.ffmpeg;
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  // winget installs it under the user's package folder; the PATH change needs a new shell
  const base = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet", "Packages");
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    if (!dir.startsWith("Gyan.FFmpeg")) continue;
    for (const build of readdirSync(join(base, dir))) {
      const exe = join(base, dir, build, "bin", "ffmpeg.exe");
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error("ffmpeg が見つかりません（winget install Gyan.FFmpeg）");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The full title of the window whose title contains `part` (the development host
 * adds its own prefix to window.title), or undefined.
 */
function findWindowTitle(part: string): string | undefined {
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle -like '*${part}*' } | Select-Object -First 1 -ExpandProperty MainWindowTitle`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return result.stdout.trim() || undefined;
}

/** Copy of the folder to run the demo on, without caches. */
function copyFolder(folder: string): string {
  const work = join(mkdtempSync(join(tmpdir(), "voice-coder-demo-")), basename(folder));
  cpSync(folder, work, { recursive: true, filter: (src) => !/[\\/](__pycache__|\.pytest_cache|\.git|node_modules)([\\/]|$)/.test(src) });
  return work;
}

function userDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "voice-coder-demo-user-"));
  mkdirSync(join(dir, "User"), { recursive: true });
  const settings = {
    "window.title": WINDOW_TITLE,
    "window.newWindowDimensions": "maximized",
    "window.zoomLevel": 1,
    "editor.fontSize": 16,
    "editor.minimap.enabled": false,
    "editor.renderWhitespace": "none",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.secondarySideBar.defaultVisibility": "hidden",
    "workbench.colorTheme": "Default Dark Modern",
    "chat.commandCenter.enabled": false,
    "chat.disableAIFeatures": true,
    "security.workspace.trust.enabled": false,
    "update.mode": "none",
    "extensions.ignoreRecommendations": true,
    "telemetry.telemetryLevel": "off",
    "terminal.integrated.fontSize": 15,
  };
  writeFileSync(join(dir, "User", "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}

/**
 * Screen rectangle of the window (physical pixels). Capturing the window by title
 * gives black frames for VS Code (Electron draws through DirectComposition), so the
 * desktop is captured at the window's position instead.
 */
function windowRect(title: string): { x: number; y: number; width: number; height: number } {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$env:DEMO_WINDOW_PART*" } | Select-Object -First 1
$h = $p.MainWindowHandle
[W]::SetForegroundWindow($h) | Out-Null
$r = New-Object W+R
[W]::GetWindowRect($h, [ref]$r) | Out-Null
"$($r.L) $($r.T) $($r.Rt) $($r.B)"`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", env: { ...process.env, DEMO_WINDOW_PART: WINDOW_TITLE } });
  const [left, top, right, bottom] = result.stdout.trim().split(/\s+/).map(Number);
  if (!(right > left && bottom > top)) {
    throw new Error(`ウィンドウ「${title}」の位置を取得できませんでした: ${result.stdout.trim()} ${result.stderr.trim().slice(0, 500)}`);
  }
  // A maximized window reaches a few pixels past the screen edge on each side
  const inset = 8;
  const even = (n: number) => n - (n % 2);
  return { x: left + inset, y: top + inset, width: even(right - left - 2 * inset), height: even(bottom - top - 2 * inset) };
}

function startRecording(ffmpeg: string, path: string, title: string): { process: ChildProcess; startedAt: number } {
  const rect = windowRect(title);
  console.log(`capturing ${rect.width}x${rect.height} at ${rect.x},${rect.y}`);
  const process = spawn(
    ffmpeg,
    ["-y", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "0", "-offset_x", String(rect.x), "-offset_y", String(rect.y), "-video_size", `${rect.width}x${rect.height}`, "-i", "desktop", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", path],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let log = "";
  process.stderr?.setEncoding("utf8").on("data", (t: string) => (log = (log + t).slice(-4000)));
  process.on("exit", (code) => {
    if (code) console.error(`ffmpeg (recording) exited with ${code}\n${log}`);
  });
  return { process, startedAt: Date.now() };
}

/** Escapes a value for an ffmpeg filter option. */
const filterText = (path: string) => path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

function compose(ffmpeg: string, raw: string, out: string, timeline: TimelineEntry[], recordStart: number, work: string): void {
  const audioDir = join(ROOT, "test", "audio");
  const inputs = ["-i", raw];
  const audioFilters: string[] = [];
  timeline.forEach((entry, i) => {
    inputs.push("-i", join(audioDir, entry.wav));
    const delay = Math.max(0, entry.audioStart - recordStart);
    audioFilters.push(`[${i + 1}:a]adelay=${delay}|${delay}[a${i}]`);
  });
  const english = opts.lang === "en";
  const captions: string[] = [];
  const caption = (text: string, from: number, to: number, y: string, size: number) => {
    const file = join(work, `caption_${captions.length}.txt`);
    writeFileSync(file, text, "utf8");
    captions.push(
      `drawtext=fontfile='${FONT}':textfile='${filterText(file)}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=18:x=(w-text_w)/2:y=${y}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`,
    );
  };
  const t = (ms: number) => Math.max(0, (ms - recordStart) / 1000);
  for (const entry of timeline) {
    caption(`${english ? "Voice" : "音声"}: ${entry.caption}`, t(entry.audioStart), t(entry.doneAt) + 1.5, "h-200", 56);
    if (entry.extra) caption(`${english ? "Key" : "キー"}: ${entry.extra.caption}`, t(entry.extra.at), t(entry.extra.at) + 3.5, "h-200", 48);
  }
  caption(
    english ? "Voice Coder — synthesized test speech (ElevenLabs) played in place of the microphone" : "Voice Coder — テスト用の合成音声（ElevenLabs）をマイクの代わりに流しています",
    0,
    6,
    "40",
    30,
  );

  const video = `[0:v]scale=1920:-2,${captions.join(",")}[v]`;
  const audio = timeline.length
    ? `${audioFilters.join(";")};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0[a]`
    : "";
  const filterScript = join(work, "filter.txt");
  writeFileSync(filterScript, [video, audio].filter(Boolean).join(";"), "utf8");
  const args = ["-y", ...inputs, "-/filter_complex", filterScript, "-map", "[v]", ...(timeline.length ? ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"] : []), "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out];
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg (compose) failed:\n${result.stderr.slice(-3000)}`);
}

async function main(): Promise<void> {
  const ffmpeg = findFfmpeg();
  if (!existsSync(join(ROOT, "out", "demo", "demo.cjs"))) throw new Error("先に npm run build を実行してください");
  const folder = copyFolder(opts.folder!);
  const work = dirname(folder);
  const raw = join(work, "raw.mkv");
  const timelinePath = join(work, "timeline.json");
  console.log(`demo folder (copy): ${folder}`);

  let recording: { process: ChildProcess; startedAt: number } | undefined;
  const watcher = (async () => {
    for (let waited = 0; waited < 120_000 && !recording; waited += 500) {
      const title = findWindowTitle(WINDOW_TITLE);
      if (title) {
        await sleep(1500); // let the window settle (maximize, layout)
        recording = startRecording(ffmpeg, raw, title);
        console.log(`recording "${title}"…`);
        return;
      }
      await sleep(500);
    }
  })();

  process.env.DEMO_TIMELINE = timelinePath;
  await runTests({
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: join(ROOT, "out", "demo", "demo.cjs"),
    launchArgs: [folder, "--disable-extensions", "--disable-gpu", "--skip-welcome", "--skip-release-notes", "--user-data-dir", userDataDir()],
    extensionTestsEnv: { DEMO_TIMELINE: timelinePath, DEMO_LEAD_MS: "6000", DEMO_LANG: opts.lang! },
  });
  await watcher;
  if (!recording) throw new Error(`録画するウィンドウ「${WINDOW_TITLE}」が見つかりませんでした`);
  recording.process.stdin?.end("q");
  await new Promise((r) => recording!.process.once("exit", r));

  const timeline = JSON.parse(readFileSync(timelinePath, "utf8")) as TimelineEntry[];
  for (const entry of timeline) console.log(`${entry.caption.padEnd(20)} ${((entry.doneAt - entry.audioStart) / 1000).toFixed(1)} s  ${entry.message}`);
  const out = opts.out ?? join(ROOT, "demo", opts.lang === "en" ? "voice-coder-demo-en.mp4" : "voice-coder-demo.mp4");
  mkdirSync(dirname(out), { recursive: true });
  compose(ffmpeg, raw, out, timeline, recording.startedAt, work);
  console.log(`wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
  rmSync(raw, { force: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
