// Entry point VS Code calls inside the extension host: runs every *.test.cjs next to it.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", timeout: 60_000, color: true });
  for (const file of readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort()) {
    mocha.addFile(join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures ? reject(new Error(`${failures} test(s) failed`)) : resolve()));
  });
}
