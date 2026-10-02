import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { resamplePcm16 } from "../../src/audio/resample.js";
import { WavFileSource } from "../../src/audio/source.js";
import { encodeWav, SAMPLE_RATE } from "../../src/audio/wav.js";
import { characterErrorRate } from "../../src/eval/sttCompare.js";
import { OpenAIFileBackend } from "../../src/stt/OpenAIFileBackend.js";
import { OpenAIRealtimeBackend } from "../../src/stt/OpenAIRealtimeBackend.js";

function wav(seconds: number): WavFileSource {
  const path = join(mkdtempSync(join(tmpdir(), "vc-")), "s.wav");
  writeFileSync(path, encodeWav(Buffer.alloc(Math.round(seconds * SAMPLE_RATE) * 2)));
  return new WavFileSource(path, 0);
}

describe("resamplePcm16", () => {
  it("turns 16 kHz into 24 kHz, keeping the waveform", () => {
    const input = Buffer.alloc(160 * 2);
    for (let i = 0; i < 160; i++) input.writeInt16LE(i * 100, i * 2);
    const output = resamplePcm16(input, 16000, 24000);
    expect(output.length).toBe(240 * 2);
    expect(output.readInt16LE(0)).toBe(0);
    expect(output.readInt16LE(3 * 2)).toBe(200); // sample 3 at 24 kHz is sample 2 at 16 kHz
  });
});

describe("characterErrorRate", () => {
  it("folds numerals, width and punctuation before comparing", () => {
    expect(characterErrorRate("十行目から二十行目を解説して", "10行目から20行目を解説して。")).toBe(0);
    expect(characterErrorRate("ＦｉｚｚＢｕｚｚを作って", "fizzbuzzを作って")).toBe(0);
    expect(characterErrorRate("デバッグして", "デバックして")).toBeCloseTo(1 / 6);
    expect(characterErrorRate("デバッグして", "")).toBe(1);
  });
});

describe("OpenAIRealtimeBackend protocol", () => {
  let server: WebSocketServer | undefined;
  afterEach(() => server?.close());

  it("configures a transcription session, streams 24 kHz audio, and commits on stop", async () => {
    const received: Array<{ type: string; audio?: string; session?: unknown }> = [];
    const url = await new Promise<string>((resolve) => {
      server = new WebSocketServer({ port: 0 }, () => resolve(`ws://127.0.0.1:${(server!.address() as { port: number }).port}`));
      server.on("connection", (ws) => {
        ws.on("message", (data) => {
          const event = JSON.parse(data.toString());
          received.push(event);
          if (event.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
          if (event.type === "input_audio_buffer.append" && received.filter((e) => e.type === "input_audio_buffer.append").length === 2) {
            ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "デバッグ" }));
          }
          if (event.type === "input_audio_buffer.commit") {
            ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "して" }));
            ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: "デバッグして。" }));
          }
        });
      });
    });
    const backend = new OpenAIRealtimeBackend(wav(10), { apiKey: "test", url });
    const partials: string[] = [];
    const finals: string[] = [];
    backend.onPartial((p) => partials.push(p.text));
    backend.onFinal((f) => finals.push(f.text));
    await backend.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await backend.stop();

    expect(received[0]).toMatchObject({
      type: "session.update",
      session: { type: "transcription", audio: { input: { format: { rate: 24000 }, transcription: { model: "gpt-live-transcribe", languages: ["ja"] }, turn_detection: null } } },
    });
    const firstAudio = Buffer.from(received.find((e) => e.type === "input_audio_buffer.append")!.audio!, "base64");
    expect(firstAudio.length).toBe(1024 * 1.5); // a 32 ms chunk at 24 kHz
    expect(received.at(-1)?.type).toBe("input_audio_buffer.commit");
    expect(partials).toEqual(["デバッグ", "デバッグして"]);
    expect(finals).toEqual(["デバッグして。"]);
    expect(backend.error).toBeUndefined();
  });
});

describe("OpenAIFileBackend", () => {
  it("uploads the recording on stop and streams the transcript back", async () => {
    const uploads: FormData[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      // The SDK first fetches a data: URL to probe FormData support; only the POST is the upload
      if (init?.method === "POST") uploads.push(init.body as FormData);
      if (!String(url).startsWith("http")) return new Response("");
      const events = [
        { type: "transcript.text.delta", delta: "FizzBuzz" },
        { type: "transcript.text.delta", delta: "を作って" },
        { type: "transcript.text.done", text: "FizzBuzzを作って。" },
      ];
      const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const backend = new OpenAIFileBackend(wav(0.2), { apiKey: "test", fetch: fakeFetch });
    const partials: string[] = [];
    const finals: string[] = [];
    backend.onPartial((p) => partials.push(p.text));
    backend.onFinal((f) => finals.push(f.text));
    await backend.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(partials).toEqual([]); // nothing while recording
    await backend.stop();

    expect(uploads).toHaveLength(1);
    expect(uploads[0].get("model")).toBe("gpt-transcribe");
    expect(uploads[0].get("language")).toBe("ja");
    expect(partials).toEqual(["FizzBuzz", "FizzBuzzを作って"]);
    expect(finals).toEqual(["FizzBuzzを作って。"]);
  });
});
