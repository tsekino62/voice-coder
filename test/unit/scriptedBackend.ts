import { SttEvents, type FinalTranscript, type SttBackend, type Transcript } from "../../src/stt/SttBackend.js";

export type ScriptStep = ({ partial: string } | { final: string; intent?: FinalTranscript["intent"] }) & { atMs: number };

/** Plays a fixed sequence of transcript events on start(). */
export class ScriptedBackend implements SttBackend {
  private readonly events = new SttEvents();

  constructor(private readonly script: ScriptStep[]) {}

  onPartial(listener: (partial: Transcript) => void): void {
    this.events.onPartial(listener);
  }

  onFinal(listener: (final: FinalTranscript) => void): void {
    this.events.onFinal(listener);
  }

  async start(): Promise<void> {
    for (const step of this.script) {
      if ("partial" in step) this.events.emitPartial({ text: step.partial, atMs: step.atMs });
      else this.events.emitFinal({ text: step.final, atMs: step.atMs, ...("intent" in step ? { intent: step.intent } : {}) });
    }
  }

  async stop(): Promise<void> {}
}
