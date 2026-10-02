import type { Intent, IntentKind, LineRange } from "./types.js";

/**
 * Verb stems, not whole verbs, so a partial transcript ("FizzBuzzを作っ")
 * already reads as a command. Japanese puts the verb last, so by the time a
 * stem shows up the object and any line range before it are already there.
 */
const INTENT_WORDS: Array<[IntentKind, RegExp]> = [
  ["debug", /デバッグ|バグ|不具合|エラー|動かない|落ちる/g],
  ["explain", /説明|解説|教えて|どういう(?:意味|こと)|何をして|なにをして/g],
  // 作 but not 動作/操作/工作/制作 (動作しない is a bug report, not a request to build)
  ["generate", /(?<![動操工制])作[っるりれ成]|実装|書い|書く|書き|生成/g],
];

/** Right after an intent word, these take it back: 作るんじゃなくて, 説明はいらない. */
const NEGATION = /^.{0,6}?(?:じゃなく|ではなく|じゃない|ではない|いらない|いらん|不要|やめ|なしで)/;

const KANJI_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const KANJI_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 十 → 10, 二十五 → 25, 百二 → 102, 一〇 → 10. */
export function kanjiToNumber(kanji: string): number | null {
  if (!/^[〇零一二三四五六七八九十百千]+$/.test(kanji)) return null;
  if (!/[十百千]/.test(kanji)) {
    // Digit by digit, as in 一〇 or 二〇
    return Number([...kanji].map((ch) => KANJI_DIGITS[ch]).join(""));
  }
  let total = 0;
  let digit = 0;
  for (const ch of kanji) {
    if (ch in KANJI_UNITS) {
      total += (digit || 1) * KANJI_UNITS[ch];
      digit = 0;
    } else {
      digit = KANJI_DIGITS[ch];
    }
  }
  return total + digit;
}

/**
 * Width/case folding plus kanji numerals turned into digits where they count
 * lines (十行目, 十から二十行目). Other kanji like 一緒 or 一旦 are left alone.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    // STT homophones of 行目 and of じゅう before it: 従業目 (じゅうぎょうめ) is 十行目
    .replace(/([\d〇零一二三四五六七八九十百千従重住充])業目/g, "$1行目")
    .replace(/[従重住充](?=行目)/g, "十")
    .replace(/[〇零一二三四五六七八九十百千]+(?=\s*(?:行|から|まで|[-~〜]))/g, (kanji) => String(kanjiToNumber(kanji) ?? kanji));
}

const SEP = String.raw`\s*(?:から|[-~〜ー―])\s*`;
const LINE = String.raw`\s*行目?`;
// 10行目から20行目 / 10-20行目 / 10から20行目 / 10行目から20(まで)
// / 10秒目から20行目 (the first counter misheard, the second still says 行目)
const RANGE_PATTERNS = [
  new RegExp(String.raw`(\d+)(?:${LINE})?${SEP}(\d+)${LINE}`),
  new RegExp(String.raw`(\d+)${LINE}${SEP}(\d+)`),
  new RegExp(String.raw`(\d+)\s*[^\d\s]目${SEP}(\d+)${LINE}`),
];
const SINGLE_LINE = /(\d+)\s*行目/;

/** The line range in already-normalized text, lowest line first. */
export function parseLineRange(normalized: string): LineRange | null {
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (match) {
      const [a, b] = [Number(match[1]), Number(match[2])];
      return { from: Math.min(a, b), to: Math.max(a, b) };
    }
  }
  const single = SINGLE_LINE.exec(normalized);
  return single ? { from: Number(single[1]), to: Number(single[1]) } : null;
}

/** Identifiers: runs of latin letters/digits, spaces closed up (Fizz Buzz → fizzbuzz). */
export function parseTerms(normalized: string): string[] {
  const runs = normalized.match(/[a-z][a-z0-9_]*(?:\s+[a-z0-9_]+)*/g) ?? [];
  return [...new Set(runs.map((run) => run.replace(/\s+/g, "")))].sort();
}

/**
 * The command a transcript asks for. When the speaker changes their mind
 * (作って、あ、やっぱり説明して) the last intent word that is not taken back wins.
 */
export function parseIntent(text: string): Intent | null {
  const normalized = normalizeText(text);
  let last: { kind: IntentKind; index: number } | null = null;
  for (const [kind, pattern] of INTENT_WORDS) {
    for (const match of normalized.matchAll(pattern)) {
      const after = normalized.slice(match.index + match[0].length);
      if (NEGATION.test(after)) continue;
      if (!last || match.index > last.index) last = { kind, index: match.index };
    }
  }
  if (!last) return null;
  return { kind: last.kind, range: parseLineRange(normalized), terms: parseTerms(normalized) };
}

/** Same command as far as the downstream action is concerned. */
export function sameIntent(a: Intent | null, b: Intent | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.range?.from === b.range?.from &&
    a.range?.to === b.range?.to &&
    a.terms.join("\u0000") === b.terms.join("\u0000")
  );
}
