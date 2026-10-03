// Screen recording helpers shared by the demo and comparison videos (Windows, ffmpeg gdigrab).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FONT = "C\\:/Windows/Fonts/YuGothB.ttc";

export function findFfmpeg(override?: string): string {
  if (override) return override;
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The full title of a top-level window whose title contains `part`, or undefined. */
export function findWindowTitle(part: string): string | undefined {
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle -like '*${part}*' } | Select-Object -First 1 -ExpandProperty MainWindowTitle`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return result.stdout.trim() || undefined;
}

/**
 * Brings the window whose title contains `part` to the front and returns its
 * screen rectangle (physical pixels). Capturing a window by title gives black
 * frames for VS Code (Electron draws through DirectComposition), so the desktop
 * is captured at the window's position instead.
 */
export function windowRect(part: string): { x: number; y: number; width: number; height: number } {
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$env:DEMO_WINDOW_PART*" } | Select-Object -First 1
$h = $p.MainWindowHandle
[W]::ShowWindow($h, 3) | Out-Null
Start-Sleep -Milliseconds 600
[W]::SetForegroundWindow($h) | Out-Null
$r = New-Object W+R
[W]::GetWindowRect($h, [ref]$r) | Out-Null
"$($r.L) $($r.T) $($r.Rt) $($r.B)"`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", env: { ...process.env, DEMO_WINDOW_PART: part } });
  const [left, top, right, bottom] = result.stdout.trim().split(/\s+/).map(Number);
  if (!(right > left && bottom > top)) {
    throw new Error(`ウィンドウ「${part}」の位置を取得できませんでした: ${result.stdout.trim()} ${result.stderr.trim().slice(0, 500)}`);
  }
  // A maximized window reaches a few pixels past the screen edge on each side
  const inset = 8;
  const even = (n: number) => n - (n % 2);
  return { x: left + inset, y: top + inset, width: even(right - left - 2 * inset), height: even(bottom - top - 2 * inset) };
}

export interface Recording {
  process: ChildProcess;
  startedAt: number;
  stop(): Promise<void>;
}

/** Records the screen area of the window whose title contains `part`. */
export function startRecording(ffmpeg: string, path: string, part: string): Recording {
  const rect = windowRect(part);
  console.log(`capturing ${rect.width}x${rect.height} at ${rect.x},${rect.y}`);
  const child = spawn(
    ffmpeg,
    ["-y", "-f", "gdigrab", "-framerate", "30", "-draw_mouse", "0", "-offset_x", String(rect.x), "-offset_y", String(rect.y), "-video_size", `${rect.width}x${rect.height}`, "-i", "desktop", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", path],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let log = "";
  child.stderr?.setEncoding("utf8").on("data", (t: string) => (log = (log + t).slice(-4000)));
  child.on("exit", (code) => {
    if (code) console.error(`ffmpeg (recording) exited with ${code}\n${log}`);
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return {
    process: child,
    startedAt: Date.now(),
    stop: async () => {
      child.stdin?.end("q");
      await exited;
    },
  };
}

/** Duration in seconds of a media file, read from ffmpeg's banner. */
export function mediaDuration(ffmpeg: string, path: string): number | undefined {
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", path], { encoding: "utf8" }).stderr;
  const [, h, m, sec] = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe) ?? [];
  return h === undefined ? undefined : Number(h) * 3600 + Number(m) * 60 + Number(sec);
}

/** Escapes a path for an ffmpeg filter option. */
export const filterPath = (path: string) => path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/** Builds drawtext filters; caption text goes through files so nothing needs escaping. */
export class Captions {
  readonly filters: string[] = [];
  constructor(private readonly workDir: string) {}

  add(text: string, from: number, to: number, opts: { y: string; size: number; x?: string; color?: string } ): void {
    const file = join(this.workDir, `caption_${this.filters.length}.txt`);
    writeFileSync(file, text, "utf8");
    this.filters.push(
      `drawtext=fontfile='${FONT}':textfile='${filterPath(file)}':fontsize=${opts.size}:fontcolor=${opts.color ?? "white"}:box=1:boxcolor=black@0.65:boxborderw=18:x=${opts.x ?? "(w-text_w)/2"}:y=${opts.y}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`,
    );
  }

  /** A running "label 12.3 s" timer counting from `from` until `to`, then frozen until `until`. */
  timer(label: string, from: number, to: number, until: number, opts: { y: string; size: number; x?: string }): void {
    // Read from a file, so the expansion needs no filtergraph escaping
    const running = `%{eif:floor(t-${from.toFixed(2)}):d}.%{eif:mod(floor((t-${from.toFixed(2)})*10),10):d}`;
    const fixed = (to - from).toFixed(1);
    const fileRunning = join(this.workDir, `caption_${this.filters.length}_run.txt`);
    writeFileSync(fileRunning, `${label} ${running} s`, "utf8");
    this.filters.push(
      `drawtext=fontfile='${FONT}':textfile='${filterPath(fileRunning)}':expansion=normal:fontsize=${opts.size}:fontcolor=yellow:box=1:boxcolor=black@0.65:boxborderw=14:x=${opts.x ?? "w-text_w-40"}:y=${opts.y}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`,
    );
    this.add(`${label} ${fixed} s`, to, until, { ...opts, x: opts.x ?? "w-text_w-40", color: "yellow" });
  }
}
