import { WavFileSource } from "../audio/source.js";
import { speechBounds } from "../audio/wav.js";
import { parseIntent } from "../intent/parser.js";
import { IntentSpeculator, type IntentReader, type Resolution } from "../intent/speculator.js";
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
  /** Speech end → the final's intent read (later than the final for a remote classifier). */
  resolvedAfterEndMs: number | null;
  speculativeHit: boolean;
  abortedDispatches: number;
}

/**
 * Streams one WAV through Soniox at real-time pace with the speculator
 * attached, and times both the intent dispatch and the final against the
 * end of speech.
 */
export async function runTake(path: string, file: string, options: SonioxOptions): Promise<TakeResult> {
  return (await runTakeModes(path, file, options, { regex: parseIntent })).regex;
}

/**
 * Like runTake, with one speculator per intent reader listening to the same
 * Soniox stream, so every reader sees identical partials and finals.
 */
export async function runTakeModes<M extends string>(
  path: string,
  file: string,
  options: SonioxOptions,
  readers: Record<M, IntentReader>,
): Promise<Record<M, TakeResult>> {
  const source = new WavFileSource(path);
  const bounds = speechBounds(source.pcm);
  if (!bounds) throw new Error(`${file}: no speech found`);
  const speechEndMs = bounds.end * 1000;

  const backend = new SonioxBackend(source, options);
  const modes = Object.keys(readers) as M[];
  const resolutions = Object.fromEntries(modes.map((mode) => [mode, [] as Resolution[]])) as Record<M, Resolution[]>;
  for (const mode of modes) {
    new IntentSpeculator(backend, { onIntent: () => {}, onResolved: (r) => resolutions[mode].push(r) }, readers[mode]);
  }
  await backend.start();
  // The source ends with silence, so Soniox closes the utterance and then finishes
  await backend.done;
  await backend.stop();
  if (backend.error) throw backend.error;
  // A remote reader may still be answering the last final
  const finals = backend.finalCount;
  for (let waited = 0; modes.some((m) => resolutions[m].length < finals) && waited < 5000; waited += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return Object.fromEntries(modes.map((mode) => [mode, summarize(file, speechEndMs, resolutions[mode])])) as Record<M, TakeResult>;
}

function summarize(file: string, speechEndMs: number, resolutions: Resolution[]): TakeResult {
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
    resolvedAfterEndMs: last ? last.resolvedAtMs - speechEndMs : null,
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
