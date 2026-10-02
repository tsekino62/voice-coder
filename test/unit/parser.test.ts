import { describe, expect, it } from "vitest";
import { kanjiToNumber, normalizeText, parseIntent, parseLineRange, sameIntent } from "../../src/intent/parser.js";

const kindOf = (text: string) => parseIntent(text)?.kind ?? null;

describe("intent kind", () => {
  it.each([
    ["FizzBuzzを作って", "generate"],
    ["FizzBuzzを書いて", "generate"],
    ["FizzBuzzを実装してください", "generate"],
    ["FizzBuzzのコードを生成して", "generate"],
    ["作って、FizzBuzz", "generate"],
    ["fizzbuzzを作成して", "generate"],
    ["10行目から20行目を解説して", "explain"],
    ["このファイルを説明して", "explain"],
    ["10行目から20行目で何をしているか教えて", "explain"],
    ["この関数はどういう意味？", "explain"],
    ["デバッグして", "debug"],
    ["デバッグをお願いします", "debug"],
    ["このバグを直して", "debug"],
    ["エラーの原因を調べて", "debug"],
    ["なぜか動かない", "debug"],
  ])("%s → %s", (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it("returns null when no command is named", () => {
    expect(parseIntent("えーと")).toBeNull();
    expect(parseIntent("")).toBeNull();
  });

  it("does not take 動作 as a request to build", () => {
    expect(kindOf("動作がおかしいのでデバッグして")).toBe("debug");
    expect(kindOf("動作しない")).toBeNull();
  });

  it("fires on a verb stem in a partial transcript", () => {
    expect(kindOf("FizzBuzzを作っ")).toBe("generate");
    expect(kindOf("10行目から20行目を解説")).toBe("explain");
    expect(kindOf("デバッグ")).toBe("debug");
  });

  it("reads full-width text", () => {
    expect(parseIntent("ＦｉｚｚＢｕｚｚを作って")).toMatchObject({ kind: "generate", terms: ["fizzbuzz"] });
  });
});

describe("restatement: the last intent wins", () => {
  it.each([
    ["作って、あ、やっぱり説明して", "explain"],
    ["説明して、いや、デバッグして", "debug"],
    ["デバッグして、じゃなくて作って", "generate"],
    ["作るんじゃなくて説明して", "explain"],
    ["説明じゃなくてデバッグ", "debug"],
    ["説明はいらないから作って", "generate"],
  ])("%s → %s", (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it("returns null when the only command is taken back", () => {
    expect(parseIntent("作るんじゃなくて")).toBeNull();
  });
});

describe("line ranges", () => {
  const range = (text: string) => parseIntent(text)?.range ?? null;

  it.each([
    "10-20行目を説明して",
    "10から20行目を説明して",
    "10行目から20行目を説明して",
    "10行目〜20行目を説明して",
    "10行目から20までを説明して",
    "十行目から二十行目を説明して",
    "十から二十行目を説明して",
    "一〇行目から二〇行目を説明して",
    "１０行目から２０行目を説明して",
    "10 行目から 20 行目を説明して",
    "20行目から10行目を説明して",
  ])("%s → 10..20", (text) => {
    expect(range(text)).toEqual({ from: 10, to: 20 });
  });

  it("reads a single line as a one-line range", () => {
    expect(range("十行目を説明して")).toEqual({ from: 10, to: 10 });
    expect(range("15行目を説明して")).toEqual({ from: 15, to: 15 });
  });

  it("is null when no line is named", () => {
    expect(range("FizzBuzzを作って")).toBeNull();
    expect(parseLineRange("10から20")).toBeNull();
  });
});

describe("normalization", () => {
  it.each([
    ["十", 10],
    ["二十", 20],
    ["二十五", 25],
    ["百二", 102],
    ["一〇", 10],
  ])("kanji %s → %d", (kanji, value) => {
    expect(kanjiToNumber(kanji)).toBe(value);
  });

  it("only turns kanji into digits where they count lines", () => {
    expect(normalizeText("一緒に十行目")).toBe("一緒に10行目");
  });

  it("reads STT homophones of 十行目 (heard from Soniox on explain_4.wav)", () => {
    expect(parseIntent("従業目から20行目のコードを説明してください。")?.range).toEqual({ from: 10, to: 20 });
    expect(parseIntent("重行目から二十業目を解説して")?.range).toEqual({ from: 10, to: 20 });
    expect(normalizeText("従業員の一覧")).toBe("従業員の一覧");
  });

  it("closes up a split identifier", () => {
    expect(parseIntent("Fizz Buzzを作って")?.terms).toEqual(["fizzbuzz"]);
  });

  it("compares intents by kind, range and identifiers, not wording", () => {
    expect(sameIntent(parseIntent("FizzBuzzを作っ"), parseIntent("FizzBuzzを作って。"))).toBe(true);
    expect(sameIntent(parseIntent("十から二十行目を解説"), parseIntent("10行目から20行目を解説して"))).toBe(true);
    expect(sameIntent(parseIntent("作って"), parseIntent("作って、FizzBuzz"))).toBe(false);
    expect(sameIntent(parseIntent("10行目を解説"), parseIntent("10行目から20行目を解説して"))).toBe(false);
  });
});
