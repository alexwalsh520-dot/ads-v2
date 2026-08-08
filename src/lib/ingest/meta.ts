// ─────────────────────────────────────────────────────────────────────────
// META GRAPH API — the only place this package talks to Facebook.
//
// Two calls per ad account per sync:
//   getAdLevelInsights  the money: spend, impressions, clicks, per ad per day
//   getAdEntities       the metadata: names, statuses, creative thumbnails
//
// Both paginate. Neither retries a genuine error, because a silent retry on a
// permissions failure just turns a clear problem into a slow mysterious one.
// ─────────────────────────────────────────────────────────────────────────

const GRAPH_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaAdInsight {
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
  date_start?: string;
  date_stop?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

export interface MetaAdEntity {
  id: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
    image_url?: string;
  };
  campaign?: {
    id?: string;
    name?: string;
    effective_status?: string;
    configured_status?: string;
  };
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

async function metaFetch<T>(url: string, accessToken: string): Promise<T> {
  const separator = url.includes("?") ? "&" : "?";
  // Only append the token when the URL does not already carry one: Meta's own
  // `paging.next` links come back pre-signed.
  const authedUrl = url.includes("access_token=")
    ? url
    : `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(authedUrl, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    // Never let the token reach a log line or an error message.
    throw new Error(`Meta API error ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllPages<T>(firstUrl: string, accessToken: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = firstUrl;
  // A hard page cap. Meta paging bugs are real and an unbounded while loop in a
  // serverless function is a bill, not an outage you notice.
  for (let page = 0; next && page < 200; page += 1) {
    const res: Paged<T> = await metaFetch<Paged<T>>(next, accessToken);
    out.push(...res.data);
    next = res.paging?.next;
  }
  return out;
}

/**
 * Daily spend per ad. Pass `breakdowns: ["hourly_stats_aggregated_by_advertiser_time_zone"]`
 * for an account that does not already report in your reporting timezone —
 * the hourly rows are what let a day be re-cut onto the right boundary.
 */
export async function getAdLevelInsights(
  adAccountId: string,
  since: string,
  until: string,
  options: { accessToken: string; breakdowns?: string[] },
): Promise<MetaAdInsight[]> {
  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "inline_link_clicks",
    "clicks",
  ].join(",");
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const breakdowns = options.breakdowns?.length
    ? `&breakdowns=${encodeURIComponent(options.breakdowns.join(","))}`
    : "";
  const url =
    `${BASE_URL}/${adAccountId}/insights?level=ad&fields=${fields}` +
    `&time_increment=1&limit=500&time_range=${timeRange}${breakdowns}`;
  return fetchAllPages<MetaAdInsight>(url, options.accessToken);
}

/**
 * Ad + campaign status and creative thumbnails. One paginated request per
 * account, not one per ad.
 *
 * Meta rejects pages whose nested fields add up to too much data with a 500
 * "Please reduce the amount of data you're asking for". The threshold depends
 * on the account's own ads, so a page size that works today starts failing as
 * the account grows — this is how one creator's statuses (and their whole
 * Active view) went blank after a relaunch. On that specific error, restart at
 * a smaller page size instead of losing the account's statuses outright.
 */
const AD_ENTITY_PAGE_SIZES = [500, 100, 25];

function isTooMuchDataError(error: unknown) {
  return error instanceof Error && error.message.includes("reduce the amount of data");
}

export async function getAdEntities(
  adAccountId: string,
  options: { accessToken: string },
): Promise<MetaAdEntity[]> {
  const fields = [
    "id",
    "name",
    "effective_status",
    "configured_status",
    "creative{id,name,thumbnail_url,image_url}",
    "campaign{id,name,effective_status,configured_status}",
  ].join(",");

  let lastError: unknown = null;
  for (const pageSize of AD_ENTITY_PAGE_SIZES) {
    try {
      return await fetchAllPages<MetaAdEntity>(
        `${BASE_URL}/${adAccountId}/ads?fields=${fields}&limit=${pageSize}`,
        options.accessToken,
      );
    } catch (error) {
      lastError = error;
      if (!isTooMuchDataError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Meta ad entities fetch failed");
}

export { BASE_URL as META_BASE_URL, GRAPH_VERSION as META_GRAPH_VERSION };
