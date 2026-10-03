import type { IntentKind, LineRange } from "../intent/types.js";

export interface Take {
  /** WAV file name under test/audio/. */
  file: string;
  /** What the synthesized voice says. */
  text: string;
  kind: IntentKind;
  range?: LineRange;
}

const RANGE_10_20 = { from: 10, to: 20 };

/** Three commands, five ways of saying each, every one with a keyword the regex parser knows. */
export const TAKES: Take[] = [
  { file: "generate_1.wav", text: "FizzBuzzを作って", kind: "generate" },
  { file: "generate_2.wav", text: "FizzBuzzを書いて", kind: "generate" },
  { file: "generate_3.wav", text: "FizzBuzzを実装してください", kind: "generate" },
  { file: "generate_4.wav", text: "FizzBuzzのコードを生成して", kind: "generate" },
  { file: "generate_5.wav", text: "作って、FizzBuzz", kind: "generate" },
  { file: "explain_1.wav", text: "10行目から20行目を解説して", kind: "explain", range: RANGE_10_20 },
  { file: "explain_2.wav", text: "10から20行目を説明して", kind: "explain", range: RANGE_10_20 },
  { file: "explain_3.wav", text: "十行目から二十行目までを解説して", kind: "explain", range: RANGE_10_20 },
  { file: "explain_4.wav", text: "10行目から20行目のコードを説明してください", kind: "explain", range: RANGE_10_20 },
  { file: "explain_5.wav", text: "10行目から20行目で何をしているか教えて", kind: "explain", range: RANGE_10_20 },
  { file: "debug_1.wav", text: "デバッグして", kind: "debug" },
  { file: "debug_2.wav", text: "これをデバッグして", kind: "debug" },
  { file: "debug_3.wav", text: "デバッグをお願いします", kind: "debug" },
  { file: "debug_4.wav", text: "このバグを直して", kind: "debug" },
  { file: "debug_5.wav", text: "エラーの原因を調べて", kind: "debug" },
];

/** The same three commands said without any keyword the regex parser knows. */
export const PARAPHRASE_TAKES: Take[] = [
  { file: "para_generate_1.wav", text: "FizzBuzzがほしい", kind: "generate" },
  { file: "para_generate_2.wav", text: "FizzBuzzを用意して", kind: "generate" },
  { file: "para_generate_3.wav", text: "ここにFizzBuzzをお願い", kind: "generate" },
  { file: "para_generate_4.wav", text: "FizzBuzzを足しといて", kind: "generate" },
  { file: "para_generate_5.wav", text: "FizzBuzzのコード、ちょうだい", kind: "generate" },
  { file: "para_explain_1.wav", text: "10行目から20行目って何やってるの", kind: "explain", range: RANGE_10_20 },
  { file: "para_explain_2.wav", text: "10行目から20行目の意味がわからない", kind: "explain", range: RANGE_10_20 },
  { file: "para_explain_3.wav", text: "10行目から20行目を噛み砕いて", kind: "explain", range: RANGE_10_20 },
  { file: "para_explain_4.wav", text: "10行目から20行目の処理の流れを知りたい", kind: "explain", range: RANGE_10_20 },
  { file: "para_explain_5.wav", text: "10行目から20行目、これ何してるんだっけ", kind: "explain", range: RANGE_10_20 },
  { file: "para_debug_1.wav", text: "テストが通らないんだけど", kind: "debug" },
  { file: "para_debug_2.wav", text: "なんか変な値が返ってくる", kind: "debug" },
  { file: "para_debug_3.wav", text: "例外が出て止まっちゃう", kind: "debug" },
  { file: "para_debug_4.wav", text: "実行すると固まる", kind: "debug" },
  { file: "para_debug_5.wav", text: "期待した結果にならない、見てくれる？", kind: "debug" },
];

export const ALL_TAKES: Take[] = [...TAKES, ...PARAPHRASE_TAKES];

/** Extra lines for the demo video (scripts/demo): not part of the measurements. */
export const DEMO_TAKES: Take[] = [
  { file: "demo_run.wav", text: "実行して", kind: "run" },
  { file: "demo_explain.wav", text: "このコードを説明して", kind: "explain" },
  { file: "demo_refactor.wav", text: "この処理を関数にまとめて", kind: "refactor" },
];
