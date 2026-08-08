// ─────────────────────────────────────────────────────────────────────────
// TYPES — the shapes the serving layer returns and the UI reads.
//
// Rows carry only BASE metrics (sums of individual records). Every derived
// column (CPM, CTR, cost per thing, show rate, ROI) is computed from those
// bases at render time and in the TOTAL row, so a total is always a formula
// over the union, never a sum of per-row ratios.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A creator key, or "all" for the roll-up across every configured creator.
 *
 * Open on purpose. In a single-tenant app you can enumerate your creators in
 * the type system; here the list is config, so the type has to be a string and
 * the real check happens at the request boundary against ADSV2_SERVED_CLIENTS.
 */
export type AdsV2Account = string;
export type AdsV2Status = "active" | "finished" | "all";
export type AdsV2Level = "campaign" | "adset" | "ad";

export interface AdsV2Query {
  account: AdsV2Account;
  status: AdsV2Status;
  level: AdsV2Level;
  dateFrom: string; // inclusive ET day
  dateTo: string; // inclusive ET day
}

/** One named person behind a booked / taken / show-rate number, for the hover. */
export interface CallDetail {
  name: string;
  dmEtDay: string | null;
  bookedEtDay: string | null;
  callEtDay: string | null;
  // showed = hard-key-linked taken record; noshow = GHL no-show status and no
  // taken record; upcoming = future appointment (excluded from show rate);
  // no_outcome = the call day passed with no record either way (never a show).
  status: "showed" | "noshow" | "upcoming" | "no_outcome";
  /** How many appointment records this one person had (reschedules). */
  records: number;
}

/** The base metrics summed over the individual facts for a node. */
export interface BaseMetrics {
  spendCents: number;
  impressions: number;
  clicks: number;
  messages: number; // distinct DM people (per keyword)
  booked: number; // distinct booked people (per keyword)
  taken: number; // sales-tracker calls taken (rows) -> the "Calls taken" column
  takenPeople: number; // distinct people taken in the sale window (sale cohort)
  // Cohort-true show-rate numerator: distinct people BOOKED in this window (not
  // upcoming) who have a hard-key-linked taken record. Same cohort as the popup.
  showedPeople: number;
  upcoming: number; // distinct upcoming people (subset of booked)
  newClients: number;
  collectedCents: number;
  contractedCents: number;
}

export interface BudgetInfo {
  level: "campaign" | "adset" | null;
  dailyUsdCents: number | null;
  lifetimeUsdCents: number | null;
  holds: boolean;
  currency: string;
}

export interface AdsV2Node extends BaseMetrics {
  id: string;
  level: AdsV2Level;
  name: string;
  shortName: string;
  keyword: string | null;
  clientKey: string;
  clientName: string;
  status: "active" | "finished" | "empty";
  hasSpend: boolean;
  budget: BudgetInfo | null;
  previewImageUrl: string | null;
  // The durable video file URL for a video ad (our storage), and whether this
  // ad is a video at all. The table never preloads the video; it loads only on
  // play. A video ad with no stored file yet shows its thumbnail + a note.
  videoUrl: string | null;
  hasVideo: boolean;
  /** Named records behind the call metrics, for hovers. */
  callDetails: { booked: CallDetail[]; taken: CallDetail[] } | null;
  children: AdsV2Node[];
}

export interface FreshnessSource {
  lastEtDay: string | null;
  lastSyncedAt: string | null;
  ageHours: number | null;
  stale: boolean;
}

export interface AdsV2Payload {
  account: AdsV2Account;
  status: AdsV2Status;
  level: AdsV2Level;
  dateFrom: string;
  dateTo: string;
  dataVersion: number;
  /** Campaign tree (campaign -> ad set -> ad), base metrics at every node. */
  campaigns: AdsV2Node[];
  /** Base-metric totals over the union of all displayed ads. */
  total: BaseMetrics;
  freshness: Record<string, FreshnessSource>;
  /** Per-client empty-state notes (e.g. spend recorded but no funnel yet). */
  notices: string[];
  generatedAt: string;
  computeMs: number;
  /**
   * True when this window has no snapshot yet: the request path returns this
   * instantly (never computing) and a background job prepares the real numbers.
   * The client shows a one-line "preparing" state and auto-refreshes.
   */
  preparing?: boolean;
}

/** One Eastern-time day of the metrics-card series. Base counts only; every
 *  chart's derived value is a formula over these, matching the table. */
export interface MetricsDay {
  day: string; // ET day YYYY-MM-DD
  spendCents: number;
  impressions: number;
  clicks: number;
  messages: number;
  booked: number;
  taken: number;
  newClients: number;
  collectedCents: number;
  // Revenue-category fields (optional: absent on snapshots written before the
  // revenue cards existed; the next version bump rebuilds them in).
  /** Organic-keyword sales collected, scoped to the selected account. */
  organicCents?: number;
  /** "Miscellaneous Chat" tracker sales no keyword claims. WHOLE tracker: the
   *  sales sheet has no creator column, so this cannot be scoped per creator. */
  miscChatCents?: number;
  /** Ads-attributed collected across ALL creators (coverage numerator part). */
  adsAllCents?: number;
  /** Organic-attributed collected across ALL creators. */
  organicAllCents?: number;
  /** Sales the team logged with another origin call type (Follow up,
   *  Outbound Call, Closer Cold Call) that no keyword claims. Whole tracker. */
  otherOriginAllCents?: number;
  /** Every tracker sale collected that day (coverage denominator). */
  trackerAllCents?: number;
}

/** Window totals of the revenue-category day fields, same scoping rules. */
export interface RevenueCategories {
  organicCents: number;
  miscChatCents: number;
  adsAllCents: number;
  organicAllCents: number;
  otherOriginAllCents: number;
  trackerAllCents: number;
}

/** The Metrics section's slice, stored beside the table snapshot at the SAME
 *  data_version. Fetched lazily after the table paints; its `total` equals the
 *  table payload's total by construction, so the cards and table always agree. */
export interface AdsV2MetricsPayload {
  account: AdsV2Account;
  status: AdsV2Status;
  dateFrom: string;
  dateTo: string;
  dataVersion: number;
  days: MetricsDay[];
  total: BaseMetrics;
  /** Window totals for the revenue category cards (optional on old snapshots). */
  revenue?: RevenueCategories;
  generatedAt: string;
  preparing?: boolean;
}

export const EMPTY_BASE: BaseMetrics = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  messages: 0,
  booked: 0,
  taken: 0,
  takenPeople: 0,
  showedPeople: 0,
  upcoming: 0,
  newClients: 0,
  collectedCents: 0,
  contractedCents: 0,
};

export function addBase(a: BaseMetrics, b: BaseMetrics): BaseMetrics {
  return {
    spendCents: a.spendCents + b.spendCents,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    messages: a.messages + b.messages,
    booked: a.booked + b.booked,
    taken: a.taken + b.taken,
    takenPeople: a.takenPeople + b.takenPeople,
    showedPeople: a.showedPeople + b.showedPeople,
    upcoming: a.upcoming + b.upcoming,
    newClients: a.newClients + b.newClients,
    collectedCents: a.collectedCents + b.collectedCents,
    contractedCents: a.contractedCents + b.contractedCents,
  };
}
