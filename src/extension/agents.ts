import * as vscode from "vscode";
import type { AgentBackend, AgentContext, AgentTarget } from "../agent/AgentBackend.js";
import { buildPrompt } from "../agent/prompt.js";
import type { Intent } from "../intent/types.js";
import { t } from "./messages.js";

type SelectModels = (selector: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

/** The Copilot chat models VS Code offers this extension (none without Copilot). */
export function copilotModels(select: SelectModels = vscode.lm.selectChatModels): Thenable<vscode.LanguageModelChat[]> {
  return select({ vendor: "copilot" });
}

/**
 * Without a configured model: Copilot's "Auto" (what Copilot Chat uses by default),
 * else the first model that is not one of its small utility models.
 */
export function preferredModel(models: vscode.LanguageModelChat[]): vscode.LanguageModelChat {
  return (
    models.find((m) => m.name === "Auto") ??
    models.find((m) => !/utility|mini|nano/i.test(`${m.family} ${m.name}`)) ??
    models[0]
  );
}

/**
 * GitHub Copilot's models through VS Code's Language Model API: no API key of
 * our own, the user's Copilot plan pays. VS Code asks the user once whether
 * this extension may use them.
 */
export class CopilotAgentBackend implements AgentBackend {
  constructor(private readonly options: { family?: string; select?: SelectModels } = {}) {}

  async *run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string> {
    if (context.signal.aborted) return;
    const models = await copilotModels(this.options.select);
    if (models.length === 0) throw new Error(t("copilotUnavailable"));
    const model = (this.options.family && models.find((m) => m.family === this.options.family || m.id === this.options.family)) || preferredModel(models);

    const prompt = buildPrompt(intent, target, context);
    const cancel = new vscode.CancellationTokenSource();
    const onAbort = () => cancel.cancel();
    context.signal.addEventListener("abort", onAbort, { once: true });
    try {
      // The Language Model API has no system role: the instructions lead the user message
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(`${prompt.system}\n\n${prompt.user}`)],
        { justification: t("copilotJustification") },
        cancel.token,
      );
      for await (const text of response.text) {
        if (context.signal.aborted) return;
        yield text;
      }
    } catch (error) {
      if (context.signal.aborted) return;
      if (error instanceof vscode.LanguageModelError) throw new Error(`Copilot (${error.code}): ${error.message}`);
      throw error;
    } finally {
      context.signal.removeEventListener("abort", onAbort);
      cancel.dispose();
    }
  }
}

/**
 * voiceCoder.agent "auto": Copilot when VS Code offers its models, else OpenAI
 * when OPENAI_API_KEY is set; decided on every command, so signing in to
 * Copilot (or adding a key) takes effect at once.
 */
export class AutoAgentBackend implements AgentBackend {
  constructor(
    private readonly copilot: () => AgentBackend,
    private readonly openai: (() => AgentBackend) | undefined,
    private readonly select: SelectModels = vscode.lm.selectChatModels,
  ) {}

  async *run(intent: Intent, target: AgentTarget, context: AgentContext): AsyncIterable<string> {
    const hasCopilot = (await copilotModels(this.select)).length > 0;
    const backend = hasCopilot ? this.copilot() : this.openai?.();
    if (!backend) throw new Error(t("noAgent"));
    yield* backend.run(intent, target, context);
  }
}
