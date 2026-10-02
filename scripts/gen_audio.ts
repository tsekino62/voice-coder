/**
 * Synthesizes the test takes with ElevenLabs into test/audio/ (16 kHz mono WAV).
 * The WAVs are committed; run this only to regenerate them:
 *
 *   npm run gen:audio            # files that do not exist yet
 *   npm run gen:audio -- --force # all of them (spends ElevenLabs credits)
 *   npm run gen:audio -- --dry-run
 *
 * Reads ELEVENLABS_API_KEY from the environment.
 */
import "./loadEnv.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWav, SAMPLE_RATE } from "../src/audio/wav.js";
import { ALL_TAKES as TAKES } from "../src/eval/takes.js";

const OUT_DIR = join(import.meta.dirname, "..", "test", "audio");
const MODEL_ID = "eleven_v4";
// Same two Japanese voices as stt_probe/gen_tts.py, alternating per take
const VOICES = [
  { id: "NvSwc1Fm9CxYkup0obxp", name: "Ren - Calm & Clear" },
  { id: "ScazEYvwuU9vkWE1NJuE", name: "Kagami - Storyteller & Broadcaster" },
];
const LEAD_SILENCE_S = 0.5; // a mic stream has some room tone before the voice

async function synthesize(apiKey: string, voiceId: string, text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_${SAMPLE_RATE}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  });
  if (!response.ok) throw new Error(`${response.status}: ${(await response.text()).slice(0, 300)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  const jobs = TAKES.map((take, i) => ({ take, voice: VOICES[i % VOICES.length] })).filter(
    ({ take }) => force || !existsSync(join(OUT_DIR, take.file)),
  );
  console.log(`${TAKES.length} takes, ${jobs.length} to generate`);
  for (const { take, voice } of jobs) console.log(`  ${take.file.padEnd(16)} [${voice.name}] ${take.text}`);
  if (dryRun || jobs.length === 0) return;

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { take, voice } of jobs) {
    const pcm = await synthesize(apiKey, voice.id, take.text);
    const lead = Buffer.alloc(Math.round(LEAD_SILENCE_S * SAMPLE_RATE) * 2);
    writeFileSync(join(OUT_DIR, take.file), encodeWav(Buffer.concat([lead, pcm])));
    console.log(`  ok ${take.file} (${(pcm.length / (SAMPLE_RATE * 2)).toFixed(2)} s)`);
  }
  const manifest = TAKES.map((take, i) => ({ ...take, voice: VOICES[i % VOICES.length].name, model: MODEL_ID }));
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
