import { parseIntent } from "./parser.js";
import type { IntentReader } from "./speculator.js";

/**
 * Keywords first, a classifier only when they find nothing: a transcript with
 * a known keyword is read at once (no round trip), and only phrasings the
 * regex parser misses wait for the remote reader (e.g. jev).
 */
export function hybridReader(remote: IntentReader): IntentReader {
  return (text) => parseIntent(text) ?? remote(text);
}
