# jev on / off の速さ比べ

計測日時: 2026-10-02 22:21 UTC
条件: Soniox `stt-rt-v5`（`max_endpoint_delay_ms=1000`）に `test/audio/` の 15 本を実時間ペースで流し、2 周した（計 30 発話）。
1 本の音声ストリームに 2 つの先読み制御をつなぎ、off（正規表現）と on（jev `jev-latest` の Choice 1 問）が
まったく同じ partial / final を受け取るようにした。行範囲は両方とも正規表現で読む（jev は選択肢を返すだけで文字列を抜き出さない）。
`npm run jev:compare` で再計測できる。

- **意図発火**: 最終的に採用された意図の処理を始めた時点（発話終了から。負は話し終わる前）。
- **意図確定**: final の文字列から意図を読み終えた時点。off は final と同時、on は final のあと jev の応答を待つ。
- 値は「中央値 / 最大値」（ms）。

## 集計

| モード | 意図発火 | 意図確定 | 意図の正解 | 行範囲 | partial で当たった数 | 中断した先読み |
|---|---|---|---|---|---|---|
| jev off（正規表現） | 212 / 677 | 791 / 1944 | 30/30 | 10/10 | 30/30 | 8 |
| jev on | 268 / 974 | 972 / 2106 | 30/30 | 10/10 | 28/30 | 8 |

- 発話終了 → final（両モード共通）: 791 / 1944 ms
- 意図発火の差（on − off、負なら on が早い）: 中央値 82 ms、最小 -321 ms、最大 764 ms
- jev の呼び出し: 321 回、1 回あたり 中央値 177 ms / 90 パーセンタイル 214 ms / 最大 368 ms

## 発話別

| file | 周 | 認識結果 | off の意図 | on の意図 | off 発火 | on 発火 | 差 | final | on 確定 |
|---|---|---|---|---|---|---|---|---|---|
| generate_1.wav | 1 | FizzBuzzを作って。 | generate | generate | 559 | 511 | -47 | 916 | 1080 |
| generate_2.wav | 1 | FizzBuzzを書いて、。 | generate | generate | 489 | 553 | 64 | 1916 | 2070 |
| generate_3.wav | 1 | FizzBuzzを実装してください。 | generate | generate | 108 | 272 | 164 | 931 | 1115 |
| generate_4.wav | 1 | FizzBuzzのコードを生成して、。 | generate | generate | 241 | -79 | -321 | 1931 | 2092 |
| generate_5.wav | 1 | 作って、FizzBuzz。 | generate | generate | 655 | 974 | 319 | 779 | 974 |
| explain_1.wav | 1 | 10行目から20行目を解説して、— | explain 10-20 | explain 10-20 | 215 | 264 | 48 | 1874 | 2033 |
| explain_2.wav | 1 | 10〜20行目を説明して。 | explain 10-20 | explain 10-20 | 227 | 261 | 35 | 831 | 991 |
| explain_3.wav | 1 | 10行目から20行目までを解説して、。 | explain 10-20 | explain 10-20 | 126 | 277 | 150 | 1832 | 1985 |
| explain_4.wav | 1 | 従業目から20行目のコードを説明してください。 | explain 10-20 | explain 10-20 | -151 | -74 | 76 | 611 | 781 |
| explain_5.wav | 1 | 十行目から二十行目で、何をしているか教えて。 | explain 10-20 | explain 10-20 | -217 | -45 | 172 | 606 | 799 |
| debug_1.wav | 1 | デバッグして。 | debug | debug | 416 | 495 | 79 | 669 | 850 |
| debug_2.wav | 1 | これをデバッグして。 | debug | debug | 371 | 524 | 153 | 634 | 820 |
| debug_3.wav | 1 | デバッグをお願いします。 | debug | debug | -146 | -99 | 47 | 593 | 891 |
| debug_4.wav | 1 | このバグを直して。 | debug | debug | -70 | 435 | 505 | 667 | 841 |
| debug_5.wav | 1 | エラーの原因を調べて。 | debug | debug | -577 | 187 | 764 | 601 | 803 |
| generate_1.wav | 2 | FizzBuzzを作って。 | generate | generate | 554 | 500 | -54 | 904 | 1061 |
| generate_2.wav | 2 | FizzBuzzを書いて、。 | generate | generate | 506 | 617 | 111 | 1944 | 2105 |
| generate_3.wav | 2 | FizzBuzzを実装してください。 | generate | generate | 97 | 149 | 53 | 838 | 996 |
| generate_4.wav | 2 | FizzBuzzのコードを生成して、。 | generate | generate | 233 | -65 | -298 | 1938 | 2106 |
| generate_5.wav | 2 | 作って、FizzBuzz。 | generate | generate | 677 | 970 | 293 | 803 | 970 |
| explain_1.wav | 2 | 10行目から20行目を解説して、— | explain 10-20 | explain 10-20 | 210 | 294 | 84 | 1862 | 2041 |
| explain_2.wav | 2 | 10〜20行目を説明して。 | explain 10-20 | explain 10-20 | 215 | 265 | 50 | 837 | 1055 |
| explain_3.wav | 2 | 10行目から20行目までを解説して、。 | explain 10-20 | explain 10-20 | 111 | 226 | 114 | 1821 | 1985 |
| explain_4.wav | 2 | 従業目から20行目のコードを説明してください。 | explain 10-20 | explain 10-20 | -139 | -71 | 68 | 606 | 798 |
| explain_5.wav | 2 | 十行目から二十行目で、何をしているか教えて。 | explain 10-20 | explain 10-20 | -232 | -24 | 208 | 607 | 759 |
| debug_1.wav | 2 | デバッグして。 | debug | debug | 373 | 432 | 59 | 639 | 804 |
| debug_2.wav | 2 | これをデバッグして。 | debug | debug | 366 | 451 | 85 | 614 | 790 |
| debug_3.wav | 2 | デバッグをお願いします。 | debug | debug | -183 | -122 | 61 | 562 | 731 |
| debug_4.wav | 2 | このバグを直して。 | debug | debug | -64 | 353 | 417 | 677 | 843 |
| debug_5.wav | 2 | エラーの原因を調べて。 | debug | debug | -587 | 146 | 732 | 598 | 783 |
