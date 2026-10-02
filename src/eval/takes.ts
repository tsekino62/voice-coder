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

/** Three commands, five ways of saying each. */
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
