// Bundles the extension and the VS Code integration tests into CommonJS.
import { build } from "esbuild";
import { readdirSync } from "node:fs";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "warning",
  // vscode is provided by the host; the Agent SDK is ESM that locates its own binary
  external: ["vscode", "@anthropic-ai/claude-agent-sdk", "@picovoice/pvrecorder-node", "bufferutil", "utf-8-validate", "mocha"],
};

await build({ ...common, entryPoints: ["src/extension/extension.ts"], outfile: "dist/extension.cjs" });

const vscodeTests = readdirSync("test/vscode").filter((f) => f.endsWith(".ts")).map((f) => `test/vscode/${f}`);
await build({ ...common, entryPoints: vscodeTests, outdir: "out/test/vscode", outExtension: { ".js": ".cjs" } });
await build({ ...common, entryPoints: ["test/demo/demo.ts"], outfile: "out/demo/demo.cjs" });
await build({ ...common, entryPoints: ["test/runTest.ts"], outfile: "out/test/runTest.cjs", external: [...common.external, "@vscode/test-electron"] });
