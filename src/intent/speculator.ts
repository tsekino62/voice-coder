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
  /** When the final's intent was read (later than finalAtMs for a remote classifier). */
  resolvedAtMs: number;
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
/**
 * Reads the command in a transcript. The regex parser answers at once; a
 * remote classifier such as jev answers with a promise.
 */
export type IntentReader = (text: string) => Intent | null | Promise<Intent | null>;

interface Pending {
  current: Dispatch | null;
  controller: AbortController | null;
  aborted: Dispatch[];
}

export class IntentSpeculator {
  /** The utterance in flight. */
  private state: Pending = { current: null, controller: null, aborted: [] };
  /** Bumped by every final: answers for partials of an earlier utterance are stale. */
  private utterance = 0;
  private partialSeq = 0;
  private appliedSeq = 0;
  /** Finals resolve in the order they arrived, even when their reads finish out of order. */
  private finals: Promise<void> | null = null;

  constructor(
    backend: SttBackend,
    private readonly handlers: SpeculatorHandlers,
    private readonly read: IntentReader = parseIntent,
  ) {
    backend.onPartial(({ text, atMs }) => this.partial(text, atMs));
    backend.onFinal(({ text, atMs, intent }) => this.final(text, atMs, intent));
  }

  private partial(text: string, atMs: number): void {
    const seq = ++this.partialSeq;
    const utterance = this.utterance;
    const received = performance.now();
    settle(
      () => this.read(text),
      (intent, async) => {
        // A newer partial already answered, or the utterance is over
        if (utterance !== this.utterance || seq < this.appliedSeq) return;
        this.appliedSeq = seq;
        const state = this.state;
        // A partial with no command word yet is not a reason to drop work already started
        if (!intent || (state.current && sameIntent(state.current.intent, intent))) return;
        this.abort(state);
        this.dispatch(state, intent, text, async ? atMs + (performance.now() - received) : atMs, true);
      },
      () => {}, // a failed read of a partial is not fatal: the final decides
    );
  }

  private final(text: string, atMs: number, given: Intent | null | undefined): void {
    // The utterance in flight is handed over to this final; the next one starts clean
    this.utterance++;
    this.partialSeq = this.appliedSeq = 0;
    const pending = this.state;
    this.state = { current: null, controller: null, aborted: [] };

    const received = performance.now();
    const resolve = (intent: Intent | null, async: boolean) =>
      this.resolve(pending, text, atMs, async ? atMs + (performance.now() - received) : atMs, intent);
    if (given !== undefined) {
      this.inOrder(() => resolve(given, false));
      return;
    }
    const read = settle(
      () => this.read(text),
      (intent, async) => ({ intent, async }),
      (_, async) => ({ intent: parseIntent(text), async }), // the classifier failed: fall back to keywords
    );
    if (read instanceof Promise) this.inOrder(() => read.then(({ intent, async }) => resolve(intent, async)));
    else this.inOrder(() => resolve(read.intent, read.async));
  }

  private inOrder(step: () => void | Promise<void>): void {
    if (!this.finals) {
      const result = step();
      if (result instanceof Promise) this.finals = result.finally(() => (this.finals = null));
      return;
    }
    this.finals = this.finals.then(step);
  }

  private resolve(pending: Pending, text: string, finalAtMs: number, resolvedAtMs: number, intent: Intent | null): void {
    if (!pending.current || !sameIntent(pending.current.intent, intent)) {
      this.abort(pending);
      if (intent) this.dispatch(pending, intent, text, resolvedAtMs, false);
    }
    this.handlers.onResolved?.({ text, intent, dispatch: pending.current, finalAtMs, resolvedAtMs, aborted: pending.aborted });
  }

  private dispatch(state: Pending, intent: Intent, text: string, atMs: number, speculative: boolean): void {
    state.controller = new AbortController();
    state.current = { intent, text, signal: state.controller.signal, speculative, atMs };
    this.handlers.onIntent(state.current);
  }

  private abort(state: Pending): void {
    if (!state.current || !state.controller) return;
    state.controller.abort();
    state.aborted.push(state.current);
    state.current = state.controller = null;
  }
}

/**
 * Runs `read` and hands its result to `then`, synchronously when it is a plain
 * value (the regex parser) and once it settles when it is a promise.
 */
function settle<T, R>(
  read: () => T | Promise<T>,
  then: (value: T, async: boolean) => R,
  fail: (error: unknown, async: boolean) => R,
): R | Promise<R> {
  let value: T | Promise<T>;
  try {
    value = read();
  } catch (error) {
    return fail(error, false);
  }
  return value instanceof Promise
    ? value.then(
        (v) => then(v, true),
        (error) => fail(error, true),
      )
    : then(value, false);
}
