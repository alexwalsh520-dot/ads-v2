import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runSelfCheck } from "@/lib/ads-v2/selfcheck";

// Nightly accuracy gates: reconciliation drift, cross-window invariants, and
// source-data anomalies. Findings are written to adsv2_alerts and returned.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = secret === process.env.CRON_SECRET;
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runSelfCheck();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "selfcheck failed" },
      { status: 500 },
    );
  }
}
