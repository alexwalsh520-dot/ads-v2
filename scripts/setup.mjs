#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// FIRST-RUN SETUP — puts the boring files in place and makes up the random
// passwords so nobody has to invent one.
//
//     npm run setup
//
// It never overwrites anything you already filled in.
// ─────────────────────────────────────────────────────────────────────────

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ENV_PATH, ROOT, c } from "./lib/env-file.mjs";

const done = [];
const skipped = [];

// ── .env.local ────────────────────────────────────────────────────────────
if (existsSync(ENV_PATH)) {
  skipped.push(".env.local already exists, so it was left alone");
} else {
  copyFileSync(path.join(ROOT, ".env.example"), ENV_PATH);
  done.push("made .env.local");
}

// Fill in the values that are pure randomness. Only ever writes into a BLANK
// value, so running this again cannot rotate a secret out from under a live
// site — which would sign everyone out and break the hourly update.
let env = readFileSync(ENV_PATH, "utf8");
const generated = [];

// A readable passphrase rather than random noise: a password someone can
// actually retype on their phone is a password they will not write on a
// sticky note.
const WORDS = [
  "anchor", "basket", "canyon", "cedar", "copper", "delta", "ember", "falcon",
  "granite", "harbor", "indigo", "juniper", "kestrel", "lantern", "meadow",
  "nickel", "orchard", "pebble", "quartz", "ribbon", "saddle", "timber",
  "umber", "velvet", "walnut", "yarrow",
];
function passphrase() {
  const pick = () => WORDS[randomBytes(1)[0] % WORDS.length];
  const digits = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000));
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

for (const [key, make] of [
  ["APP_PASSWORD", passphrase],
  ["AUTH_SECRET", () => randomBytes(32).toString("base64url")],
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
  writeFileSync(ENV_PATH, env);
  done.push(`made up ${generated.join(", ")}`);
}

// ── adsv2.config.json ─────────────────────────────────────────────────────
const configPath = path.join(ROOT, "adsv2.config.json");
const examplePath = path.join(ROOT, "adsv2.config.example.json");
if (existsSync(configPath)) {
  skipped.push("adsv2.config.json already exists, so it was left alone");
} else if (existsSync(examplePath)) {
  copyFileSync(examplePath, configPath);
  done.push("made adsv2.config.json");
}

const password = (readFileSync(ENV_PATH, "utf8").match(/^APP_PASSWORD=(.*)$/m) || [])[1];

console.log("\nSetup\n");
for (const line of done) console.log(`  ${c.green("done")}  ${line}`);
for (const line of skipped) console.log(`  ${c.dim("skip")}  ${c.dim(line)}`);

if (password) {
  console.log(`
  ${c.bold("Your dashboard password is:")}  ${c.bold(password)}

  Write it down. You can change it any time by editing APP_PASSWORD
  in .env.local (and in your hosting settings, once you are online).`);
}

console.log(`
Next:

  ${c.bold("npm run db")}       make the database        (needs a Supabase token)
  ${c.bold("npm run doctor")}   see what is still missing
  ${c.bold("npm run deploy")}   put it on the internet   (needs a Vercel token)

Not sure? Open this folder in Claude and say "install this".
`);
