// ─────────────────────────────────────────────────────────────────────────
// SALES SHEET — pulls your sales tracker into sales_tracker_rows.
//
// This is the only revenue input. Without it you still get spend, DMs, booked
// calls and show rate; you do not get cash, and therefore no ROAS.
//
// It is driven entirely by `salesSheet` in adsv2.config.json: you say which
// column letter holds which field, and this file does the rest. Nothing about
// any particular sheet layout is baked in, because "the sheet everyone actually
// uses" is different in every business and hardcoding one is how a data
// pipeline becomes un-installable.
//
// MONEY IS READ AS-IS AND NEVER CONVERTED. The tracker is one sheet, written in
// one currency, for every creator. FX belongs to ad SPEND only. Converting
// tracker money once turned a $1,200 sale into $842 and nobody noticed for
// weeks, because a slightly-too-small number looks exactly like a real one.
//
// READ-ONLY, ALWAYS. This code never writes to your spreadsheet.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { loadConfig, type SalesSheetConfig } from "@/lib/config";
import { normalizePersonName } from "@/lib/ads-tracker/normalize";
import { startRun, finishRun } from "@/lib/ads-v2/db";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const UPSERT_CHUNK = 100;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "A" → 0, "B" → 1, "AC" → 28. */
export function columnToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Tab name for a month, e.g. "August 2026" or "Aug 2026". */
export function monthTabName(date: Date, format: string): string {
  const month = MONTHS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear());
  return format
    .replace("MMMM", month)
    .replace("MMM", month.slice(0, 3))
    .replace("yyyy", year)
    .replace("yy", year.slice(2));
}

/** Every month tab spanned by a date range, oldest first. */
export function monthTabsBetween(from: string, to: string, format: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    out.push(monthTabName(cursor, format));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Accepts the date formats a human actually types into a spreadsheet, and
 * returns null for anything else rather than an invented date.
 */
export function parseSheetDate(value: string | undefined, fallbackYear: number): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  // M/D or M/D/YYYY. US order, because that is what the sheets this reads use.
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : fallbackYear;
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** "$1,200.50" → 120050 cents. Junk → 0, never NaN. */
export function moneyToCents(value: string | undefined): number {
  const cleaned = (value || "").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function cell(row: string[], columns: Record<string, string>, field: string): string | undefined {
  const letter = columns[field];
  if (!letter) return undefined;
  const value = row[columnToIndex(letter)];
  return typeof value === "string" ? value.trim() : undefined;
}

function keyPart(value: string | null | undefined): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return normalized || "blank";
}

/**
 * The row's identity, and it MUST be built from things that never change after
 * the row is first written. Two mutable parts once lived in a key like this and
 * each one quietly spawned duplicate sales: the creator name (tagged after the
 * first sync) and the row's position (which shifts every time somebody inserts
 * a row above it). Date + call number + name only. No position, ever.
 */
export function sheetRowKey(tab: string, date: string, callNumber: string | undefined, name: string): string {
  const call = keyPart(callNumber);
  const stableId = call === "blank" ? `name-${keyPart(name)}` : call;
  return [tab, date, stableId, keyPart(name)].join(":");
}

export interface SalesSheetResult {
  rows: number;
  tabs: Array<{ tab: string; rows: number; error?: string }>;
  skipped?: string;
}

async function fetchTab(
  spreadsheetId: string,
  tab: string,
  apiKey: string,
): Promise<string[][] | { error: string }> {
  const range = encodeURIComponent(`${tab}!A1:BZ`);
  const url = `${SHEETS_API}/${spreadsheetId}/values/${range}?key=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    // A missing tab is normal — a monthly sheet simply has no tab for a month
    // that has not started, or one you never created. Say so plainly and move
    // on rather than failing the whole sync.
    if (res.status === 400 && body.includes("Unable to parse range")) {
      return { error: "tab not found" };
    }
    return { error: `sheets ${res.status}: ${body}` };
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runSalesSheetSync(
  opts: { lookbackDays?: number; now?: Date } = {},
): Promise<SalesSheetResult> {
  const cfg: SalesSheetConfig = loadConfig().salesSheet;
  if (!cfg.enabled) {
    return { rows: 0, tabs: [], skipped: "salesSheet.enabled is false" };
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  const spreadsheetId = process.env[cfg.spreadsheetIdEnv];
  if (!apiKey || !spreadsheetId) {
    return {
      rows: 0,
      tabs: [],
      skipped: `set GOOGLE_SHEETS_API_KEY and ${cfg.spreadsheetIdEnv} to enable the sales sheet`,
    };
  }

  const db = getServiceSupabase();
  const runId = await startRun(db, "sales_sheet");
  const started = Date.now();

  const now = opts.now ?? new Date();
  const lookback = opts.lookbackDays ?? cfg.lookbackDays;
  const dateTo = now.toISOString().slice(0, 10);
  const dateFrom = new Date(now.getTime() - lookback * 86_400_000).toISOString().slice(0, 10);

  const tabs =
    cfg.tabs === "monthly" ? monthTabsBetween(dateFrom, dateTo, cfg.monthTabFormat) : [cfg.tab];

  const result: SalesSheetResult = { rows: 0, tabs: [] };

  try {
    for (const tab of tabs) {
      const values = await fetchTab(spreadsheetId, tab, apiKey);
      if ("error" in values) {
        result.tabs.push({ tab, rows: 0, error: values.error });
        continue;
      }

      const body = values.slice(cfg.headerRows);
      const payload: Record<string, unknown>[] = [];

      for (const row of body) {
        const dateRaw = cell(row, cfg.columns, "date");
        const name = cell(row, cfg.columns, "prospectName");
        const date = parseSheetDate(dateRaw, now.getUTCFullYear());
        // No date or no name is not a sale, it is a spacer row, a subtotal, or
        // a note. Skipping is correct; importing it would put junk in the funnel.
        if (!date || !name) continue;
        if (date < dateFrom || date > dateTo) continue;

        const takenRaw = (cell(row, cfg.columns, "callTakenStatus") || "").toLowerCase();
        const callTaken = cfg.callTakenYesValues.includes(takenRaw);
        const outcome = (cell(row, cfg.columns, "outcome") || "").trim();
        const manychatLink = cell(row, cfg.columns, "manychatLink") || null;

        payload.push({
          source: "google_sheets",
          sheet_id: spreadsheetId,
          sheet_tab: tab,
          sheet_row_key: sheetRowKey(tab, date, cell(row, cfg.columns, "callNumber"), name),
          date,
          call_number: cell(row, cfg.columns, "callNumber") || null,
          prospect_name: name,
          prospect_name_normalized: normalizePersonName(name),
          call_taken: callTaken,
          call_taken_status: takenRaw || null,
          call_length: cell(row, cfg.columns, "callLength") || null,
          outcome: outcome ? outcome.toUpperCase() : null,
          closer: (cell(row, cfg.columns, "closer") || "").toUpperCase() || null,
          objection: cell(row, cfg.columns, "objection") || null,
          program_length: cell(row, cfg.columns, "programLength") || null,
          contracted_revenue_cents: moneyToCents(cell(row, cfg.columns, "contractedRevenue")),
          collected_revenue_cents: moneyToCents(cell(row, cfg.columns, "collectedRevenue")),
          payment_method: cell(row, cfg.columns, "paymentMethod") || null,
          setter: cell(row, cfg.columns, "setter") || null,
          call_notes: cell(row, cfg.columns, "callNotes") || null,
          recording_link: cell(row, cfg.columns, "recordingLink") || null,
          offer: cell(row, cfg.columns, "offer") || null,
          manychat_link: manychatLink,
          manychat_subscriber_id: subscriberIdFromLink(manychatLink),
          raw_payload: { row, callType: cell(row, cfg.columns, "callType") || null },
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      for (const part of chunk(payload, UPSERT_CHUNK)) {
        const { error } = await db
          .from("sales_tracker_rows")
          .upsert(part, { onConflict: "source,sheet_row_key" });
        if (error) throw new Error(`sales upsert (${tab}): ${error.message}`);
      }

      result.rows += payload.length;
      result.tabs.push({ tab, rows: payload.length });
    }

    await finishRun(db, runId, {
      status: "ok",
      rows: result.rows,
      durationMs: Date.now() - started,
      detail: { dateFrom, dateTo, tabs: result.tabs },
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * The subscriber id out of a pasted ManyChat chat link. Links look like
 * https://app.manychat.com/fb<accountId>/chat/<subscriberId>, so the id is the
 * trailing number. A bare number is accepted too (someone pasting just the id).
 * Returns null for anything else, so junk never forces a wrong match.
 */
export function subscriberIdFromLink(link: string | null | undefined): string | null {
  const raw = (link || "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/\/chat\/(\d{5,})/);
  if (fromUrl) return fromUrl[1];
  if (/^\d{5,}$/.test(raw)) return raw;
  return null;
}
