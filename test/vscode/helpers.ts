import * as vscode from "vscode";
import type { AgentBackend } from "../../src/agent/AgentBackend.js";
import { MockAgentBackend, type MockResponder } from "../../src/agent/MockAgentBackend.js";
import type { ActionReport } from "../../src/extension/actions.js";
import type { VoiceCoderApi } from "../../src/extension/extension.js";
import { SttEvents, type FinalTranscript, type SttBackend, type Transcript } from "../../src/stt/SttBackend.js";

export type Step = { partial: string; atMs: number } | { final: string; atMs: number };

/** Plays transcript events on a timeline, the way a streaming STT would. */
export class TimedScriptBackend implements SttBackend {
  private readonly events = new SttEvents();
  private timers: NodeJS.Timeout[] = [];
  private lastFinalOut: Promise<void> = Promise.resolve();
  private onLastFinal: () => void = () => {};

  constructor(private readonly script: Step[]) {}

  onPartial(listener: (partial: Transcript) => void): void {
    this.events.onPartial(listener);
  }

  onFinal(listener: (final: FinalTranscript) => void): void {
    this.events.onFinal(listener);
  }

  async start(): Promise<void> {
    const finals = this.script.filter((s) => "final" in s);
    const lastFinal = finals.at(-1);
    this.lastFinalOut = new Promise((resolve) => (this.onLastFinal = resolve));
    if (!lastFinal) this.onLastFinal();
    for (const step of this.script) {
      this.timers.push(
        setTimeout(() => {
          if ("partial" in step) this.events.emitPartial({ text: step.partial, atMs: step.atMs });
          else this.events.emitFinal({ text: step.final, atMs: step.atMs });
          if (step === lastFinal) this.onLastFinal();
        }, step.atMs),
      );
    }
  }

  /** Like a real backend, stop() returns once the last final is out; steps after it are dropped. */
  async stop(): Promise<void> {
    await this.lastFinalOut;
    this.timers.forEach(clearTimeout);
  }
}

export async function getApi(): Promise<VoiceCoderApi> {
  const extension = vscode.extensions.getExtension<VoiceCoderApi>("tsekino62.voice-coder");
  if (!extension) throw new Error("extension tsekino62.voice-coder not found");
  return extension.activate();
}

/**
 * The agent for a test: the extension's default (OpenAI) when OPENAI_API_KEY is
 * set, otherwise a mock that streams `responder`'s canned reply.
 * VOICE_CODER_MOCK_AGENT=1 forces the mock (no API spend).
 */
export function agentFor(responder?: MockResponder, chunkDelayMs = 10): { agent: AgentBackend | undefined; mock: MockAgentBackend | undefined } {
  if (usingRealAgent()) return { agent: undefined, mock: undefined };
  const mock = new MockAgentBackend(responder, 16, chunkDelayMs);
  return { agent: mock, mock };
}

export function usingRealAgent(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.VOICE_CODER_MOCK_AGENT !== "1";
}

export async function openDocument(content: string, language = "typescript"): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(document);
}

export function nextReport(api: VoiceCoderApi, timeoutMs = 50_000): Promise<ActionReport> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose();
      reject(new Error(`no action report (status: ${api.statusBarItem.text}, listening: ${api.listening}, idle: ${api.idle})`));
    }, timeoutMs);
    const listener = api.onActionDone((report) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(report);
    });
  });
}

/** Press push-to-talk, let the script play, release, and wait for the command to finish. */
export async function speak(api: VoiceCoderApi, script: Step[]): Promise<ActionReport> {
  api.setSttFactory(() => new TimedScriptBackend(script));
  const report = nextReport(api);
  await vscode.commands.executeCommand("voiceCoder.toggleListening");
  await releaseKey(api);
  return report;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Press the key again, unless the extension already stopped listening by itself. */
export async function releaseKey(api: VoiceCoderApi): Promise<void> {
  if (api.listening) await vscode.commands.executeCommand("voiceCoder.toggleListening");
}

/**
 * Wait until the extension has finished everything a test started, so a late
 * report (a trailing fragment of an utterance, a slow agent) never lands in the next test.
 */
export async function settle(api: VoiceCoderApi, timeoutMs = 30_000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    if (api.idle) {
      await sleep(100);
      if (api.idle) return;
    }
    await sleep(50);
  }
}

export function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n";
}
