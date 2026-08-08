// ─────────────────────────────────────────────────────────────────────────
// CONFIG — reads adsv2.config.json once, validates it, and hands back a typed
// object. Everything that is specific to YOUR business lives in that file.
//
// Validation is strict and loud on purpose. A config typo that fails at boot
// costs you thirty seconds; the same typo accepted silently produces a
// dashboard full of confident wrong numbers, which costs you a week and your
// trust in the tool. So: fail fast, and say exactly which key is wrong.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Creator } from "./creators";

export interface SalesSheetConfig {
  enabled: boolean;
  spreadsheetIdEnv: string;
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
  creators: Creator[];
  salesSheet: SalesSheetConfig;
  attribution: AttributionConfig;
}

const DEFAULT_SALES_SHEET: SalesSheetConfig = {
  enabled: false,
  spreadsheetIdEnv: "GOOGLE_SHEETS_SPREADSHEET_ID",
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
  if (typeof value !== "string" || !value.trim()) fail(`${where} must be a non-empty string`);
  return (value as string).trim();
}

function asStringArray(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${where} must be an array of strings`);
  return value.map((v, i) => asString(v, `${where}[${i}]`));
}

function parseCreator(raw: unknown, index: number): Creator {
  if (typeof raw !== "object" || raw === null) fail(`creators[${index}] must be an object`);
  const c = raw as Record<string, unknown>;
  const where = `creators[${index}]`;

  const key = asString(c.key, `${where}.key`).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(key)) {
    fail(`${where}.key "${key}" may only contain lowercase letters, digits, hyphens and underscores`);
  }

  const timezone = asString(c.timezone, `${where}.timezone`);
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  } catch {
    fail(`${where}.timezone "${timezone}" is not a timezone this system knows (use an IANA name like "America/New_York")`);
  }

  const currency = c.currency === undefined ? undefined : asString(c.currency, `${where}.currency`).toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    fail(`${where}.currency "${currency}" must be a 3-letter ISO code like "USD" or "AUD"`);
  }

  const adAccountEnv = asStringArray(c.adAccountEnv, `${where}.adAccountEnv`);
  const tokenEnv = asStringArray(c.tokenEnv, `${where}.tokenEnv`);
  if (!adAccountEnv.length) fail(`${where}.adAccountEnv must name at least one environment variable`);
  if (!tokenEnv.length) fail(`${where}.tokenEnv must name at least one environment variable`);

  return {
    key,
    name: asString(c.name, `${where}.name`),
    active: c.active !== false,
    timezone,
    currency,
    adAccountEnv,
    tokenEnv,
    salesCalendarIds: asStringArray(c.salesCalendarIds, `${where}.salesCalendarIds`),
    matchTokens: asStringArray(c.matchTokens, `${where}.matchTokens`).map((t) => t.toLowerCase()),
  };
}

function parse(raw: unknown): AdsV2Config {
  if (typeof raw !== "object" || raw === null) fail("the file must contain a JSON object");
  const cfg = raw as Record<string, unknown>;

  const creatorsRaw = cfg.creators;
  if (!Array.isArray(creatorsRaw) || creatorsRaw.length === 0) {
    fail("`creators` must be a non-empty array — Ads V2 has nothing to show without at least one");
  }
  const creators = creatorsRaw.map(parseCreator);

  const seen = new Set<string>();
  for (const c of creators) {
    if (seen.has(c.key)) fail(`two creators share the key "${c.key}" — keys must be unique`);
    seen.add(c.key);
  }

  const sheetRaw = (cfg.salesSheet ?? {}) as Record<string, unknown>;
  const salesSheet: SalesSheetConfig = {
    ...DEFAULT_SALES_SHEET,
    ...sheetRaw,
    enabled: sheetRaw.enabled === true,
    columns: (sheetRaw.columns ?? {}) as Record<string, string>,
    winOutcomes: (asStringArray(sheetRaw.winOutcomes, "salesSheet.winOutcomes").length
      ? asStringArray(sheetRaw.winOutcomes, "salesSheet.winOutcomes")
      : DEFAULT_SALES_SHEET.winOutcomes
    ).map((v) => v.toLowerCase()),
    callTakenYesValues: (asStringArray(sheetRaw.callTakenYesValues, "salesSheet.callTakenYesValues").length
      ? asStringArray(sheetRaw.callTakenYesValues, "salesSheet.callTakenYesValues")
      : DEFAULT_SALES_SHEET.callTakenYesValues
    ).map((v) => v.toLowerCase()),
  };

  if (salesSheet.enabled) {
    if (!salesSheet.columns.date || !salesSheet.columns.prospectName) {
      fail("salesSheet.columns.date and salesSheet.columns.prospectName are required when the sheet is enabled — without a date and a name a row cannot be identified at all");
    }
    for (const [field, col] of Object.entries(salesSheet.columns)) {
      if (col && !/^[A-Z]{1,3}$/.test(col)) {
        fail(`salesSheet.columns.${field} must be a spreadsheet column letter like "B" or "AC", got "${col}"`);
      }
    }
  }

  return {
    reportingTimezone: asString(cfg.reportingTimezone ?? "America/New_York", "reportingTimezone"),
    creators,
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
      `Could not read ${file}. Copy adsv2.config.example.json to adsv2.config.json and fill it in, or run \`npm run setup\`.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`adsv2.config.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  cached = parse(json);
  return cached;
}

/** Test seam — lets a test load a config object without touching the disk. */
export function __setConfigForTests(cfg: AdsV2Config | null) {
  cached = cfg;
}
