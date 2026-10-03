// The package ships its types under dist/types without pointing to them
declare module "@picovoice/pvspeaker-node" {
  export class PvSpeaker {
    constructor(sampleRate: number, bitsPerSample: number, options?: { bufferSizeSecs?: number; deviceIndex?: number });
    start(): void;
    stop(): void;
    write(pcm: ArrayBuffer): number;
    flush(pcm?: ArrayBuffer): number;
    release(): void;
    static getAvailableDevices(): string[];
  }
}
