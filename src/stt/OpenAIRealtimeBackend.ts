import WebSocket from "ws";
import { resamplePcm16 } from "../audio/resample.js";
import type { AudioSource } from "../audio/source.js";
import { SAMPLE_RATE } from "../audio/wav.js";
import { DEFAULT_TERMS } from "./SonioxBackend.js";
import { SttEvents, type FinalTranscript, type SttBackend, type Transcript } from "./SttBackend.js";

export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const OPENAI_RATE = 24000;

export interface OpenAIRealtimeOptions {
  apiKey?: string;
  /** gpt-live-transcribe streams text while audio arrives. */
  model?: string;
  /** Latency vs accuracy: minimal | low | medium | high | xhigh (service default when unset). */
  delay?: string;
  terms?: string[];
  url?: string;
}

interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
}

/**
 * OpenAI realtime transcription as an SttBackend. No server-side turn
 * detection: like push-to-talk, the utterance ends when stop() commits the
 * audio buffer, and the completed transcript is the final.
 */
export class OpenAIRealtimeBackend implements SttBackend {
  private readonly events = new SttEvents();
  private readonly abort = new AbortController();
  private ws?: WebSocket;
  private t0 = 0;
  private sending?: Promise<void>;
  private closed?: Promise<void>;
  private committed = false;
  private finalDone?: () => void;
  /** Text of finished items, then the item being transcribed. */
  private finishedText = "";
  private currentText = "";
  error?: Error;

  constructor(
    private readonly audio: AudioSource,
    private readonly options: OpenAIRealtimeOptions = {},
  ) {}

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
    const apiKey = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    const ws = new WebSocket(this.options.url ?? OPENAI_REALTIME_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    this.closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    ws.on("error", (error) => this.fail(error));
    ws.on("message", (data) => this.handle(JSON.parse(data.toString()) as RealtimeEvent));

    const ready = new Promise<void>((resolve) => {
      const onMessage = (data: WebSocket.RawData) => {
        if ((JSON.parse(data.toString()) as RealtimeEvent).type === "session.updated") {
          ws.off("message", onMessage);
          resolve();
        }
      };
      ws.on("message", onMessage);
    });
    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: OPENAI_RATE },
              transcription: {
                model: this.options.model ?? "gpt-live-transcribe",
                languages: ["ja"],
                keywords: this.options.terms ?? DEFAULT_TERMS,
                ...(this.options.delay ? { delay: this.options.delay } : {}),
              },
              turn_detection: null,
            },
          },
        },
      }),
    );
    await ready;
    this.t0 = performance.now();
    this.sending = this.send(ws);
  }

  /** Ends the audio, commits it as one utterance and waits for its transcript. */
  async stop(finishTimeoutMs = 10_000): Promise<void> {
    this.abort.abort();
    await this.sending;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN && !this.committed) {
      this.committed = true;
      const done = new Promise<void>((resolve) => (this.finalDone = resolve));
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([done, this.closed, new Promise<void>((resolve) => (timer = setTimeout(resolve, finishTimeoutMs)))]);
      clearTimeout(timer);
    }
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    await this.closed;
  }

  private async send(ws: WebSocket): Promise<void> {
    try {
      for await (const chunk of this.audio.chunks(this.abort.signal)) {
        if (ws.readyState !== WebSocket.OPEN) return;
        const audio = resamplePcm16(chunk, SAMPLE_RATE, OPENAI_RATE).toString("base64");
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
      }
    } catch (error) {
      this.fail(error as Error);
    }
  }

  private handle(event: RealtimeEvent): void {
    const atMs = performance.now() - this.t0;
    if (event.type === "error") {
      // Committing an empty buffer is harmless: there was nothing to transcribe
      if (/buffer.*(empty|too small)/i.test(event.error?.message ?? "")) this.finalDone?.();
      else this.fail(new Error(`OpenAI realtime: ${event.error?.message ?? "error"}`));
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta" && event.delta) {
      this.currentText += event.delta;
      this.events.emitPartial({ text: (this.finishedText + this.currentText).trim(), atMs });
    } else if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = (event.transcript ?? this.currentText).trim();
      this.finishedText += text;
      this.currentText = "";
      if (text) this.events.emitFinal({ text, atMs });
      if (this.committed) this.finalDone?.();
    }
  }

  private fail(error: Error): void {
    const key = this.options.apiKey ?? process.env.OPENAI_API_KEY;
    this.error ??= new Error(key ? error.message.split(key).join("***") : error.message);
    this.abort.abort();
    this.finalDone?.();
    this.ws?.close();
  }
}
