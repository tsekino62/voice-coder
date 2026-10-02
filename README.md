# Voice Coder

日本語の音声で「FizzBuzz を作って」「10 行目から 20 行目を解説して」「デバッグして」と指示する VS Code 拡張。

```
マイク ─▶ Python サイドカー ─stdio JSONL─▶ SttBackend (Soniox) ─partial/final─▶ IntentSpeculator ─▶ AgentBackend (Claude Agent SDK)
                                                       │                                               │
                                                  ステータスバー                         final で確定した結果だけをエディタへ
```

- **push-to-talk**: `Ctrl+Alt+V`（macOS は `Cmd+Alt+V`）で聞き始め、もう一度押すと止める。常時待ち受けはしない。
- **先読み**: partial に意図語が出た時点でエージェントを動かし始める。final で意図が食い違えば `AbortSignal` で止め、
  final の意図でやり直す。エディタに書き込むのは final で確定した結果だけなので、止めた実行は何も残さない。
- **explain**: 出力パネル「Voice Coder」に説明を流す。ドキュメントは変えない。
- **generate**: カーソル位置に 1 回の `WorkspaceEdit` で挿入する。`Ctrl+Z` 1 回で元に戻る。
- **debug**: 対象範囲のエラー（`getDiagnostics`）とコードから修正案を作り、diff で表示する。
  「適用」を押すか `Voice Coder: 修正案を適用` を実行するまで書き込まない。

## セットアップ

### 1. 環境変数

VS Code は起動したときの環境変数を引き継ぐ。設定してから VS Code を起動し直すこと（ターミナルから `code .` で起動するのが確実）。

| 変数 | 用途 | 必須 |
|---|---|---|
| `SONIOX_API_KEY` | 音声認識（Soniox `stt-rt-v5`） | はい |
| `ANTHROPIC_API_KEY` | Claude Agent SDK。未設定なら Claude Code にログイン済みの認証を使う | どちらか |
| `ELEVENLABS_API_KEY` | テスト音声の再生成（`npm run gen:audio`）だけで使う | いいえ |

Windows で恒久的に設定する例:

```powershell
setx SONIOX_API_KEY "..."
setx ANTHROPIC_API_KEY "..."
```

開発時はリポジトリ直下の `.env`（git 管理外）にも書ける。`.env` を読むのはテストとスクリプトだけで、拡張本体は読まない。

### 2. Python サイドカー（マイク）

マイク入力は `python/mic_sidecar.py` が PyAudio で 16 kHz モノラルを録り、stdout に JSON Lines で流す
（stt_probe/record_takes.py と同じ録音方法）。拡張が聞き始めるときに自動で起動し、止めるときに `{"cmd":"stop"}` を送る。

```bash
pip install pyaudio
```
```bash
python python/mic_sidecar.py --list-devices
```

単体で動作を見るとき（1 行 1 JSON が流れる。`{"cmd":"stop"}` を入力するか標準入力を閉じる（Windows は Ctrl+Z → Enter）と止まる）:

```bash
python python/mic_sidecar.py --device 1
```

VS Code の設定:

| 設定 | 既定値 | 説明 |
|---|---|---|
| `voiceCoder.pythonPath` | `python` | PyAudio が入った Python（例: `D:\work\stt_probe\.venv\Scripts\python.exe`） |
| `voiceCoder.micDevice` | `null` | `--list-devices` で出た入力デバイス番号。`null` で既定のデバイス |
| `voiceCoder.model` | `claude-opus-5-5` | Claude Agent SDK に渡すモデル |
| `voiceCoder.claudeCodePath` | 空 | Claude Code の実行ファイル。空なら SDK 同梱のもの、なければ PATH 上の `claude` |
| `voiceCoder.maxEndpointDelayMs` | `1000` | Soniox の発話終了判定の上限 |

`.vsix` には SDK 同梱の Claude Code 実行ファイル（Windows で 238 MB）を入れていない。
`.vsix` からインストールした場合は Claude Code をインストールして PATH に通すか、`voiceCoder.claudeCodePath` を設定する。

### 3. キーバインド

| キー | コマンド |
|---|---|
| `Ctrl+Alt+V` / `Cmd+Alt+V` | `Voice Coder: 音声入力の開始/停止`（`voiceCoder.toggleListening`） |
| （なし） | `Voice Coder: 修正案を適用`（`voiceCoder.applyProposal`） |
| （なし） | `Voice Coder: 修正案を破棄`（`voiceCoder.discardProposal`） |

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

- `npm test` は vitest（意図パーサ、先読み制御、Soniox プロトコル、サイドカー）のあと、`@vscode/test-electron` で
  VS Code を起動して `test/vscode/` を走らせる。初回は VS Code を `.vscode-test/` にダウンロードする。
- `ANTHROPIC_API_KEY` が無いと、VS Code のテストは `AgentBackend` をモック（`src/agent/MockAgentBackend.ts`）に差し替える。
  音声認識はどちらの場合も、タイミングを決めて partial / final を流すスクリプトに差し替える。
- `SONIOX_API_KEY` があると `test/audio/` の 15 本を実時間で Soniox に流す統合テストも走る（無ければ skip）。
  `npm run latency` で `docs/LATENCY.md` を計測し直す。
- `test/audio/` の WAV はコミット済み。作り直すのは `npm run gen:audio -- --force` を明示的に実行したときだけ。

## 構成

| パス | 内容 |
|---|---|
| `src/stt/` | `SttBackend`（start / onPartial / onFinal / stop）と Soniox 実装 |
| `src/audio/` | WAV、実時間再生、Python サイドカーからの音声 |
| `src/intent/` | 意図パーサ（generate / explain / debug、行範囲）と先読み制御 |
| `src/agent/` | `AgentBackend`、Claude Agent SDK 実装、モック、プロンプト |
| `src/extension/` | VS Code 拡張（ステータスバー、push-to-talk、各アクション） |
| `python/mic_sidecar.py` | マイクのサイドカー |
