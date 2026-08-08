// Reading and writing .env.local, shared by every script.
//
// Kept deliberately small and dependency-free so the scripts run before
// `npm install` has finished, which is exactly when someone needs them most.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_PATH = path.join(ROOT, ".env.local");

/** Load .env.local and .env into process.env without overwriting real env vars. */
export function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

/**
 * Set values in .env.local, in place.
 *
 * Rewrites a key that already exists rather than appending a second copy —
 * a file with two lines for the same name is a bug that is very hard to see
 * and behaves differently depending on who reads it.
 */
export function setEnv(values) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
    process.env[key] = String(value);
  }
  writeFileSync(ENV_PATH, text);
}

export function getEnv(key) {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : null;
}

export const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Wait, printing a dot every few seconds so a long step does not look dead. */
export async function waitWithDots(ms) {
  const step = 3000;
  for (let waited = 0; waited < ms; waited += step) {
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
    process.stdout.write(".");
  }
}
