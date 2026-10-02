# 意図の読み取り: 正規表現 / jev / ハイブリッド

計測日時: 2026-10-02 22:35 UTC
条件: Soniox `stt-rt-v5`（`max_endpoint_delay_ms=1000`）に `test/audio/` の 30 本
（キーワードあり 15 本、キーワードなし 15 本）を実時間ペースで流し、2 周した。
1 本の音声ストリームに 3 つの先読み制御をつなぎ、3 モードがまったく同じ partial / final を受け取るようにした。

- **正規表現のみ**: キーワードで読む（従来の既定）。
- **jev のみ**: すべての partial / final を jev（`jev-latest`、Choice 1 問）で読む。
- **ハイブリッド**: キーワードで読めればそのまま、読めないときだけ jev に聞く。
- 行範囲はどのモードも正規表現で読む。
- **意図発火**: 最終的に採用された意図の処理を始めた時点（発話終了から、ms。負は話し終わる前）。
- **意図確定**: final の文字列から意図を読み終えた時点。
- 時間は「中央値 / 最大値」で、意図を正しく読めた発話だけで集計した。

`npm run jev:compare` で再計測できる。

## 集計

### キーワードあり（30 発話）

| モード | 意図の正解 | 行範囲 | 意図発火 | 意図確定 | partial で当たった数 |
|---|---|---|---|---|---|
| 正規表現のみ（jev off） | 30/30 | 10/10 | 181 / 704 | 800 / 1973 | 30/30 |
| jev のみ（jev on） | 30/30 | 10/10 | 272 / 1131 | 968 / 2152 | 28/30 |
| ハイブリッド | 30/30 | 10/10 | 130 / 704 | 800 / 1973 | 30/30 |

発話終了 → final（全モード共通）: 800 / 1973 ms

### キーワードなし（30 発話）

| モード | 意図の正解 | 行範囲 | 意図発火 | 意図確定 | partial で当たった数 |
|---|---|---|---|---|---|
| 正規表現のみ（jev off） | 0/30 | 0/10 | - | - | 0/0 |
| jev のみ（jev on） | 30/30 | 10/10 | 90 / 787 | 960 / 2056 | 30/30 |
| ハイブリッド | 30/30 | 10/10 | 86 / 737 | 944 / 2073 | 30/30 |

発話終了 → final（全モード共通）: 768 / 1893 ms

jev の呼び出し: jev のみ 688 回（1 回 中央値 170 ms / 90 パーセンタイル 209 ms）、ハイブリッド 546 回（1 回 中央値 171 ms / 90 パーセンタイル 209 ms）

## 発話別

各セルは「読んだ意図 発火時刻(ms)」。✗ は誤り。

| file | 周 | 認識結果 | 正規表現 | jev | ハイブリッド |
|---|---|---|---|---|---|
| generate_1.wav | 1 | FizzBuzzを作って。 | generate 558 | generate 543 | generate 558 |
| generate_2.wav | 1 | FizzBuzzを書いて、。 | generate 471 | generate 511 | generate 471 |
| generate_3.wav | 1 | FizzBuzzを実装してください。 | generate 64 | generate 224 | generate 64 |
| generate_4.wav | 1 | FizzBuzzのコードを生成して、。 | generate 239 | generate 285 | generate -27 |
| generate_5.wav | 1 | 作って、FizzBuzz。 | generate 704 | generate 1131 | generate 704 |
| explain_1.wav | 1 | 10行目から20行目を解説して、— | explain 10-20 187 | explain 10-20 210 | explain 10-20 187 |
| explain_2.wav | 1 | 10〜20行目を説明して。 | explain 10-20 174 | explain 10-20 229 | explain 10-20 174 |
| explain_3.wav | 1 | 10行目から20行目までを解説して、。 | explain 10-20 137 | explain 10-20 306 | explain 10-20 137 |
| explain_4.wav | 1 | 従業目から20行目のコードを説明してください。 | explain 10-20 -151 | explain 10-20 -45 | explain 10-20 -151 |
| explain_5.wav | 1 | 十行目から二十行目で、何をしているか教えて。 | explain 10-20 -239 | explain 10-20 -36 | explain 10-20 -239 |
| debug_1.wav | 1 | デバッグして。 | debug 427 | debug 505 | debug 427 |
| debug_2.wav | 1 | これをデバッグして。 | debug 398 | debug 491 | debug 398 |
| debug_3.wav | 1 | デバッグをお願いします。 | debug -145 | debug -112 | debug -145 |
| debug_4.wav | 1 | このバグを直して。 | debug -82 | debug 336 | debug -82 |
| debug_5.wav | 1 | エラーの原因を調べて。 | debug -545 | debug -377 | debug -545 |
| para_generate_1.wav | 1 | FizzBuzzが欲しい。 | ✗ なし - | generate 513 | generate 513 |
| para_generate_2.wav | 1 | FizzBuzzを用意して。 | ✗ なし - | generate 438 | generate 434 |
| para_generate_3.wav | 1 | ここにFizzBuzzをお願い。 | ✗ なし - | generate 646 | generate 673 |
| para_generate_4.wav | 1 | FizzBuzzを足しといて。 | ✗ なし - | generate 400 | generate 434 |
| para_generate_5.wav | 1 | FizzBuzzのコード、ちょうだい。 | ✗ なし - | generate 296 | generate 89 |
| para_explain_1.wav | 1 | 10行目から20行目って、何やってるの？ | ✗ なし - | explain 10-20 118 | explain 10-20 143 |
| para_explain_2.wav | 1 | 従業目から20行目の意味が分からない。 | ✗ なし - | explain 10-20 -172 | explain 10-20 -223 |
| para_explain_3.wav | 1 | 従業目から20行目を噛み砕いて、。 | ✗ なし - | explain 10-20 459 | explain 10-20 323 |
| para_explain_4.wav | 1 | 10行目から20行目の処理の流れを知りたい。 | ✗ なし - | explain 10-20 -73 | explain 10-20 -63 |
| para_explain_5.wav | 1 | 10秒目から20行目、これ何してるんだっけ。 | ✗ なし - | explain 10-20 -98 | explain 10-20 -91 |
| para_debug_1.wav | 1 | テストが通らないんだけど。 | ✗ なし - | debug 1 | debug -4 |
| para_debug_2.wav | 1 | なんか変な値が返ってくる。 | ✗ なし - | debug 85 | debug 84 |
| para_debug_3.wav | 1 | 例外が出て止まっちゃう。 | ✗ なし - | debug 75 | debug 58 |
| para_debug_4.wav | 1 | 実行すると固まる。 | ✗ なし - | debug 725 | debug 737 |
| para_debug_5.wav | 1 | 期待した結果にならない。見てくれる。 | ✗ なし - | debug -672 | debug -657 |
| generate_1.wav | 2 | FizzBuzzを作って。 | generate 552 | generate 516 | generate 492 |
| generate_2.wav | 2 | FizzBuzzを書いて、。 | generate 522 | generate 561 | generate 522 |
| generate_3.wav | 2 | FizzBuzzを実装してください。 | generate 96 | generate 278 | generate 73 |
| generate_4.wav | 2 | FizzBuzzのコードを生成して、。 | generate 197 | generate -5 | generate -94 |
| generate_5.wav | 2 | 作って、FizzBuzz。 | generate 686 | generate 979 | generate 686 |
| explain_1.wav | 2 | 10行目から20行目を解説して、— | explain 10-20 206 | explain 10-20 266 | explain 10-20 206 |
| explain_2.wav | 2 | 10〜20行目を説明して。 | explain 10-20 203 | explain 10-20 229 | explain 10-20 203 |
| explain_3.wav | 2 | 10行目から20行目までを解説して、。 | explain 10-20 123 | explain 10-20 281 | explain 10-20 123 |
| explain_4.wav | 2 | 従業目から20行目のコードを説明してください。 | explain 10-20 -188 | explain 10-20 -118 | explain 10-20 -188 |
| explain_5.wav | 2 | 十行目から二十行目で、何をしているか教えて。 | explain 10-20 -238 | explain 10-20 -68 | explain 10-20 -238 |
| debug_1.wav | 2 | デバッグして。 | debug 379 | debug 440 | debug 379 |
| debug_2.wav | 2 | これをデバッグして。 | debug 391 | debug 450 | debug 391 |
| debug_3.wav | 2 | デバッグをお願いします。 | debug -149 | debug -40 | debug -149 |
| debug_4.wav | 2 | このバグを直して。 | debug -61 | debug 125 | debug -61 |
| debug_5.wav | 2 | エラーの原因を調べて。 | debug -560 | debug -363 | debug -560 |
| para_generate_1.wav | 2 | FizzBuzzが欲しい。 | ✗ なし - | generate 493 | generate 514 |
| para_generate_2.wav | 2 | FizzBuzzを用意して。 | ✗ なし - | generate 529 | generate 447 |
| para_generate_3.wav | 2 | ここにFizzBuzzをお願い。 | ✗ なし - | generate 614 | generate 606 |
| para_generate_4.wav | 2 | FizzBuzzを足しといて。 | ✗ なし - | generate 571 | generate 430 |
| para_generate_5.wav | 2 | FizzBuzzのコード、ちょうだい。 | ✗ なし - | generate 96 | generate 92 |
| para_explain_1.wav | 2 | 10行目から20行目って、何やってるの？ | ✗ なし - | explain 10-20 57 | explain 10-20 70 |
| para_explain_2.wav | 2 | 従業目から20行目の意味が分からない。 | ✗ なし - | explain 10-20 -202 | explain 10-20 -216 |
| para_explain_3.wav | 2 | 従業目から20行目を噛み砕いて、。 | ✗ なし - | explain 10-20 337 | explain 10-20 342 |
| para_explain_4.wav | 2 | 10行目から20行目の処理の流れを知りたい。 | ✗ なし - | explain 10-20 -71 | explain 10-20 -59 |
| para_explain_5.wav | 2 | 10秒目から20行目、これ何してるんだっけ。 | ✗ なし - | explain 10-20 -74 | explain 10-20 -104 |
| para_debug_1.wav | 2 | テストが通らないんだけど。 | ✗ なし - | debug 85 | debug 13 |
| para_debug_2.wav | 2 | なんか変な値が返ってくる。 | ✗ なし - | debug 62 | debug 61 |
| para_debug_3.wav | 2 | 例外が出て止まっちゃう。 | ✗ なし - | debug 65 | debug 74 |
| para_debug_4.wav | 2 | 実行すると固まる。 | ✗ なし - | debug 787 | debug 703 |
| para_debug_5.wav | 2 | 期待した結果にならない。見てくれる。 | ✗ なし - | debug -645 | debug -654 |
