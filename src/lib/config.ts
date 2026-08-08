// ─────────────────────────────────────────────────────────────────────────
// CONFIG — reads adsv2.config.json once, checks it, and hands back a typed
// object. Everything specific to a business lives in that file.
//
// Checking is strict and loud on purpose. A config typo that stops the app at
// boot costs thirty seconds. The same typo accepted quietly produces a
// dashboard full of confident wrong numbers, which costs a week and, worse,
// costs you trusting the tool again afterwards.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The single business this dashboard is for.
 *
 * Internally the pipeline still carries a `key` on every row. With one
 * business it is always the same value — but it stays in the data because the
 * database columns, the SQL functions and the attribution all expect it, and
 * ripping it out would buy nothing except a very large diff.
 */
export const BUSINESS_KEY = "main";

export interface Business {
  key: string;
  name: string;
  active: true;
  /** The ad account's REPORTING timezone — what decides where a day ends. */
  timezone: string;
  /**
   * The currency Meta bills the ad account in. SPEND AND BUDGETS ONLY.
   * Sales money is read exactly as written and never converted.
   */
  currency?: string;
  adAccountEnv: readonly string[];
  tokenEnv: readonly string[];
  /** Booking-tool calendar ids whose bookings count as SALES calls. */
  salesCalendarIds: readonly string[];
  /** Kept for the shared attribution code; unused with a single business. */
  matchTokens: readonly string[];
}

export interface SalesSheetConfig {
  enabled: boolean;
  /** "auto" picks whichever of the two connection methods you configured. */
  source: "auto" | "url" | "api";
  spreadsheetIdEnv: string;
  sheetUrlEnv: string;
  tabs: "monthly" | "single";
  monthTabFormat: string;
  tab: string;
  headerRows: number;
  lookbackDays: number;
  columns: Record<string, string>;
  winOutcomes: string[];
  callTakenYesValues: string[];
}

export interface AttributionConfig {
  keywordFromAdName: boolean;
  factsLookbackDays: number;
  factsUpcomingDays: number;
  spendHistoryDays: number;
  staleHours: number;
}

export interface AdsV2Config {
  reportingTimezone: string;
  business: Business;
  salesSheet: SalesSheetConfig;
  attribution: AttributionConfig;
}

const DEFAULT_SALES_SHEET: SalesSheetConfig = {
  enabled: false,
  source: "auto",
  spreadsheetIdEnv: "GOOGLE_SHEETS_SPREADSHEET_ID",
  sheetUrlEnv: "SHEET_URL",
  tabs: "monthly",
  monthTabFormat: "MMMM yyyy",
  tab: "Sheet1",
  headerRows: 1,
  lookbackDays: 90,
  columns: {},
  winOutcomes: ["win", "won", "closed", "close"],
  callTakenYesValues: ["yes", "y", "true", "taken", "showed"],
};

const DEFAULT_ATTRIBUTION: AttributionConfig = {
  keywordFromAdName: true,
  factsLookbackDays: 45,
  factsUpcomingDays: 60,
  spendHistoryDays: 180,
  staleHours: 26,
};

function fail(message: string): never {
  throw new Error(`adsv2.config.json: ${message}`);
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${where} must be some text`);
  return (value as string).trim();
}

function asStringArray(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${where} must be a list`);
  return value.map((v, i) => asString(v, `${where}[${i}]`));
}

function parseBusiness(raw: unknown): Business {
  if (typeof raw !== "object" || raw === null) {
    fail("`business` is missing. It should be an object describing your business.");
  }
  const b = raw as Record<string, unknown>;

  const timezone = asString(b.timezone, "business.timezone");
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  } catch {
    fail(
      `business.timezone "${timezone}" is not a timezone this computer recognises. ` +
        `Use a name like "America/New_York" or "Australia/Sydney".`,
    );
  }

  const currency = b.currency === undefined ? undefined : asString(b.currency, "business.currency").toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    fail(`business.currency "${currency}" should be a 3-letter code like "USD" or "AUD"`);
  }

  const adAccountEnv = asStringArray(b.adAccountEnv, "business.adAccountEnv");
  const tokenEnv = asStringArray(b.tokenEnv, "business.tokenEnv");

  return {
    key: BUSINESS_KEY,
    name: asString(b.name, "business.name"),
    active: true,
    timezone,
    currency,
    adAccountEnv: adAccountEnv.length ? adAccountEnv : ["META_AD_ACCOUNT"],
    tokenEnv: tokenEnv.length ? tokenEnv : ["META_ACCESS_TOKEN"],
    salesCalendarIds: asStringArray(b.salesCalendarIds, "business.salesCalendarIds"),
    matchTokens: [],
  };
}

function parse(raw: unknown): AdsV2Config {
  if (typeof raw !== "object" || raw === null) fail("the file must contain a JSON object");
  const cfg = raw as Record<string, unknown>;

  const sheetRaw = (cfg.salesSheet ?? {}) as Record<string, unknown>;
  const winOutcomes = asStringArray(sheetRaw.winOutcomes, "salesSheet.winOutcomes");
  const takenValues = asStringArray(sheetRaw.callTakenYesValues, "salesSheet.callTakenYesValues");

  const salesSheet: SalesSheetConfig = {
    ...DEFAULT_SALES_SHEET,
    ...sheetRaw,
    enabled: sheetRaw.enabled === true,
    source: (sheetRaw.source as SalesSheetConfig["source"]) || "auto",
    columns: (sheetRaw.columns ?? {}) as Record<string, string>,
    winOutcomes: (winOutcomes.length ? winOutcomes : DEFAULT_SALES_SHEET.winOutcomes).map((v) => v.toLowerCase()),
    callTakenYesValues: (takenValues.length ? takenValues : DEFAULT_SALES_SHEET.callTakenYesValues).map((v) =>
      v.toLowerCase(),
    ),
  };

  if (salesSheet.enabled) {
    if (!salesSheet.columns.date || !salesSheet.columns.prospectName) {
      fail(
        "salesSheet.columns.date and salesSheet.columns.prospectName are both required when the sheet is on. " +
          "Without a date and a name there is no way to tell one row from another.",
      );
    }
    for (const [field, col] of Object.entries(salesSheet.columns)) {
      if (col && !/^[A-Z]{1,3}$/.test(col)) {
        fail(`salesSheet.columns.${field} should be a column letter like "B" or "AC", not "${col}"`);
      }
    }
  }

  return {
    reportingTimezone: asString(cfg.reportingTimezone ?? "America/New_York", "reportingTimezone"),
    business: parseBusiness(cfg.business),
    salesSheet,
    attribution: { ...DEFAULT_ATTRIBUTION, ...((cfg.attribution ?? {}) as object) },
  };
}

let cached: AdsV2Config | null = null;

export function loadConfig(): AdsV2Config {
  if (cached) return cached;
  const file = path.join(process.cwd(), "adsv2.config.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `Could not read ${file}. Copy adsv2.config.example.json to adsv2.config.json, or run \`npm run setup\`.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `adsv2.config.json is not valid JSON — usually a missing comma or quote. ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  cached = parse(json);
  return cached;
}

/** Test seam — lets a test supply a config without touching the disk. */
export function __setConfigForTests(cfg: AdsV2Config | null) {
  cached = cfg;
}
