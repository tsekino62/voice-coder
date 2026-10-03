export type Language = "ja" | "en";

/** Japanese when the text has any kana or kanji, English when it has Latin letters only. */
export function languageOf(text: string): Language {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text)) return "ja";
  return /[a-z]/i.test(text) ? "en" : "ja";
}
