// ─────────────────────────────────────────────────────────────────────────
// INGEST CRON — pulls the outside world in, then hands over to the Ads V2
// sync which turns it into numbers.
//
// Order matters. FX first (so spend has rates to convert against), then Meta
// spend, then the sales sheet. Each step is isolated: one failing source
// leaves the others' data fresh rather than taking the whole run down. The
// step that failed is recorded in adsv2_sync_runs, so a silent partial run is
// not a thing that can happen.
//
// Runs hourly by default (see vercel.json).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runFxSync } from "@/lib/ingest/fx";
import { runMetaSpendSync } from "@/lib/ingest/meta-spend";
import { runSalesSheetSync } from "@/lib/ingest/sales-sheet";
import { runAdsV2Sync } from "@/lib/ads-v2/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StepResult = { ok: true; value: unknown } | { ok: false; error: string };

async function step(fn: () => Promise<unknown>): Promise<StepResult> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest) {
  if (!(await isCronAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lookbackDays = Number(url.searchParams.get("lookbackDays")) || undefined;
  // ?only=meta lets you re-run one source without paying for the others.
  const only = url.searchParams.get("only");
  const wants = (name: string) => !only || only === name;

  const out: Record<string, unknown> = {};

  if (wants("fx")) out.fx = await step(() => runFxSync());
  if (wants("meta")) out.meta = await step(() => runMetaSpendSync({ lookbackDays }));
  if (wants("sales")) out.sales = await step(() => runSalesSheetSync({ lookbackDays }));

  // Rebuild the numbers from whatever did land. Skipped when you asked for a
  // single source, because a half-refreshed input is not worth a full rebuild.
  if (!only) out.adsv2 = await step(() => runAdsV2Sync());

  const failures = Object.entries(out)
    .filter(([, v]) => v && typeof v === "object" && (v as StepResult).ok === false)
    .map(([k, v]) => `${k}: ${(v as { error: string }).error}`);

  return NextResponse.json(
    { ok: failures.length === 0, failures, ...out },
    // 207 when some sources worked and some did not: a monitor that only
    // watches for 200 should notice, and one that only watches for 500
    // should not page anyone at 3am over a missing spreadsheet tab.
    { status: failures.length === 0 ? 200 : failures.length === Object.keys(out).length ? 500 : 207 },
  );
}

export async function POST(req: NextRequest) {
  return GET(req);
}
