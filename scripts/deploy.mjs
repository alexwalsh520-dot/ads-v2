#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// PUT IT ON THE INTERNET — creates your Vercel project, copies every setting
// across, deploys, and tells you the address.
//
//     npm run deploy
//
// You need a Vercel access token:
//     vercel.com/account/tokens  →  Create Token
// The scope MUST be "Full Account". A project-scoped token cannot create a
// project, and the project does not exist yet, so a scoped token fails in a way
// that reads like a permissions bug rather than a wrong choice at setup.
// Put it in .env.local as VERCEL_TOKEN, or pass --token=...
//
// WHY THIS MATTERS, and it is easy to miss: running the app on your own
// computer only works while your computer is on and that terminal is open. The
// hourly update does not happen. Deploying is what makes it a real website
// with a real address that updates by itself.
//
// Run it again any time to push new settings and redeploy.
// ─────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { ROOT, c, getEnv, loadEnv, setEnv } from "./lib/env-file.mjs";

loadEnv();

const API = "https://api.vercel.com";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

const token = args.token || getEnv("VERCEL_TOKEN");
if (!token) {
  console.error(`
${c.bold("A Vercel access token is needed.")}

  1. Go to  https://vercel.com/account/tokens
  2. Click  Create Token.  Name it anything.
  3. Set Scope to  FULL ACCOUNT.  This matters: a project-scoped token cannot
     create a project, and yours does not exist yet.
  4. Pick the longest expiry offered, then Create.
  5. Copy it. It starts with  vcp_
  6. Add this line to .env.local:

       VERCEL_TOKEN=your_token_here

Then run  npm run deploy  again.
`);
  process.exit(1);
}

const teamId = getEnv("VERCEL_TEAM_ID");
function withTeam(pathname) {
  return teamId ? `${pathname}${pathname.includes("?") ? "&" : "?"}teamId=${teamId}` : pathname;
}

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${withTeam(pathname)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(`Vercel said ${res.status}: ${json?.error?.message || text.slice(0, 300)}`);
  }
  return json;
}

// ── what needs to travel to the server ────────────────────────────────────
// Deliberately a fixed list. Copying the whole file across would also ship the
// tokens used to BUILD the thing (Supabase and Vercel admin tokens), which the
// running app never needs and which should not sit in a hosting dashboard.
const SHIP = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_SECRET",
  "APP_PASSWORD",
  "CRON_SECRET",
  "WEBHOOK_SECRET",
  "META_AD_ACCOUNT",
  "META_ACCESS_TOKEN",
  "SHEET_URL",
  "GOOGLE_SHEETS_API_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
];

const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AUTH_SECRET", "APP_PASSWORD"].filter(
  (k) => !getEnv(k),
);
if (missing.length) {
  console.error(
    `\n${c.red("Not ready to deploy yet.")} These are still missing: ${missing.join(", ")}\n` +
      `Run ${c.bold("npm run doctor")} to see what to do about each one.\n`,
  );
  process.exit(1);
}

const projectName = args.name || getEnv("VERCEL_PROJECT_NAME") || "ads-v2";

// ── 1. find or create the project ─────────────────────────────────────────

let project = null;
try {
  project = await api(`/v9/projects/${projectName}`);
  console.log(`Found your existing Vercel project "${projectName}".`);
} catch {
  console.log(`Creating a Vercel project called "${projectName}"...`);
  project = await api("/v11/projects", {
    method: "POST",
    body: JSON.stringify({ name: projectName, framework: "nextjs" }),
  });
}
setEnv({ VERCEL_PROJECT_NAME: projectName });

// ── 2. push the settings ──────────────────────────────────────────────────

process.stdout.write("Copying your settings across ");
for (const key of SHIP) {
  const value = getEnv(key);
  if (!value) continue;
  const body = JSON.stringify({
    key,
    value,
    type: "encrypted",
    target: ["production", "preview", "development"],
  });
  try {
    await api(`/v10/projects/${project.id}/env?upsert=true`, { method: "POST", body });
    process.stdout.write(".");
  } catch (err) {
    console.log("");
    console.error(c.yellow(`  could not set ${key}: ${err.message}`));
  }
}
console.log(c.green(" done"));

// ── 3. deploy ─────────────────────────────────────────────────────────────
// Uploading the whole folder over the API means implementing Vercel's file
// hashing, and getting it subtly wrong ships a broken build. Their CLI already
// does this correctly, so use it via npx rather than reinventing it.

console.log("\nBuilding and deploying. This takes a couple of minutes.\n");
let output = "";
try {
  output = execFileSync(
    "npx",
    ["--yes", "vercel@latest", "deploy", "--prod", "--yes", "--token", token, ...(teamId ? ["--scope", teamId] : [])],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
} catch (err) {
  console.error(
    c.red("\nThe deploy failed.") +
      "\nThe error above is from Vercel. The most common cause is a setting that did not copy across —\n" +
      `run ${c.bold("npm run doctor")}, fix what it lists, then try again.\n`,
  );
  process.exit(1);
}

const url = (output.match(/https:\/\/[^\s]+\.vercel\.app/g) || []).pop();

if (url) {
  setEnv({ AUTH_URL: url });
  // AUTH_URL has to exist on the server too, and it is only knowable after the
  // first deploy — which is why this runs after, not before.
  await api(`/v10/projects/${project.id}/env?upsert=true`, {
    method: "POST",
    body: JSON.stringify({
      key: "AUTH_URL",
      value: url,
      type: "encrypted",
      target: ["production", "preview", "development"],
    }),
  }).catch(() => {});
}

console.log(`
${c.green("It is live.")}

  Your dashboard:  ${c.bold(url || "check vercel.com")}

  Sign in with the password in APP_PASSWORD.

  It now updates itself every hour, whether your computer is on or not.

Your two webhook addresses, for ManyChat and your booking tool:

  ${url || "https://YOUR-APP"}/api/webhooks/manychat?secret=${getEnv("WEBHOOK_SECRET") || "YOUR_WEBHOOK_SECRET"}
  ${url || "https://YOUR-APP"}/api/webhooks/booking?secret=${getEnv("WEBHOOK_SECRET") || "YOUR_WEBHOOK_SECRET"}
`);
