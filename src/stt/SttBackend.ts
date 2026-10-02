import type { Intent } from "../intent/types.js";

/** A transcript update. `atMs` is milliseconds since the backend started sending audio. */
export interface Transcript {
  text: string;
  atMs: number;
}

/**
 * A finished utterance. A backend that classifies speech itself (e.g. jev from
 * typesafe.ai, which returns typed values for a schema) may attach its own
 * `intent`; the speculation layer then uses it instead of parsing `text`.
 */
export interface FinalTranscript extends Transcript {
  intent?: Intent | null;
}

/**
 * Speech-to-text behind one shape: start streaming, get partials while the
 * user speaks and one final per utterance, stop.
 */
export interface SttBackend {
  /** Resolves once the backend is accepting audio. */
  start(): Promise<void>;
  onPartial(listener: (partial: Transcript) => void): void;
  onFinal(listener: (final: FinalTranscript) => void): void;
  /** Ends the stream and releases the connection. Safe to call more than once. */
  stop(): Promise<void>;
}

/** Listener bookkeeping shared by backend implementations. */
export class SttEvents {
  private readonly partialListeners: Array<(partial: Transcript) => void> = [];
  private readonly finalListeners: Array<(final: FinalTranscript) => void> = [];

  onPartial(listener: (partial: Transcript) => void): void {
    this.partialListeners.push(listener);
  }

  onFinal(listener: (final: FinalTranscript) => void): void {
    this.finalListeners.push(listener);
  }

  emitPartial(partial: Transcript): void {
    for (const listener of this.partialListeners) listener(partial);
  }

  emitFinal(final: FinalTranscript): void {
    for (const listener of this.finalListeners) listener(final);
  }
}
