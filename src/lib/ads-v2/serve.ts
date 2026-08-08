// ─────────────────────────────────────────────────────────────────────────
// SERVE — the request path, and ONLY a read path. It reads ONE precomputed
// snapshot row and returns it. It never aggregates facts, never touches raw
// tables, never calls an external API, and never recomputes history. A window
// with no snapshot yet returns instantly with an honest "preparing" payload;
// the actual build runs in the background (see prepareWindow), and the client
// auto-refreshes when it lands.
//
// Cache invalidation is explicit: every snapshot is stamped with the current
// data_version. A sync bumps the version, so a stale snapshot is ignored and
// rebuilt by the next background prepare. An identical request that hits a
// snapshot returns a byte-identical payload.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { getDataVersion, type Db } from "./db";
import { buildWindow, buildDaySeries } from "./windows";
import { EMPTY_BASE, type AdsV2MetricsPayload, type AdsV2Payload, type AdsV2Query } from "./types";

// Level is a view concern (which rows are shown first); the data is the full
// campaign tree, so snapshots are stored once per account/window/status.
const SNAPSHOT_LEVEL = "tree";

function snapKey(q: AdsV2Query): string {
  return `${q.account}|${q.dateFrom}|${q.dateTo}|${q.status}`;
}

export interface ServeResult {
  payload: AdsV2Payload;
  /** True when a real snapshot was served; false when returning "preparing". */
  prepared: boolean;
}

/**
 * THE READ PATH. One indexed SELECT. On a hit, return the snapshot. On a miss,
 * return an instant "preparing" payload and let the caller schedule the build
 * in the background. This function itself never builds anything.
 */
export async function serveWindow(query: AdsV2Query): Promise<ServeResult> {
  const db = getServiceSupabase();
  const version = await getDataVersion(db);
  const cached = await readSnapshot(db, query, version);
  if (cached) return { payload: withLevel(cached, query), prepared: true };
  return { payload: preparingPayload(query, version), prepared: false };
}

async function readSnapshot(db: Db, query: AdsV2Query, version: number): Promise<AdsV2Payload | null> {
  const { data } = await db
    .from("adsv2_window_snapshots")
    .select("payload, data_version")
    .eq("account", query.account)
    .eq("date_from", query.dateFrom)
    .eq("date_to", query.dateTo)
    .eq("level", SNAPSHOT_LEVEL)
    .eq("status", query.status)
    .maybeSingle();
  if (!data) return null;
  if (Number(data.data_version) !== version) return null;
  return data.payload as AdsV2Payload;
}

// De-dupe concurrent identical builds within a single server instance so a
// burst of misses for the same window only builds once.
const inFlight = new Map<string, Promise<void>>();

/**
 * Background preparation. Builds a window from the ALREADY-COMPUTED facts store
 * (indexed reads + set-based SQL) and stores the snapshot. Runs off the request
 * path only: from the route's `after()` hook or the precompute cron. Safe to
 * call repeatedly; it no-ops if the snapshot already exists at this version.
 */
export async function prepareWindow(query: AdsV2Query): Promise<void> {
  const db = getServiceSupabase();
  const version = await getDataVersion(db);
  const existing = await readSnapshot(db, query, version);
  if (existing) return;

  const key = `${snapKey(query)}|${version}`;
  const running = inFlight.get(key);
  if (running) return running;

  const promise = computeAndStore(db, query, version)
    .then(() => undefined)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function computeAndStore(db: Db, query: AdsV2Query, version: number): Promise<AdsV2Payload> {
  const payload = await buildWindow(query, version);
  // The Metrics slice is built and stored in the SAME row at the SAME version,
  // so the cards and the table can never disagree. Its total is the table's
  // total (window-distinct people), so every card's big number matches the
  // table's TOTAL row; the day series drives only the chart shape.
  const metrics = await buildDaySeries(query, version);
  metrics.total = payload.total;
  await db.from("adsv2_window_snapshots").upsert(
    {
      account: query.account,
      date_from: query.dateFrom,
      date_to: query.dateTo,
      level: SNAPSHOT_LEVEL,
      status: query.status,
      data_version: version,
      payload: payload as unknown as object,
      metrics_payload: metrics as unknown as object,
      compute_ms: payload.computeMs,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "account,date_from,date_to,level,status" },
  );
  return payload;
}

/**
 * THE METRICS READ PATH. One indexed SELECT of the metrics slice stored beside
 * the table snapshot. On a hit at the current version, return it; on a miss,
 * return a "preparing" slice and schedule the same background build the table
 * uses (computeAndStore builds both). Never computes on the request path.
 */
export async function serveMetrics(query: AdsV2Query): Promise<{ payload: AdsV2MetricsPayload; prepared: boolean }> {
  const db = getServiceSupabase();
  const version = await getDataVersion(db);
  const { data } = await db
    .from("adsv2_window_snapshots")
    .select("metrics_payload, data_version")
    .eq("account", query.account)
    .eq("date_from", query.dateFrom)
    .eq("date_to", query.dateTo)
    .eq("level", SNAPSHOT_LEVEL)
    .eq("status", query.status)
    .maybeSingle();
  if (data?.metrics_payload && Number(data.data_version) === version) {
    return { payload: data.metrics_payload as AdsV2MetricsPayload, prepared: true };
  }
  return {
    payload: {
      account: query.account,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      dataVersion: version,
      days: [],
      total: { ...EMPTY_BASE },
      generatedAt: new Date().toISOString(),
      preparing: true,
    },
    prepared: false,
  };
}

function preparingPayload(query: AdsV2Query, version: number): AdsV2Payload {
  return {
    account: query.account,
    status: query.status,
    level: query.level,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    dataVersion: version,
    campaigns: [],
    total: { ...EMPTY_BASE },
    freshness: {},
    notices: ["Preparing this window. It will appear in a moment."],
    generatedAt: new Date().toISOString(),
    computeMs: 0,
    preparing: true,
  };
}

// The stored payload is level-agnostic; stamp the requested level on the way
// out so the response echoes what was asked for (view concern only).
function withLevel(payload: AdsV2Payload, query: AdsV2Query): AdsV2Payload {
  if (payload.level === query.level) return payload;
  return { ...payload, level: query.level };
}
