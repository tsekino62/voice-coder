import { existsSync } from "node:fs";
import { join } from "node:path";

// Keys come from the environment; a local .env (git-ignored) fills in what is not set.
// process.loadEnvFile never overrides variables that already exist.
const envFile = join(import.meta.dirname, "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
