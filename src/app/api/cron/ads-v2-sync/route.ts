import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runAdsV2Sync } from "@/lib/ads-v2/sync";

// Background sync: budget snapshot -> facts pass -> version bump -> precompute.
// All external fetching happens here, never in the request path.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // The scheduler with the shared secret, or a signed-in human forcing a run.
  if (!(await isCronAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // ?factsOnly=1 rebuilds the facts without touching the snapshots the tab
    // reads. Used to compare new attribution against the live numbers before
    // letting anything the owner sees change.
    const factsOnly = new URL(req.url).searchParams.get("factsOnly") === "1";
    const result = await runAdsV2Sync(new Date(), { factsOnly });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
