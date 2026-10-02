import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";

/**
 * The Claude Code executable for the Agent SDK: the configured path, else
 * the SDK's own platform binary when it is installed (a dev checkout), else
 * `claude` on PATH (the packaged extension leaves the 238 MB binary out).
 * Undefined lets the SDK report what is missing.
 */
export function findClaudeExecutable(
  configured: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  resolvePackage: (id: string) => string = createRequire(__filename).resolve,
): string | undefined {
  if (configured) return configured;
  const binary = platform === "win32" ? "claude.exe" : "claude";
  try {
    return resolvePackage(`@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}/${binary}`);
  } catch {
    // not installed; look on PATH
  }
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, binary))) return join(dir, binary);
  }
  return undefined;
}
