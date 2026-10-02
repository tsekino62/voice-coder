import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findClaudeExecutable } from "../../src/agent/claudeExecutable.js";

const notInstalled = () => {
  throw new Error("not found");
};

describe("findClaudeExecutable", () => {
  it("prefers the configured path", () => {
    expect(findClaudeExecutable("C:/tools/claude.exe", {}, "win32", () => "bundled")).toBe("C:/tools/claude.exe");
  });

  it("uses the SDK's platform binary when it is installed", () => {
    expect(findClaudeExecutable("", {}, "win32", (id) => `/nm/${id}`)).toMatch(/claude-agent-sdk-win32-.*\/claude\.exe$/);
  });

  it("falls back to claude on PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-"));
    writeFileSync(join(dir, "claude.exe"), "");
    expect(findClaudeExecutable("", { PATH: ["/nowhere", dir].join(delimiter) }, "win32", notInstalled)).toBe(join(dir, "claude.exe"));
  });

  it("is undefined when there is none", () => {
    expect(findClaudeExecutable("", { PATH: "/nowhere" }, "linux", notInstalled)).toBeUndefined();
  });
});
