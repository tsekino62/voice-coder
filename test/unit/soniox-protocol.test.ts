import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { WavFileSource } from "../../src/audio/source.js";
import { encodeWav, SAMPLE_RATE } from "../../src/audio/wav.js";
import { SonioxBackend } from "../../src/stt/SonioxBackend.js";

let server: WebSocketServer | undefined;
afterEach(() => server?.close());

/** A stand-in for Soniox that replays canned responses once the audio has ended. */
function fakeSoniox(responses: object[]): Promise<{ url: string; config: Promise<Record<string, unknown>> }> {
  return new Promise((resolve) => {
    let gotConfig!: (config: Record<string, unknown>) => void;
    const config = new Promise<Record<string, unknown>>((r) => (gotConfig = r));
    server = new WebSocketServer({ port: 0 }, () => {
      const { port } = server!.address() as { port: number };
      resolve({ url: `ws://127.0.0.1:${port}`, config });
    });
    server.on("connection", (ws) => {
      let first = true;
      ws.on("message", (data, isBinary) => {
        if (first) {
          first = false;
          gotConfig(JSON.parse(data.toString()));
        } else if (!isBinary && data.toString() === "") {
          for (const response of responses) ws.send(JSON.stringify(response));
        }
      });
    });
  });
}

function shortWav(): WavFileSource {
  const path = join(mkdtempSync(join(tmpdir(), "vc-")), "s.wav");
  writeFileSync(path, encodeWav(Buffer.alloc(SAMPLE_RATE * 0.1 * 2)));
  return new WavFileSource(path, 0);
}

describe("SonioxBackend protocol", () => {
  it("sends the configured model, endpoint delay and terms, and turns tokens into partials and a final", async () => {
    const { url, config } = await fakeSoniox([
      { tokens: [{ text: "Fizz", is_final: false }] },
      { tokens: [{ text: "FizzBuzz", is_final: true }, { text: "を作", is_final: false }] },
      { tokens: [{ text: "を作って", is_final: true }, { text: "<end>", is_final: true }] },
      { tokens: [], finished: true },
    ]);
    const backend = new SonioxBackend(shortWav(), { apiKey: "test-key", url });
    const partials: string[] = [];
    const finals: string[] = [];
    backend.onPartial((p) => partials.push(p.text));
    backend.onFinal((f) => finals.push(f.text));
    await backend.start();
    await backend.done;
    await backend.stop();

    expect(await config).toMatchObject({
      model: "stt-rt-v5",
      max_endpoint_delay_ms: 1000,
      enable_endpoint_detection: true,
      context: { terms: ["FizzBuzz", "async", "await", "リファクタ", "デバッグ"] },
    });
    expect(partials).toEqual(["Fizz", "FizzBuzzを作"]);
    expect(finals).toEqual(["FizzBuzzを作って"]);
    expect(backend.error).toBeUndefined();
  });

  it("stop() ends the audio and still delivers the final (push-to-talk)", async () => {
    const { url } = await fakeSoniox([
      { tokens: [{ text: "デバッグして", is_final: true }] },
      { tokens: [], finished: true },
    ]);
    const path = join(mkdtempSync(join(tmpdir(), "vc-")), "long.wav");
    writeFileSync(path, encodeWav(Buffer.alloc(SAMPLE_RATE * 10 * 2)));
    const backend = new SonioxBackend(new WavFileSource(path, 0), { apiKey: "k", url });
    const finals: string[] = [];
    backend.onFinal((f) => finals.push(f.text));
    await backend.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = performance.now();
    await backend.stop();
    expect(performance.now() - started).toBeLessThan(2000);
    expect(finals).toEqual(["デバッグして"]);
  });

  it("reports a Soniox error without the API key in it", async () => {
    const { url } = await fakeSoniox([{ error_code: 401, error_message: "bad key secret-key" }]);
    const backend = new SonioxBackend(shortWav(), { apiKey: "secret-key", url });
    await backend.start();
    await backend.done;
    await backend.stop();
    expect(backend.error?.message).toBe("Soniox 401: bad key ***");
  });
});
