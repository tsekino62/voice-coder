/**
 * Try the voice layer with a real microphone, outside VS Code.
 * Enter starts listening, Enter again stops (push-to-talk); q + Enter quits.
 * Shows partials, the speculative dispatch, the final and the agent's reply,
 * and after each stop the times from the end of speech.
 *
 *   npm run mic
 *   npm run mic -- --python D:\work\stt_probe\.venv\Scripts\python.exe --device 1
 *   npm run mic -- --reader regex --agent off
 *   npm run mic -- --file src/intent/parser.ts --save recordings
 *   npm run mic -- --list-devices
 *   npm run mic -- --wav test/audio/para_debug_1.wav   # replay a file instead of the mic
 *
 * Keys: SONIOX_API_KEY (required), TYPESAFE_API_KEY (hybrid / jev),
 * OPENAI_API_KEY or ANTHROPIC_API_KEY (agent), from the environment or .env.
 */
import "./loadEnv.js";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import type { AgentBackend, AgentTarget } from "../src/agent/AgentBackend.js";
import { ClaudeAgentBackend } from "../src/agent/ClaudeAgentBackend.js";
import { OpenAIAgentBackend } from "../src/agent/OpenAIAgentBackend.js";
import { SidecarAudioSource } from "../src/audio/sidecar.js";
import type { AudioSource } from "../src/audio/source.js";
import { encodeWav, speechBounds } from "../src/audio/wav.js";
import { hybridReader } from "../src/intent/hybrid.js";
import { JevIntentReader } from "../src/intent/jev.js";
import { parseIntent } from "../src/intent/parser.js";
import { IntentSpeculator, type Dispatch, type IntentReader, type Resolution } from "../src/intent/speculator.js";
import type { Intent } from "../src/intent/types.js";
import { SonioxBackend } from "../src/stt/SonioxBackend.js";

const ROOT = join(import.meta.dirname, "..");
const SIDECAR = join(ROOT, "python", "mic_sidecar.py");

const { values: opts } = parseArgs({
  options: {
    python: { type: "string", default: process.env.VOICE_CODER_PYTHON ?? "python" },
    device: { type: "string" },
    reader: { type: "string", default: "hybrid" },
    agent: { type: "string" },
    model: { type: "string" },
    file: { type: "string" },
    save: { type: "string" },
    wav: { type: "string" },
    "list-devices": { type: "boolean", default: false },
  },
});

// A small file to explain / debug when --file is not given (line 13 has a bug)
const SAMPLE = `// sample.ts
export function fizzBuzz(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else out.push(String(i));
  }
  return out;
}

export function average(values: number[]): number {
  let sum: number = "0";
  for (const v of values) sum += v;
  return sum / values.length;
}

export async function fetchUser(id: string) {
  const res = await fetch(\`/api/users/\${id}\`);
  return res.json();
}
`;

// What the agent is told the language is (VS Code gives the editor's language mode instead)
const LANGUAGES: Record<string, string> = {
  ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript",
  ".py": "python", ".java": "java", ".kt": "kotlin", ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php",
  ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".h": "c", ".swift": "swift", ".scala": "scala", ".sql": "sql", ".sh": "shellscript",
};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const sec = (ms: number) => `${ms >= 0 ? "+" : ""}${(ms / 1000).toFixed(2)} s`;
const label = (intent: Intent | null) => (intent ? `${intent.kind}${intent.range ? ` ${intent.range.from}-${intent.range.to}行目` : ""}` : "（コマンドなし）");

function fail(message: string): never {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

/** Passes the sidecar's audio through, keeping a copy and when the first chunk arrived. */
class TappedSource implements AudioSource {
  readonly chunks_: Buffer[] = [];
  firstChunkAt: number | undefined;
  constructor(private readonly inner: AudioSource) {}
  async *chunks(signal: AbortSignal): AsyncIterable<Buffer> {
    for await (const chunk of this.inner.chunks(signal)) {
      this.firstChunkAt ??= performance.now();
      this.chunks_.push(chunk);
      yield chunk;
    }
  }
  get pcm(): Buffer {
    return Buffer.concat(this.chunks_);
  }
}

function makeReader(): { read: IntentReader; name: string } {
  const mode = opts.reader;
  if (mode === "regex") return { read: parseIntent, name: "regex" };
  if (!process.env.TYPESAFE_API_KEY) {
    console.log(dim("TYPESAFE_API_KEY が無いので正規表現だけで意図を読みます"));
    return { read: parseIntent, name: "regex" };
  }
  const jev = new JevIntentReader();
  return mode === "jev" ? { read: jev.read, name: "jev" } : { read: hybridReader(jev.read), name: "hybrid" };
}

function makeAgent(): { agent: AgentBackend | undefined; name: string } {
  const choice = opts.agent ?? (process.env.OPENAI_API_KEY ? "openai" : "off");
  if (choice === "off") return { agent: undefined, name: "off" };
  if (choice === "openai") {
    if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY がありません（--agent off で LLM なしにできます）");
    return { agent: new OpenAIAgentBackend({ model: opts.model }), name: `openai ${opts.model ?? "(gpt-6.1-sol)"}` };
  }
  if (choice === "claude") return { agent: new ClaudeAgentBackend({ model: opts.model }), name: `claude ${opts.model ?? "(claude-opus-5-5)"}` };
  fail(`--agent は openai / claude / off のどれか: ${choice}`);
}

interface Run {
  dispatch: Dispatch;
  output: string;
  firstTextAt: number | undefined;
  live: boolean;
  done: Promise<void>;
}

async function main(): Promise<void> {
  if (opts["list-devices"]) {
    spawnSync(opts.python, [SIDECAR, "--list-devices"], { stdio: "inherit" });
    return;
  }
  const soniox = process.env.SONIOX_API_KEY;
  if (!soniox) fail("SONIOX_API_KEY がありません（環境変数か .env）");
  const check = spawnSync(opts.python, ["-c", "import pyaudio"], { encoding: "utf8" });
  if (!opts.wav && check.status !== 0) {
    fail(
      `${opts.python} で PyAudio が使えません。\n` +
        `  pip install pyaudio するか、PyAudio 入りの Python を指定してください:\n` +
        `  npm run mic -- --python D:\\work\\stt_probe\\.venv\\Scripts\\python.exe`,
    );
  }

  const fileText = opts.file ? readFileSync(opts.file, "utf8") : SAMPLE;
  const fileName = opts.file ? basename(opts.file) : "sample.ts";
  const languageId = LANGUAGES[extname(fileName).toLowerCase()] ?? "plaintext";
  const lines = fileText.split("\n");
  const describeTarget = (intent: Intent) => {
    const where = opts.file ? fileName : `${fileName}（内蔵サンプル。自分のファイルは --file で指定）`;
    if (intent.kind === "generate") return `${where} の末尾に書く想定（このツールは表示だけで書き込まない）`;
    const range = intent.range;
    if (!range) return `${where} 全体`;
    const beyond = range.from > lines.length ? `  ⚠ ${lines.length} 行しかないファイルです` : "";
    return `${where} ${range.from}-${Math.min(range.to, lines.length)}行目${beyond}`;
  };
  const reader = makeReader();
  const { agent, name: agentName } = makeAgent();

  console.log(bold("voice-coder マイク試験"));
  console.log(dim(`  Python: ${opts.python}  ${opts.wav ? `音声: ${opts.wav}（マイクの代わり）` : `デバイス: ${opts.device ?? "既定"}`}  意図: ${reader.name}  LLM: ${agentName}  対象: ${fileName}（${lines.length} 行）`));
  console.log(dim("  Enter で話し始め、話し終えたら Enter で止める。q + Enter で終了。"));
  console.log(dim("  例: 「FizzBuzzを作って」「13行目から17行目を解説して」「テストが通らないんだけど」\n"));

  const stdin = createInterface({ input: process.stdin });
  const nextLine = () => new Promise<string>((resolve) => stdin.once("line", resolve));
  let take = 0;

  while (true) {
    process.stdout.write(bold("[Enter] 話し始める > "));
    if ((await nextLine()).trim().toLowerCase() === "q") break;
    take++;

    const source = new TappedSource(
      new SidecarAudioSource({
        python: opts.python,
        script: SIDECAR,
        args: opts.wav ? ["--wav", opts.wav] : opts.device ? ["--device", opts.device] : [],
      }),
    );
    const backend = new SonioxBackend(source, { apiKey: soniox, maxEndpointDelayMs: 1000 });
    const runs = new Map<Dispatch, Run>();
    const resolutions: Resolution[] = [];
    let partialShown = false;
    // The agent's reply streams in pieces; a status line must not land mid-line
    let midLine = false;
    const write = (text: string) => {
      if (!text) return;
      process.stdout.write(text);
      midLine = !text.endsWith("\n");
    };
    const say = (line: string) => {
      if (partialShown) process.stdout.write("\r\x1b[K");
      partialShown = false;
      if (midLine) process.stdout.write("\n");
      midLine = false;
      console.log(line);
    };

    new IntentSpeculator(
      backend,
      {
        onIntent: (dispatch) => {
          say(`  ${dispatch.speculative ? "▶ 先読み発火" : "▶ final で発火"}: ${bold(label(dispatch.intent))}  ${dim(`(音声開始から ${sec(dispatch.atMs)})`)}`);
          if (!agent) return;
          const range = dispatch.intent.range;
          const startLine = range ? Math.max(0, range.from - 1) : 0;
          const endLine = range ? Math.min(lines.length - 1, range.to - 1) : lines.length - 1;
          const target: AgentTarget =
            dispatch.intent.kind === "generate"
              ? { fileName, languageId, startLine: lines.length, endLine: lines.length, code: "" }
              : { fileName, languageId, startLine, endLine, code: lines.slice(startLine, endLine + 1).join("\n") };
          const diagnostics = dispatch.intent.kind === "debug" && !opts.file ? [{ line: 13, message: "Type 'string' is not assignable to type 'number'." }] : [];
          const run: Run = { dispatch, output: "", firstTextAt: undefined, live: false, done: Promise.resolve() };
          run.done = (async () => {
            for await (const text of agent.run(dispatch.intent, target, { utterance: dispatch.text, documentText: fileText, diagnostics, signal: dispatch.signal })) {
              run.firstTextAt ??= performance.now() - backend.startedAt;
              run.output += text;
              if (run.live) write(text);
            }
          })();
          run.done.catch(() => {});
          runs.set(dispatch, run);
        },
        onResolved: (resolution) => {
          resolutions.push(resolution);
          say(`  ✓ final: ${resolution.text}`);
          for (const aborted of resolution.aborted) say(`  ✗ 先読みを中断: ${label(aborted.intent)}`);
          const standing = resolution.dispatch;
          say(`  = 採用: ${bold(label(resolution.intent))}${standing ? (standing.speculative ? "（先読みが当たり）" : "（final で発火）") : ""}`);
          if (resolution.intent) say(`  対象: ${describeTarget(resolution.intent)}`);
          const run = standing && runs.get(standing);
          if (run) {
            say(dim("  --- 応答 ---"));
            write(run.output);
            run.live = true;
            run.done.then(
              () => say(dim("  --- ここまで ---")),
              (error) => say(`  LLM エラー: ${error instanceof Error ? error.message : error}`),
            );
          }
        },
      },
      reader.read,
    );
    backend.onPartial(({ text }) => {
      // While a reply is streaming, partials of the next utterance stay off screen
      if (midLine) return;
      process.stdout.write(`\r\x1b[K  … ${text}`);
      partialShown = true;
    });

    try {
      await backend.start();
    } catch (error) {
      say(`  接続できません: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    say(dim("  ● 聞いています…（話し終えたら Enter）"));
    await nextLine();
    say(dim("  ■ 停止。final を待っています…"));
    await backend.stop();
    if (backend.error) say(`  エラー: ${backend.error.message}`);
    // Let the final's intent read and the agent finish before the summary
    await new Promise((resolve) => setTimeout(resolve, 300));
    await Promise.all([...runs.values()].filter((r) => r.live).map((r) => r.done.catch(() => {})));

    const pcm = source.pcm;
    if (opts.save) {
      mkdirSync(opts.save, { recursive: true });
      const path = join(opts.save, `take_${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
      writeFileSync(path, encodeWav(pcm));
      say(dim(`  録音を保存: ${path}`));
    }
    const bounds = speechBounds(pcm);
    const last = resolutions.filter((r) => r.intent).at(-1) ?? resolutions.at(-1);
    if (!pcm.length) say("  音声が届いていません（マイクの指定を確認: --list-devices）");
    else if (!bounds) say("  音声は届いたが発話を検出できませんでした（音が小さい？）");
    else if (!last) say("  final が返りませんでした");
    else {
      // The sidecar starts after the socket opens: audio time 0 is when its first chunk arrived
      const audioStart = (source.firstChunkAt ?? backend.startedAt) - backend.startedAt;
      const speechEnd = audioStart + bounds.end * 1000;
      const run = last.dispatch && runs.get(last.dispatch);
      const parts = [
        last.dispatch ? `意図発火 ${sec(last.dispatch.atMs - speechEnd)}` : undefined,
        `final ${sec(last.finalAtMs - speechEnd)}`,
        `意図確定 ${sec(last.resolvedAtMs - speechEnd)}`,
        run?.firstTextAt !== undefined ? `LLM 最初の文字 ${sec(run.firstTextAt - speechEnd)}` : undefined,
      ].filter(Boolean);
      say(`  ⏱ 発話終了から: ${parts.join(" / ")}`);
      say(dim(`     （発話 ${(bounds.end - bounds.start).toFixed(2)} s、録音 ${(pcm.length / 32000).toFixed(1)} s。発話終了は音量から推定）`));
    }
    console.log("");
  }
  stdin.close();
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
