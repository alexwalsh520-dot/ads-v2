#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// SETUP — gets the boring files into place and generates the secrets that
// nobody should be inventing by hand.
//
//     npm run setup
//
// It never overwrites anything you already have, and it never asks you a
// question it can answer itself. What it cannot do is create your Supabase
// project or your Google OAuth client — those need a human in a browser, and
// docs/SOP.md walks through them.
// ─────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const done = [];
const skipped = [];

// ── .env.local ────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, ".env.local");
if (existsSync(envPath)) {
  skipped.push(".env.local already exists — left untouched");
} else {
  copyFileSync(path.join(ROOT, ".env.example"), envPath);
  done.push("created .env.local from .env.example");
}

// Fill in the three secrets that are pure randomness. Only ever writes into a
// blank value, so re-running cannot rotate a secret out from under a live
// deployment — that would sign every existing session out.
let env = readFileSync(envPath, "utf8");
const generated = [];
for (const [key, make] of [
  ["AUTH_SECRET", () => randomBytes(32).toString("base64")],
  ["CRON_SECRET", () => randomBytes(32).toString("hex")],
  ["WEBHOOK_SECRET", () => randomBytes(32).toString("hex")],
]) {
  const re = new RegExp(`^${key}=\\s*$`, "m");
  if (re.test(env)) {
    env = env.replace(re, `${key}=${make()}`);
    generated.push(key);
  }
}
if (generated.length) {
  writeFileSync(envPath, env);
  done.push(`generated ${generated.join(", ")}`);
}

// ── adsv2.config.json ─────────────────────────────────────────────────────
const configPath = path.join(ROOT, "adsv2.config.json");
const examplePath = path.join(ROOT, "adsv2.config.example.json");
if (existsSync(configPath)) {
  skipped.push("adsv2.config.json already exists — left untouched");
} else if (existsSync(examplePath)) {
  copyFileSync(examplePath, configPath);
  done.push("created adsv2.config.json from the example");
}

console.log("\nSetup\n");
for (const line of done) console.log(`  done   ${line}`);
for (const line of skipped) console.log(`  skip   ${line}`);

console.log(`
Still needs a human (a browser and about 20 minutes) — see docs/SOP.md:

  1. Create a Supabase project, put its three keys in .env.local
  2. Create a Google OAuth client, put its two keys in .env.local
  3. Create a Meta System User token per creator, put it in .env.local
  4. Describe your creators in adsv2.config.json

Then:

  npm run migrate     create the database schema
  npm run doctor      check what is still missing
  npm run dev         open http://localhost:3000
`);
