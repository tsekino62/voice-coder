import { describe, expect, it } from "vitest";
import type { AgentContext, AgentTarget } from "../../src/agent/AgentBackend.js";
import { buildPrompt, parseFileEdits, safeRelativePath } from "../../src/agent/prompt.js";
import { parseIntent } from "../../src/intent/parser.js";

const kindOf = (text: string) => parseIntent(text)?.kind ?? null;

describe("refactor and create intents", () => {
  it.each([
    ["CircleとSquareを抽象クラスにまとめて", "refactor"],
    ["抽象クラスを作成して、類似クラスをまとめる", "refactor"],
    ["類似クラスをまとめて抽象クラスを作って", "refactor"],
    ["この関数をリファクタして", "refactor"],
    ["重複してる処理を共通化して", "refactor"],
    ["この処理を別の関数に切り出して", "refactor"],
    ["変数名をリネームして", "refactor"],
    ["Userクラスのファイルを作って", "create"],
    ["新しいファイルを追加して", "create"],
    ["設定ファイルを用意して", "create"],
  ])("%s → %s", (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it("keeps the smaller requests where they were", () => {
    expect(kindOf("Userクラスを作って")).toBe("generate");
    expect(kindOf("このファイルを説明して")).toBe("explain");
    expect(kindOf("FizzBuzzを作って")).toBe("generate");
  });

  it("lets a change of mind win over precedence", () => {
    expect(kindOf("リファクタして、あ、やっぱり説明して")).toBe("explain");
    expect(kindOf("ファイルを作るんじゃなくてここに書いて")).toBe("generate");
  });
});

describe("refactor prompt and reply", () => {
  const target: AgentTarget = { fileName: "src/shapes/Circle.ts", languageId: "typescript", startLine: 0, endLine: 2, code: "a\nb\nc" };
  const context: AgentContext = {
    utterance: "抽象クラスにまとめて",
    documentText: "a\nb\nc",
    diagnostics: [],
    files: [{ path: "src/shapes/Square.ts", text: "class Square {}" }],
    workspaceFiles: ["src/shapes/Circle.ts", "src/shapes/Square.ts"],
    signal: new AbortController().signal,
  };

  it("sends the open files and the workspace listing, and asks for whole files by path", () => {
    const { user } = buildPrompt(parseIntent("CircleとSquareを抽象クラスにまとめて")!, target, context);
    expect(user).toContain("=== src/shapes/Circle.ts ===");
    expect(user).toContain("=== src/shapes/Square.ts ===\n```\nclass Square {}");
    expect(user).toContain("- src/shapes/Square.ts");
    expect(user).toMatch(/abstract base class/);
    expect(user).toMatch(/complete new content/);
  });

  it("reads the files out of a reply", () => {
    const reply = [
      "Here you go.",
      "=== src/shapes/Shape.ts ===",
      "```typescript",
      "export abstract class Shape {}",
      "```",
      "",
      "=== `src/shapes/Circle.ts` ===",
      "```ts",
      "export class Circle extends Shape {}",
      "```",
    ].join("\n");
    expect(parseFileEdits(reply)).toEqual([
      { path: "src/shapes/Shape.ts", content: "export abstract class Shape {}\n" },
      { path: "src/shapes/Circle.ts", content: "export class Circle extends Shape {}\n" },
    ]);
    expect(parseFileEdits("```ts\nno path\n```")).toEqual([]);
  });

  it.each([
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src\\models\\User.ts", "src/models/User.ts"],
    ["../outside.ts", null],
    ["src/../../x.ts", null],
    ["/etc/passwd", null],
    ["C:/Windows/x.ts", null],
    ["", null],
  ])("safe path %s → %s", (path, expected) => {
    expect(safeRelativePath(path)).toBe(expected);
  });
});
