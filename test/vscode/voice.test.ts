import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { loadSdk } from "../../src/agent/ClaudeAgentBackend.js";
import { microphoneDevices } from "../../src/audio/microphone.js";
import { PROPOSAL_SCHEME } from "../../src/extension/actions.js";
import type { VoiceCoderApi } from "../../src/extension/extension.js";
import { agentFor, getApi, nextReport, settle, numberedLines, openDocument, sleep, speak, TimedScriptBackend, usingRealAgent } from "./helpers.js";

describe("Voice Coder in VS Code", () => {
  let api: VoiceCoderApi;

  before(async () => {
    api = await getApi();
  });

  afterEach(async () => {
    await settle(api);
    api.setSttFactory(undefined);
    api.setAgentBackend(undefined);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("loads the ESM-only Claude Agent SDK from the CommonJS bundle", async () => {
    const sdk = await loadSdk();
    assert.equal(typeof sdk.query, "function");
  });

  it("loads the native microphone recorder in the extension host (no recording)", async () => {
    const devices = await microphoneDevices();
    assert.ok(Array.isArray(devices));
  });

  it("streams partial transcripts into the status bar", async () => {
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    await openDocument(numberedLines(30));
    const seen: string[] = [];
    const listener = api.onStatus((text) => seen.push(text));
    try {
      const partials = ["10行目", "10行目から20行目", "10行目から20行目を解説"];
      await speak(api, [
        { partial: partials[0], atMs: 100 },
        { partial: partials[1], atMs: 250 },
        { partial: partials[2], atMs: 400 },
        { final: "10行目から20行目を解説して。", atMs: 900 },
      ]);
      // Each partial reached the status bar item, in order
      const shown = partials.map((p) => seen.findIndex((text) => text.includes(p) && text.startsWith("$(record)")));
      assert.ok(shown.every((i) => i >= 0), `status texts: ${JSON.stringify(seen)}`);
      assert.deepEqual([...shown].sort((a, b) => a - b), shown);
      assert.ok(seen[0].includes("聞いています"));
      assert.ok(api.statusBarItem.text.startsWith("$(check)"), api.statusBarItem.text);
    } finally {
      listener.dispose();
    }
  });

  it("keeps the result in the status bar when the command finished before the key was released", async () => {
    // The usual case with a real mic: Soniox closes the utterance after a second of
    // silence and the command is done before the speaker presses the key again
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    const editor = await openDocument("// fizzbuzz goes below\n");
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    api.setSttFactory(() => new TimedScriptBackend([
      { partial: "FizzBuzzを作っ", atMs: 100 },
      { final: "FizzBuzzを作って。", atMs: 300 },
      { partial: "", atMs: 60_000 }, // keeps listening until stop()
    ]));
    const report = nextReport(api);
    await vscode.commands.executeCommand("voiceCoder.toggleListening");
    assert.equal((await report).kind, "generate");
    await vscode.commands.executeCommand("voiceCoder.toggleListening");
    assert.ok(api.statusBarItem.text.startsWith("$(check)"), api.statusBarItem.text);
    assert.equal(api.listening, false);
  });

  it("with no file open, generate writes into a new file in the language the agent chose", async () => {
    const { agent, mock } = agentFor(() => "```python\nfor i in range(1, 101):\n    print(i)\n```");
    api.setAgentBackend(agent);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    assert.equal(vscode.window.visibleTextEditors.filter((e) => ["file", "untitled"].includes(e.document.uri.scheme)).length, 0);

    const report = await speak(api, [
      { partial: "PythonでFizzBuzzを作っ", atMs: 100 },
      { final: "PythonでFizzBuzzを作って。", atMs: 500 },
    ]);

    assert.equal(report.kind, "generate");
    assert.equal(report.applied, true, report.message);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, "a new editor is open");
    assert.equal(editor.document.isUntitled, true);
    assert.equal(editor.document.languageId, "python");
    if (mock) assert.match(editor.document.getText(), /range\(1, 101\)/);
  });

  it("with no file open, explain asks for a file instead of doing nothing", async () => {
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    const report = await speak(api, [{ final: "10行目から20行目を解説して。", atMs: 300 }]);

    assert.equal(report.kind, "explain");
    assert.equal(report.applied, false);
    assert.match(report.message, /ファイルを開いて/);
    assert.ok(api.statusBarItem.text.startsWith("$(error)"), api.statusBarItem.text);
  });

  it("writes into the code file even while the Output panel has the focus", async () => {
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    const editor = await openDocument("// fizzbuzz goes below\n");
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    const before = editor.document.getText();
    // Put the focus on the Output panel, as after reading an explanation
    await vscode.commands.executeCommand("workbench.action.output.toggleOutput");
    await vscode.commands.executeCommand("workbench.panel.output.focus");
    await sleep(300);

    const report = await speak(api, [
      { partial: "FizzBuzzを作っ", atMs: 100 },
      { final: "FizzBuzzを作って。", atMs: 500 },
    ]);

    assert.equal(report.kind, "generate");
    assert.equal(report.applied, true, report.message);
    assert.ok(editor.document.getText().startsWith(before) && editor.document.getText() !== before, "inserted into the code file");
    const output = vscode.workspace.textDocuments.filter((d) => d.uri.scheme === "output");
    for (const doc of output) assert.ok(!doc.getText().includes("for (") || doc.getText() === "", "nothing written to the Output panel");
  });

  it("explain leaves the document untouched", async () => {
    const { agent, mock } = agentFor();
    api.setAgentBackend(agent);
    const editor = await openDocument(numberedLines(30));
    const before = editor.document.getText();
    const version = editor.document.version;

    const report = await speak(api, [
      { partial: "10行目から20行目を解説", atMs: 100 },
      { final: "10行目から20行目を解説して。", atMs: 600 },
    ]);

    assert.equal(report.kind, "explain");
    assert.equal(report.applied, true);
    assert.ok(report.output && report.output.length > 0);
    assert.equal(editor.document.getText(), before);
    assert.equal(editor.document.version, version);
    if (mock) assert.deepEqual([mock.runs[0].target.startLine, mock.runs[0].target.endLine], [9, 19]);
  });

  it("generate inserts with one WorkspaceEdit and one undo takes it back", async () => {
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    const editor = await openDocument("// fizzbuzz goes below\n");
    const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    editor.selection = new vscode.Selection(end, end);
    const before = editor.document.getText();
    const version = editor.document.version;

    const report = await speak(api, [
      { partial: "FizzBuzzを作っ", atMs: 100 },
      { partial: "FizzBuzzを作って", atMs: 250 },
      { final: "FizzBuzzを作って。", atMs: 700 },
    ]);

    assert.equal(report.kind, "generate");
    assert.equal(report.applied, true);
    const after = editor.document.getText();
    assert.notEqual(after, before);
    assert.ok(after.startsWith(before), "inserted at the cursor, nothing else touched");
    if (!usingRealAgent()) assert.match(after, /function fizzBuzz/);
    assert.equal(editor.document.version, version + 1, "exactly one edit");

    // undo acts on whatever has focus: make sure it is this editor, not a notification or panel
    await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    await vscode.commands.executeCommand("undo");
    assert.equal(editor.document.getText(), before);
  });

  it("debug shows a fix as a diff from the diagnostics and applies nothing until approved", async () => {
    const broken = ['function total(items: number[]): number {', '  let sum: number = "0";', "  for (const item of items) sum += item;", "  return sum;", "}", ""].join("\n");
    const fixed = broken.replace('let sum: number = "0";', "let sum: number = 0;");
    const { agent, mock } = agentFor((intent, target, context) => {
      assert.equal(intent.kind, "debug");
      assert.ok(context.diagnostics.some((d) => d.line === 1 && d.message.includes("not assignable")));
      return "```typescript\n" + target.code.replace('"0"', "0") + "\n```";
    });
    api.setAgentBackend(agent);
    const editor = await openDocument(broken);
    // Our own collection, so the error is there without waiting for the TypeScript server
    const diagnostics = vscode.languages.createDiagnosticCollection("voice-coder-test");
    diagnostics.set(editor.document.uri, [
      new vscode.Diagnostic(new vscode.Range(1, 6, 1, 9), "Type 'string' is not assignable to type 'number'.", vscode.DiagnosticSeverity.Error),
    ]);
    try {
      const before = editor.document.getText();
      const version = editor.document.version;

      const report = await speak(api, [
        { partial: "デバッグ", atMs: 100 },
        { final: "デバッグして。", atMs: 600 },
      ]);

      assert.equal(report.kind, "debug");
      assert.equal(report.applied, true, report.message);
      if (mock) assert.equal(mock.runs.length, 1);
      // Shown as a diff, not applied
      assert.equal(editor.document.getText(), before);
      assert.equal(editor.document.version, version);
      const proposal = api.pendingProposal();
      assert.ok(proposal, "a proposal is pending");
      const diffTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.scheme === PROPOSAL_SCHEME);
      assert.ok(diffTab, "the diff editor is open");
      const shown = await vscode.workspace.openTextDocument(proposal.changes[0].proposalUri);
      if (!usingRealAgent()) assert.equal(shown.getText(), fixed);

      // Approval writes it
      assert.equal(await vscode.commands.executeCommand("voiceCoder.applyProposal"), true);
      assert.equal(editor.document.getText(), proposal.changes[0].newText);
      assert.equal(api.pendingProposal(), undefined);
    } finally {
      diagnostics.dispose();
    }
  });

  it("reads intents with jev when voiceCoder.intentReader is jev", async () => {
    // With TYPESAFE_API_KEY the real jev answers; without it the extension falls back to the regex
    const settings = vscode.workspace.getConfiguration("voiceCoder");
    await settings.update("intentReader", "jev", vscode.ConfigurationTarget.Global);
    try {
      const { agent } = agentFor();
      api.setAgentBackend(agent);
      const editor = await openDocument(numberedLines(30));
      const before = editor.document.getText();
      const report = await speak(api, [
        { partial: "10行目から20行目", atMs: 100 },
        { partial: "10行目から20行目で何をしているか", atMs: 400 },
        { final: "10行目から20行目で何をしているか教えて。", atMs: 900 },
      ]);
      assert.equal(report.kind, "explain");
      assert.equal(editor.document.getText(), before);
    } finally {
      await settings.update("intentReader", undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it("hybrid (the default) reads a phrasing without keywords through jev", async function () {
    if (!process.env.TYPESAFE_API_KEY) this.skip();
    const { agent } = agentFor();
    api.setAgentBackend(agent);
    const editor = await openDocument(numberedLines(10));
    const before = editor.document.getText();
    const report = await speak(api, [
      { partial: "テストが", atMs: 100 },
      { partial: "テストが通らない", atMs: 400 },
      { final: "テストが通らないんだけど。", atMs: 900 },
    ]);
    assert.equal(report.kind, "debug");
    // debug never writes before approval
    assert.equal(editor.document.getText(), before);
  });

  describe("speculative run aborted by a mismatching final", () => {
    for (const [name, chunkDelayMs] of [
      ["while the agent is still streaming", 100],
      ["after the agent already finished", 1],
    ] as const) {
      it(`leaves no trace in the editor (${name})`, async () => {
        const { agent, mock } = agentFor(undefined, chunkDelayMs);
        api.setAgentBackend(agent);
        const editor = await openDocument(numberedLines(5));
        const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
        editor.selection = new vscode.Selection(end, end);
        const before = editor.document.getText();
        const version = editor.document.version;

        const report = await speak(api, [
          { partial: "作って", atMs: 100 },
          { partial: "作って、あ、やっぱり", atMs: 700 },
          { final: "作って、あ、やっぱり説明して。", atMs: 1200 },
        ]);
        // Give an aborted run every chance to (wrongly) write something
        await sleep(Math.max(chunkDelayMs * 30, 200));

        assert.equal(report.kind, "explain");
        assert.equal(report.speculative, false, "the final's intent was dispatched anew");
        assert.equal(editor.document.getText(), before);
        assert.equal(editor.document.version, version);
        if (mock) {
          const [generate, explain] = mock.runs;
          assert.equal(generate.intent.kind, "generate");
          assert.equal(generate.context.signal.aborted, true);
          if (chunkDelayMs > 1) assert.equal(generate.aborted, true);
          else assert.equal(generate.finished, true);
          assert.equal(explain.intent.kind, "explain");
          assert.equal(explain.context.signal.aborted, false);
        }
      });
    }
  });
});
