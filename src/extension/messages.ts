import type { Language } from "../intent/language.js";

/**
 * What the extension says, in Japanese and English. Messages follow the language
 * of the last spoken command (voiceCoder.messageLanguage "auto"), or a fixed one.
 */
const MESSAGES = {
  idleTooltip: { ja: "Voice Coder: クリックかキーで音声入力を開始", en: "Voice Coder: click or press the key to start speaking" },
  listening: { ja: "聞いています…", en: "Listening…" },
  listeningTooltip: { ja: "Voice Coder: もう一度押すと停止", en: "Voice Coder: press again to stop" },
  finishingTooltip: { ja: "Voice Coder: 確定待ち", en: "Voice Coder: finishing" },
  runningTooltip: { ja: "Voice Coder: 実行中", en: "Voice Coder: working" },
  noCommand: { ja: "コマンドを読み取れませんでした: {0}", en: "No command recognized: {0}" },
  openFileFirst: { ja: "対象のファイルを開いてから話してください", en: "Open the file to work on, then speak" },
  agentFailed: { ja: "{0} に失敗しました: {1}", en: "{0} failed: {1}" },
  agentFailedShort: { ja: "エージェントが失敗しました", en: "The agent failed" },
  shownInOutput: { ja: "{0}: 出力に表示しました", en: "{0}: shown in Output" },
  inserted: { ja: "{0}: 挿入しました", en: "{0}: inserted" },
  insertFailed: { ja: "{0}: 挿入できませんでした", en: "{0}: could not insert" },
  noFix: { ja: "{0}: 修正案はありません", en: "{0}: no fix to propose" },
  fixTitle: { ja: "修正案（未適用）: {0}", en: "proposed fix (not applied): {0}" },
  newFileWritten: { ja: "{0}: 新しいファイル（{1}、未保存）に書きました", en: "{0}: written to a new file ({1}, unsaved)" },
  noProposal: { ja: "{0}: 変更案がありませんでした", en: "{0}: no changes were proposed" },
  needFolder: { ja: "{0}: ファイルを作るにはフォルダー（ワークスペース）を開いてください", en: "{0}: open a folder (workspace) to create files" },
  outsideWorkspace: { ja: "{0}: ワークスペースの外を指すパスがあったので中止しました（{1}）", en: "{0}: stopped, a path points outside the workspace ({1})" },
  noChanges: { ja: "{0}: 変更はありませんでした", en: "{0}: nothing to change" },
  changesTitle: { ja: "変更案（未適用）: {0}", en: "proposed changes (not applied): {0}" },
  newEntry: { ja: "新規 {0}", en: "new {0}" },
  changedEntry: { ja: "変更 {0}", en: "change {0}" },
  listSeparator: { ja: "、", en: ", " },
  proposalShown: { ja: "{0}: {1} ファイルの変更案を表示しました（未適用）", en: "{0}: proposed changes to {1} file(s) (not applied)" },
  applyQuestion: { ja: "Voice Coder: 適用しますか？ {0}", en: "Voice Coder: apply? {0}" },
  apply: { ja: "適用", en: "Apply" },
  discard: { ja: "破棄", en: "Discard" },
  nothingPending: { ja: "Voice Coder: 適用待ちの変更案はありません", en: "Voice Coder: no proposal is waiting" },
  changedSince: { ja: "Voice Coder: 変更案の作成後に {0} が変わったので適用しません", en: "Voice Coder: {0} changed after the proposal was made; not applied" },
  testsNeedFolder: { ja: "テストを実行するにはフォルダー（ワークスペース）を開いてください", en: "Open a folder (workspace) to run its tests" },
  testsUnknown: {
    ja: "このプロジェクトのテストの実行方法が分かりませんでした（npm test / pytest / go test / cargo test に対応）",
    en: "Could not tell how to run this project's tests (npm test / pytest / go test / cargo test)",
  },
  runOpenFile: { ja: "実行するファイルを開いてから話してください", en: "Open the file to run, then speak" },
  runSaveFirst: { ja: "実行する前にファイルを保存してください", en: "Save the file before running it" },
  runUnknownLanguage: { ja: "{0} のファイルの実行方法が分かりません", en: "Don't know how to run a {0} file" },
  saveFailed: { ja: "ファイルを保存できませんでした", en: "Could not save the file" },
  micHint: { ja: "。コマンド「Voice Coder: マイクを選ぶ」で別のマイクを選べます", en: ". Pick another one with \"Voice Coder: Select Microphone\"" },
  keyMissing: {
    ja: "{0} がありません（環境変数か、設定 voiceCoder.envFile で指す .env に書く）",
    en: "{0} is missing (set it in the environment or in the .env that voiceCoder.envFile points to)",
  },
  jevMissing: {
    ja: "Voice Coder: TYPESAFE_API_KEY が無いので jev を使わず正規表現で意図を読みます",
    en: "Voice Coder: no TYPESAFE_API_KEY, so commands are read with keywords instead of jev",
  },
  micDefault: { ja: "システムの既定のマイク", en: "System default microphone" },
  micInUse: { ja: "使用中", en: "in use" },
  micPlaceholder: { ja: "音声入力に使うマイク", en: "Microphone for voice input" },
  micSet: { ja: "Voice Coder: マイクを「{0}」にしました", en: "Voice Coder: microphone set to \"{0}\"" },
} satisfies Record<string, Record<Language, string>>;

export type MessageKey = keyof typeof MESSAGES;

let spoken: Language = "ja";
let fixed: Language | undefined;

/** "auto": follow the last command's language; "ja" / "en": always that one. */
export function setMessageLanguageSetting(setting: string | undefined): void {
  fixed = setting === "ja" || setting === "en" ? setting : undefined;
}

/** The language of the command just spoken (used while the setting is "auto"). */
export function noteSpokenLanguage(language: Language): void {
  spoken = language;
}

export function messageLanguage(): Language {
  return fixed ?? spoken;
}

/** A message in the current language, with {0}, {1}, ... filled in. */
export function t(key: MessageKey, ...args: Array<string | number>): string {
  return MESSAGES[key][messageLanguage()].replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ""));
}
