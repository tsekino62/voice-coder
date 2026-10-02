import OpenAI from "openai";
import type { Intent } from "../intent/types.js";
import type { AgentBackend, AgentContext, AgentTarget } from "./AgentBackend.js";
import { buildPrompt } from "./prompt.js";

export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";

export interface OpenAIAgentOptions {
  apiKey?: string;
  model?: string;
  /** For tests: a fetch that stands in for the network. */
  fetch?: typeof fetch;
  baseURL?: string;
}

/**
 * OpenAI through the Responses API: one request, no tools, output text
 * streamed as it is generated. Aborting the context's signal cancels the
 * request, including while the response is still streaming.
 */
export class OpenAIAgentBackend implements AgentBackend {
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIAgentOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: options.baseURL,
      fetch: options.fetch,
    });
  }

  async *run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string> {
    if (context.signal.aborted) return;
    const prompt = buildPrompt(intent, target, context);
    try {
      const stream = await this.client.responses.create(
        {
          model: this.options.model || DEFAULT_OPENAI_MODEL,
          instructions: prompt.system,
          input: prompt.user,
          stream: true,
          store: false,
        },
        { signal: context.signal },
      );
      for await (const event of stream) {
        if (context.signal.aborted) return;
        if (event.type === "response.output_text.delta") yield event.delta;
        else if (event.type === "error") throw new Error(`OpenAI: ${event.message}`);
        else if (event.type === "response.failed") throw new Error(`OpenAI: ${event.response.error?.message ?? "response failed"}`);
      }
    } catch (error) {
      if (context.signal.aborted) return; // the abort itself surfaces as an error from the SDK
      throw error;
    }
  }
}
