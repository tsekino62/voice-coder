import * as vscode from "vscode";
import type { AgentBackend } from "../agent/AgentBackend.js";
import { ClaudeAgentBackend } from "../agent/ClaudeAgentBackend.js";
import { findClaudeExecutable } from "../agent/claudeExecutable.js";
import { DEFAULT_OPENAI_MODEL, OpenAIAgentBackend } from "../agent/OpenAIAgentBackend.js";
import { SidecarAudioSource } from "../audio/sidecar.js";
import { JevIntentReader } from "../intent/jev.js";
import { parseIntent } from "../intent/parser.js";
import type { IntentReader } from "../intent/speculator.js";
import { SonioxBackend } from "../stt/SonioxBackend.js";
import type { SttBackend } from "../stt/SttBackend.js";
import { ActionRunner, type ActionReport, type Proposal } from "./actions.js";
import { VoiceController } from "./controller.js";
import { StatusView } from "./status.js";

/** Returned from activate(); the integration tests swap backends through it. */
export interface VoiceCoderApi {
  readonly statusBarItem: vscode.StatusBarItem;
  readonly onStatus: vscode.Event<string>;
  readonly onActionDone: vscode.Event<ActionReport>;
  readonly listening: boolean;
  pendingProposal(): Proposal | undefined;
  setSttFactory(factory: (() => SttBackend) | undefined): void;
  setAgentBackend(agent: AgentBackend | undefined): void;
}

function config() {
  const c = vscode.workspace.getConfiguration("voiceCoder");
  return {
    pythonPath: c.get<string>("pythonPath") || "python",
    micDevice: c.get<number | null>("micDevice") ?? null,
    agent: c.get<"openai" | "claude">("agent") ?? "openai",
    model: c.get<string>("model") || "",
    claudeCodePath: c.get<string>("claudeCodePath") || "",
    maxEndpointDelayMs: c.get<number>("maxEndpointDelayMs") ?? 1000,
    intentReader: c.get<"regex" | "jev">("intentReader") ?? "regex",
  };
}

export function activate(context: vscode.ExtensionContext): VoiceCoderApi {
  let sttFactory: (() => SttBackend) | undefined;
  let agentOverride: AgentBackend | undefined;

  const defaultStt = (): SttBackend => {
    const apiKey = process.env.SONIOX_API_KEY;
    if (!apiKey) throw new Error("環境変数 SONIOX_API_KEY が設定されていません");
    const c = config();
    const source = new SidecarAudioSource({
      python: c.pythonPath,
      script: context.asAbsolutePath("python/mic_sidecar.py"),
      args: c.micDevice === null ? [] : ["--device", String(c.micDevice)],
    });
    return new SonioxBackend(source, { apiKey, maxEndpointDelayMs: c.maxEndpointDelayMs });
  };
  const agent = (): AgentBackend => {
    if (agentOverride) return agentOverride;
    const c = config();
    if (c.agent === "openai") {
      if (!process.env.OPENAI_API_KEY) throw new Error("環境変数 OPENAI_API_KEY が設定されていません");
      return new OpenAIAgentBackend({ model: c.model || DEFAULT_OPENAI_MODEL });
    }
    return new ClaudeAgentBackend({
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
  let jev: JevIntentReader | undefined;
  const reader = (): IntentReader => {
    if (config().intentReader !== "jev") return parseIntent;
    if (!process.env.TYPESAFE_API_KEY) {
      void vscode.window.showWarningMessage("Voice Coder: TYPESAFE_API_KEY が無いので jev を使わず正規表現で意図を読みます");
      return parseIntent;
    }
    jev ??= new JevIntentReader();
    return jev.read;
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
  );

  return {
    statusBarItem: status.item,
    onStatus: status.onDidChange,
    onActionDone: actions.onDidReport,
    get listening() {
      return controller.listening;
    },
    pendingProposal: () => actions.pendingProposal,
    setSttFactory: (factory) => (sttFactory = factory),
    setAgentBackend: (backend) => (agentOverride = backend),
  };
}

export function deactivate(): void {}
