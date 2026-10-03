// Drives a comparison run inside the user's own VS Code (opened as an Extension Development Host).
// On start-up it looks for job.json next to it and carries out that job:
//   list     — voice / chat commands and the Copilot models this VS Code offers
//   compare  — the same recording spoken to (1) VS Code's voice chat with Copilot and
//              (2) Voice Coder, both hearing it through the virtual cable; times written to `out`
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { MicrophoneSource, microphoneDevices } from "../../src/audio/microphone.js";
import { readWavPcm, speechBounds } from "../../src/audio/wav.js";
import { SonioxBackend } from "../../src/stt/SonioxBackend.js";

interface Job {
  action: "list" | "compare" | "probe";
  out: string;
  wav?: string;
  file?: string;
  sonioxKey?: string;
  phases?: Array<"builtin" | "voicecoder">;
  leadMs?: number;
}

export interface PhaseResult {
  phase: "builtin" | "voicecoder";
  audioStart: number;
  speechEnd: number;
  /** When the request was sent (VS Code's dictation: the Enter press). */
  sentAt?: number;
  firstEdit?: number;
  lastEdit?: number;
  finalText: string;
  note?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function activate(): Promise<void> {
  const jobPath = join(__dirname, "..", "job.json");
  if (!existsSync(jobPath)) return;
  const job = JSON.parse(readFileSync(jobPath, "utf8")) as Job;
  try {
    if (job.action === "list") await list(job);
    else if (job.action === "probe") await probe(job);
    else await compare(job);
  } catch (error) {
    writeFileSync(job.out, JSON.stringify({ error: String(error instanceof Error ? error.stack : error) }, null, 2));
  }
  await vscode.commands.executeCommand("workbench.action.closeWindow");
}

async function list(job: Job): Promise<void> {
  const all = await vscode.commands.getCommands(true);
  const wanted = all.filter((id) => /voice|dictat|speech|chat\.(open|submit|newChat)/i.test(id)).sort();
  let models: string[] = [];
  for (let waited = 0; waited < 30_000 && models.length === 0; waited += 1000) {
    models = (await vscode.lm.selectChatModels({ vendor: "copilot" })).map((m) => `${m.family} | ${m.name}`);
    if (models.length === 0) await sleep(1000);
  }
  writeFileSync(job.out, JSON.stringify({ version: vscode.version, commands: wanted, copilotModels: models }, null, 2));
}

/** Tries the built-in chat dictation: does it start, and does it put the spoken text in the chat input? */
async function probe(job: Job): Promise<void> {
  const log: string[] = [];
  const run = async (id: string, ...args: unknown[]) => {
    try {
      const result = await vscode.commands.executeCommand(id, ...args);
      log.push(`${id}: ok ${result === undefined ? "" : JSON.stringify(result)}`);
    } catch (e) {
      log.push(`${id}: ERROR ${e instanceof Error ? e.message : e}`);
    }
  };
  await sleep(3000);
  await run("workbench.action.chat.newChat");
  await run("workbench.action.chat.open", { mode: "agent" });
  await run("workbench.action.chat.toggleSpeechToText");
  await sleep(3000);
  const start = await playIntoCable(job.wav!).catch((e) => (log.push(`play: ${e}`), 0));
  log.push(`played at +${start ? 0 : -1}`);
  await sleep(2500);
  await run("workbench.action.chat.toggleSpeechToText");
  await sleep(1000);
  log.push(`dictation.enabled=${vscode.workspace.getConfiguration("dictation").get("enabled")}`);
  writeFileSync(job.out, JSON.stringify({ log }, null, 2));
  await sleep(8000); // leave the window up long enough to see what happened
}

/** Plays a 16 kHz WAV into the virtual cable's input; resolves when it has been played. */
async function playIntoCable(wav: string): Promise<number> {
  const { PvSpeaker } = await import("@picovoice/pvspeaker-node");
  const devices = PvSpeaker.getAvailableDevices();
  const index = devices.findIndex((d) => /^CABLE Input/i.test(d));
  if (index < 0) throw new Error(`no CABLE Input among ${devices.join(", ")}`);
  const pcm = readWavPcm(wav);
  const speaker = new PvSpeaker(16000, 16, { deviceIndex: index, bufferSizeSecs: 20 });
  speaker.start();
  const startedAt = Date.now();
  speaker.flush(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
  speaker.stop();
  speaker.release();
  return startedAt;
}

function watchEdits(document: vscode.TextDocument) {
  const seen = { first: undefined as number | undefined, last: undefined as number | undefined };
  const subscription = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document !== document || e.contentChanges.length === 0) return;
    const now = Date.now();
    seen.first ??= now;
    seen.last = now;
  });
  return { seen, dispose: () => subscription.dispose() };
}

/** Until the file has been edited and then left alone for `quietMs`, or `timeoutMs`. */
async function settled(seen: { first?: number; last?: number }, quietMs: number, timeoutMs: number, since: number): Promise<void> {
  while (Date.now() - since < timeoutMs) {
    if (seen.last && Date.now() - seen.last > quietMs) return;
    await sleep(200);
  }
}

async function emptyFile(document: vscode.TextDocument): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.delete(document.uri, new vscode.Range(0, 0, document.lineCount, 0));
  await vscode.workspace.applyEdit(edit);
  await document.save();
}

async function compare(job: Job): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0].uri;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root, job.file ?? "fizzbuzz.py"));
  const speechEndMs = (speechBounds(readWavPcm(job.wav!))?.end ?? 0) * 1000;
  const results: PhaseResult[] = [];
  await vscode.window.showTextDocument(document);
  await sleep(job.leadMs ?? 4000);
  await vscode.commands.executeCommand("notifications.clearAll");

  for (const phase of job.phases ?? ["builtin", "voicecoder"]) {
    await emptyFile(document);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    const edits = watchEdits(document);
    let audioStart: number;
    let sentAt: number | undefined;
    let note: string | undefined;

    if (phase === "builtin") {
      // VS Code's own dictation into Copilot Chat (agent mode): dictate, stop, press Enter
      await vscode.commands.executeCommand("workbench.action.chat.newChat");
      await vscode.commands.executeCommand("workbench.action.chat.open", { mode: "agent" }).then(undefined, (e) => (note = `open: ${e}`));
      await vscode.commands.executeCommand("workbench.action.chat.toggleSpeechToText");
      await sleep(1500); // the recognizer starts
      audioStart = await playIntoCable(job.wav!);
      // Stop dictating and send, as a user would right after speaking (the best case for this path)
      await sleep(Math.max(0, audioStart + speechEndMs + 300 - Date.now()));
      await vscode.commands.executeCommand("workbench.action.chat.toggleSpeechToText");
      await sleep(300);
      await vscode.commands.executeCommand("workbench.action.chat.submit");
      sentAt = Date.now();
      await settled(edits.seen, 5000, 120_000, audioStart);
    } else {
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar").then(undefined, () => {});
      const extension = vscode.extensions.getExtension("tsekino.voice-coder")!;
      const api = (await extension.activate()) as { setSttFactory(f: (() => unknown) | undefined): void };
      const cable = (await microphoneDevices()).findIndex((d) => /^CABLE Output/i.test(d));
      api.setSttFactory(() => new SonioxBackend(new MicrophoneSource({ deviceIndex: cable }), { apiKey: job.sonioxKey!, maxEndpointDelayMs: 1000 }));
      await vscode.commands.executeCommand("voiceCoder.toggleListening");
      await sleep(500);
      audioStart = await playIntoCable(job.wav!);
      await settled(edits.seen, 3000, 120_000, audioStart);
      api.setSttFactory(undefined);
    }
    edits.dispose();
    results.push({ phase, audioStart, speechEnd: audioStart + speechEndMs, sentAt, firstEdit: edits.seen.first, lastEdit: edits.seen.last, finalText: document.getText(), note });
    await sleep(3000);
  }
  writeFileSync(job.out, JSON.stringify({ results }, null, 2));
}

export function deactivate(): void {}
