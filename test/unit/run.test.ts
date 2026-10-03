import { describe, expect, it } from "vitest";
import { parseIntent } from "../../src/intent/parser.js";
import { fileRunCommand, testRunCommand, wantsTests } from "../../src/run/commands.js";

const kindOf = (text: string) => parseIntent(text)?.kind ?? null;

describe("run intent", () => {
  it.each([
    ["実行して", "run"],
    ["実行してみて", "run"],
    ["これを走らせて", "run"],
    ["ちょっと動かしてみて", "run"],
    ["テストを実行して", "run"],
  ])("%s → %s", (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it("does not read a report about running as a request to run", () => {
    expect(kindOf("実行すると固まる")).toBeNull(); // left to jev, which reads it as debug
    expect(kindOf("実行してもエラーが出る")).toBe("debug");
    expect(kindOf("動かない")).toBe("debug");
    expect(kindOf("FizzBuzzを書いて実行して")).toBe("run");
  });
});

describe("run commands", () => {
  it.each([
    ["python", "python \"D:\\p\\fizz buzz.py\""],
    ["javascript", "node \"D:\\p\\fizz buzz.py\""],
    ["typescript", "npx tsx \"D:\\p\\fizz buzz.py\""],
    ["go", "go run \"D:\\p\\fizz buzz.py\""],
  ])("%s file", (languageId, command) => {
    expect(fileRunCommand(languageId, "D:\\p\\fizz buzz.py")).toBe(command);
  });

  it("has no single-file runner for everything", () => {
    expect(fileRunCommand("cpp", "a.cpp")).toBeNull();
    expect(fileRunCommand("plaintext", "a.txt")).toBeNull();
  });

  it("picks the project's test runner", () => {
    const none = { hasPytestConfig: false, hasPythonTests: false, hasGoMod: false, hasCargoToml: false };
    expect(testRunCommand({ ...none, npmTestScript: "vitest run" })).toBe("npm test");
    expect(testRunCommand({ ...none, npmTestScript: 'echo "Error: no test specified" && exit 1' })).toBeNull();
    expect(testRunCommand({ ...none, hasPythonTests: true })).toBe("python -m pytest");
    expect(testRunCommand({ ...none, hasGoMod: true })).toBe("go test ./...");
    expect(testRunCommand(none)).toBeNull();
  });

  it("tells a test run from a file run", () => {
    expect(wantsTests("テストを実行して")).toBe(true);
    expect(wantsTests("実行してみて")).toBe(false);
  });
});
