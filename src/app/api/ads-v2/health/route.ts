// ─────────────────────────────────────────────────────────────────────────
// HEALTH — what the badge next to the gear reads.
//
// Two questions, answered from what the package already records:
//   is anything wrong?      adsv2_alerts, last 7 days, counted by severity
//   is anything still running? adsv2_sync_runs, the most recent of each source
//
// A sync that has not run is a health problem in its own right, and a quiet
// dashboard showing yesterday's numbers looks exactly like a healthy one.
// ─────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { STALE_HOURS } from "@/lib/ads-v2/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getServiceSupabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

  const { data: alerts } = await db
    .from("adsv2_alerts")
    .select("severity")
    .gte("et_day", since);

  const counts: Record<string, number> = {};
  for (const row of alerts || []) {
    const severity = (row as { severity?: string }).severity || "warn";
    counts[severity] = (counts[severity] || 0) + 1;
  }

  const { data: runs } = await db
    .from("adsv2_sync_runs")
    .select("source,status,started_at,error")
    .order("started_at", { ascending: false })
    .limit(50);

  const latestBySource = new Map<string, { status: string; started_at: string; error?: string }>();
  for (const run of (runs || []) as Array<{ source: string; status: string; started_at: string; error?: string }>) {
    if (!latestBySource.has(run.source)) latestBySource.set(run.source, run);
  }

  const lastRunAt = runs?.[0]?.started_at ?? null;
  const staleMs = STALE_HOURS * 3_600_000;
  const stale = lastRunAt ? Date.now() - new Date(lastRunAt).getTime() > staleMs : true;

  // A sync that stopped running is counted as a red finding, not left silent.
  if (stale) counts.red = (counts.red || 0) + 1;
  for (const run of latestBySource.values()) {
    if (run.status === "error") counts.error = (counts.error || 0) + 1;
  }

  return NextResponse.json({
    counts,
    lastRunAt,
    stale,
    sources: Object.fromEntries(latestBySource),
  });
}
