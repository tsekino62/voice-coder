import { languageOf } from "./language.js";
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
  // 抽象クラスにまとめて / 共通化 / 切り出して / リネーム
  ["refactor", /リファクタ|共通化|抽象化|抽象クラス|基底クラス|親クラス|スーパークラス|まとめ[てるた]|切り出|抽出|書き直|整理して|リネーム|名前を変え|分割/g],
  // 新しいファイル / ファイルを作って / ファイルを追加
  ["create", /(?:新しい|新規)ファイル|ファイル(?:を|に)?(?:新しく|新規に?)?(?:作[っるりれ成]|追加|用意)/g],
  // 実行して / 走らせて / 動かして, but not 実行すると固まる (a bug report)
  ["run", /実行し[てた]|実行を|走らせ|動かして|動かしてみ|起動して|ランして/g],
  // English: whole words, on the lower-cased transcript
  ["debug", /\bdebug|\bbugs?\b|\berrors?\b|\bexceptions?\b|\bcrash|\bbroken\b|doesn'?t work|not working|\bfail(?:s|ing|ed)?\b|\bfix (?:it|this|that|the)\b/g],
  ["explain", /\bexplain|\bdescribe|\bwhat does\b|\bwhat is (?:this|that|it)\b|\bwalk me through|\btell me (?:about|what|how)/g],
  ["generate", /\bcreate\b(?! (?:a |an |the )?(?:new )?file)|\bwrite\b|\bmake\b(?! (?:a |an |the )?(?:new )?file)|\bgenerate\b|\bimplement\b|\bbuild\b|\badd\b(?! (?:a |an |the )?(?:new )?file)/g],
  ["refactor", /\brefactor|\bextract|\brename|\bclean (?:it |this |that )?up|\bsimplify|\binto (?:a |an )?(?:function|method|class)|\babstract (?:base )?class|\bbase class|\bmerge\b|\bsplit\b/g],
  ["create", /\bnew file|\b(?:create|add|make) (?:a |an |the )?(?:new )?file/g],
  ["run", /\brun\b|\bexecute\b|\blaunch\b/g],
];

/**
 * Words that mark a change of mind (作って、あ、やっぱり説明して). Without one, a
 * bigger request outranks a smaller one in the same sentence: 抽象クラスを作って
 * is a refactoring, not a generate, and ファイルを作って is a new file.
 */
const RESTATEMENT = /やっぱ|いや|じゃなく|ではなく|違う|ちがう|やめ|\bactually\b|\binstead\b|\bno,|\bwait\b|\bnever ?mind\b/;
const PRECEDENCE: IntentKind[] = ["refactor", "create"];

/** Right after an intent word, these take it back: 作るんじゃなくて, 説明はいらない. */
const NEGATION = /^.{0,6}?(?:じゃなく|ではなく|じゃない|ではない|いらない|いらん|不要|やめ|なしで)/;
/** In English the taking back comes first: don't create, no need to explain. */
const NEGATION_BEFORE = /(?:\bdon'?t|\bdo not|\bno need to|\binstead of|\bnot)\s+$/;

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
// / 21行目か25行目 (から heard as か; only with 行目 on both sides)
const RANGE_PATTERNS = [
  new RegExp(String.raw`(\d+)${LINE}\s*か\s*(\d+)${LINE}`),
  new RegExp(String.raw`(\d+)(?:${LINE})?${SEP}(\d+)${LINE}`),
  new RegExp(String.raw`(\d+)${LINE}${SEP}(\d+)`),
  new RegExp(String.raw`(\d+)\s*[^\d\s]目${SEP}(\d+)${LINE}`),
];
const SINGLE_LINE = /(\d+)\s*行目/;
// lines 10 to 20 / line 10 through line 20 / lines 10-20 / from line 10 to 20
const EN_RANGE = /\blines? (\d+)\s*(?:to|through|thru|until|till|and|-)\s*(?:line )?(\d+)/;
const EN_SINGLE = /\bline (\d+)\b/;
const EN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

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
  if (single) return { from: Number(single[1]), to: Number(single[1]) };
  // English, with spelled-out numbers turned into digits (lines ten to twenty)
  const english = normalized.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\b/g, (w) => String(EN_NUMBERS[w]));
  const range = EN_RANGE.exec(english);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  const line = EN_SINGLE.exec(english);
  return line ? { from: Number(line[1]), to: Number(line[1]) } : null;
}

/** Identifiers: runs of latin letters/digits, spaces closed up (Fizz Buzz → fizzbuzz). */
export function parseTerms(normalized: string): string[] {
  const runs = normalized.match(/[a-z][a-z0-9_]*(?:\s+[a-z0-9_]+)*/g) ?? [];
  return [...new Set(runs.map((run) => run.replace(/\s+/g, "")))].sort();
}

/**
 * Identifiers named in a transcript. In Japanese every Latin run is one; in an
 * English sentence only code-like words count (FizzBuzz, fetchUser, fetch_user,
 * main.py), or every new word would look like a different request.
 */
export function termsOf(text: string): string[] {
  if (languageOf(text) === "ja") return parseTerms(normalizeText(text));
  const words = text.normalize("NFKC").match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9]+)?/g) ?? [];
  const codeLike = words.filter((w) => /^[A-Za-z][a-z0-9]*[A-Z]|_|\d|\./.test(w));
  return [...new Set(codeLike.map((w) => w.toLowerCase()))].sort();
}

/**
 * The command a transcript asks for. When the speaker changes their mind
 * (作って、あ、やっぱり説明して) the last intent word that is not taken back wins.
 */
export function parseIntent(text: string): Intent | null {
  const normalized = normalizeText(text);
  let last: { kind: IntentKind; index: number } | null = null;
  const found = new Set<IntentKind>();
  for (const [kind, pattern] of INTENT_WORDS) {
    for (const match of normalized.matchAll(pattern)) {
      const after = normalized.slice(match.index + match[0].length);
      if (NEGATION.test(after)) continue;
      if (NEGATION_BEFORE.test(normalized.slice(Math.max(0, match.index - 16), match.index))) continue;
      found.add(kind);
      if (!last || match.index > last.index) last = { kind, index: match.index };
    }
  }
  if (!last) return null;
  const kind = RESTATEMENT.test(normalized) ? last.kind : (PRECEDENCE.find((k) => found.has(k)) ?? last.kind);
  return { kind, range: parseLineRange(normalized), terms: termsOf(text) };
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
