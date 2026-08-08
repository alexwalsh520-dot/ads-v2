#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// DOCTOR — tells you what is working, what is not, and what to do about it.
//
//     npm run doctor
//
// Safe to run whenever, as often as you like. It only reads.
//
// Every message is written for the person doing the setup, not for a
// developer. "Missing X" is useless on its own; what you need to know is what
// you lose without it and where to get it.
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, c, loadEnv } from "./lib/env-file.mjs";

loadEnv();

const results = [];
const ok = (what, detail) => results.push({ level: "ok", what, detail });
const warn = (what, detail) => results.push({ level: "warn", what, detail });
const gap = (what, detail) => results.push({ level: "gap", what, detail });

// A value that is obviously still an example is worse than a blank one: blank
// fails loudly and immediately, a leftover placeholder fails later with a
// confusing error that looks like a real problem.
const PLACEHOLDER = /^(YOUR|CHANGE|act_123456789|https:\/\/YOUR)/i;
function has(name) {
  const value = (process.env[name] || "").trim();
  return !!value && !PLACEHOLDER.test(value);
}

// ── your config file ──────────────────────────────────────────────────────
let config = null;
const configPath = path.join(ROOT, "adsv2.config.json");
if (!existsSync(configPath)) {
  gap("Your settings file", "adsv2.config.json is missing. Run `npm run setup` to make it.");
} else {
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
    const business = config.business || {};
    if (!business.name || business.name === "My Coaching Business") {
      warn("Your business name", "still says the placeholder. Change `business.name` in adsv2.config.json.");
    } else {
      ok("Your business", business.name);
    }
    if (!business.timezone) {
      gap("Your ad account timezone", "not set. Days will be cut in the wrong place without it.");
    }
    if (!business.salesCalendarIds?.length) {
      warn(
        "Sales calendars",
        "none set yet, so NO booked calls are being counted. Once a few bookings have come in, run `npm run calendars` and paste the sales ones in.",
      );
    } else {
      ok("Sales calendars", `${business.salesCalendarIds.length} set`);
    }
  } catch (err) {
    gap("Your settings file", `adsv2.config.json is not valid — usually a missing comma. ${err.message}`);
  }
}

// ── the things it cannot run without ──────────────────────────────────────
const REQUIRED = [
  ["APP_PASSWORD", "the password you type to open your dashboard. Without it nobody can get in, including you."],
  ["AUTH_SECRET", "keeps your sign-in secure. Run `npm run setup` and it is made for you."],
  ["NEXT_PUBLIC_SUPABASE_URL", "your database. Run `npm run db`."],
  ["SUPABASE_SERVICE_ROLE_KEY", "your database key. Run `npm run db`."],
];
for (const [name, why] of REQUIRED) {
  if (has(name)) ok(name);
  else gap(name, why);
}

const RECOMMENDED = [
  ["CRON_SECRET", "without it the hourly update cannot run, so your numbers stop moving."],
  ["WEBHOOK_SECRET", "without it ManyChat and your booking tool are turned away, so no DMs or calls arrive."],
];
for (const [name, why] of RECOMMENDED) {
  if (has(name)) ok(name);
  else warn(name, why);
}

// ── Meta ──────────────────────────────────────────────────────────────────
const business = config?.business || {};
const accountEnvs = business.adAccountEnv || ["META_AD_ACCOUNT"];
const tokenEnvs = business.tokenEnv || ["META_ACCESS_TOKEN"];
const account = accountEnvs.find(has);
const token = tokenEnvs.find(has);
if (account && token) {
  ok("Meta connection", process.env[account]);
} else {
  gap(
    "Meta connection",
    `set ${accountEnvs.join(" or ")} and ${tokenEnvs.join(" or ")}. Without both there is no ad spend at all, and everything else is meaningless.`,
  );
}

// ── the sales sheet ───────────────────────────────────────────────────────
const sheet = config?.salesSheet || {};
if (!sheet.enabled) {
  warn(
    "Sales tracker",
    "turned off. You will see spend, DMs, booked calls and show rate — but no money, and no ROAS. Turn on `salesSheet.enabled` in adsv2.config.json.",
  );
} else if (has("SHEET_URL")) {
  const url = process.env.SHEET_URL;
  if (/\/spreadsheets\/d\/e\/[^/]+\/pub/.test(url)) {
    ok("Sales tracker", "connected by published link (one tab only)");
  } else if (/\/spreadsheets\/d\/[a-zA-Z0-9-_]+/.test(url)) {
    ok("Sales tracker", "connected by shared link");
  } else {
    gap("Sales tracker", "SHEET_URL does not look like a Google Sheets link. Paste the whole address from your browser.");
  }
} else if (has("GOOGLE_SHEETS_API_KEY") && has("GOOGLE_SHEETS_SPREADSHEET_ID")) {
  ok("Sales tracker", "connected by API key");
} else {
  gap(
    "Sales tracker",
    "turned on but not connected. Share your sheet as 'anyone with the link can view' and paste the link into SHEET_URL.",
  );
}

// ── is it actually online? ────────────────────────────────────────────────
const authUrl = (process.env.AUTH_URL || "").trim();
if (!authUrl || authUrl.includes("localhost")) {
  warn(
    "Online",
    "not deployed yet. Right now this only works on your own computer, and the hourly update does not run. When you are ready: `npm run deploy`.",
  );
} else {
  ok("Online", authUrl);
}

// ── the database itself ───────────────────────────────────────────────────
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
  if (!has("NEXT_PUBLIC_SUPABASE_URL") || !has("SUPABASE_SERVICE_ROLE_KEY")) return;

  const missing = [];
  for (const table of TABLES) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.status === 404 || res.status === 400) missing.push(table);
      else if (res.status === 401) {
        gap("Database", "your key was refused. Run `npm run db` again to refresh it.");
        return;
      }
    } catch (err) {
      gap("Database", `cannot be reached: ${err.message}. Check NEXT_PUBLIC_SUPABASE_URL.`);
      return;
    }
  }

  if (missing.length === TABLES.length) {
    gap("Database tables", "none built yet. Run `npm run db`.");
    return;
  }
  if (missing.length) {
    gap("Database tables", `${missing.length} missing. Run \`npm run db\` again — it is safe to repeat.`);
  } else {
    ok("Database tables", `all ${TABLES.length} there`);
  }

  // Tables existing and data arriving are different questions, and only the
  // second one means the thing actually works.
  const labels = {
    ads_meta_insights_daily: "ad spend",
    ads_keyword_events: "keyword DMs",
    ghl_appointments: "booked calls",
    sales_tracker_rows: "sales rows",
  };
  const counts = {};
  for (const table of Object.keys(labels)) {
    if (missing.includes(table)) continue;
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact", Range: "0-0" },
      });
      counts[labels[table]] = Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
    } catch {
      /* a count is nice to have, never a reason to fail the check */
    }
  }

  const entries = Object.entries(counts);
  if (entries.length) {
    const empty = entries.filter(([, n]) => n === 0).map(([label]) => label);
    const summary = entries.map(([label, n]) => `${label}: ${n}`).join("   ");
    if (empty.length === entries.length) {
      warn("Your data", `nothing has arrived yet. Run \`npm run sync\` once the gaps above are fixed.\n       ${summary}`);
    } else if (empty.length) {
      warn("Your data", `still nothing for ${empty.join(", ")}.\n       ${summary}`);
    } else {
      ok("Your data", summary);
    }
  }
}

await checkDatabase();

// ── report ────────────────────────────────────────────────────────────────
console.log(`\n${c.bold("Setup check")}\n`);
for (const r of results) {
  const mark =
    r.level === "ok" ? c.green("  ok  ") : r.level === "warn" ? c.yellow(" note ") : c.red(" todo ");
  console.log(`${mark} ${r.what}${r.detail ? c.dim(` — ${r.detail}`) : ""}`);
}

const gaps = results.filter((r) => r.level === "gap");
const notes = results.filter((r) => r.level === "warn");
console.log("");
if (gaps.length) {
  console.log(c.red(`${gaps.length} thing${gaps.length === 1 ? "" : "s"} still to do before this works.`));
  process.exitCode = 1;
} else if (notes.length) {
  console.log(c.yellow(`Working. ${notes.length} optional thing${notes.length === 1 ? "" : "s"} not set up — see the "note" lines.`));
} else {
  console.log(c.green("Everything is set up."));
}
console.log("");
