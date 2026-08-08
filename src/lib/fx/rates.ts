// ─────────────────────────────────────────────────────────────────────────
// FX — convert a creator's native-currency money into USD for the ads tab.
//
// Every dollar figure in CCOS is USD on Eastern-time days. Meta bills some
// creators in another currency (an Australian ad account bills in AUD). We store
// their spend raw (in their currency) and convert to USD HERE, at read time,
// using the real reference rate FOR THE DAY THAT MONEY MOVED — never a single
// flat rate. Raw data is never overwritten, so a rate correction re-flows
// everywhere and stays auditable.
//
// Rate convention (matches the fx_rates table): rate = USD per 1 unit of base.
//   AUD row rate 0.70  →  1 AUD = 0.70 USD  →  usdCents = audCents * 0.70
// ─────────────────────────────────────────────────────────────────────────
import type { getServiceSupabase } from "@/lib/supabase";
import { CREATORS } from "@/lib/creators";

export const USD = "USD";

/** The currency Meta bills a creator in. Defaults to USD for everyone unmarked. */
export function creatorCurrency(clientKey: string | null | undefined): string {
  if (!clientKey) return USD;
  const creator = CREATORS.find((c) => c.key === clientKey);
  return (creator?.currency || USD).toUpperCase();
}

/** Distinct non-USD currencies among a set of client keys (what we must load rates for). */
export function nonUsdCurrenciesForClients(clientKeys: readonly string[]): string[] {
  const set = new Set<string>();
  for (const key of clientKeys) {
    const cur = creatorCurrency(key);
    if (cur !== USD) set.add(cur);
  }
  return [...set];
}

type DatedRate = { date: string; rate: number };

/**
 * An immutable lookup of USD-per-unit rates. `rate(base, day)` returns the rate
 * published ON that day, or — for weekends/holidays/gaps — the most recent one
 * BEFORE it (carry-forward, the standard treatment). Returns null only when we
 * have no rate at all for that currency, so a caller never silently multiplies
 * by a guessed number.
 */
export class UsdRateMap {
  private readonly byBase: Map<string, DatedRate[]>;

  constructor(byBase: Map<string, DatedRate[]>) {
    this.byBase = byBase;
  }

  rate(base: string, day: string): number | null {
    const b = (base || USD).toUpperCase();
    if (b === USD) return 1;
    const series = this.byBase.get(b);
    if (!series || series.length === 0) return null;
    // series is sorted ascending by date. Find the latest entry with date <= day.
    let lo = 0;
    let hi = series.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].date <= day) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // If the day predates every stored rate, fall back to the earliest we have
    // rather than returning nothing (keeps historical rows convertible).
    return series[idx >= 0 ? idx : 0].rate;
  }

  hasBase(base: string): boolean {
    return this.byBase.has((base || USD).toUpperCase());
  }
}

/**
 * Load a rate map for the given currencies over [dateFrom, dateTo]. We read a
 * 14-day buffer BEFORE dateFrom so carry-forward always has a prior rate to lean
 * on (e.g. a window that opens on a Sunday). USD is never queried (it is 1).
 */
export async function loadUsdRateMap(
  db: ReturnType<typeof getServiceSupabase>,
  bases: readonly string[],
  dateFrom: string,
  dateTo: string
): Promise<UsdRateMap> {
  const wanted = [...new Set(bases.map((b) => (b || "").toUpperCase()).filter((b) => b && b !== USD))];
  const byBase = new Map<string, DatedRate[]>();
  if (wanted.length === 0) return new UsdRateMap(byBase);

  const bufferedFrom = shiftIsoDate(dateFrom, -14);
  const { data, error } = await db
    .from("fx_rates")
    .select("rate_date, base, rate")
    .eq("quote", USD)
    .in("base", wanted)
    .gte("rate_date", bufferedFrom)
    .lte("rate_date", dateTo)
    .order("rate_date", { ascending: true });

  if (error) {
    console.warn("[fx] rate load failed", error.message);
    return new UsdRateMap(byBase);
  }

  for (const row of (data || []) as { rate_date: string; base: string; rate: number | string }[]) {
    const base = String(row.base).toUpperCase();
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const list = byBase.get(base) || [];
    list.push({ date: row.rate_date, rate });
    byBase.set(base, list);
  }
  return new UsdRateMap(byBase);
}

/**
 * Convert a cents amount in `base` currency, spent/collected on `day`, into USD
 * cents. USD passes through untouched. If we genuinely have no rate for the day,
 * the amount is returned unchanged and a warning is logged (never a fabricated
 * rate) — the backfill + daily cron are what keep that from happening.
 */
export function convertCentsToUsd(
  cents: number,
  base: string,
  day: string,
  rateMap: UsdRateMap
): number {
  const b = (base || USD).toUpperCase();
  if (b === USD) return cents;
  const rate = rateMap.rate(b, day);
  if (rate == null) {
    console.warn(`[fx] no ${b}->USD rate for ${day}; left unconverted`);
    return cents;
  }
  return Math.round(cents * rate);
}

/** Convert a dollars (not cents) amount. Thin wrapper for the sales path. */
export function convertDollarsToUsd(
  dollars: number,
  base: string,
  day: string,
  rateMap: UsdRateMap
): number {
  const b = (base || USD).toUpperCase();
  if (b === USD || !dollars) return dollars;
  const rate = rateMap.rate(b, day);
  if (rate == null) {
    console.warn(`[fx] no ${b}->USD rate for ${day}; left unconverted`);
    return dollars;
  }
  return dollars * rate;
}

/** Add `days` (can be negative) to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
