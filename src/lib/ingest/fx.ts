// ─────────────────────────────────────────────────────────────────────────
// FX RATES — keeps fx_rates current so spend billed in another currency can be
// shown in USD at the rate for the day it actually moved.
//
// If every one of your ad accounts bills in USD this does nothing at all, and
// costs nothing. The moment one does not, it is the difference between a real
// ROAS and a wrong one.
//
// Source: the European Central Bank's daily reference rates, republished by
// frankfurter.app. No key, no account, no rate limit worth worrying about.
// Rates are published on working days only, so weekends and holidays are
// carried forward by the reader rather than invented here.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS } from "@/lib/creators";
import { startRun, finishRun } from "@/lib/ads-v2/db";

const API = "https://api.frankfurter.app";

/** Every non-USD currency any configured creator bills in. */
export function currenciesInUse(): string[] {
  const set = new Set<string>();
  for (const creator of CREATORS) {
    const cur = (creator.currency || "USD").toUpperCase();
    if (cur !== "USD") set.add(cur);
  }
  return [...set];
}

interface FrankfurterSeries {
  rates?: Record<string, Record<string, number>>;
}

export interface FxSyncResult {
  currencies: string[];
  rows: number;
  skipped?: string;
}

export async function runFxSync(
  opts: { days?: number; now?: Date } = {},
): Promise<FxSyncResult> {
  const bases = currenciesInUse();
  if (bases.length === 0) {
    return { currencies: [], rows: 0, skipped: "every ad account bills in USD" };
  }

  const db = getServiceSupabase();
  const runId = await startRun(db, "fx");
  const started = Date.now();

  const now = opts.now ?? new Date();
  // A generous default window. Re-writing a rate that has not changed is free,
  // and it means one missed day heals itself instead of leaving a hole that
  // silently degrades every conversion after it.
  const days = opts.days ?? 30;
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - days * 86_400_000);
  const from = fromDate.toISOString().slice(0, 10);

  try {
    let rows = 0;
    for (const base of bases) {
      const url = `${API}/${from}..${to}?from=${base}&to=USD`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`frankfurter ${base}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as FrankfurterSeries;
      const series = json.rates ?? {};

      const payload = Object.entries(series)
        .map(([date, quotes]) => ({
          rate_date: date,
          base,
          quote: "USD",
          // rate = USD per 1 unit of base, which is the convention the readers
          // and the SQL both assume. Getting this upside down is a silent 2x.
          rate: quotes.USD,
          source: "ecb-frankfurter",
          carried: false,
          fetched_at: new Date().toISOString(),
        }))
        .filter((r) => Number.isFinite(r.rate) && r.rate > 0);

      if (payload.length) {
        const { error } = await db
          .from("fx_rates")
          .upsert(payload, { onConflict: "rate_date,base,quote" });
        if (error) throw new Error(`fx upsert ${base}: ${error.message}`);
        rows += payload.length;
      }
    }

    await finishRun(db, runId, {
      status: "ok",
      rows,
      durationMs: Date.now() - started,
      detail: { currencies: bases, from, to },
    });
    return { currencies: bases, rows };
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
