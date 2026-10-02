import WebSocket from "ws";
import type { AudioSource } from "../audio/source.js";
import { SAMPLE_RATE } from "../audio/wav.js";
import { SttEvents, type FinalTranscript, type SttBackend, type Transcript } from "./SttBackend.js";

export const SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

export interface SonioxOptions {
  apiKey: string;
  model?: string;
  /** Upper bound on the wait after speech before `<end>` closes the utterance. */
  maxEndpointDelayMs?: number;
  terms?: string[];
  url?: string;
}

/** Vocabulary the coding commands need (FizzBuzz is misheard without it). */
export const DEFAULT_TERMS = ["FizzBuzz", "async", "await", "リファクタ", "デバッグ"];

interface SonioxToken {
  text: string;
  is_final?: boolean;
}

interface SonioxResponse {
  tokens?: SonioxToken[];
  finished?: boolean;
  error_code?: number;
  error_message?: string;
}

/**
 * Soniox real-time STT (stt-rt-v5) with endpoint detection: final tokens
 * accumulate until `<end>`, which closes the utterance and emits a final.
 */
export class SonioxBackend implements SttBackend {
  private readonly events = new SttEvents();
  private readonly abort = new AbortController();
  private ws?: WebSocket;
  private t0 = 0;
  private finalText = "";
  private lastPartial = "";
  private sending?: Promise<void>;
  private closed?: Promise<void>;
  error?: Error;

  constructor(
    private readonly audio: AudioSource,
    private readonly options: SonioxOptions,
  ) {}

  onPartial(listener: (partial: Transcript) => void): void {
    this.events.onPartial(listener);
  }

  onFinal(listener: (final: FinalTranscript) => void): void {
    this.events.onFinal(listener);
  }

  /** Resolves when Soniox has sent `finished` (all audio processed) or the socket closed. */
  get done(): Promise<void> {
    return this.closed ?? Promise.resolve();
  }

  async start(): Promise<void> {
    const ws = new WebSocket(this.options.url ?? SONIOX_URL);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    this.closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("error", (error) => this.fail(error));
    ws.on("message", (data) => this.handle(JSON.parse(data.toString()) as SonioxResponse));

    ws.send(
      JSON.stringify({
        api_key: this.options.apiKey,
        model: this.options.model ?? "stt-rt-v5",
        audio_format: "pcm_s16le",
        sample_rate: SAMPLE_RATE,
        num_channels: 1,
        language_hints: ["ja"],
        enable_endpoint_detection: true,
        max_endpoint_delay_ms: this.options.maxEndpointDelayMs ?? 1000,
        context: { terms: this.options.terms ?? DEFAULT_TERMS },
      }),
    );
    this.t0 = performance.now();
    this.sending = this.send(ws);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.sending;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close();
    await this.closed;
  }

  private async send(ws: WebSocket): Promise<void> {
    try {
      for await (const chunk of this.audio.chunks(this.abort.signal)) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(chunk);
      }
      // An empty frame tells Soniox the audio is over
      if (ws.readyState === WebSocket.OPEN) ws.send("");
    } catch (error) {
      this.fail(error as Error);
    }
  }

  private handle(response: SonioxResponse): void {
    if (response.error_code) {
      this.fail(new Error(`Soniox ${response.error_code}: ${response.error_message ?? ""}`));
      return;
    }
    const atMs = performance.now() - this.t0;
    let nonFinal = "";
    let ended = false;
    for (const token of response.tokens ?? []) {
      if (/^<\w+>$/.test(token.text)) {
        ended ||= token.text === "<end>" && token.is_final === true;
      } else if (token.is_final) {
        this.finalText += token.text;
      } else {
        nonFinal += token.text;
      }
    }

    const current = (this.finalText + nonFinal).trim();
    if (current && current !== this.lastPartial && !ended) {
      this.lastPartial = current;
      this.events.emitPartial({ text: current, atMs });
    }
    if (ended || (response.finished && this.finalText.trim())) {
      const text = this.finalText.trim();
      this.finalText = this.lastPartial = "";
      if (text) this.events.emitFinal({ text, atMs });
    }
    if (response.finished) this.ws?.close();
  }

  private fail(error: Error): void {
    // The API key travels in the first frame only, but never let it reach a log
    const message = error.message.split(this.options.apiKey).join("***");
    this.error ??= new Error(message);
    this.abort.abort();
    this.ws?.close();
  }
}
