import OpenAI, { toFile } from "openai";
import type { AudioSource } from "../audio/source.js";
import { encodeWav } from "../audio/wav.js";
import { DEFAULT_TERMS } from "./SonioxBackend.js";
import { SttEvents, type FinalTranscript, type SttBackend, type Transcript } from "./SttBackend.js";

export interface OpenAIFileOptions {
  apiKey?: string;
  model?: string;
  terms?: string[];
  /** For tests: stands in for the network. */
  fetch?: typeof fetch;
}

/**
 * Record, then transcribe: audio is collected while the key is held and sent
 * as one file when stop() is called, the way dictation buttons work (Codex's
 * included). Text streams back after the upload; nothing arrives while speaking.
 */
export class OpenAIFileBackend implements SttBackend {
  private readonly events = new SttEvents();
  private readonly abort = new AbortController();
  private readonly client: OpenAI;
  private readonly chunks: Buffer[] = [];
  private t0 = 0;
  private recording?: Promise<void>;
  error?: Error;

  constructor(
    private readonly audio: AudioSource,
    private readonly options: OpenAIFileOptions = {},
  ) {
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY, fetch: options.fetch });
  }

  get startedAt(): number {
    return this.t0;
  }

  onPartial(listener: (partial: Transcript) => void): void {
    this.events.onPartial(listener);
  }

  onFinal(listener: (final: FinalTranscript) => void): void {
    this.events.onFinal(listener);
  }

  async start(): Promise<void> {
    this.t0 = performance.now();
    this.recording = (async () => {
      for await (const chunk of this.audio.chunks(this.abort.signal)) this.chunks.push(chunk);
    })();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.recording;
    const pcm = Buffer.concat(this.chunks);
    if (!pcm.length) return;
    try {
      const stream = await this.client.audio.transcriptions.create({
        file: await toFile(encodeWav(pcm), "speech.wav", { type: "audio/wav" }),
        model: this.options.model ?? "gpt-transcribe",
        language: "ja",
        keywords: this.options.terms ?? DEFAULT_TERMS,
        stream: true,
      });
      let text = "";
      for await (const event of stream) {
        const atMs = performance.now() - this.t0;
        if (event.type === "transcript.text.delta") {
          text += event.delta;
          this.events.emitPartial({ text: text.trim(), atMs });
        } else if (event.type === "transcript.text.done") {
          if (event.text.trim()) this.events.emitFinal({ text: event.text.trim(), atMs });
        }
      }
    } catch (error) {
      this.error = error as Error;
    }
  }
}
