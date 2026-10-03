import * as vscode from "vscode";
import type { AgentBackend } from "../agent/AgentBackend.js";
import { ClaudeAgentBackend } from "../agent/ClaudeAgentBackend.js";
import { findClaudeExecutable } from "../agent/claudeExecutable.js";
import { DEFAULT_OPENAI_MODEL, OpenAIAgentBackend } from "../agent/OpenAIAgentBackend.js";
import { MicrophoneSource, microphoneDevices } from "../audio/microphone.js";
import { WavFileSource } from "../audio/source.js";
import { hybridReader } from "../intent/hybrid.js";
import { JevIntentReader } from "../intent/jev.js";
import { parseIntent } from "../intent/parser.js";
import type { IntentReader } from "../intent/speculator.js";
import { SonioxBackend } from "../stt/SonioxBackend.js";
import type { SttBackend } from "../stt/SttBackend.js";
import { ActionRunner, type ActionReport, type Proposal } from "./actions.js";
import { VoiceController } from "./controller.js";
import { readKeys, type KeyName } from "./keys.js";
import { StatusView } from "./status.js";

/** Returned from activate(); the integration tests swap backends through it. */
export interface VoiceCoderApi {
  readonly statusBarItem: vscode.StatusBarItem;
  readonly onStatus: vscode.Event<string>;
  readonly onActionDone: vscode.Event<ActionReport>;
  readonly listening: boolean;
  /** Not listening and no command in progress. */
  readonly idle: boolean;
  pendingProposal(): Proposal | undefined;
  setSttFactory(factory: (() => SttBackend) | undefined): void;
  setAgentBackend(agent: AgentBackend | undefined): void;
}

function config() {
  const c = vscode.workspace.getConfiguration("voiceCoder");
  return {
    micDevice: c.get<number | null>("micDevice") ?? null,
    agent: c.get<"openai" | "claude">("agent") ?? "openai",
    model: c.get<string>("model") || "",
    claudeCodePath: c.get<string>("claudeCodePath") || "",
    maxEndpointDelayMs: c.get<number>("maxEndpointDelayMs") ?? 1000,
    intentReader: c.get<"regex" | "jev" | "hybrid">("intentReader") ?? "hybrid",
    envFile: c.get<string>("envFile") || "",
    replayWav: c.get<string>("replayWav") || "",
  };
}

export function activate(context: vscode.ExtensionContext): VoiceCoderApi {
  let sttFactory: (() => SttBackend) | undefined;
  let agentOverride: AgentBackend | undefined;
  // Read on every use, so editing the .env or the setting takes effect without a reload
  const keys = () => readKeys(config().envFile, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const required = (name: KeyName): string => {
    const value = keys()[name];
    if (!value) throw new Error(`${name} がありません（環境変数か、設定 voiceCoder.envFile で指す .env に書く）`);
    return value;
  };

  const defaultStt = (): SttBackend => {
    const apiKey = required("SONIOX_API_KEY");
    const c = config();
    // replayWav: a file instead of the mic, for trying the pipeline without speaking
    const source = c.replayWav ? new WavFileSource(c.replayWav, 3) : new MicrophoneSource({ deviceIndex: c.micDevice ?? -1 });
    return new SonioxBackend(source, { apiKey, maxEndpointDelayMs: c.maxEndpointDelayMs });
  };
  const agent = (): AgentBackend => {
    if (agentOverride) return agentOverride;
    const c = config();
    if (c.agent === "openai") {
      return new OpenAIAgentBackend({ apiKey: required("OPENAI_API_KEY"), model: c.model || DEFAULT_OPENAI_MODEL });
    }
    return new ClaudeAgentBackend({
      apiKey: keys().ANTHROPIC_API_KEY,
      model: c.model || "claude-opus-5-5",
      pathToClaudeCodeExecutable: findClaudeExecutable(c.claudeCodePath),
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  };

  const status = new StatusView();
  const output = vscode.window.createOutputChannel("Voice Coder");
  const actions = new ActionRunner(agent, output, (state, label) => {
    if (state === "running") status.running(label);
    else if (state === "done") status.done(label);
    else status.error(label);
  });
  const jevByKey = new Map<string, JevIntentReader>();
  const reader = (): IntentReader => {
    const mode = config().intentReader;
    if (mode === "regex") return parseIntent;
    const apiKey = keys().TYPESAFE_API_KEY;
    if (!apiKey) {
      // hybrid quietly degrades to keywords; an explicit jev choice deserves a word
      if (mode === "jev") void vscode.window.showWarningMessage("Voice Coder: TYPESAFE_API_KEY が無いので jev を使わず正規表現で意図を読みます");
      return parseIntent;
    }
    let jev = jevByKey.get(apiKey);
    if (!jev) jevByKey.set(apiKey, (jev = new JevIntentReader({ apiKey })));
    return mode === "jev" ? jev.read : hybridReader(jev.read);
  };
  const controller = new VoiceController(() => (sttFactory ?? defaultStt)(), actions, status, reader);

  context.subscriptions.push(
    status,
    output,
    actions,
    controller,
    vscode.commands.registerCommand("voiceCoder.toggleListening", () => controller.toggle()),
    vscode.commands.registerCommand("voiceCoder.applyProposal", () => actions.applyProposal()),
    vscode.commands.registerCommand("voiceCoder.discardProposal", () => actions.discardProposal()),
    vscode.commands.registerCommand("voiceCoder.selectMicrophone", selectMicrophone),
  );

  return {
    statusBarItem: status.item,
    onStatus: status.onDidChange,
    onActionDone: actions.onDidReport,
    get listening() {
      return controller.listening;
    },
    get idle() {
      return !controller.listening && actions.idle;
    },
    pendingProposal: () => actions.pendingProposal,
    setSttFactory: (factory) => (sttFactory = factory),
    setAgentBackend: (backend) => (agentOverride = backend),
  };
}

/** Pick the input device from the ones the recorder sees; stored in voiceCoder.micDevice. */
async function selectMicrophone(): Promise<void> {
  let devices: string[];
  try {
    devices = await microphoneDevices();
  } catch (error) {
    void vscode.window.showErrorMessage(`Voice Coder: ${(error as Error).message}`);
    return;
  }
  const current = vscode.workspace.getConfiguration("voiceCoder").get<number | null>("micDevice") ?? null;
  const items = [
    { label: "システムの既定のマイク", index: null as number | null },
    ...devices.map((name, index) => ({ label: name, index: index as number | null })),
  ].map((item) => ({ ...item, description: item.index === current ? "使用中" : undefined }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: "音声入力に使うマイク" });
  if (!picked) return;
  await vscode.workspace.getConfiguration("voiceCoder").update("micDevice", picked.index, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`Voice Coder: マイクを「${picked.label}」にしました`);
}

export function deactivate(): void {}
