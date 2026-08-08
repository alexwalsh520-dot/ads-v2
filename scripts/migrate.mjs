#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// MIGRATE — creates the schema in your Supabase project.
//
//     npm run migrate
//
// Two ways, and it picks whichever is available:
//   1. SUPABASE_DB_URL is set and `psql` exists → it runs the files for you.
//   2. Otherwise → it prints exactly what to paste where, and stops.
//
// Both SQL files are idempotent, so re-running is always safe.
// ─────────────────────────────────────────────────────────────────────────

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["supabase/01_tables.sql", "supabase/02_functions.sql"];

for (const file of [".env.local", ".env"]) {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function havePsql() {
  try {
    execSync("psql --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const dbUrl = process.env.SUPABASE_DB_URL;

if (dbUrl && havePsql()) {
  for (const file of FILES) {
    const full = path.join(ROOT, file);
    console.log(`\nRunning ${file} …`);
    // ON_ERROR_STOP means a broken statement fails the run instead of leaving a
    // half-built schema that looks fine until the first query against it.
    execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", full], { stdio: "inherit" });
  }
  console.log("\nSchema is in place. Next: `npm run doctor`.\n");
} else {
  console.log(`
The schema was NOT applied automatically.

Two options:

  A. Paste it in (no tools needed, takes a minute)
     1. Open your Supabase project → SQL Editor → New query
     2. Paste the whole contents of:  ${FILES[0]}   → Run
     3. Paste the whole contents of:  ${FILES[1]}   → Run
     Both are safe to run more than once.

  B. Let this script do it
     1. Supabase → Project Settings → Database → Connection string → URI
     2. Add it to .env.local as:   SUPABASE_DB_URL=postgresql://...
     3. Make sure \`psql\` is installed  (macOS: brew install libpq)
     4. npm run migrate

${dbUrl ? "SUPABASE_DB_URL is set, but psql was not found on this machine." : "SUPABASE_DB_URL is not set."}
`);
  process.exitCode = 1;
}
