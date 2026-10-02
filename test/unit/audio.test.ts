import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WavFileSource } from "../../src/audio/source.js";
import { encodeWav, readWavPcm, SAMPLE_RATE, speechBounds } from "../../src/audio/wav.js";

/** silence, then a 440 Hz tone, then silence (seconds). */
function tone(before: number, length: number, after: number): Buffer {
  const total = Math.round((before + length + after) * SAMPLE_RATE);
  const pcm = Buffer.alloc(total * 2);
  for (let i = Math.round(before * SAMPLE_RATE); i < Math.round((before + length) * SAMPLE_RATE); i++) {
    pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)), i * 2);
  }
  return pcm;
}

describe("wav", () => {
  it("round-trips PCM through a WAV file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "vc-")), "t.wav");
    const pcm = tone(0.1, 0.2, 0.1);
    writeFileSync(path, encodeWav(pcm));
    expect(readWavPcm(path).equals(pcm)).toBe(true);
  });

  it("finds where speech ends", () => {
    const bounds = speechBounds(tone(0.5, 1.0, 1.0));
    expect(bounds!.start).toBeCloseTo(0.5, 1);
    expect(bounds!.end).toBeCloseTo(1.5, 1);
  });

  it("streams a file at real-time pace", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "vc-")), "t.wav");
    writeFileSync(path, encodeWav(tone(0, 0.3, 0)));
    const started = performance.now();
    let bytes = 0;
    for await (const chunk of new WavFileSource(path, 0).chunks(new AbortController().signal)) bytes += chunk.length;
    expect(bytes).toBe(0.3 * SAMPLE_RATE * 2);
    expect(performance.now() - started).toBeGreaterThan(250);
  });
});
