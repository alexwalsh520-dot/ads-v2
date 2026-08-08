// The Metrics section slice: one indexed SELECT of the day series stored beside
// the table snapshot at the same data_version. Never aggregates raw tables at
// request time. On a miss it returns "preparing" and schedules the shared
// background build after the response, exactly like the table route.
import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { serveMetrics, prepareWindow } from "@/lib/ads-v2/serve";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Query, AdsV2Status } from "@/lib/ads-v2/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Whatever is configured, plus the roll-up. Hardcoding names here would
// reject a perfectly good creator with a 400 that names no cause.
const ACCOUNTS = new Set<string>(["all", ...ADSV2_SERVED_CLIENTS]);
const STATUSES = new Set(["active", "finished", "all"]);
const PRESET_IDS = new Set([
  "today", "yesterday", "last3", "last7", "last14", "last30", "mtd", "lmtd", "custom",
]);

function isIsoDay(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const account = (ACCOUNTS.has(sp.get("account") || "") ? sp.get("account") : "all") as AdsV2Account;
  const status = (STATUSES.has(sp.get("status") || "") ? sp.get("status") : "active") as AdsV2Status;
  let dateFrom = sp.get("dateFrom");
  let dateTo = sp.get("dateTo");
  if (!isIsoDay(dateFrom) || !isIsoDay(dateTo)) {
    const presetRaw = sp.get("preset");
    const preset = (PRESET_IDS.has(presetRaw || "") ? presetRaw : "last7") as PresetId;
    const range = rangeForPreset(preset, todayEt());
    dateFrom = range.from;
    dateTo = range.to;
  }
  if (dateTo < dateFrom) [dateFrom, dateTo] = [dateTo, dateFrom];

  const query: AdsV2Query = { account, status, level: "campaign", dateFrom, dateTo };
  try {
    const { payload, prepared } = await serveMetrics(query);
    if (!prepared) {
      after(async () => {
        try {
          await prepareWindow(query);
        } catch {
          /* retried on next request or cron */
        }
      });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read metrics" },
      { status: 500 },
    );
  }
}
