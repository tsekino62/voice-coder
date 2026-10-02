import * as vscode from "vscode";
import type { AgentBackend } from "../agent/AgentBackend.js";
import { ClaudeAgentBackend } from "../agent/ClaudeAgentBackend.js";
import { findClaudeExecutable } from "../agent/claudeExecutable.js";
import { SidecarAudioSource } from "../audio/sidecar.js";
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
    model: c.get<string>("model") || "claude-opus-5-5",
    claudeCodePath: c.get<string>("claudeCodePath") || "",
    maxEndpointDelayMs: c.get<number>("maxEndpointDelayMs") ?? 1000,
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
    return new ClaudeAgentBackend({
      model: c.model,
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
  const controller = new VoiceController(() => (sttFactory ?? defaultStt)(), actions, status);

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
