import * as assert from "node:assert/strict";
import { join } from "node:path";
import * as vscode from "vscode";
import type { VoiceCoderApi } from "../../src/extension/extension.js";
import { getApi, nextReport, numberedLines, openDocument, settle, sleep } from "./helpers.js";

// The extension's own pipeline, nothing swapped: the Python sidecar (replaying a WAV
// instead of the microphone) → Soniox → hybrid intent reading → OpenAI.
const live = Boolean(process.env.SONIOX_API_KEY && process.env.OPENAI_API_KEY);

describe("the real pipeline inside VS Code (sidecar replaying a WAV)", () => {
  let api: VoiceCoderApi;
  const settings = () => vscode.workspace.getConfiguration("voiceCoder");
  const audio = (file: string) => join(vscode.extensions.getExtension("tsekino.voice-coder")!.extensionPath, "test", "audio", file);

  before(async function () {
    if (!live) this.skip();
    api = await getApi();
  });

  afterEach(async () => {
    if (api) await settle(api);
    await settings().update("replayWav", undefined, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("explains lines 10-20 from a spoken request and leaves the file alone", async () => {
    await settings().update("replayWav", audio("explain_1.wav"), vscode.ConfigurationTarget.Global);
    const editor = await openDocument(numberedLines(30));
    const before = editor.document.getText();
    const seen: string[] = [];
    const listener = api.onStatus((text) => seen.push(text));
    try {
      const report = nextReport(api);
      await vscode.commands.executeCommand("voiceCoder.toggleListening");
      await sleep(4500); // the take is 3.3 s; let it play out like a speaker who then releases the key
      await vscode.commands.executeCommand("voiceCoder.toggleListening");
      const done = await report;
      assert.equal(done.kind, "explain", JSON.stringify(done));
      assert.match(done.message, /explain 10-20/);
      assert.ok(done.output && done.output.length > 20, "OpenAI wrote an explanation");
      assert.ok(seen.some((text) => text.startsWith("$(record)") && text.includes("行目")), `partials: ${JSON.stringify(seen)}`);
      assert.equal(editor.document.getText(), before);
    } finally {
      listener.dispose();
    }
  });

  it("shows a sidecar failure in the status bar instead of listening forever", async () => {
    await settings().update("replayWav", audio("does-not-exist.wav"), vscode.ConfigurationTarget.Global);
    await openDocument(numberedLines(3));
    const seen: string[] = [];
    const listener = api.onStatus((text) => seen.push(text));
    try {
      await vscode.commands.executeCommand("voiceCoder.toggleListening");
      for (let waited = 0; !seen.some((t) => t.startsWith("$(error)")) && waited < 10_000; waited += 100) await sleep(100);
      assert.ok(seen.some((t) => t.startsWith("$(error)") && /sidecar/.test(t)), JSON.stringify(seen));
      for (let waited = 0; api.listening && waited < 5000; waited += 100) await sleep(100);
      assert.equal(api.listening, false, "listening stopped by itself");
    } finally {
      listener.dispose();
    }
  });
});
