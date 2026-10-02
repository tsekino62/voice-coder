# 発話終了から意図発火・final までの時間

計測日時: 2026-10-02 21:36 UTC
条件: Soniox `stt-rt-v5`、`max_endpoint_delay_ms=1000`、`context.terms` = FizzBuzz / async / await / リファクタ / デバッグ。
`test/audio/` の ElevenLabs 合成音声 15 本を実時間ペースで流した（同時に最大 3 本）。`npm run latency` で再計測できる。

- **発話終了**: WAV の音量から求めた発話の終わり（stt_probe と同じ方法）。
- **意図発火**: 最終的に採用された意図の処理を始めた時点。partial で当たった場合は partial の時点、
  外れて final でやり直した場合は final の時点。負の値は話し終わる前に発火したことを表す。
- **final**: Soniox の `<end>` で発話が確定した時点。

## 集計

| 指標 | 中央値 (ms) | 最大値 (ms) |
|---|---|---|
| 発話終了 → 意図発火 | 180 | 657 |
| 発話終了 → final | 776 | 1958 |

意図の正解 15/15、partial での発火がそのまま採用された本数 15/15。

## テイク別

| file | 読み上げ文 | 認識結果 | 意図 | 意図発火 (ms) | final (ms) | 採用 |
|---|---|---|---|---|---|---|
| generate_1.wav | FizzBuzzを作って | FizzBuzzを作って。 | generate  | 548 | 907 | partial |
| generate_2.wav | FizzBuzzを書いて | FizzBuzzを書いて、。 | generate  | 531 | 1958 | partial |
| generate_3.wav | FizzBuzzを実装してください | FizzBuzzを実装してください。 | generate  | 65 | 889 | partial |
| generate_4.wav | FizzBuzzのコードを生成して | FizzBuzzのコードを生成して、。 | generate  | 230 | 1932 | partial |
| generate_5.wav | 作って、FizzBuzz | 作って、FizzBuzz。 | generate  | 657 | 776 | partial |
| explain_1.wav | 10行目から20行目を解説して | 10行目から20行目を解説して、— | explain 10-20 | 180 | 1835 | partial |
| explain_2.wav | 10から20行目を説明して | 10〜20行目を説明して。 | explain 10-20 | 211 | 809 | partial |
| explain_3.wav | 十行目から二十行目までを解説して | 10行目から20行目までを解説して、。 | explain 10-20 | 95 | 1791 | partial |
| explain_4.wav | 10行目から20行目のコードを説明してください | 従業目から20行目のコードを説明してください。 | explain 10-20 | -130 | 599 | partial |
| explain_5.wav | 10行目から20行目で何をしているか教えて | 十行目から二十行目で、何をしているか教えて。 | explain 10-20 | -234 | 609 | partial |
| debug_1.wav | デバッグして | デバッグして。 | debug  | 415 | 680 | partial |
| debug_2.wav | これをデバッグして | これをデバッグして。 | debug  | 373 | 644 | partial |
| debug_3.wav | デバッグをお願いします | デバッグをお願いします。 | debug  | -150 | 594 | partial |
| debug_4.wav | このバグを直して | このバグを直して。 | debug  | -77 | 669 | partial |
| debug_5.wav | エラーの原因を調べて | エラーの原因を調べて。 | debug  | -538 | 655 | partial |
