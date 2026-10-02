/**
 * Sends one generate / explain / debug request to the configured agent and prints
 * the reply with time-to-first-text. Reads OPENAI_API_KEY (or ANTHROPIC_API_KEY with --claude).
 *
 *   npm run try:agent
 *   npm run try:agent -- --model gpt-6-luna
 */
import "./loadEnv.js";
import type { AgentBackend, AgentTarget } from "../src/agent/AgentBackend.js";
import { ClaudeAgentBackend } from "../src/agent/ClaudeAgentBackend.js";
import { OpenAIAgentBackend } from "../src/agent/OpenAIAgentBackend.js";
import { parseIntent } from "../src/intent/parser.js";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const agent: AgentBackend = args.includes("--claude") ? new ClaudeAgentBackend({ model }) : new OpenAIAgentBackend({ model });

const file = ["function total(items: number[]): number {", '  let sum: number = "0";', "  for (const item of items) sum += item;", "  return sum;", "}"].join("\n");
const cases: Array<{ utterance: string; target: AgentTarget; diagnostics: Array<{ line: number; message: string }> }> = [
  { utterance: "FizzBuzzを作って", target: { fileName: "main.ts", languageId: "typescript", startLine: 5, endLine: 5, code: "" }, diagnostics: [] },
  { utterance: "1行目から5行目を解説して", target: { fileName: "main.ts", languageId: "typescript", startLine: 0, endLine: 4, code: file }, diagnostics: [] },
  {
    utterance: "デバッグして",
    target: { fileName: "main.ts", languageId: "typescript", startLine: 0, endLine: 4, code: file },
    diagnostics: [{ line: 1, message: "Type 'string' is not assignable to type 'number'." }],
  },
];

for (const { utterance, target, diagnostics } of cases) {
  const intent = parseIntent(utterance)!;
  const started = performance.now();
  let first: number | undefined;
  let reply = "";
  for await (const text of agent.run(intent, target, { utterance, documentText: file, diagnostics, signal: new AbortController().signal })) {
    first ??= performance.now() - started;
    reply += text;
  }
  const total = performance.now() - started;
  console.log(`\n=== ${intent.kind}: ${utterance}  (first text ${Math.round(first ?? total)} ms, done ${Math.round(total)} ms)\n${reply}`);
}
