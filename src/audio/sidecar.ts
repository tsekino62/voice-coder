import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AudioSource } from "./source.js";

export interface SidecarOptions {
  python: string;
  script: string;
  /** Extra arguments, e.g. ["--device", "1"] or ["--wav", "take.wav"]. */
  args?: string[];
}

type SidecarMessage =
  | { type: "ready"; sample_rate: number; source: string }
  | { type: "audio"; pcm: string }
  | { type: "end" }
  | { type: "error"; message: string };

/**
 * Microphone audio from python/mic_sidecar.py, which writes PCM chunks to
 * stdout as JSON Lines. Aborting the signal asks the sidecar to stop; the
 * chunks it already captured are still delivered.
 */
export class SidecarAudioSource implements AudioSource {
  constructor(private readonly options: SidecarOptions) {}

  async *chunks(signal: AbortSignal): AsyncIterable<Buffer> {
    const child = spawn(this.options.python, ["-u", this.options.script, ...(this.options.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (text: string) => (stderr = (stderr + text).slice(-2000)));
    const spawnError = new Promise<never>((_, reject) => child.once("error", reject));
    spawnError.catch(() => {});

    const stop = () => {
      if (child.stdin.writable) child.stdin.end(JSON.stringify({ cmd: "stop" }) + "\n");
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let ended = false;
    try {
      const iterator = lines[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), spawnError]);
        if (next.done) break;
        if (!next.value.trim()) continue;
        const message = JSON.parse(next.value) as SidecarMessage;
        if (message.type === "audio") yield Buffer.from(message.pcm, "base64");
        else if (message.type === "error") throw new Error(`mic sidecar: ${message.message}`);
        else if (message.type === "end") {
          ended = true;
          break;
        }
      }
      if (!ended && !signal.aborted) throw new Error(`mic sidecar exited unexpectedly${stderr ? `: ${stderr.trim()}` : ""}`);
    } finally {
      signal.removeEventListener("abort", stop);
      lines.close();
      stop();
      if (child.exitCode === null) child.kill();
    }
  }
}
