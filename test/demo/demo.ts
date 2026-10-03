// The demo video's script, run inside the VS Code that scripts/demo/record_demo.ts records.
// Each scene plays a test recording in place of the microphone (voiceCoder.replayWav) through
// the real pipeline: Soniox → intent reading → OpenAI → the editor.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import type { ActionReport } from "../../src/extension/actions.js";
import type { VoiceCoderApi } from "../../src/extension/extension.js";
import { getApi, releaseKey, sleep } from "../vscode/helpers.js";

/** The report of the scene's command (a stray fragment of the utterance does not count). */
function nextCommandReport(api: VoiceCoderApi): Promise<ActionReport> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no command report")), 120_000);
    const listener = api.onActionDone((report) => {
      if (!report.kind) return;
      clearTimeout(timer);
      listener.dispose();
      resolve(report);
    });
  });
}

interface Scene {
  wav: string;
  /** Shown as a caption while the line is spoken. */
  caption: string;
  /** Pause after the command finished, so the viewer can read the result. */
  holdMs: number;
  /** After the pause, approve the proposal (as Ctrl+Alt+Enter would). */
  apply?: boolean;
}

const SCENES_JA: Scene[] = [
  { wav: "generate_1.wav", caption: "「FizzBuzzを作って」", holdMs: 3000 },
  { wav: "demo_run.wav", caption: "「実行して」", holdMs: 4000 },
  { wav: "demo_explain.wav", caption: "「このコードを説明して」", holdMs: 6000 },
  { wav: "demo_refactor.wav", caption: "「この処理を関数にまとめて」", holdMs: 4000, apply: true },
  { wav: "demo_run.wav", caption: "「実行して」", holdMs: 4000 },
];

const SCENES_EN: Scene[] = [
  { wav: "en_generate_1.wav", caption: "“Create FizzBuzz”", holdMs: 3000 },
  { wav: "en_run_1.wav", caption: "“Run it”", holdMs: 4000 },
  { wav: "en_explain_3.wav", caption: "“Explain this code”", holdMs: 6000 },
  { wav: "en_refactor_1.wav", caption: "“Refactor this into a function”", holdMs: 4000, apply: true },
  { wav: "en_run_1.wav", caption: "“Run it”", holdMs: 4000 },
];
const english = process.env.DEMO_LANG === "en";
const SCENES = english ? SCENES_EN : SCENES_JA;

/** Seconds of speech in a 16 kHz mono 16-bit WAV. */
const seconds = (path: string) => (statSync(path).size - 44) / 32000;

export interface TimelineEntry {
  wav: string;
  caption: string;
  /** Date.now() when the recording started playing into the extension. */
  audioStart: number;
  /** Date.now() when the command's result was in. */
  doneAt: number;
  message: string;
  /** A caption shown from this time on (the approval). */
  extra?: { caption: string; at: number };
}

export async function run(): Promise<void> {
  const api = await getApi();
  const extensionPath = vscode.extensions.getExtension("tsekino.voice-coder")!.extensionPath;
  const root = vscode.workspace.workspaceFolders![0].uri;
  const settings = () => vscode.workspace.getConfiguration("voiceCoder");
  const timeline: TimelineEntry[] = [];

  const editor = await vscode.window.showTextDocument(vscode.Uri.joinPath(root, "fizzbuzz.py"));
  // Start from an empty file, whatever reached the window before the recording began
  const clear = new vscode.WorkspaceEdit();
  clear.delete(editor.document.uri, new vscode.Range(0, 0, editor.document.lineCount, 0));
  await vscode.workspace.applyEdit(clear);
  await editor.document.save();
  editor.selection = new vscode.Selection(0, 0, 0, 0);
  await vscode.commands.executeCommand("notifications.clearAll");
  // Give the recorder time to find the window and start
  await sleep(Number(process.env.DEMO_LEAD_MS ?? 5000));
  await vscode.commands.executeCommand("notifications.clearAll");

  try {
    for (const scene of SCENES) {
      const wav = join(extensionPath, "test", "audio", scene.wav);
      await settings().update("replayWav", wav, vscode.ConfigurationTarget.Global);
      await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
      const report = nextCommandReport(api);
      await vscode.commands.executeCommand("voiceCoder.toggleListening");
      const audioStart = Date.now();
      // Listening stops by itself once the line is final; press again only if it has not
      await sleep(seconds(wav) * 1000 + 1500);
      await releaseKey(api);
      const done = await report;
      const entry: TimelineEntry = { wav: scene.wav, caption: scene.caption, audioStart, doneAt: Date.now(), message: done.message };
      timeline.push(entry);
      await sleep(scene.holdMs);
      if (scene.apply) {
        entry.extra = { caption: english ? "Ctrl+Alt+Enter to apply" : "Ctrl+Alt+Enter で適用", at: Date.now() };
        await sleep(1200);
        await vscode.commands.executeCommand("voiceCoder.applyProposal");
        await sleep(3000);
      }
    }
    await sleep(2000);
  } finally {
    await settings().update("replayWav", undefined, vscode.ConfigurationTarget.Global);
    if (process.env.DEMO_TIMELINE) writeFileSync(process.env.DEMO_TIMELINE, JSON.stringify(timeline, null, 2));
  }
}
