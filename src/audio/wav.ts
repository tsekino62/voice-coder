import { readFileSync } from "node:fs";

export const SAMPLE_RATE = 16000;
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;

/** 16 kHz mono 16-bit PCM wrapped in a WAV header. */
export function encodeWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** The PCM payload of a 16 kHz mono 16-bit WAV file. */
export function readWavPcm(path: string): Buffer {
  const wav = readFileSync(path);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a WAV file`);
  }
  let offset = 12;
  let format: { channels: number; rate: number; bits: number } | undefined;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = { channels: wav.readUInt16LE(body + 2), rate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!format || format.channels !== 1 || format.rate !== SAMPLE_RATE || format.bits !== 16) {
        throw new Error(`${path}: WAV must be ${SAMPLE_RATE} Hz, mono, 16-bit PCM`);
      }
      return wav.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

const FRAME_S = 0.02;
const MIN_SPEECH_FRAMES = 5; // ignore bursts under 100 ms
const MAX_GAP_IN_SPEECH_S = 0.25; // silences up to this long are part of the same stretch of speech

/**
 * Start and end of speech in seconds, from frame energy. Same method as
 * stt_probe/summarize_compare.py, minus the guard for the Enter key that
 * started a mic recording (synthesized takes have none).
 */
export function speechBounds(pcm: Buffer): { start: number; end: number } | null {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const frame = Math.round(SAMPLE_RATE * FRAME_S);
  const rms: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let sum = 0;
    for (let j = i; j < i + frame; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / frame));
  }
  if (rms.length === 0) return null;
  const ordered = [...rms].sort((a, b) => a - b);
  const noise = ordered[Math.floor(ordered.length / 5)];
  const loud = ordered[Math.floor(ordered.length * 0.95)];
  const threshold = Math.max(noise * 2.5, noise + 0.1 * (loud - noise));

  const maxGap = Math.round(MAX_GAP_IN_SPEECH_S / FRAME_S);
  const stretches: number[][] = [];
  rms.forEach((level, i) => {
    if (level <= threshold) return;
    const last = stretches.at(-1);
    if (last && i - last[last.length - 1] <= maxGap) last.push(i);
    else stretches.push([i]);
  });
  const speech = stretches.filter((stretch) => stretch.length >= MIN_SPEECH_FRAMES);
  if (speech.length === 0) return null;
  return { start: speech[0][0] * FRAME_S, end: (speech.at(-1)!.at(-1)! + 1) * FRAME_S };
}
