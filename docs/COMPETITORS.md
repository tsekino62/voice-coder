# 音声コーディングの競合調査（2026-10-03）

VS Code 向けの音声コーディング拡張と、その周辺ツールを調べた。
Marketplace のインストール数と最終更新日は、2026-10-03 に Marketplace の公開 API で取得した値。
【未確認】は公式の情報で裏付けられなかった項目、【二次情報】は第三者の記事だけが出典の項目。

## 比較表

| 製品 | 形態 | 音声の使い方 | 音声認識 | 日本語 | 話し終わる前に動くか | 価格 | 規模・状態 |
|---|---|---|---|---|---|---|---|
| **Voice Coder（この拡張）** | VS Code 拡張 | 意図を読み、生成・説明・デバッグ・リファクタ・ファイル作成・実行に振り分ける。変更は差分で承認 | Soniox、クラウド、ストリーミング | ◎（主な対象） | **◎ 途中結果で LLM を動かし始める（先読み）** | 未定 | 開発中 |
| VS Code 組み込みディクテーション＋Voice Mode | VS Code 本体（1.131〜1.132） | チャット・エディタ・ターミナルへの音声入力と、エージェントとの音声会話 | Nemotron 3.5、端末内、ストリーミング | ○（モデルは ja-JP 対応。VS Code での実用性は【未確認】） | 記載なし | 無料（Voice Mode は Copilot の個人プラン） | 活発 |
| VS Code Speech（ms-vscode.vscode-speech） | 拡張 | ディクテーション、「Hey Code」、読み上げ | 端末内 | ○（言語パック） | × | 無料 | 約 144 万インストール |
| Claude Code /voice | CLI＋VS Code 拡張 | プロンプトのディクテーション | Anthropic のクラウド、ストリーミング | ○（20 言語に日本語を含む） | ×（キーを離すか自動送信で送る） | Claude のプラン（文字起こしは利用枠を消費しない） | 活発。claude.ai ログインが必須で API キーでは使えない |
| Codex（CLI・Codex Audio 拡張・アプリ） | CLI／拡張／アプリ | ディクテーションと、リアルタイムの音声会話【二次情報】 | OpenAI（詳細は【未確認】） | 【未確認】 | 音声会話は全二重【二次情報】 | ChatGPT のプラン | Codex Audio は約 55 万インストール、評価 1.5/5 |
| Cursor | 独立した IDE | Agent へのディクテーション、送信用キーワード | 3.1 で「録音後に一括認識」に変更 | 【未確認】 | × | Cursor のプラン | 活発 |
| Windsurf | 独立した IDE | Cascade へのディクテーション | 【未確認】 | 【未確認】 | × | Windsurf のプラン | 活発 |
| Cline | 拡張 | ディクテーション | Cline のサービス、録音後に一括 | 【未確認】 | × | 不明 | 活発 |
| Talon＋Cursorless | アプリ＋拡張 | エディタ操作と構造的な編集のコマンド | 端末内（Conformer） | ×（英語前提） | コマンドは即時実行（LLM なし） | 無料／Talon+ | Talon 1.0（2026-09）、Cursorless 約 7,600 インストール |
| Serenade | アプリ＋拡張 | コマンド | 独自 | × | — | 無料（OSS） | 開発停止（拡張の更新は 2022 年が最後） |
| Wispr Flow／Aqua Voice／Superwhisper／Spokenly | OS 全体のアプリ | 汎用ディクテーション（どのアプリにも文字を入れる） | クラウドまたは端末内 | Aqua は ○、他は【未確認】 | × | 無料枠＋月 $8〜15 程度 | 活発 |
| Ceres（pa-andreas.skia-ai-sidebar） | 拡張 | ディクテーションと、音声でのコード変更（Pro） | 【未確認】 | 【未確認】 | 【未確認】 | 無料＋Pro | 約 2,600 インストール |
| Launchpad（NascentPoly） | 拡張 | 意図を読んで VS Code のコマンドを実行（LLM なし） | VS Code Speech | 【未確認】 | × | 無料 | インストール数 8 |

ほかに、Marketplace には「録音して Whisper 系で文字にし、チャット欄に貼る」小規模な拡張が多数ある（Claude Voice 約 4,300、Voice to Copilot 約 800 など）。Soniox を使うもの（vvoice、voice-input）も 2 つあった。
日本語に特化した音声コーディングツールは見つからなかった。日本語の記事は「既存ツールを日本語に設定して使う」ものがほとんど。

## Voice Coder が差別化できる点

1. **途中結果からの先読み**：途中の書き起こしから意図を読み、LLM を話し終わる前に動かし始める製品は見つからなかった。Cursor は逆に「録音後に一括認識」へ移り、Claude Code は途中結果を表示するが送るのは確定後。話し終わりから約 0.1 秒で意図を判断し、約 1.5 秒で LLM の最初の文字が出る、という実測値は明確な訴求点になる。
2. **意図に応じた動作の振り分け**：ほとんどの競合は「チャット欄に文字を入れる」だけ。Voice Coder は、生成（直接挿入、1 回で元に戻せる）、デバッグ・リファクタ（差分を承認）、実行（ターミナル）と、意図ごとに処理を分ける。近い発想は Ceres（Pro）と Launchpad だが、どちらも規模が小さい。
3. **日本語を第一に設計**：日本語を主な対象にした音声コーディング拡張は見つからなかった。日本語の意図判定（正規表現＋Jev）も独自。
4. **LLM を選べる**：OpenAI と Claude Agent SDK を選べる。Claude Code の /voice は claude.ai ログインが必須で API キーでは使えないので、API キーで使いたい人の受け皿になれる。

## 競合が強い点

1. **端末内で動く無料の音声認識**：VS Code 組み込み（Nemotron）、VS Code Speech、Copilot CLI、Talon は端末内で無料。Soniox はクラウドの従量課金なので、プライバシーと費用の面で不利。
2. **VS Code 本体への統合と配布力**：組み込みディクテーションはインストール不要で既定で有効。エディタとターミナルにも対応し、Voice Mode は音声会話とハンズフリーまで備える。
3. **エディタ操作の成熟度**：選択や移動などの細かい操作は Talon＋Cursorless が圧倒的。
4. **エージェントの能力**：Claude Code、Codex、Copilot のエージェントは、複数ファイルの編集、ツール実行、文脈の収集で先行している。
5. **普及規模**：VS Code Speech は約 144 万、Codex Audio は約 55 万インストール。

## リスク・課題

1. **VS Code 本体に取り込まれるリスク**：組み込みディクテーションは 2026 年 7〜8 月に強化され、途中結果の表示、日本語対応モデル、ハンズフリーがそろった。Microsoft が「途中結果でエージェントを先に動かす」機能を足せば、主な差別化点がなくなる。
2. **ショートカットの衝突**：**Ctrl+Alt+V は VS Code 標準の「Voice: Start Dictation in Editor」（組み込み、既定で有効）と、Claude Voice 拡張にも割り当てられている。**最初に使ったときに、不具合と受け取られるおそれがある。→ 2026-10-03 に Voice Coder のキーを `Ctrl+Shift+Space` に変更した（こちらは VS Code の「パラメーターヒントを表示」と Voice Mode に割り当てられているので、拡張を入れている間はそれらをこのキーで呼べない）。
3. **音声認識の費用と導入の手間**：Soniox の課金と API キーの設定が必要。無料で端末内処理の競合と比べ、導入の障壁が高い。オフライン環境や社外秘コードの職場では使えない可能性がある。
4. **先読みの外れ**：外れたら中断するが、LLM のトークンは消費される。直接挿入する「生成」で誤った意図が通ると、信頼を損なう。意図の正解率と中断率を示す必要がある。
5. **エージェント能力の差**：独自に LLM を呼ぶ構成では、複雑な作業で既存のエージェントに見劣りする可能性がある。読み取った意図付きで、既存のエージェント（Claude Code / Copilot Chat）に渡すモードも検討の余地がある。

## 最も直接的な競合

1. **VS Code 組み込みディクテーション＋Copilot Voice Mode**：同じ場所で、日本語対応のモデルを無料で提供している。
2. **Claude Code の音声ディクテーション（VS Code 拡張）**：日本語に対応し、途中結果を表示し、そのままエージェントに渡せる。
3. **Codex（Codex Audio 拡張と音声会話）**：約 55 万インストール。OpenAI を既定の LLM にしている Voice Coder と利用者が重なる。
4. **Ceres と Launchpad**：規模は小さいが、「意図に応じて実行する」という設計が最も近い。

Talon/Cursorless や Wispr/Aqua 系のアプリは別のカテゴリー（エディタ操作、汎用ディクテーション）で、併用される補完的な存在。

## 出典

- https://code.visualstudio.com/docs/configure/accessibility/voice
- https://raw.githubusercontent.com/microsoft/vscode-docs/main/release-notes/v1_132.md
- https://code.visualstudio.com/updates/v1_87
- https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- https://marketplace.visualstudio.com/items?itemName=ms-vscode.vscode-speech
- https://visualstudiomagazine.com/Articles/2024/03/04/copilot-voice.aspx
- https://visualstudiomagazine.com/articles/2026/07/29/vs-code-1-131-adds-built-in-dictation-hybrid-markdown-editing-and-subagent-status.aspx
- https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input
- https://code.claude.com/docs/en/voice-dictation
- https://github.com/openai/codex/releases/tag/rust-v0.105.0
- https://marketplace.visualstudio.com/items?itemName=openai.codex-audio
- https://learn.chatgpt.com/docs/changelog
- https://codex.danielvaughan.com/2026/08/04/voice-driven-development-codex-cli-gpt-live-full-duplex-push-to-talk-realtime-v3/
- https://cursor.com/changelog/2-0
- https://cursor.com/changelog/3-1
- https://docs.devin.ai/windsurf/plugins/cascade/cascade-overview
- https://docs.cline.bot/features/dictation
- https://docs.roocode.com/features/more-features
- https://talonvoice.com/
- https://talonvoice.com/dl/latest/changelog.html
- https://marketplace.visualstudio.com/items?itemName=pokey.cursorless
- https://github.com/cursorless-dev/cursorless
- https://github.com/serenadeai/serenade
- https://wisprflow.ai/pricing
- https://superwhisper.com/
- https://aquavoice.com/ja
- https://spokenly.app/
- https://www.getvoibe.com/resources/voicedash-pricing/
- https://support.microsoft.com/en-us/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc-fec94565-c4bd-329d-e59a-af033fa5689f
- https://marketplace.visualstudio.com/items?itemName=jsaluja.claude-voice
- https://marketplace.visualstudio.com/items?itemName=pa-andreas.skia-ai-sidebar
- https://marketplace.visualstudio.com/items?itemName=aleaf.voice-to-text-copilot
- https://marketplace.visualstudio.com/items?itemName=NascentPoly.launchpad-command-palette
- https://atmarkit.itmedia.co.jp/ait/articles/2403/19/news086.html
- https://zenn.dev/sigma_tom/articles/c13edd1eb57832
- https://smhn.info/202603-claude-code-voice-mode
- https://smartscope.blog/generative-ai/claude/claude-code-voice-japanese-setup/
