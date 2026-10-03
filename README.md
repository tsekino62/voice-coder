# Voice Coder

日本語または英語の音声で「FizzBuzz を作って」「10 行目から 20 行目を解説して」「デバッグして」
（"Create FizzBuzz" / "Explain lines 10 to 20" / "Debug this"）と指示する VS Code 拡張。

```
マイク (pvrecorder) ─▶ SttBackend (Soniox) ─partial/final─▶ IntentSpeculator ─▶ AgentBackend (OpenAI / Claude)
                                                       │                                               │
                                                  ステータスバー                         final で確定した結果だけをエディタへ
```

- **push-to-talk**: `Ctrl+Shift+Space`（macOS は `Cmd+Shift+Space`）で聞き始め、話し終えて指示が確定すると自動で止まる
  （設定 `voiceCoder.stopAfterUtterance`）。途中で止めるときはもう一度押す。聞いている間はステータスバーに録音中の印が出る。常時待ち受けはしない。
- **日本語と英語**: どちらで話してもよい。説明などの返答と、ステータスバー・通知の言葉は話した言語に合わせる（設定 `voiceCoder.messageLanguage`）。
- **先読み**: partial に意図語が出た時点でエージェントを動かし始める。final で意図が食い違えば `AbortSignal` で止め、
  final の意図でやり直す。エディタに書き込むのは final で確定した結果だけなので、止めた実行は何も残さない。
- **explain**: 出力パネル「Voice Coder」に説明を流す。ドキュメントは変えない。
- **generate**: カーソル位置に 1 回の `WorkspaceEdit` で挿入する。`Ctrl+Z` 1 回で元に戻る。
- **debug**: 対象範囲のエラー（`getDiagnostics`）とコードから修正案を作り、diff で表示する。
  差分表示の右上の ✓ ボタン、`Ctrl+Alt+Enter`、通知の「適用」のどれかで承認するまで書き込まない。
- **refactor**（「リファクタして」「共通化して」「似たクラスを抽象クラスにまとめて」）: 開いているファイルと
  ワークスペースのファイル一覧を LLM に渡し、新しいファイルの作成と既存ファイルの書き換えを複数ファイルの diff で表示する。
  承認すると 1 回の `WorkspaceEdit` でまとめて書き込む。関係するファイルは開いておくと案に含まれる。
- **create**（「Userクラスのファイルを作って」「新しいファイルを追加して」）: 新しいファイルの案を diff で表示し、承認で作る。
  「Userクラスを作って」のようにファイルと言わなければ generate（カーソル位置に挿入）になる。
- **run**（「実行して」「動かしてみて」「テストを実行して」）: 今のファイルを言語に合ったコマンド（`python` / `node` / `npx tsx` /
  `go run` など）で、テストならプロジェクトに合わせて `npm test` / `python -m pytest` / `go test ./...` / `cargo test` を、
  ターミナル「Voice Coder」で実行する。コマンドは拡張が決まった形で組み立て、LLM の返答は実行しない。未保存の変更は保存してから実行する。
- 変更案は、作った後に対象ファイルが変わっていたら適用しない。LLM が返したパスがワークスペースの外を指す場合は案ごと捨てる。

## セットアップ

### 1. 環境変数

VS Code は起動したときの環境変数を引き継ぐ。設定してから VS Code を起動し直すこと（ターミナルから `code .` で起動するのが確実）。

**GitHub Copilot に入っていれば、必要なキーは `SONIOX_API_KEY` だけ。**

| 変数 | 用途 | 必須 |
|---|---|---|
| `SONIOX_API_KEY` | 音声認識（Soniox `stt-rt-v5`） | はい |
| `OPENAI_API_KEY` | LLM。Copilot が使えないときの代わり（`voiceCoder.agent` が `auto` / `openai`） | Copilot が無いときだけ |
| `ANTHROPIC_API_KEY` | `voiceCoder.agent` を `claude` にしたとき（Claude Agent SDK） | `claude` のときだけ |
| `TYPESAFE_API_KEY` | キーワードの無い言い回し（「FizzBuzzがほしい」など）を jev で読む。無くてもキーワードで動く | いいえ（任意） |
| `ELEVENLABS_API_KEY` | テスト音声の再生成（`npm run gen:audio`）だけで使う | いいえ |

Windows で恒久的に設定する例:

```powershell
setx SONIOX_API_KEY "..."
setx OPENAI_API_KEY "..."
```

環境変数の代わりに `.env` に書いて、設定 `voiceCoder.envFile` でそのパスを指定してもよい（例: `D:\work\voice-coder\.env`）。
環境変数があればそちらが優先。`.env` の値はこの拡張の中だけで使い、VS Code の環境変数（他の拡張と共有）には入れない。
テストとスクリプトはリポジトリ直下の `.env`（git 管理外）を自動で読む。

### 2. マイク

マイクは `@picovoice/pvrecorder-node`（Windows / macOS / Linux 用のビルド済みバイナリ同梱、Apache-2.0）で
16 kHz モノラルを直接録る。Python やコンパイラは要らない。

- 既定ではシステムの既定のマイクを使う。別のマイクはコマンド「Voice Coder: マイクを選ぶ」で選ぶ（設定 `voiceCoder.micDevice` に入る）。
- Windows で VB-CABLE などの仮想デバイスを「既定の録音デバイス」にしている場合は、ここで実際のマイクを選ぶ。
- macOS では初回に VS Code へのマイク許可を求められる。

| 設定 | 既定値 | 説明 |
|---|---|---|
| `voiceCoder.micDevice` | `null` | 入力デバイスの番号（「マイクを選ぶ」で設定）。`null` でシステムの既定 |
| `voiceCoder.envFile` | 空 | API キーを書いた `.env` のパス |
| `voiceCoder.agent` | `auto` | コマンドを実行する LLM。`auto`（Copilot が使えれば Copilot、無ければ OpenAI）、`copilot`、`openai`、`claude` |
| `voiceCoder.copilotModel` | 空 | Copilot のモデル（「Voice Coder: Copilot のモデルを選ぶ」で選ぶ）。空なら VS Code が最初に返すもの |
| `voiceCoder.model` | 空 | OpenAI / Claude のモデル名。空なら `openai` は `gpt-6.1-sol`、`claude` は `claude-opus-5-5` |
| `voiceCoder.intentReader` | `hybrid` | 発話から意図を読む方法。`hybrid`（キーワードで読めなければ jev）、`regex`、`jev`。比較は `docs/JEV.md` |
| `voiceCoder.claudeCodePath` | 空 | `claude` のときの Claude Code 実行ファイル。空なら SDK 同梱のもの、なければ PATH 上の `claude` |
| `voiceCoder.stopAfterUtterance` | `true` | 指示が確定したら自動で聞き取りを止める |
| `voiceCoder.languages` | `["ja", "en"]` | 音声認識の言語ヒント |
| `voiceCoder.messageLanguage` | `auto` | 表示の言語。`auto` は話した言語に合わせる（最初は日本語）、`ja` / `en` で固定 |
| `voiceCoder.replayWav` | 空 | 動作確認用: マイクの代わりにこの WAV（16 kHz モノラル）を実時間で流す |
| `voiceCoder.maxEndpointDelayMs` | `1000` | Soniox の発話終了判定の上限 |

`claude` を使うときは、Claude Code をインストールして PATH に通すか `voiceCoder.claudeCodePath` を設定する（`.vsix` には SDK 同梱の実行ファイルを入れていない）。

### 3. マイクを試す（VS Code なし）

拡張に入れる前に、ターミナルでマイク → Soniox → 意図 → LLM の流れを確かめられる。
Enter で話し始め、話し終えたら Enter で止める（push-to-talk と同じ）。q + Enter で終了。

```bash
npm run mic
```

- 画面に partial、先読みの発火、final、採用された意図、LLM の応答が順に出て、止めたあとに
  「発話終了から 意図発火 / final / 意図確定 / LLM 最初の文字」の時間が出る（発話終了は録音の音量から推定）。
- 対象コードは内蔵の 23 行のサンプル（14 行目に型エラー）。`--file path` で実ファイルにできる（generate は応答を表示するだけで書き込まない）。
- `--device N`（`--list-devices` で番号を確認。拡張の「マイクを選ぶ」と同じ番号）、`--reader regex|jev|hybrid`、`--agent openai|claude|off`、`--model`、
  `--save dir`（録音を WAV で保存）、`--wav file`（マイクの代わりに WAV を流す）。

### 4. キーバインド

| キー | コマンド |
|---|---|
| `Ctrl+Shift+Space` / `Cmd+Shift+Space` | `Voice Coder: 音声入力の開始/停止`（`voiceCoder.toggleListening`） |
| `Ctrl+Alt+Enter`（変更案があるとき） | `Voice Coder: 変更案を適用`（`voiceCoder.applyProposal`。差分表示の右上の ✓ ボタンでも同じ） |
| （なし） | `Voice Coder: 変更案を破棄`（`voiceCoder.discardProposal`。差分表示の右上のボタンでも同じ） |
| （なし） | `Voice Coder: マイクを選ぶ`（`voiceCoder.selectMicrophone`） |
| （なし） | `Voice Coder: Copilot のモデルを選ぶ`（`voiceCoder.selectCopilotModel`） |

変えるときは「キーボード ショートカット」で `voiceCoder.toggleListening` を探す。ステータスバー左のマイクアイコン「Voice」をクリックしても同じ。

## 開発

```bash
npm install
```
```bash
npm run build
```
```bash
npm test
```
```bash
npx vsce package
```

- `npm test` は vitest（意図パーサ、先読み制御、Soniox / OpenAI の音声認識プロトコル、マイク）のあと、`@vscode/test-electron` で
  VS Code を起動して `test/vscode/` を走らせる。初回は VS Code を `.vscode-test/` にダウンロードする。
- `OPENAI_API_KEY` があると VS Code のテストは実際の OpenAI を呼ぶ（1 回の `npm test` で 7 リクエスト程度）。
  キーが無いか `VOICE_CODER_MOCK_AGENT=1` のときは `AgentBackend` をモック（`src/agent/MockAgentBackend.ts`）に差し替える。
  音声認識はどちらの場合も、タイミングを決めて partial / final を流すスクリプトに差し替える。
- `SONIOX_API_KEY` があると `test/audio/` の 15 本を実時間で Soniox に流す統合テストも走る（無ければ skip）。
  `npm run latency` で `docs/LATENCY.md` を計測し直す。`TYPESAFE_API_KEY` もあると、同じ音声で jev による意図の読み取りも確かめる。
- `npm run demo`（`-- --lang en` で英語版）はデモ動画を `demo/` に作る（ffmpeg が必要。録画中の約 1 分半はキーボードとマウスに触れない）。
- 競合の調査結果は `docs/COMPETITORS.md`。
- `npm run stt:compare` は音声認識を Soniox と OpenAI（`gpt-live-transcribe` / `gpt-transcribe`、Codex のディクテーション相当）で
  比べ、`docs/STT_COMPARE.md` に書く（30 本、push-to-talk で発話終了 300 ms 後に離した扱い）。
- `npm run jev:compare` は正規表現 / jev / ハイブリッドを、キーワードありの 15 本と無しの 15 本（`test/audio/para_*.wav`）で比べ、`docs/JEV.md` に書く。
- `test/audio/` の WAV はコミット済み。作り直すのは `npm run gen:audio -- --force` を明示的に実行したときだけ。

## 構成

| パス | 内容 |
|---|---|
| `src/stt/` | `SttBackend`（start / onPartial / onFinal / stop）と Soniox 実装 |
| `src/audio/` | マイク（pvrecorder）、WAV の実時間再生、リサンプル |
| `src/intent/` | 意図パーサ（generate / explain / debug、行範囲）、jev による読み取り、先読み制御 |
| `src/agent/` | `AgentBackend`、OpenAI（Responses API）と Claude Agent SDK の実装、モック、プロンプト |
| `src/extension/` | VS Code 拡張（ステータスバー、push-to-talk、各アクション） |
