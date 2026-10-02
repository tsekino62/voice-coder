import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Intent } from "../intent/types.js";
import type { AgentBackend, AgentContext, AgentTarget } from "./AgentBackend.js";
import { buildPrompt } from "./prompt.js";

export interface ClaudeAgentOptions {
  model?: string;
  /** Claude Code executable; the SDK's bundled one when unset. */
  pathToClaudeCodeExecutable?: string;
  cwd?: string;
}

type Sdk = typeof import("@anthropic-ai/claude-agent-sdk");

// The SDK is ESM-only and finds its native executable from its own location,
// so it stays outside the CommonJS bundle and is loaded with a real import()
// of its resolved file URL (a bare name has no base to resolve from here).
const importUrl = new Function("url", "return import(url)") as (url: string) => Promise<Sdk>;

export function loadSdk(): Promise<Sdk> {
  const entry = createRequire(__filename).resolve("@anthropic-ai/claude-agent-sdk");
  return importUrl(pathToFileURL(entry).href);
}

/**
 * Claude through the Claude Agent SDK: one turn, no tools, text streamed as
 * it is generated. Aborting the context's signal ends the SDK query.
 */
export class ClaudeAgentBackend implements AgentBackend {
  constructor(private readonly options: ClaudeAgentOptions = {}) {}

  async *run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string> {
    if (context.signal.aborted) return;
    const { query } = await loadSdk();
    const prompt = buildPrompt(intent, target, context);
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    context.signal.addEventListener("abort", onAbort, { once: true });

    const options: Options = {
      abortController,
      model: this.options.model ?? "claude-opus-5-5",
      systemPrompt: prompt.system,
      tools: [],
      maxTurns: 1,
      includePartialMessages: true,
      persistSession: false,
      settingSources: [],
      cwd: this.options.cwd,
      pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable || undefined,
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "voice-coder/0.1.0" } as Record<string, string>,
    };
    try {
      for await (const message of query({ prompt: prompt.user, options }) as AsyncIterable<SDKMessage>) {
        if (context.signal.aborted) return;
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
        } else if (message.type === "result" && message.subtype !== "success") {
          throw new Error(`Claude Agent SDK: ${message.subtype}`);
        }
      }
    } catch (error) {
      if (context.signal.aborted) return; // the abort itself surfaces as an error from the SDK
      throw error;
    } finally {
      context.signal.removeEventListener("abort", onAbort);
    }
  }
}
