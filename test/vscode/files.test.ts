import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { MockAgentBackend, type MockResponder } from "../../src/agent/MockAgentBackend.js";
import type { VoiceCoderApi } from "../../src/extension/extension.js";
import { agentFor, getApi, settle, speak } from "./helpers.js";

const SHAPE = [
  "export abstract class Shape {",
  "  abstract area(): number;",
  "",
  "  describe(): string {",
  "    return `${this.constructor.name} with area ${this.area().toFixed(2)}`;",
  "  }",
  "}",
  "",
].join("\n");

function extendsShape(name: string, field: string, area: string): string {
  return [
    'import { Shape } from "./Shape";',
    "",
    `export class ${name} extends Shape {`,
    `  constructor(private readonly ${field}: number) {`,
    "    super();",
    "  }",
    "",
    "  area(): number {",
    `    return ${area};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

const root = () => vscode.workspace.workspaceFolders![0].uri;
const file = (path: string) => vscode.Uri.joinPath(root(), path);

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function open(path: string): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file(path)));
}

describe("refactor and file creation (proposed as diffs, written on approval)", () => {
  let api: VoiceCoderApi;

  before(async () => {
    api = await getApi();
    assert.ok(vscode.workspace.workspaceFolders?.length, "the test workspace is open");
  });

  afterEach(async () => {
    await settle(api);
    api.setSttFactory(undefined);
    api.setAgentBackend(undefined);
    await vscode.commands.executeCommand("voiceCoder.discardProposal");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  it("merges similar classes into an abstract class across files", async () => {
    const responder: MockResponder = (intent, target, context) => {
      assert.equal(intent.kind, "refactor");
      assert.equal(target.fileName, "src/shapes/Circle.ts");
      // The other open file and the workspace listing reach the agent
      assert.ok(context.files?.some((f) => f.path === "src/shapes/Square.ts" && f.text.includes("class Square")));
      assert.ok(context.workspaceFiles?.includes("src/shapes/Square.ts"));
      return [
        "=== src/shapes/Shape.ts ===",
        "```typescript",
        SHAPE,
        "```",
        "=== src/shapes/Circle.ts ===",
        "```typescript",
        extendsShape("Circle", "radius", "Math.PI * this.radius ** 2"),
        "```",
        "=== src/shapes/Square.ts ===",
        "```typescript",
        extendsShape("Square", "side", "this.side * this.side"),
        "```",
      ].join("\n");
    };
    const { agent, mock } = agentFor(responder);
    api.setAgentBackend(agent);
    const square = await open("src/shapes/Square.ts");
    const circle = await open("src/shapes/Circle.ts");
    const before = { circle: circle.document.getText(), square: square.document.getText() };

    const report = await speak(api, [
      { partial: "CircleとSquareを抽象クラスに", atMs: 100 },
      { partial: "CircleとSquareを抽象クラスにまとめ", atMs: 400 },
      { final: "CircleとSquareを抽象クラスにまとめて。", atMs: 900 },
    ]);

    assert.equal(report.kind, "refactor");
    assert.equal(report.applied, true, report.message);
    const proposal = api.pendingProposal();
    assert.ok(proposal, "a proposal is pending");
    assert.ok(proposal.changes.length >= 2, `${proposal.changes.length} changes`);
    if (mock) {
      assert.deepEqual(
        proposal.changes.map((c) => [vscode.workspace.asRelativePath(c.uri), c.create]),
        [
          ["src/shapes/Shape.ts", true],
          ["src/shapes/Circle.ts", false],
          ["src/shapes/Square.ts", false],
        ],
      );
    }
    // Nothing written before approval
    assert.equal(circle.document.getText(), before.circle);
    assert.equal(square.document.getText(), before.square);
    for (const change of proposal.changes.filter((c) => c.create)) assert.equal(await exists(change.uri), false);

    assert.equal(await vscode.commands.executeCommand("voiceCoder.applyProposal"), true);
    for (const change of proposal.changes) {
      const document = await vscode.workspace.openTextDocument(change.uri);
      assert.equal(document.getText(), change.newText, vscode.workspace.asRelativePath(change.uri));
    }
    if (mock) assert.match(circle.document.getText(), /class Circle extends Shape/);
  });

  it("creates a new file only after approval", async () => {
    const { agent, mock } = agentFor(() =>
      ["=== src/models/User.ts ===", "```typescript", "export class User {", "  constructor(readonly name: string) {}", "}", "```"].join("\n"),
    );
    api.setAgentBackend(agent);
    await open("src/shapes/Circle.ts");

    const report = await speak(api, [
      { partial: "Userクラスのファイルを", atMs: 100 },
      { partial: "Userクラスのファイルを作っ", atMs: 400 },
      { final: "Userクラスのファイルを作って。", atMs: 900 },
    ]);

    assert.equal(report.kind, "create");
    assert.equal(report.applied, true, report.message);
    const proposal = api.pendingProposal()!;
    const created = proposal.changes.filter((c) => c.create);
    assert.ok(created.length >= 1);
    if (mock) assert.equal(vscode.workspace.asRelativePath(created[0].uri), "src/models/User.ts");
    for (const change of created) assert.equal(await exists(change.uri), false, "not on disk before approval");

    assert.equal(await vscode.commands.executeCommand("voiceCoder.applyProposal"), true);
    for (const change of created) {
      assert.equal(await exists(change.uri), true);
      assert.equal((await vscode.workspace.openTextDocument(change.uri)).getText(), change.newText);
    }
  });

  it("refuses an agent reply that points outside the workspace", async () => {
    // Always the mock: this checks what happens with a hostile reply
    api.setAgentBackend(new MockAgentBackend(() => ["=== ../outside.ts ===", "```", "export const x = 1;", "```"].join("\n")));
    await open("src/shapes/Circle.ts");

    const report = await speak(api, [{ final: "新しいファイルを追加して。", atMs: 300 }]);

    assert.equal(report.kind, "create");
    assert.equal(report.applied, false);
    assert.match(report.message, /ワークスペースの外/);
    assert.equal(api.pendingProposal(), undefined);
    assert.equal(await exists(vscode.Uri.joinPath(root(), "..", "outside.ts")), false);
  });
});
