#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// LIST CALENDARS — prints the booking calendars that actually appear in YOUR
// data, with how many bookings each holds.
//
//     npm run calendars
//
// Why this exists: `salesCalendarIds` in adsv2.config.json is the setting that
// silently breaks booking numbers when it is wrong, and you cannot guess the
// ids. Look at this list and pin the ones that are genuinely SALES calls.
//
// WATCH FOR NEAR-DUPLICATES. CRMs make it easy to end up with "Strategy
// Session (TS)" and "Strategy Session - (TS)" side by side, and bookings quietly
// split between them. If your booked count looks low, that is the first thing
// to check. Pin every id that is really a sales call, duplicates included.
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env.local", ".env"]) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const res = await fetch(
  `${url}/rest/v1/ghl_appointments?select=calendar_id,calendar_name,client,start_time&order=start_time.desc&limit=5000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
);
if (!res.ok) {
  console.error(`Could not read bookings: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const rows = await res.json();
if (!rows.length) {
  console.log("\nNo bookings recorded yet. Send one test booking through the webhook, then run this again.\n");
  process.exit(0);
}

const byId = new Map();
for (const row of rows) {
  const id = row.calendar_id || "(no id)";
  const entry = byId.get(id) || { id, names: new Set(), clients: new Set(), count: 0, latest: "" };
  entry.count += 1;
  if (row.calendar_name) entry.names.add(row.calendar_name);
  if (row.client) entry.clients.add(row.client);
  if (row.start_time && row.start_time > entry.latest) entry.latest = row.start_time;
  byId.set(id, entry);
}

const list = [...byId.values()].sort((a, b) => b.count - a.count);

console.log(`\nCalendars found in ${rows.length} recent bookings:\n`);
for (const entry of list) {
  const name = [...entry.names].join(" / ") || "(unnamed)";
  const clients = [...entry.clients].join(", ") || "unassigned";
  console.log(`  ${String(entry.count).padStart(5)}  ${entry.id}`);
  console.log(`         ${name}`);
  console.log(`         creator: ${clients}   latest: ${entry.latest.slice(0, 10) || "?"}\n`);
}

// Flag likely duplicates by name similarity, since that is the failure mode
// that actually bites and it is invisible if you are only reading ids.
const normalized = new Map();
for (const entry of list) {
  for (const name of entry.names) {
    const k = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const seen = normalized.get(k) || [];
    seen.push(entry.id);
    normalized.set(k, seen);
  }
}
const dupes = [...normalized.entries()].filter(([, ids]) => new Set(ids).size > 1);
if (dupes.length) {
  console.log("Possible duplicate calendars (same name, different ids):");
  for (const [, ids] of dupes) console.log(`  ${[...new Set(ids)].join("  +  ")}`);
  console.log("If both are really sales calls, pin BOTH ids or you will undercount bookings.\n");
}

console.log('Add the sales ones to "salesCalendarIds" for the right creator in adsv2.config.json.\n');
