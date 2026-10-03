import { describe, expect, it } from "vitest";
import { MicrophoneSource, microphoneDevices, type Recorder } from "../../src/audio/microphone.js";

/** A recorder that hands out numbered 512-sample frames every few ms. */
function fakeRecorder(log: string[]) {
  let n = 0;
  return (frameLength: number, deviceIndex: number): Recorder => {
    log.push(`create ${frameLength} ${deviceIndex}`);
    return {
      start: () => log.push("start"),
      read: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return new Int16Array(frameLength).fill(++n);
      },
      stop: () => log.push("stop"),
      release: () => log.push("release"),
    };
  };
}

describe("MicrophoneSource", () => {
  it("yields 32 ms chunks of 16-bit PCM until aborted, then stops and releases the recorder", async () => {
    const log: string[] = [];
    const source = new MicrophoneSource({ deviceIndex: 2, createRecorder: fakeRecorder(log) });
    const controller = new AbortController();
    const chunks: Buffer[] = [];
    for await (const chunk of source.chunks(controller.signal)) {
      chunks.push(chunk);
      if (chunks.length === 3) controller.abort();
    }
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBe(1024);
    expect(chunks[1].readInt16LE(0)).toBe(2);
    expect(log).toEqual(["create 512 2", "start", "stop", "release"]);
  });

  it("uses the system default device unless told otherwise", async () => {
    const log: string[] = [];
    const controller = new AbortController();
    for await (const _ of new MicrophoneSource({ createRecorder: fakeRecorder(log) }).chunks(controller.signal)) controller.abort();
    expect(log[0]).toBe("create 512 -1");
  });

  it("says which device failed to open", async () => {
    const source = new MicrophoneSource({
      deviceIndex: 7,
      createRecorder: () => {
        throw new Error("PvRecorder: invalid device index");
      },
    });
    await expect(async () => {
      for await (const _ of source.chunks(new AbortController().signal)) void _;
    }).rejects.toThrow(/マイクを開けません .*（デバイス 7）/);
  });
});

// Loads the real native module (no recording)
describe("the native recorder", () => {
  it("loads on this platform and lists input devices", async () => {
    const devices = await microphoneDevices();
    expect(Array.isArray(devices)).toBe(true);
  });
});
