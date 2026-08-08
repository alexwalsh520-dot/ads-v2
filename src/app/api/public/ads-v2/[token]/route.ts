// ─────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN ADS V2 API — the security boundary for the client share
// link. The client scope is derived SOLELY from the token row in
// public_share_links (token -> client_key); a request never chooses the
// account. A tampered ?account=... cannot exist here (we ignore everything but
// status/date), so a link can only ever return its own client's data.
//
// It serves from the SAME precomputed snapshot read path as the authed route
// (serveWindow), so the numbers, colors, and speed are identical. On a snapshot
// miss it returns the instant "preparing" payload and schedules the build after
// the response, exactly like the authed route.
//
// On the api/public allow-list in src/proxy.ts, so it is NOT auth-gated; the
// token check below replaces auth. Service role, server-side only, GET only.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse, after } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isCreatorKey } from "@/lib/creators";
import { serveWindow, serveMetrics, prepareWindow } from "@/lib/ads-v2/serve";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Query, AdsV2Status } from "@/lib/ads-v2/types";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { buildProtections } from "@/lib/ads-v2/protections";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  // A share link is private-by-link; keep it out of every index.
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const STATUSES = new Set(["active", "finished", "all"]);
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

// Simple per-token rate limit: a token-bucket in module memory. Enough to blunt
// a scripted hammer on one link without any external dependency. Per instance.
const RATE_MAX = 30; // requests
const RATE_WINDOW_MS = 10_000; // per 10 seconds
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(token: string, now: number): boolean {
  const b = buckets.get(token);
  if (!b || now > b.resetAt) {
    buckets.set(token, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

async function resolveToken(token: string): Promise<{ clientKey: AdsV2Account } | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked || data.kind !== "ads_v2") return null;
    // Fail closed: the token's client must be a real served creator key.
    if (!isCreatorKey(data.client_key)) return null;
    if (!ADSV2_SERVED_CLIENTS.includes(data.client_key)) return null;
    return { clientKey: data.client_key as AdsV2Account };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = Date.now();
  if (rateLimited(token, now)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE_HEADERS });
  }

  const resolved = await resolveToken(token);
  if (!resolved) {
    return NextResponse.json({ error: "Not available" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const sp = req.nextUrl.searchParams;

  // The "How this app protects itself" panel reads the same non-sensitive
  // health records the authed gear shows. Safe to expose to the share link.
  if (sp.get("section") === "protections") {
    try {
      const report = await buildProtections(getServiceSupabase());
      return NextResponse.json(report, { headers: NO_STORE_HEADERS });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  }

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

  // The account is the token's client, ALWAYS. Nothing from the request.
  const query: AdsV2Query = {
    account: resolved.clientKey,
    status,
    level: "campaign",
    dateFrom,
    dateTo,
  };

  // The Metrics slice (charts + cards), same token-scoped snapshot path.
  if (sp.get("section") === "metrics") {
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
      // Tracker-wide money (misc chats, coverage denominators) spans the whole
      // team; a creator's share link must never carry it, so it is stripped
      // from the JSON itself, not just hidden in the UI. Account-scoped organic
      // stays: it is this creator's own revenue.
      const publicPayload = {
        ...payload,
        revenue: payload.revenue
          ? {
              ...payload.revenue,
              miscChatCents: 0,
              adsAllCents: 0,
              organicAllCents: 0,
              otherOriginAllCents: 0,
              trackerAllCents: 0,
            }
          : undefined,
        days: payload.days.map((d) => ({
          ...d,
          miscChatCents: 0,
          adsAllCents: 0,
          organicAllCents: 0,
          otherOriginAllCents: 0,
          trackerAllCents: 0,
        })),
      };
      return NextResponse.json(publicPayload, { headers: NO_STORE_HEADERS });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed" },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
  }

  try {
    const { payload, prepared } = await serveWindow(query);
    if (!prepared) {
      after(async () => {
        try {
          await prepareWindow(query);
        } catch {
          /* retried on the next request or cron */
        }
      });
    }
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to read window" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
