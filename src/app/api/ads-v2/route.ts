import { NextRequest, NextResponse, after } from "next/server";
import { isSignedIn } from "@/auth";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { serveWindow, prepareWindow } from "@/lib/ads-v2/serve";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Level, AdsV2Query, AdsV2Status } from "@/lib/ads-v2/types";

// Read path only: ONE indexed SELECT of a precomputed snapshot. It never
// aggregates facts, never touches raw tables, never calls an external API, and
// never recomputes history. A window with no snapshot returns instantly with a
// "preparing" payload and the build is scheduled to run AFTER the response is
// sent (never blocking the request). The response is milliseconds.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Whatever is configured, plus the roll-up. Hardcoding names here would
// reject a perfectly good creator with a 400 that names no cause.
const ACCOUNTS = new Set<string>(["all", ...ADSV2_SERVED_CLIENTS]);
const STATUSES = new Set(["active", "finished", "all"]);
const LEVELS = new Set(["campaign", "adset", "ad"]);
const PRESET_IDS = new Set([
  "today",
  "yesterday",
  "last3",
  "last7",
  "last14",
  "last30",
  "mtd",
  "lmtd",
  "custom",
]);

function isIsoDay(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest) {
  if (!(await isSignedIn())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const account = (ACCOUNTS.has(sp.get("account") || "") ? sp.get("account") : "all") as AdsV2Account;
  const status = (STATUSES.has(sp.get("status") || "") ? sp.get("status") : "active") as AdsV2Status;
  const level = (LEVELS.has(sp.get("level") || "") ? sp.get("level") : "campaign") as AdsV2Level;

  // Range: explicit dateFrom/dateTo win; otherwise resolve a preset server-side
  // (so the ET math is identical to the client's), defaulting to last 7 days.
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

  const query: AdsV2Query = { account, status, level, dateFrom, dateTo };

  try {
    const { payload, prepared } = await serveWindow(query);
    // On a miss, prepare the window AFTER the response is sent, so the request
    // stays a pure read. The client sees `preparing: true` and auto-refreshes.
    if (!prepared) {
      after(async () => {
        try {
          await prepareWindow(query);
        } catch {
          // A failed background build is retried on the next request or cron;
          // it never surfaces as a request error.
        }
      });
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read window" },
      { status: 500 },
    );
  }
}
