import type { SttBackend } from "../stt/SttBackend.js";
import { parseIntent, sameIntent } from "./parser.js";
import type { Intent } from "./types.js";

/** One start of downstream work (e.g. an LLM call) for an intent. */
export interface Dispatch {
  intent: Intent;
  /** The transcript the intent was read from. */
  text: string;
  /** Aborted when the intent turns out to be wrong. */
  signal: AbortSignal;
  /** Started from a partial transcript, before the utterance was final. */
  speculative: boolean;
  /** Backend time the dispatch started, ms since audio started. */
  atMs: number;
}

/** How one utterance ended. */
export interface Resolution {
  text: string;
  intent: Intent | null;
  /** The dispatch that stands; null when the utterance held no command. */
  dispatch: Dispatch | null;
  finalAtMs: number;
  /** Speculative dispatches thrown away for this utterance. */
  aborted: Dispatch[];
}

export interface SpeculatorHandlers {
  /** Start work for the intent; stop when `dispatch.signal` aborts. */
  onIntent(dispatch: Dispatch): void;
  onResolved?(resolution: Resolution): void;
}

/**
 * Starts work as soon as a partial transcript names a command, instead of
 * waiting for the final (about a second later with Soniox at
 * max_endpoint_delay_ms=1000, see stt_probe/COMPARE.md). The final is then
 * compared with what was started; on a mismatch the speculative work is
 * aborted and the final's intent is dispatched instead.
 */
export class IntentSpeculator {
  private current: Dispatch | null = null;
  private controller: AbortController | null = null;
  private aborted: Dispatch[] = [];

  constructor(
    backend: SttBackend,
    private readonly handlers: SpeculatorHandlers,
  ) {
    backend.onPartial(({ text, atMs }) => this.partial(text, atMs));
    backend.onFinal(({ text, atMs, intent }) => this.final(text, atMs, intent === undefined ? parseIntent(text) : intent));
  }

  private partial(text: string, atMs: number): void {
    const intent = parseIntent(text);
    // A partial with no command word yet is not a reason to drop work already started
    if (!intent || (this.current && sameIntent(this.current.intent, intent))) return;
    this.abortCurrent();
    this.dispatch(intent, text, atMs, true);
  }

  private final(text: string, atMs: number, intent: Intent | null): void {
    if (!this.current || !sameIntent(this.current.intent, intent)) {
      this.abortCurrent();
      if (intent) this.dispatch(intent, text, atMs, false);
    }
    const resolution: Resolution = { text, intent, dispatch: this.current, finalAtMs: atMs, aborted: this.aborted };
    this.current = this.controller = null;
    this.aborted = [];
    this.handlers.onResolved?.(resolution);
  }

  private dispatch(intent: Intent, text: string, atMs: number, speculative: boolean): void {
    this.controller = new AbortController();
    this.current = { intent, text, signal: this.controller.signal, speculative, atMs };
    this.handlers.onIntent(this.current);
  }

  private abortCurrent(): void {
    if (!this.current || !this.controller) return;
    this.controller.abort();
    this.aborted.push(this.current);
    this.current = this.controller = null;
  }
}
