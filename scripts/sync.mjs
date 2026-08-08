#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// SYNC — runs the ingest job once, right now, against a running app.
//
//     npm run dev          (in one terminal)
//     npm run sync         (in another)
//
// Options:
//     npm run sync -- --only=meta          just Meta spend
//     npm run sync -- --lookback=90        pull further back (first run)
//     npm run sync -- --url=https://your-app.vercel.app
// ─────────────────────────────────────────────────────────────────────────

import { loadEnv } from "./lib/env-file.mjs";

loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

const base = args.url || process.env.AUTH_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET is not set, so the sync endpoint will refuse this request.");
  process.exit(1);
}

const params = new URLSearchParams();
if (args.only) params.set("only", args.only);
if (args.lookback) params.set("lookbackDays", args.lookback);
const url = `${base.replace(/\/$/, "")}/api/cron/ingest${params.toString() ? `?${params}` : ""}`;

console.log(`\nPOST ${url}\n`);
const started = Date.now();

let res;
try {
  res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
} catch (err) {
  console.error(`Could not reach the app at ${base}. Is it running? (${err.message})`);
  process.exit(1);
}

const body = await res.text();
let json;
try {
  json = JSON.parse(body);
} catch {
  console.error(`HTTP ${res.status}\n${body.slice(0, 2000)}`);
  process.exit(1);
}

console.log(JSON.stringify(json, null, 2));
console.log(`\nHTTP ${res.status} in ${Math.round((Date.now() - started) / 1000)}s`);
if (json.failures?.length) {
  console.log("\nFailures:");
  for (const f of json.failures) console.log(`  - ${f}`);
}
console.log("");
process.exitCode = res.ok || res.status === 207 ? 0 : 1;
