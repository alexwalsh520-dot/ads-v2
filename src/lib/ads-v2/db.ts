// ─────────────────────────────────────────────────────────────────────────
// DB helpers shared by the Ads v2 background jobs. Nothing here runs in the
// request path. The request path only reads one precomputed snapshot row.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";

export type Db = ReturnType<typeof getServiceSupabase>;

/**
 * Page through a Supabase select in fixed chunks so we never rely on the
 * silent 1000-row cap. `build(from, to)` must apply `.range(from, to)` and any
 * filters/order and return the query. Deterministic order in `build` is
 * required for correctness.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Hard ceiling so a bug can never loop forever.
  for (let page = 0; page < 1000; page++) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Read the current data version (a monotonically increasing integer). */
export async function getDataVersion(db: Db): Promise<number> {
  const { data } = await db.from("adsv2_meta").select("value").eq("key", "data_version").maybeSingle();
  const v = data?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 1;
}

/** Bump the data version so cached snapshots invalidate. Returns the new value. */
export async function bumpDataVersion(db: Db): Promise<number> {
  const current = await getDataVersion(db);
  const next = current + 1;
  await db
    .from("adsv2_meta")
    .upsert({ key: "data_version", value: next as unknown as object, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return next;
}

/** Record the start of a sync run; returns the row id. */
export async function startRun(db: Db, source: string): Promise<string | null> {
  const { data } = await db
    .from("adsv2_sync_runs")
    .insert({ source, status: "ok", started_at: new Date().toISOString() })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/** Close a sync run with an outcome. */
export async function finishRun(
  db: Db,
  id: string | null,
  patch: { status: string; rows?: number; durationMs?: number; detail?: unknown; error?: string },
): Promise<void> {
  if (!id) return;
  await db
    .from("adsv2_sync_runs")
    .update({
      status: patch.status,
      ended_at: new Date().toISOString(),
      rows: patch.rows ?? null,
      duration_ms: patch.durationMs ?? null,
      detail: (patch.detail ?? null) as object | null,
      error: patch.error ?? null,
    })
    .eq("id", id);
}
