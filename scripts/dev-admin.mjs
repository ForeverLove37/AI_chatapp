import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const adminEnvironment = { ...process.env };
for (const name of [
  "KEY",
  "URL",
  "OPENAI_API_KEY",
  "OPENAI_API_KEYS",
  "GEMINI_API_KEY",
  "GEMINI_API_KEYS",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_API_KEYS",
  "UPSTREAM_KEY_ENCRYPTION_SECRET",
]) {
  delete adminEnvironment[name];
}

const nextCli = resolve("node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextCli, "dev", "apps/admin"], {
  env: adminEnvironment,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
