import { WavFileSource } from "../audio/source.js";
import { speechBounds } from "../audio/wav.js";
import { IntentSpeculator, type Dispatch, type Resolution } from "../intent/speculator.js";
import type { Intent } from "../intent/types.js";
import { SonioxBackend, type SonioxOptions } from "../stt/SonioxBackend.js";

export interface TakeResult {
  file: string;
  /** All finals of the take, joined (normally just one). */
  text: string;
  finals: number;
  intent: Intent | null;
  /** End of speech in the WAV, ms from its start. */
  speechEndMs: number;
  /** Speech end → the dispatch that stood (negative: started before the speaker finished). */
  intentAfterEndMs: number | null;
  /** Speech end → the final transcript. */
  finalAfterEndMs: number | null;
  speculativeHit: boolean;
  abortedDispatches: number;
}

/**
 * Streams one WAV through Soniox at real-time pace with the speculator
 * attached, and times both the intent dispatch and the final against the
 * end of speech.
 */
export async function runTake(path: string, file: string, options: SonioxOptions): Promise<TakeResult> {
  const source = new WavFileSource(path);
  const bounds = speechBounds(source.pcm);
  if (!bounds) throw new Error(`${file}: no speech found`);
  const speechEndMs = bounds.end * 1000;

  const backend = new SonioxBackend(source, options);
  const resolutions: Resolution[] = [];
  new IntentSpeculator(backend, {
    onIntent: (_dispatch: Dispatch) => {},
    onResolved: (resolution) => resolutions.push(resolution),
  });
  await backend.start();
  // The source ends with silence, so Soniox closes the utterance and then finishes
  await backend.done;
  await backend.stop();
  if (backend.error) throw backend.error;

  // If the utterance came back in pieces, the last piece with a command is the one that counts
  const last = resolutions.filter((r) => r.intent).at(-1) ?? resolutions.at(-1);
  return {
    file,
    text: resolutions.map((r) => r.text).join(" "),
    finals: resolutions.length,
    intent: last?.intent ?? null,
    speechEndMs,
    intentAfterEndMs: last?.dispatch ? last.dispatch.atMs - speechEndMs : null,
    finalAfterEndMs: last ? last.finalAtMs - speechEndMs : null,
    speculativeHit: last?.dispatch?.speculative ?? false,
    abortedDispatches: resolutions.reduce((n, r) => n + r.aborted.length, 0),
  };
}

/** Runs `tasks` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
