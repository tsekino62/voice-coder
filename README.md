# voice-coder

日本語音声コーディング拡張の「音声→意図」層。

```
マイク / WAV ─▶ SttBackend (Soniox stt-rt-v5) ─partial/final─▶ IntentSpeculator ─onIntent(AbortSignal)─▶ 後段 (LLM など)
                                                                 └ parseIntent: generate / explain / debug + 行範囲
```

- `src/stt/SttBackend.ts` — `start / onPartial / onFinal / stop`。final は型付きの `intent` を持てるので、
  jev (typesafe.ai) のように意図を直接返すバックエンドもこの形に収まる（`test/unit/jev-fit.test.ts`）。
- `src/stt/SonioxBackend.ts` — `max_endpoint_delay_ms=1000`、`context.terms` = FizzBuzz / async / await / リファクタ / デバッグ。
- `src/audio/source.ts` — `WavFileSource` は WAV を実時間ペースで流す（ファイル再生用の音源）。
- `src/intent/parser.ts` — 意図と行範囲（`10-20行目` / `10から20行目` / `十行目から二十行目` → `{from:10,to:20}`）。
  言い直しは、打ち消されていない最後の意図語を採用する。
- `src/intent/speculator.ts` — partial に意図語が出た時点で `onIntent` を発火し、final と比較して食い違えば
  `AbortSignal` で中断して final の意図で発火し直す（stt_probe/COMPARE.md「音声コーディングツールへの示唆」）。

## 使い方

```bash
npm install
npm run build
npm test                 # SONIOX_API_KEY が無いと統合テストは skip
npm run latency          # docs/LATENCY.md を再計測（SONIOX_API_KEY）
npm run gen:audio        # test/audio/ の未生成分だけ合成（ELEVENLABS_API_KEY）
```

`test/audio/` の WAV はコミット済みのものを使う。作り直すのは `npm run gen:audio -- --force` を明示的に実行したときだけ。
