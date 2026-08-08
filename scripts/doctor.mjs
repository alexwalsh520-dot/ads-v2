#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// DOCTOR — tells you exactly what is set up, what is not, and what each gap
// actually costs you. Safe to run at any point, as often as you like: it only
// reads.
//
//     npm run doctor
//
// Written for the person (or the assistant) doing the install: every failure
// says what to do about it, not just that something is wrong.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── tiny env loader, so this works with no dependencies installed ─────────
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const results = [];
function ok(what, detail) { results.push({ level: "ok", what, detail }); }
function warn(what, detail) { results.push({ level: "warn", what, detail }); }
function bad(what, detail) { results.push({ level: "bad", what, detail }); }

// A value that is obviously still the example is worse than a blank one: blank
// fails loudly, a placeholder fails at runtime with a confusing error.
const PLACEHOLDER = /YOUR-|example\.com|CHANGE.?ME|act_123456789|<.*>/i;

function has(name) {
  const value = (process.env[name] || "").trim();
  if (!value) return false;
  if (PLACEHOLDER.test(value)) return false;
  return true;
}

// ── config ────────────────────────────────────────────────────────────────
let config = null;
const configPath = path.join(ROOT, "adsv2.config.json");
if (!existsSync(configPath)) {
  bad("adsv2.config.json", "missing. Copy adsv2.config.example.json to adsv2.config.json.");
} else {
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
    const creators = Array.isArray(config.creators) ? config.creators : [];
    const active = creators.filter((x) => x.active !== false);
    if (!creators.length) {
      bad("creators", "none configured. Ads V2 has nothing to show.");
    } else if (creators.some((x) => x.key === "example")) {
      bad("creators", 'the placeholder "example" creator is still there. Replace it with a real one.');
    } else {
      ok("creators", `${active.length} active of ${creators.length} configured`);
    }
    for (const creator of active) {
      if (!creator.salesCalendarIds?.length) {
        warn(
          `${creator.key}: sales calendars`,
          "none pinned, so NO booked calls will be counted for this creator. Run `npm run calendars` once bookings exist, then pin the sales calendar ids.",
        );
      }
    }
  } catch (err) {
    bad("adsv2.config.json", `is not valid JSON: ${err.message}`);
  }
}

// ── required environment ──────────────────────────────────────────────────
const REQUIRED = [
  ["NEXT_PUBLIC_SUPABASE_URL", "the database. Nothing works without it."],
  ["SUPABASE_SERVICE_ROLE_KEY", "the database write key. Nothing works without it."],
  ["AUTH_GOOGLE_ID", "sign-in. You cannot open the dashboard without it."],
  ["AUTH_GOOGLE_SECRET", "sign-in. You cannot open the dashboard without it."],
  ["AUTH_SECRET", "session signing. Generate with: openssl rand -base64 32"],
  ["ALLOWED_EMAILS", "who is allowed in. With none set, nobody can sign in."],
];
for (const [name, why] of REQUIRED) {
  if (has(name)) ok(name);
  else bad(name, why);
}

const RECOMMENDED = [
  ["CRON_SECRET", "without it the scheduled sync cannot authenticate and your numbers stop updating."],
  ["WEBHOOK_SECRET", "without it the ManyChat and booking webhooks reject every delivery, so no DMs or bookings arrive."],
  ["AUTH_URL", "needed in production so Google redirects back to the right host."],
];
for (const [name, why] of RECOMMENDED) {
  if (has(name)) ok(name);
  else warn(name, why);
}

// ── Meta credentials, per creator ─────────────────────────────────────────
if (config?.creators) {
  for (const creator of config.creators.filter((x) => x.active !== false)) {
    const account = (creator.adAccountEnv || []).find(has);
    const token = (creator.tokenEnv || []).find(has);
    if (account && token) {
      ok(`${creator.key}: Meta credentials`, account);
    } else {
      bad(
        `${creator.key}: Meta credentials`,
        `set ${(creator.adAccountEnv || []).join(" or ")} and ${(creator.tokenEnv || []).join(" or ")}. Without both, this creator has no spend at all.`,
      );
    }
  }
}

// ── sales sheet ───────────────────────────────────────────────────────────
if (config?.salesSheet?.enabled) {
  const idEnv = config.salesSheet.spreadsheetIdEnv || "GOOGLE_SHEETS_SPREADSHEET_ID";
  if (has("GOOGLE_SHEETS_API_KEY") && has(idEnv)) ok("sales sheet");
  else bad("sales sheet", `enabled in config but GOOGLE_SHEETS_API_KEY and/or ${idEnv} are missing. No revenue means no ROAS.`);
} else {
  warn("sales sheet", "disabled. You will see spend, DMs, booked calls and show rate — but no cash and no ROAS.");
}

// ── database reachability and schema ──────────────────────────────────────
const TABLES = [
  "ads_meta_insights_daily", "ads_keyword_events", "ghl_appointments", "sales_tracker_rows",
  "manychat_contact_links", "organic_keywords", "registry_keywords", "ad_creative_image",
  "person_context", "fx_rates", "adsv2_meta", "adsv2_dm_facts", "adsv2_booking_facts",
  "adsv2_sale_facts", "adsv2_booking_resolutions", "adsv2_sale_resolutions",
  "adsv2_budget_snapshots", "adsv2_window_snapshots", "adsv2_sync_runs", "adsv2_alerts",
  "app_users", "public_share_links",
];

async function checkDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const missing = [];
  for (const table of TABLES) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.status === 404 || res.status === 400) missing.push(table);
      else if (!res.ok) {
        warn("database", `unexpected ${res.status} reading ${table}`);
        return;
      }
    } catch (err) {
      bad("database", `unreachable: ${err.message}. Check NEXT_PUBLIC_SUPABASE_URL.`);
      return;
    }
  }

  if (missing.length === TABLES.length) {
    bad("database schema", "no tables found. Run the two files in supabase/ against your project (npm run migrate).");
  } else if (missing.length) {
    bad("database schema", `${missing.length} table(s) missing: ${missing.join(", ")}. Re-run supabase/01_tables.sql.`);
  } else {
    ok("database schema", `all ${TABLES.length} tables present`);
  }

  // Row counts tell you whether data is actually flowing, which is a different
  // question from whether the plumbing is connected.
  const counts = {};
  for (const table of ["ads_meta_insights_daily", "ads_keyword_events", "ghl_appointments", "sales_tracker_rows"]) {
    if (missing.includes(table)) continue;
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
      });
      counts[table] = res.headers.get("content-range")?.split("/")[1] ?? "?";
    } catch { /* a count is a nice-to-have, never a reason to fail the check */ }
  }
  if (Object.keys(counts).length) {
    const empty = Object.entries(counts).filter(([, n]) => n === "0").map(([t]) => t);
    const summary = Object.entries(counts).map(([t, n]) => `${t}=${n}`).join("  ");
    if (empty.length === Object.keys(counts).length) {
      warn("data", `every source table is empty. Run \`npm run sync\` once the credentials above are set.\n     ${summary}`);
    } else if (empty.length) {
      warn("data", `no rows yet in: ${empty.join(", ")}\n     ${summary}`);
    } else {
      ok("data", summary);
    }
  }
}

await checkDatabase();

// ── report ────────────────────────────────────────────────────────────────
console.log(`\n${c.bold("Ads V2 — setup check")}\n`);
for (const r of results) {
  const mark = r.level === "ok" ? c.green("  ok ") : r.level === "warn" ? c.yellow("warn") : c.red(" gap");
  console.log(`${mark}  ${r.what}${r.detail ? c.dim(` — ${r.detail}`) : ""}`);
}

const gaps = results.filter((r) => r.level === "bad");
const warns = results.filter((r) => r.level === "warn");
console.log("");
if (gaps.length) {
  console.log(c.red(`${gaps.length} thing(s) still needed before this will work.`));
  process.exitCode = 1;
} else if (warns.length) {
  console.log(c.yellow(`Ready to run. ${warns.length} optional thing(s) not set up — see the "warn" lines above.`));
} else {
  console.log(c.green("Everything is set up."));
}
console.log("");
