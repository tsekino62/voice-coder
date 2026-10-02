import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseEnv } from "node:util";

export const KEY_NAMES = ["SONIOX_API_KEY", "OPENAI_API_KEY", "TYPESAFE_API_KEY", "ANTHROPIC_API_KEY"] as const;
export type KeyName = (typeof KEY_NAMES)[number];

/**
 * API keys for the extension: the environment first, then the .env file the
 * user pointed voiceCoder.envFile at. The file's values stay inside the
 * extension; they are not written into process.env, which other extensions share.
 */
export function readKeys(envFile: string, workspaceRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): Partial<Record<KeyName, string>> {
  let fromFile: Record<string, string | undefined> = {};
  if (envFile) {
    const path = isAbsolute(envFile) || !workspaceRoot ? envFile : join(workspaceRoot, envFile);
    if (existsSync(path)) fromFile = parseEnv(readFileSync(path, "utf8"));
  }
  const keys: Partial<Record<KeyName, string>> = {};
  for (const name of KEY_NAMES) {
    const value = env[name] || fromFile[name];
    if (value) keys[name] = value;
  }
  return keys;
}
