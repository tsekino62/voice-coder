import type { AudioSource } from "./source.js";

/** What MicrophoneSource needs from a recorder: 16 kHz mono 16-bit frames. */
export interface Recorder {
  start(): void;
  read(): Promise<Int16Array>;
  stop(): void;
  release(): void;
}

export interface MicrophoneOptions {
  /** Index into Microphone.devices(); -1 or unset for the system default. */
  deviceIndex?: number;
  /** For tests: stands in for the native recorder. */
  createRecorder?: (frameLength: number, deviceIndex: number) => Recorder;
}

const FRAME_LENGTH = 512; // 32 ms at 16 kHz, the chunk size the STT backends were tuned with

type PvRecorderModule = typeof import("@picovoice/pvrecorder-node");

let pvRecorder: Promise<PvRecorderModule> | undefined;

/**
 * @picovoice/pvrecorder-node: prebuilt N-API binaries for Windows, macOS and
 * Linux (no compiler, no Python), recording at 16 kHz mono 16-bit. Loaded on
 * first use so a missing binary is a clear error, not a failed activation.
 */
function loadPvRecorder(): Promise<PvRecorderModule> {
  pvRecorder ??= import("@picovoice/pvrecorder-node").catch((error: Error) => {
    pvRecorder = undefined;
    throw new Error(`マイク用のモジュールを読み込めません / cannot load the microphone module（${process.platform}-${process.arch}）: ${error.message}`);
  });
  return pvRecorder;
}

/** Input devices, in the order deviceIndex refers to. */
export async function microphoneDevices(): Promise<string[]> {
  return (await loadPvRecorder()).PvRecorder.getAvailableDevices();
}

async function nativeRecorder(): Promise<(frameLength: number, index: number) => Recorder> {
  const { PvRecorder } = await loadPvRecorder();
  return (frameLength, index) => new PvRecorder(frameLength, index);
}

/** Live microphone audio. Recording starts on the first chunk and stops when the signal aborts. */
export class MicrophoneSource implements AudioSource {
  constructor(private readonly options: MicrophoneOptions = {}) {}

  async *chunks(signal: AbortSignal): AsyncIterable<Buffer> {
    const deviceIndex = this.options.deviceIndex ?? -1;
    let recorder: Recorder;
    try {
      const create = this.options.createRecorder ?? (await nativeRecorder());
      recorder = create(FRAME_LENGTH, deviceIndex);
      recorder.start();
    } catch (error) {
      throw new Error(`マイクを開けません / cannot open the microphone（デバイス ${deviceIndex === -1 ? "既定 / default" : deviceIndex}）: ${(error as Error).message}`);
    }
    try {
      while (!signal.aborted) {
        const frame = await recorder.read();
        if (signal.aborted) break;
        yield Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      }
    } finally {
      recorder.stop();
      recorder.release();
    }
  }
}
