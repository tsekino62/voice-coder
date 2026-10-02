import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SidecarAudioSource } from "../../src/audio/sidecar.js";
import { encodeWav, SAMPLE_RATE } from "../../src/audio/wav.js";

const python = process.env.VOICE_CODER_PYTHON ?? "python";
const hasPython = spawnSync(python, ["--version"]).status === 0;
const script = join(import.meta.dirname, "..", "..", "python", "mic_sidecar.py");

function wav(seconds: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "vc-")), "s.wav");
  const pcm = Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE((i % 100) - 50, i * 2);
  writeFileSync(path, encodeWav(pcm));
  return path;
}

// The sidecar's --wav mode speaks the same JSON Lines protocol as the mic, without PyAudio
describe.skipIf(!hasPython)("mic sidecar over stdio JSON Lines", () => {
  it("delivers every sample of a replayed WAV and ends", async () => {
    const source = new SidecarAudioSource({ python, script, args: ["--wav", wav(0.5)] });
    let bytes = 0;
    for await (const chunk of source.chunks(new AbortController().signal)) bytes += chunk.length;
    expect(bytes).toBe(0.5 * SAMPLE_RATE * 2);
  });

  it("stops early when asked (push-to-talk released)", async () => {
    const source = new SidecarAudioSource({ python, script, args: ["--wav", wav(5)] });
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(), 300);
    let bytes = 0;
    for await (const chunk of source.chunks(controller.signal)) bytes += chunk.length;
    expect(performance.now() - started).toBeLessThan(3000);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(5 * SAMPLE_RATE * 2);
  });

  it("reports a sidecar error", async () => {
    const source = new SidecarAudioSource({ python, script, args: ["--wav", join(tmpdir(), "does-not-exist.wav")] });
    await expect(async () => {
      for await (const _ of source.chunks(new AbortController().signal)) void _;
    }).rejects.toThrow(/mic sidecar: FileNotFoundError/);
  });
});
