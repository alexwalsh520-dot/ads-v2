#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// SET UP THE DATABASE — creates your Supabase project, builds the tables, and
// writes the keys into .env.local. One token, no clicking around.
//
//     npm run db
//
// You need a Supabase Personal Access Token:
//     supabase.com/dashboard/account/tokens  →  Generate new token
// Put it in .env.local as SUPABASE_ACCESS_TOKEN, or pass --token=...
//
// If you already made a project, pass --project-ref=abcdefgh and it will skip
// creating one and just build the tables.
//
// Safe to run more than once. The SQL is written so that running it again
// changes nothing.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ROOT, c, getEnv, loadEnv, setEnv, waitWithDots } from "./lib/env-file.mjs";

loadEnv();

const API = "https://api.supabase.com/v1";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

const token = args.token || getEnv("SUPABASE_ACCESS_TOKEN");
if (!token) {
  console.error(`
${c.bold("A Supabase access token is needed.")}

  1. Go to  https://supabase.com/dashboard/account/tokens
  2. Click  Generate new token,  name it anything
  3. Copy it
  4. Add this line to .env.local:

       SUPABASE_ACCESS_TOKEN=sbp_your_token_here

Then run  npm run db  again.
`);
  process.exit(1);
}

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
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
    /* some endpoints return plain text on failure */
  }
  if (!res.ok) {
    const message = json?.message || json?.error || text.slice(0, 300);
    throw new Error(`Supabase said ${res.status}: ${message}`);
  }
  return json;
}

// ── 1. find or create the project ─────────────────────────────────────────

let ref = args["project-ref"] || getEnv("SUPABASE_PROJECT_REF");

if (!ref) {
  console.log("\nLooking at your Supabase account...");
  const orgs = await api("/organizations");
  if (!orgs?.length) {
    console.error(
      "\nThat token works, but the account has no organisation yet.\n" +
        "Open supabase.com, create one (it is free), then run this again.\n",
    );
    process.exit(1);
  }
  const org = orgs[0];
  if (orgs.length > 1) {
    console.log(c.dim(`  ${orgs.length} organisations found; using "${org.name}".`));
    console.log(c.dim("  To use a different one, create the project yourself and pass --project-ref."));
  }

  // Existing project first. Making a second one by accident is expensive in a
  // way that is not obvious until the bill arrives.
  const projects = await api("/projects");
  const existing = projects?.find((p) => p.name === "ads-v2" && p.organization_id === org.id);

  if (existing) {
    ref = existing.id;
    console.log(`Found your existing "ads-v2" project.`);
  } else {
    // Supabase cannot change this later through the API, so it is generated
    // strong and written down where the user can find it.
    const dbPassword = randomBytes(24).toString("base64url");
    console.log(`Creating a new Supabase project in "${org.name}"...`);
    const created = await api("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "ads-v2",
        organization_id: org.id,
        db_pass: dbPassword,
        region: args.region || "us-east-1",
      }),
    });
    ref = created.id;
    setEnv({ SUPABASE_DB_PASSWORD: dbPassword });
    console.log(c.dim("  Database password saved to .env.local as SUPABASE_DB_PASSWORD."));
  }
  setEnv({ SUPABASE_PROJECT_REF: ref });
}

console.log(`Project: ${c.bold(ref)}`);

// ── 2. wait for it to be ready ────────────────────────────────────────────

process.stdout.write("Waiting for the database to come up");
let healthy = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const health = await api(`/projects/${ref}/health?services=db`);
    const db = Array.isArray(health) ? health.find((h) => h.name === "db") : null;
    if (db?.status === "ACTIVE_HEALTHY") {
      healthy = true;
      break;
    }
  } catch {
    /* a brand new project 404s for a few seconds; that is expected */
  }
  await waitWithDots(6000);
}
console.log("");
if (!healthy) {
  console.error(
    c.red("\nThe database did not come up in time.") +
      "\nIt is probably still starting. Wait a minute and run `npm run db` again.\n",
  );
  process.exit(1);
}

// ── 3. build the tables ───────────────────────────────────────────────────

for (const file of ["supabase/01_tables.sql", "supabase/02_functions.sql"]) {
  process.stdout.write(`Running ${file} ... `);
  const sql = readFileSync(path.join(ROOT, file), "utf8");
  await api(`/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: sql }),
  });
  console.log(c.green("done"));
}

// ── 4. collect the keys ───────────────────────────────────────────────────

process.stdout.write("Collecting your keys ... ");
const keys = await api(`/projects/${ref}/api-keys?reveal=true`);

function keyNamed(...names) {
  for (const name of names) {
    const found = keys?.find((k) => k.name === name || k.type === name);
    if (found?.api_key) return found.api_key;
  }
  return null;
}

const anon = keyNamed("anon", "publishable");
const service = keyNamed("service_role", "secret");

if (!anon || !service) {
  console.log(c.yellow("partly"));
  console.error(
    "\nCould not read both keys automatically. Get them by hand from:\n" +
      `  https://supabase.com/dashboard/project/${ref}/settings/api\n` +
      "and put them in .env.local as NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.\n",
  );
} else {
  setEnv({
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  });
  console.log(c.green("done"));
}

console.log(`
${c.green("Your database is ready.")}

  Dashboard:  https://supabase.com/dashboard/project/${ref}
  Keys were written into .env.local for you.

Next:  ${c.bold("npm run doctor")}
`);
