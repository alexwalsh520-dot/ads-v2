// ─────────────────────────────────────────────────────────────────────────
// META SPEND SYNC — fills ads_meta_insights_daily, the table every number on
// the page is ultimately divided by.
//
// THE ONE IDEA THAT MATTERS: a "day" must mean the same thing for every
// creator. Meta reports each ad account on that account's OWN timezone, so a
// Sydney account and a Los Angeles account disagree about when Tuesday was.
// Left alone, that quietly smears spend across day boundaries and makes a
// week-over-week comparison meaningless.
//
// So: an account already reporting in your reporting timezone is stored as-is.
// Any other account is pulled with Meta's hourly advertiser-time breakdown,
// each hour is converted to a real instant, and the hours are re-bucketed onto
// reporting-timezone days. Every row is then stamped with the timezone it was
// cut on, and the reader trusts nothing that lacks the stamp.
//
// KEYWORDS come out of the AD NAME. That is the join between money and DMs:
// the keyword in the ad's name is the same word the ad tells people to send.
// An ad whose name carries no keyword still syncs — it just cannot be
// attributed, which the dashboard shows rather than hides.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS, creatorCredentials, type Creator } from "@/lib/creators";
import { loadConfig } from "@/lib/config";
import { displayKeyword, keywordFromAdName } from "@/lib/ads-tracker/normalize";
import { getAdEntities, getAdLevelInsights, type MetaAdEntity, type MetaAdInsight } from "./meta";
import { startRun, finishRun } from "@/lib/ads-v2/db";

const HOURLY_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone";
const DEFAULT_LOOKBACK_DAYS = 10;
const UPSERT_CHUNK = 200;

const REPORTING_TIMEZONE = loadConfig().reportingTimezone;

// ── date helpers, all timezone-explicit ───────────────────────────────────

function dateInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function datePartsInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * "2026-08-07 14:00 in Australia/Sydney" → the real instant.
 *
 * Solved by iteration rather than arithmetic because offsets are not constants:
 * they change with DST, and on a DST boundary a naive calculation lands an hour
 * out — which is exactly how spend leaks into the wrong day. Four passes
 * converge for every real zone, including half-hour and 45-minute offsets.
 */
function zonedDateTimeToUtc(date: string, hour: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = new Date(targetUtcMs);
  for (let i = 0; i < 4; i += 1) {
    const p = datePartsInTimezone(guess, timeZone);
    const asLocalUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asLocalUtcMs - targetUtcMs;
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }
  return guess;
}

function hourFromBreakdown(value: string | undefined): number | null {
  const match = value?.match(/^(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

// ── row building ──────────────────────────────────────────────────────────

export interface InsightRow {
  client_key: string;
  client_name: string;
  ad_account_id: string;
  account_timezone: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  ad_effective_status: string | null;
  ad_configured_status: string | null;
  campaign_effective_status: string | null;
  campaign_configured_status: string | null;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  date: string;
  spend_cents: number;
  impressions: number;
  link_clicks: number;
  synced_at: string;
  raw_payload: Record<string, unknown>;
}

function creativePreview(entity: MetaAdEntity | undefined) {
  const creative = entity?.creative;
  if (!creative?.thumbnail_url && !creative?.image_url) return null;
  return {
    creative_id: creative.id || null,
    creative_name: creative.name || null,
    thumbnail_url: creative.thumbnail_url || null,
    image_url: creative.image_url || null,
  };
}

function keywordOf(adName: string | undefined, enabled: boolean) {
  if (!enabled) return { keyword: null, keywordRaw: adName || null };
  const keyword = keywordFromAdName(adName);
  return { keyword, keywordRaw: keyword ? displayKeyword(keyword) : adName || null };
}

function num(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Turn one account's insights into storable rows.
 *
 * Exported so the timezone re-bucketing is directly testable — it is the part
 * of this file most likely to be wrong and least likely to be noticed.
 */
export function buildRows(
  creator: Creator,
  adAccountId: string,
  insights: MetaAdInsight[],
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
  statusByAdId: Map<string, MetaAdEntity>,
  keywordFromName: boolean,
): InsightRow[] {
  const nativeReporting = creator.timezone === REPORTING_TIMEZONE;

  // Same-timezone account: Meta's own day boundary is already the right one.
  if (nativeReporting) {
    return insights
      .filter((row) => row.ad_id && row.date_start)
      .map((row) => {
        const status = statusByAdId.get(row.ad_id as string);
        const { keyword, keywordRaw } = keywordOf(row.ad_name, keywordFromName);
        return {
          client_key: creator.key,
          client_name: creator.name,
          ad_account_id: adAccountId,
          account_timezone: creator.timezone,
          campaign_id: row.campaign_id || null,
          campaign_name: row.campaign_name || null,
          adset_id: row.adset_id || null,
          adset_name: row.adset_name || null,
          ad_id: row.ad_id as string,
          ad_name: row.ad_name || null,
          ad_effective_status: status?.effective_status || null,
          ad_configured_status: status?.configured_status || null,
          campaign_effective_status: status?.campaign?.effective_status || null,
          campaign_configured_status: status?.campaign?.configured_status || null,
          keyword_raw: keywordRaw,
          keyword_normalized: keyword,
          date: row.date_start as string,
          spend_cents: Math.round(num(row.spend) * 100),
          impressions: num(row.impressions),
          link_clicks: num(row.inline_link_clicks) || num(row.clicks),
          synced_at: syncedAt,
          // The stamp goes on EVERY row, including this path. The reader filters
          // on it, so an unstamped row is invisible — a row that exists, looks
          // fine in the table, and silently contributes nothing.
          raw_payload: {
            ...row,
            reporting_timezone: REPORTING_TIMEZONE,
            account_timezone: creator.timezone,
            creative_preview: creativePreview(status),
          },
        };
      });
  }

  // Different timezone: re-cut the hourly rows onto reporting-timezone days.
  const grouped = new Map<string, InsightRow & { spend: number }>();

  for (const row of insights) {
    if (!row.ad_id || !row.date_start) continue;
    const hour = hourFromBreakdown(row[HOURLY_BREAKDOWN as keyof MetaAdInsight] as string | undefined);
    // No hour means the row cannot be placed on a day boundary. Dropping it is
    // the honest move: a row placed on a guessed day is a wrong number that
    // looks exactly like a right one.
    if (hour === null) continue;

    const reportingDate = dateInTimezone(
      zonedDateTimeToUtc(row.date_start, hour, creator.timezone),
      REPORTING_TIMEZONE,
    );
    // Edge hours legitimately fall outside the requested window once shifted.
    if (reportingDate < dateFrom || reportingDate > dateTo) continue;

    const status = statusByAdId.get(row.ad_id);
    const key = `${row.ad_id}:${reportingDate}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.spend += num(row.spend);
      existing.impressions += num(row.impressions);
      existing.link_clicks += num(row.inline_link_clicks) || num(row.clicks);
      (existing.raw_payload.hourly_rows as MetaAdInsight[]).push(row);
      continue;
    }

    const { keyword, keywordRaw } = keywordOf(row.ad_name, keywordFromName);
    grouped.set(key, {
      client_key: creator.key,
      client_name: creator.name,
      ad_account_id: adAccountId,
      account_timezone: creator.timezone,
      campaign_id: row.campaign_id || null,
      campaign_name: row.campaign_name || null,
      adset_id: row.adset_id || null,
      adset_name: row.adset_name || null,
      ad_id: row.ad_id,
      ad_name: row.ad_name || null,
      ad_effective_status: status?.effective_status || null,
      ad_configured_status: status?.configured_status || null,
      campaign_effective_status: status?.campaign?.effective_status || null,
      campaign_configured_status: status?.campaign?.configured_status || null,
      keyword_raw: keywordRaw,
      keyword_normalized: keyword,
      date: reportingDate,
      spend_cents: 0,
      spend: num(row.spend),
      impressions: num(row.impressions),
      link_clicks: num(row.inline_link_clicks) || num(row.clicks),
      synced_at: syncedAt,
      raw_payload: {
        reporting_timezone: REPORTING_TIMEZONE,
        account_timezone: creator.timezone,
        source_breakdown: HOURLY_BREAKDOWN,
        creative_preview: creativePreview(status),
        hourly_rows: [row],
      },
    });
  }

  return Array.from(grouped.values()).map(({ spend, ...row }) => ({
    ...row,
    spend_cents: Math.round(spend * 100),
  }));
}

// ── the sync ──────────────────────────────────────────────────────────────

export interface MetaSpendResult {
  rows: number;
  creators: Array<{
    key: string;
    status: "ok" | "not_configured" | "error";
    rows?: number;
    ads?: number;
    statusesFailed?: boolean;
    error?: string;
  }>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runMetaSpendSync(
  opts: { lookbackDays?: number; now?: Date } = {},
): Promise<MetaSpendResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "meta_spend");
  const started = Date.now();

  const now = opts.now ?? new Date();
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const dateTo = dateInTimezone(now, REPORTING_TIMEZONE);
  const dateFrom = shiftDate(dateTo, -lookback);
  const syncedAt = now.toISOString();
  const keywordFromName = loadConfig().attribution.keywordFromAdName;

  const result: MetaSpendResult = { rows: 0, creators: [] };

  try {
    for (const creator of ACTIVE_CREATORS) {
      const creds = creatorCredentials(creator);
      if (!creds) {
        // Not an error. A creator you have added to the config but not yet
        // given credentials for is a normal in-between state.
        result.creators.push({ key: creator.key, status: "not_configured" });
        continue;
      }

      try {
        // Statuses are best-effort. Losing them costs the Active/Paused filter;
        // losing spend costs every number. So a status failure must never take
        // the money down with it.
        let entities: MetaAdEntity[] = [];
        let statusesFailed = false;
        try {
          entities = await getAdEntities(creds.adAccountId, { accessToken: creds.accessToken });
        } catch {
          statusesFailed = true;
        }
        const statusByAdId = new Map(entities.map((e) => [e.id, e]));

        const nativeReporting = creator.timezone === REPORTING_TIMEZONE;
        const insights = await getAdLevelInsights(creds.adAccountId, dateFrom, dateTo, {
          accessToken: creds.accessToken,
          // Only ask for hourly rows when the day boundary actually has to move.
          // They are ~24x the volume, so requesting them needlessly is slow and
          // pointless.
          breakdowns: nativeReporting ? undefined : [HOURLY_BREAKDOWN],
        });

        const rows = buildRows(
          creator,
          creds.adAccountId,
          insights,
          dateFrom,
          dateTo,
          syncedAt,
          statusByAdId,
          keywordFromName,
        );

        for (const part of chunk(rows, UPSERT_CHUNK)) {
          const { error } = await db
            .from("ads_meta_insights_daily")
            .upsert(part, { onConflict: "client_key,ad_id,date" });
          if (error) throw new Error(`upsert failed: ${error.message}`);
        }

        // Remember each ad's still-current creative image so the table can show
        // a thumbnail long after Meta's own preview URL has expired.
        const creatives = entities
          .filter((e) => e.creative?.thumbnail_url || e.creative?.image_url)
          .map((e) => ({
            ad_id: e.id,
            client_key: creator.key,
            source_image_url: e.creative?.image_url || e.creative?.thumbnail_url || null,
          }));
        for (const part of chunk(creatives, UPSERT_CHUNK)) {
          await db.from("ad_creative_image").upsert(part, { onConflict: "ad_id" });
        }

        result.rows += rows.length;
        result.creators.push({
          key: creator.key,
          status: "ok",
          rows: rows.length,
          ads: entities.length,
          statusesFailed,
        });
      } catch (err) {
        // One creator's Meta problem must not stop the others syncing.
        result.creators.push({
          key: creator.key,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const failed = result.creators.filter((c) => c.status === "error");
    await finishRun(db, runId, {
      status: failed.length && failed.length === result.creators.length ? "error" : "ok",
      rows: result.rows,
      durationMs: Date.now() - started,
      detail: { dateFrom, dateTo, creators: result.creators },
      error: failed.length ? failed.map((f) => `${f.key}: ${f.error}`).join("; ") : undefined,
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
