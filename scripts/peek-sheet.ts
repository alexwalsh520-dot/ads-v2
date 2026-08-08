#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────
// LOOK AT THE SALES TRACKER — reads the top of the sheet and proposes which
// column is which.
//
//     npm run sheet
//     npm run sheet -- --tab="August 2026"
//
// Nobody should be asked to type out their own column names. Point this at the
// sheet and it reads them, guesses the mapping, and prints a block ready to
// drop into adsv2.config.json.
//
// It PROPOSES. Always confirm the mapping with the person before saving it —
// a wrong guess accepted quietly puts call notes in the revenue column and
// every number after that is confidently wrong.
//
// Reads only. It cannot change anything in the sheet.
// ─────────────────────────────────────────────────────────────────────────

import { loadEnv } from "./lib/env-file.mjs";
import { fetchTab, resolveSheetSource } from "../src/lib/ingest/sheet-source";
import {
  columnLetter,
  findHeaderRow,
  guessColumns,
  letterToIndex,
} from "../src/lib/ingest/sheet-columns";

loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function main() {
  const resolved = resolveSheetSource({
    sheetUrl: process.env.SHEET_URL || null,
    apiKey: process.env.GOOGLE_SHEETS_API_KEY || null,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || null,
    prefer: "auto",
  });
  if ("error" in resolved) {
    console.error(`\nCannot reach the sheet: ${resolved.error}\n`);
    process.exit(1);
  }

  // Try what was asked for, then this month, then last month, then the first
  // tab. A monthly tracker often has no tab yet for a month that just started.
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const thisMonth = `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  const lastMonth = `${MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`;

  const candidates = args.tab
    ? [args.tab]
    : resolved.supportsNamedTabs
      ? [thisMonth, lastMonth, "Sheet1", ""]
      : [""];

  let rows: string[][] = [];
  let usedTab = "";
  const tried: string[] = [];

  for (const tab of candidates) {
    const result = await fetchTab(resolved, tab);
    if (result.rows.length) {
      rows = result.rows;
      usedTab = tab;
      break;
    }
    tried.push(`${tab || "(first tab)"} — ${result.error ?? "empty"}`);
  }

  if (!rows.length) {
    console.error(`\nCould not read any rows. Tried:\n  ${tried.join("\n  ")}\n`);
    console.error('If the tabs are named differently:  npm run sheet -- --tab="My Tab"\n');
    process.exit(1);
  }

  const headerIndex = findHeaderRow(rows);
  const headers = rows[headerIndex] || [];
  const guess = guessColumns(headers);

  console.log(`\nReading tab: ${usedTab || "(first tab)"}`);
  console.log(`Header row:  ${headerIndex + 1}   →  set headerRows to ${headerIndex + 1}\n`);

  console.log("Columns in the sheet:\n");
  headers.forEach((h, i) => {
    if (h && h.trim()) console.log(`  ${columnLetter(i).padEnd(3)} ${h.trim()}`);
  });

  console.log("\nProposed mapping — CONFIRM THIS WITH THEM before saving:\n");
  console.log('  "columns": {');
  const entries = Object.entries(guess.columns);
  entries.forEach(([field, letter], i) => {
    const comma = i === entries.length - 1 ? "" : ",";
    const line = `    "${field}": "${letter}"${comma}`;
    console.log(`${line.padEnd(40)}// ${guess.matchedHeaders[field]}`);
  });
  console.log("  }\n");

  if (guess.missingRequired.length) {
    console.log(`REQUIRED, not found: ${guess.missingRequired.join(", ")}`);
    console.log("Ask which column holds each. Nothing works without them.\n");
  }

  if (guess.missingHighValue.includes("manychatLink")) {
    console.log("NO MANYCHAT LINK COLUMN.");
    console.log("That column is what ties a sale back to the DM, and so back to the ad.");
    console.log("They should add one now, before more sales get logged — rows already in");
    console.log("the sheet can never be attributed after the fact.\n");
  }
  for (const field of guess.missingHighValue.filter((f) => f !== "manychatLink")) {
    console.log(`Not found: ${field}. Ask which column it is.\n`);
  }

  // Two real rows read through the mapping make a wrong guess obvious.
  const sample = rows
    .slice(headerIndex + 1)
    .filter((r) => r.some((c) => c && c.trim()))
    .slice(0, 2);

  if (sample.length) {
    console.log("Sample rows, read through that mapping:\n");
    for (const row of sample) {
      for (const [field, letter] of entries) {
        const value = (row[letterToIndex(letter)] || "").trim();
        if (value) console.log(`  ${field.padEnd(20)} ${value.slice(0, 60)}`);
      }
      console.log("");
    }
    console.log("If any of those look wrong, fix the mapping before saving it.\n");
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
