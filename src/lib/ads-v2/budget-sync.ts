// ─────────────────────────────────────────────────────────────────────────
// BUDGET SNAPSHOT SYNC — the ONE new external sync in v2. It reads the ACTUAL
// configured budget from Meta (daily budget, lifetime budget, and which level
// holds it) and writes one immutable snapshot row per entity per Eastern-time
// day. With ABO the budget sits on the ad set; with CBO on the campaign; ads
// never hold a budget. Raising a budget today only writes today's row, so past
// days stay exactly as they were, like spend.
//
// CHANGED 2026-07-25 (Build 2, Phase 2). It used to photograph every entity
// every day: about 370 rows daily when only 9 were actually live, so 97% of
// each day's writes were an unchanged dead campaign repeating itself. Now:
//
//   * an ACTIVE campaign or ad set is photographed every day, because what a
//     live dial is set to on a given day is a fact we want per day;
//   * anything else is photographed only on a day when one of its dials
//     actually moved (daily budget, lifetime budget, or status).
//
// Nothing already written is deleted or rewritten. Reading history is
// unchanged in meaning: to know what a paused ad set's budget was on some day,
// take its most recent photo on or before that day, which is exactly how you
// would read it before, since the skipped rows were identical repeats.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import {
  ACTIVE_CREATORS,
  firstEnv,
  normalizeAdAccountId,
  type Creator,
} from "@/lib/creators";
import { creatorCurrency, loadUsdRateMap, convertCentsToUsd } from "@/lib/fx/rates";
import { todayEt } from "./time";
import { startRun, finishRun, type Db } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";

interface MetaBudgetEntity {
  id: string;
  name?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  campaign_id?: string;
}

async function graphAll(path: string, fields: string, token: string): Promise<MetaBudgetEntity[]> {
  const out: MetaBudgetEntity[] = [];
  let url: string | undefined = `${GRAPH}/${path}?fields=${fields}&limit=500&access_token=${token}`;
  for (let page = 0; page < 50 && url; page++) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Meta budget fetch ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: MetaBudgetEntity[]; paging?: { next?: string } };
    out.push(...(json.data || []));
    url = json.paging?.next;
  }
  return out;
}

function centsFrom(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface BudgetResult {
  clients: string[];
  rows: number;
  skipped: { client: string; reason: string }[];
  etDay: string;
  /** How many entities Meta reported, before the active-or-changed filter. */
  seen?: number;
  /** Why each written row was written, so the reduction is auditable. */
  written?: { active: number; changed: number; firstSeen: number };
}

interface LatestBudgetState {
  entity_level: string;
  entity_id: string;
  daily_budget_cents: number | null;
  lifetime_budget_cents: number | null;
  effective_status: string | null;
}

function isActive(status: string | null | undefined): boolean {
  return (status || "").trim().toUpperCase() === "ACTIVE";
}

/** Did any dial we track actually move since the last photo of this entity? */
function dialMoved(now: Record<string, unknown>, last: LatestBudgetState | undefined): boolean {
  if (!last) return true; // never photographed before: record it once
  return (
    (now.daily_budget_cents ?? null) !== (last.daily_budget_cents ?? null) ||
    (now.lifetime_budget_cents ?? null) !== (last.lifetime_budget_cents ?? null) ||
    (now.effective_status ?? null) !== (last.effective_status ?? null)
  );
}

export async function runBudgetSnapshot(now: Date = new Date()): Promise<BudgetResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "budget");
  const started = Date.now();
  try {
    const result = await snapshotBudgets(db, now);
    await finishRun(db, runId, {
      status: "ok",
      rows: result.rows,
      durationMs: Date.now() - started,
      detail: result,
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

async function snapshotBudgets(db: Db, now: Date): Promise<BudgetResult> {
  const etToday = todayEt(now);
  const clientsDone: string[] = [];
  const skipped: { client: string; reason: string }[] = [];
  let totalRows = 0;
  let totalSeen = 0;
  const written = { active: 0, changed: 0, firstSeen: 0 };

  const rateMap = await loadUsdRateMap(
    db,
    ACTIVE_CREATORS.map((c) => creatorCurrency(c.key)),
    etToday,
    etToday,
  );

  for (const creator of ACTIVE_CREATORS) {
    const token = firstEnv(creator.tokenEnv);
    const account = firstEnv(creator.adAccountEnv);
    if (!token || !account) {
      // Honest: a creator whose ad account is not connected yet simply has no
      // budget data. We record why and move on; other creators are unaffected.
      skipped.push({ client: creator.key, reason: !token ? "no access token" : "no ad account" });
      continue;
    }
    try {
      const res = await snapshotOneClient(db, creator, normalizeAdAccountId(account), token, etToday, rateMap);
      totalRows += res.rows;
      totalSeen += res.seen;
      written.active += res.written.active;
      written.changed += res.written.changed;
      written.firstSeen += res.written.firstSeen;
      clientsDone.push(creator.key);
    } catch (err) {
      // Failure containment: one creator failing never blocks the others.
      skipped.push({ client: creator.key, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { clients: clientsDone, rows: totalRows, skipped, etDay: etToday, seen: totalSeen, written };
}

async function snapshotOneClient(
  db: Db,
  creator: Creator,
  account: string,
  token: string,
  etDayStr: string,
  rateMap: ReturnType<typeof loadUsdRateMap> extends Promise<infer R> ? R : never,
): Promise<{ rows: number; seen: number; written: { active: number; changed: number; firstSeen: number } }> {
  const currency = creatorCurrency(creator.key);
  const campaigns = await graphAll(
    `${account}/campaigns`,
    "id,name,daily_budget,lifetime_budget,effective_status",
    token,
  );
  const adsets = await graphAll(
    `${account}/adsets`,
    "id,name,daily_budget,lifetime_budget,effective_status,campaign_id",
    token,
  );

  // What we already hold for this creator, so an unchanged dead campaign is
  // recognised and skipped rather than re-photographed identically.
  const { data: latestRows, error: latestError } = await db.rpc("adsv2_latest_budget_state", {
    p_client: creator.key,
  });
  if (latestError) throw new Error(`latest budget state failed for ${creator.key}: ${latestError.message}`);
  const latest = new Map<string, LatestBudgetState>();
  for (const r of (latestRows || []) as LatestBudgetState[]) {
    latest.set(`${r.entity_level}|${r.entity_id}`, r);
  }

  const rows: Record<string, unknown>[] = [];
  let seen = 0;
  const written = { active: 0, changed: 0, firstSeen: 0 };

  const push = (level: "campaign" | "adset", e: MetaBudgetEntity) => {
    seen++;
    const daily = centsFrom(e.daily_budget);
    const lifetime = centsFrom(e.lifetime_budget);
    const status = e.effective_status ?? null;

    // Active every day; everything else only on a day its dial actually moved.
    const last = latest.get(`${level}|${e.id}`);
    const active = isActive(status);
    const moved = dialMoved(
      { daily_budget_cents: daily, lifetime_budget_cents: lifetime, effective_status: status },
      last,
    );
    if (!active && !moved) return;
    if (active) written.active++;
    else if (!last) written.firstSeen++;
    else written.changed++;

    rows.push({
      client_key: creator.key,
      entity_level: level,
      entity_id: e.id,
      entity_name: e.name ?? null,
      campaign_id: level === "adset" ? e.campaign_id ?? null : e.id,
      et_day: etDayStr,
      currency,
      daily_budget_cents: daily,
      lifetime_budget_cents: lifetime,
      daily_budget_usd_cents: daily == null ? null : convertCentsToUsd(daily, currency, etDayStr, rateMap),
      lifetime_budget_usd_cents:
        lifetime == null ? null : convertCentsToUsd(lifetime, currency, etDayStr, rateMap),
      holds_budget: daily != null || lifetime != null,
      effective_status: status,
      raw: e as unknown as object,
      synced_at: new Date().toISOString(),
    });
  };

  for (const c of campaigns) push("campaign", c);
  for (const a of adsets) push("adset", a);

  if (rows.length) {
    // Upsert only today's rows; unique(entity_level, entity_id, et_day) makes a
    // re-run today idempotent and never touches any past day.
    const { error } = await db
      .from("adsv2_budget_snapshots")
      .upsert(rows, { onConflict: "entity_level,entity_id,et_day" });
    if (error) throw new Error(`budget upsert failed for ${creator.key}: ${error.message}`);
  }
  return { rows: rows.length, seen, written };
}
