import { WavFileSource } from "../audio/source.js";
import { speechBounds } from "../audio/wav.js";
import { normalizeText } from "../intent/parser.js";
import { IntentSpeculator, type IntentReader, type Resolution } from "../intent/speculator.js";
import type { Intent } from "../intent/types.js";
import type { SttBackend } from "../stt/SttBackend.js";

/** A backend whose event times can be put on the audio's clock. */
export type TimedBackend = SttBackend & { readonly startedAt: number; readonly error?: Error };

export interface PushToTalkResult {
  text: string;
  intent: Intent | null;
  /** Speech end → the dispatch that stood (negative: before the speaker finished). */
  intentAfterEndMs: number | null;
  /** Speech end → the final transcript. */
  finalAfterEndMs: number | null;
  /** Speech end → the final's intent read. */
  resolvedAfterEndMs: number | null;
  /** Partial transcripts that arrived before the end of speech. */
  partialsBeforeEnd: number;
  error?: string;
}

/**
 * Streams a WAV to a backend at real-time pace and releases push-to-talk
 * `releaseMs` after the end of speech (stop() on the backend), the way a
 * person lets go of the key. Intents are read with `reader` as they arrive.
 */
export async function runPushToTalk(
  path: string,
  makeBackend: (source: WavFileSource) => TimedBackend,
  reader: IntentReader,
  releaseMs = 300,
): Promise<PushToTalkResult> {
  const source = new WavFileSource(path, 3);
  const bounds = speechBounds(source.pcm);
  if (!bounds) throw new Error(`${path}: no speech found`);
  const speechEndMs = bounds.end * 1000;

  const backend = makeBackend(source);
  const resolutions: Resolution[] = [];
  let finals = 0;
  let partialsBeforeEnd = 0;
  new IntentSpeculator(backend, { onIntent: () => {}, onResolved: (r) => resolutions.push(r) }, reader);
  backend.onFinal(() => finals++);
  backend.onPartial(({ atMs }) => {
    if (atMs < speechEndMs) partialsBeforeEnd++;
  });

  try {
    await backend.start();
  } catch (error) {
    return empty(`start: ${(error as Error).message}`);
  }
  const releaseAt = backend.startedAt + speechEndMs + releaseMs;
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, releaseAt - performance.now())));
  await backend.stop();
  // A remote intent reader may still be answering the last final
  for (let waited = 0; resolutions.length < finals && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (backend.error) return { ...empty(backend.error.message), partialsBeforeEnd };

  const last = resolutions.filter((r) => r.intent).at(-1) ?? resolutions.at(-1);
  return {
    text: resolutions.map((r) => r.text).join(" "),
    intent: last?.intent ?? null,
    intentAfterEndMs: last?.dispatch ? last.dispatch.atMs - speechEndMs : null,
    finalAfterEndMs: last ? last.finalAtMs - speechEndMs : null,
    resolvedAfterEndMs: last ? last.resolvedAtMs - speechEndMs : null,
    partialsBeforeEnd,
  };
}

function empty(error: string): PushToTalkResult {
  return { text: "", intent: null, intentAfterEndMs: null, finalAfterEndMs: null, resolvedAfterEndMs: null, partialsBeforeEnd: 0, error };
}

/** Text compared for errors: width, case and numerals folded, spaces and punctuation dropped. */
export function comparable(text: string): string {
  return [...normalizeText(text)].filter((ch) => !/[\s\p{P}\p{S}]/u.test(ch)).join("");
}

/** Character error rate of `hypothesis` against `reference` (edit distance / reference length). */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const a = [...comparable(reference)];
  const b = [...comparable(hypothesis)];
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] / a.length;
}
