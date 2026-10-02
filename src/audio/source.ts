import { BYTES_PER_SECOND, readWavPcm } from "./wav.js";

const CHUNK_BYTES = 1024; // 32 ms of 16 kHz mono 16-bit

/** PCM audio for an STT backend, 16 kHz mono 16-bit. */
export interface AudioSource {
  /** Yields chunks no earlier than the audio in them would have been spoken. */
  chunks(signal: AbortSignal): AsyncIterable<Buffer>;
}

/**
 * Plays a WAV file at real-time pace, followed by silence so the STT service
 * can close the last utterance on its own (as a live mic would keep sending).
 */
export class WavFileSource implements AudioSource {
  readonly pcm: Buffer;

  constructor(
    path: string,
    private readonly trailingSilenceS = 3,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.pcm = readWavPcm(path);
  }

  async *chunks(signal: AbortSignal): AsyncIterable<Buffer> {
    const audio = Buffer.concat([this.pcm, Buffer.alloc(Math.round(this.trailingSilenceS * BYTES_PER_SECOND))]);
    const started = this.now();
    for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
      if (signal.aborted) return;
      const chunk = audio.subarray(offset, offset + CHUNK_BYTES);
      // A chunk goes out once the audio it holds has "been spoken"
      const due = started + ((offset + chunk.length) / BYTES_PER_SECOND) * 1000;
      const wait = due - this.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      yield chunk;
    }
  }
}
