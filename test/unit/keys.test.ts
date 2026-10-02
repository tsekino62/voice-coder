import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readKeys } from "../../src/extension/keys.js";

describe("readKeys", () => {
  const dir = mkdtempSync(join(tmpdir(), "vc-"));
  writeFileSync(join(dir, ".env"), "SONIOX_API_KEY=from-file\nOPENAI_API_KEY='quoted'\n# comment\nOTHER=ignored\n");

  it("reads the keys from the .env file", () => {
    expect(readKeys(join(dir, ".env"), undefined, {})).toEqual({ SONIOX_API_KEY: "from-file", OPENAI_API_KEY: "quoted" });
  });

  it("lets the environment win over the file", () => {
    expect(readKeys(join(dir, ".env"), undefined, { SONIOX_API_KEY: "from-env" }).SONIOX_API_KEY).toBe("from-env");
  });

  it("resolves a relative path against the workspace and tolerates a missing file", () => {
    expect(readKeys(".env", dir, {}).SONIOX_API_KEY).toBe("from-file");
    expect(readKeys("missing.env", dir, {})).toEqual({});
    expect(readKeys("", dir, { OPENAI_API_KEY: "x" })).toEqual({ OPENAI_API_KEY: "x" });
  });
});
