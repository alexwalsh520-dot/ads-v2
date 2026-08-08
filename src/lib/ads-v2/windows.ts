// ─────────────────────────────────────────────────────────────────────────
// WINDOW BUILD — turn the DB's pre-aggregated leaves into the campaign tree
// the UI reads. The database did every sum and distinct-count; here we only
// assemble the small result, attach budgets, compute node status, and build
// the named-record hover lists. This runs in the precompute job, never in a
// request.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";
import { creatorCurrency } from "@/lib/fx/rates";
import { etDay, shiftDay } from "./time";
import { displayKeyword } from "./keyword";
import { groupBookingsByPerson, type BookingRecord } from "./attribution";
import { fetchAllRows, type Db } from "./db";
import { ADSV2_SERVED_CLIENTS } from "./config";
import {
  EMPTY_BASE,
  addBase,
  type AdsV2Account,
  type AdsV2MetricsPayload,
  type AdsV2Node,
  type AdsV2Payload,
  type AdsV2Query,
  type BaseMetrics,
  type BudgetInfo,
  type CallDetail,
  type MetricsDay,
  type RevenueCategories,
} from "./types";

interface LeafRow {
  client_key: string;
  keyword: string;
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_status: string | null;
  campaign_status: string | null;
  preview_url: string | null;
  video_url: string | null;
  is_video: boolean;
  spend_cents: number;
  impressions: number;
  clicks: number;
  messages: number;
  booked: number;
  upcoming: number;
  showed_people: number;
  taken_rows: number;
  taken_people: number;
  new_clients: number;
  collected_usd_cents: number;
  contracted_usd_cents: number;
  has_spend: boolean;
}

interface BudgetRow {
  entity_level: "campaign" | "adset";
  entity_id: string;
  campaign_id: string | null;
  daily_usd_cents: number | null;
  lifetime_usd_cents: number | null;
  holds: boolean;
  effective_status: string | null;
}

function clientsForAccount(account: AdsV2Account): CreatorKey[] {
  if (account === "all") return [...ADSV2_SERVED_CLIENTS];
  return ADSV2_SERVED_CLIENTS.includes(account as CreatorKey) ? [account as CreatorKey] : [];
}

function currencyMap(clients: CreatorKey[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of clients) map[c] = creatorCurrency(c);
  return map;
}

const ACTIVE = "ACTIVE";

export async function buildWindow(query: AdsV2Query, dataVersion: number): Promise<AdsV2Payload> {
  const started = Date.now();
  const db = getServiceSupabase();
  const clients = clientsForAccount(query.account);

  if (clients.length === 0) {
    return emptyPayload(query, dataVersion, ["No accounts match this view."], started);
  }

  // 1. Pre-aggregated leaves (the DB did the work).
  const { data: leavesData, error: leavesErr } = await db.rpc("adsv2_window_leaves", {
    p_clients: clients,
    p_from: query.dateFrom,
    p_to: query.dateTo,
    p_currency: currencyMap(clients),
  });
  if (leavesErr) throw new Error(`adsv2_window_leaves failed: ${leavesErr.message}`);
  const leaves = (leavesData || []) as LeafRow[];

  // 2. Budget as of the last day of the window.
  const { data: budgetData, error: budgetErr } = await db.rpc("adsv2_budget_asof", {
    p_clients: clients,
    p_to: query.dateTo,
  });
  if (budgetErr) throw new Error(`adsv2_budget_asof failed: ${budgetErr.message}`);
  const budgetByEntity = new Map<string, BudgetRow>();
  for (const b of (budgetData || []) as BudgetRow[]) budgetByEntity.set(b.entity_id, b);

  // 3. Bounded hover detail: named booked people + who took their call.
  const callDetailsByLeaf = await loadHoverDetails(db, clients, query);

  // 4. Status filter at the leaf level.
  const statusFiltered = leaves.filter((l) => {
    if (query.status === "all") return true;
    const active = (l.ad_status || "").toUpperCase() === ACTIVE;
    return query.status === "active" ? active : !active;
  });

  // 5. Assemble the campaign -> ad set -> ad tree.
  const campaigns = buildTree(statusFiltered, budgetByEntity, callDetailsByLeaf);

  // 6. TOTAL over the union of all displayed ads (base sums, not row ratios).
  let total: BaseMetrics = EMPTY_BASE;
  for (const l of statusFiltered) total = addBase(total, leafBase(l));

  const notices = buildNotices(clients, leaves);
  const freshness = await loadFreshness(db, clients);

  return {
    account: query.account,
    status: query.status,
    level: query.level,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    dataVersion,
    campaigns,
    total,
    freshness,
    notices,
    generatedAt: new Date().toISOString(),
    computeMs: Date.now() - started,
  };
}

interface DayRow {
  et_day: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  messages: number;
  booked: number;
  taken: number;
  new_clients: number;
  collected_usd_cents: number;
}

interface RevenueDayRow {
  et_day: string;
  organic_scoped_cents: number;
  ads_all_cents: number;
  organic_all_cents: number;
  misc_chat_all_cents: number;
  other_origin_all_cents: number;
  tracker_all_cents: number;
}

// The Metrics-card day series. Same account/window/status filters and the same
// DB (set-based) work as the table; run in the precompute job, never a request.
// Its total equals the table payload's total by construction.
export async function buildDaySeries(
  query: AdsV2Query,
  dataVersion: number,
): Promise<AdsV2MetricsPayload> {
  const db = getServiceSupabase();
  const clients = clientsForAccount(query.account);
  let days: MetricsDay[] = [];
  let revenue: RevenueCategories | undefined;
  if (clients.length > 0) {
    const { data, error } = await db.rpc("adsv2_window_days", {
      p_clients: clients,
      p_from: query.dateFrom,
      p_to: query.dateTo,
      p_currency: currencyMap(clients),
    });
    if (error) throw new Error(`adsv2_window_days failed: ${error.message}`);
    // Revenue by category (organic / misc chat / coverage). Organic is scoped
    // to this account's clients; the misc and coverage numbers are whole-tracker
    // because the sales sheet has no creator column. Both RPCs emit one row per
    // window day, so this zips 1:1 with the base series.
    const { data: revData, error: revErr } = await db.rpc("adsv2_revenue_days", {
      p_clients: clients,
      p_from: query.dateFrom,
      p_to: query.dateTo,
    });
    if (revErr) throw new Error(`adsv2_revenue_days failed: ${revErr.message}`);
    const revByDay = new Map(((revData || []) as RevenueDayRow[]).map((r) => [r.et_day, r]));
    days = ((data || []) as DayRow[]).map((d) => {
      const r = revByDay.get(d.et_day);
      return {
        day: d.et_day,
        spendCents: d.spend_cents,
        impressions: d.impressions,
        clicks: d.clicks,
        messages: d.messages,
        booked: d.booked,
        taken: d.taken,
        newClients: d.new_clients,
        collectedCents: d.collected_usd_cents,
        organicCents: r?.organic_scoped_cents ?? 0,
        miscChatCents: r?.misc_chat_all_cents ?? 0,
        adsAllCents: r?.ads_all_cents ?? 0,
        organicAllCents: r?.organic_all_cents ?? 0,
        otherOriginAllCents: r?.other_origin_all_cents ?? 0,
        trackerAllCents: r?.tracker_all_cents ?? 0,
      };
    });
    revenue = {
      organicCents: sumBy(days, (d) => d.organicCents ?? 0),
      miscChatCents: sumBy(days, (d) => d.miscChatCents ?? 0),
      adsAllCents: sumBy(days, (d) => d.adsAllCents ?? 0),
      organicAllCents: sumBy(days, (d) => d.organicAllCents ?? 0),
      otherOriginAllCents: sumBy(days, (d) => d.otherOriginAllCents ?? 0),
      trackerAllCents: sumBy(days, (d) => d.trackerAllCents ?? 0),
    };
  }
  // Total over the union of days (base sums), so the cards' big numbers derive
  // exactly like the table's TOTAL row.
  let total: BaseMetrics = EMPTY_BASE;
  for (const d of days) {
    total = addBase(total, {
      ...EMPTY_BASE,
      spendCents: d.spendCents,
      impressions: d.impressions,
      clicks: d.clicks,
      messages: d.messages,
      booked: d.booked,
      taken: d.taken,
      newClients: d.newClients,
      collectedCents: d.collectedCents,
    });
  }
  return {
    account: query.account,
    status: query.status,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    dataVersion,
    days,
    total,
    revenue,
    generatedAt: new Date().toISOString(),
  };
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((acc, item) => acc + pick(item), 0);
}

function leafBase(l: LeafRow): BaseMetrics {
  return {
    spendCents: l.spend_cents,
    impressions: l.impressions,
    clicks: l.clicks,
    messages: l.messages,
    booked: l.booked,
    taken: l.taken_rows,
    takenPeople: l.taken_people,
    showedPeople: l.showed_people,
    upcoming: l.upcoming,
    newClients: l.new_clients,
    collectedCents: l.collected_usd_cents,
    contractedCents: l.contracted_usd_cents,
  };
}

function budgetInfo(row: BudgetRow | undefined, level: "campaign" | "adset"): BudgetInfo | null {
  if (!row || !row.holds) return { level: null, dailyUsdCents: null, lifetimeUsdCents: null, holds: false, currency: "USD" };
  return {
    level,
    dailyUsdCents: row.daily_usd_cents,
    lifetimeUsdCents: row.lifetime_usd_cents,
    holds: true,
    currency: "USD",
  };
}

function buildTree(
  leaves: LeafRow[],
  budgetByEntity: Map<string, BudgetRow>,
  callDetailsByLeaf: Map<string, { booked: CallDetail[]; taken: CallDetail[] }>,
): AdsV2Node[] {
  const campaigns = new Map<string, AdsV2Node>();

  for (const l of leaves) {
    const client = CREATORS_BY_KEY[l.client_key as CreatorKey];
    const clientName = client?.name || l.client_key;
    const campId = l.campaign_id || `${l.client_key}:nocampaign`;
    const adsetId = l.adset_id || `${l.client_key}:noadset`;
    const adActive = (l.ad_status || "").toUpperCase() === ACTIVE;
    const leafKey = `${l.client_key}:${l.keyword}`;

    // Campaign node.
    let camp = campaigns.get(campId);
    if (!camp) {
      const cb = budgetByEntity.get(campId);
      camp = makeNode({
        id: campId,
        level: "campaign",
        name: l.campaign_name || "Untitled campaign",
        keyword: null,
        clientKey: l.client_key,
        clientName,
        // A campaign only shows a budget when it holds one (CBO).
        budget: cb && cb.holds ? budgetInfo(cb, "campaign") : { level: null, dailyUsdCents: null, lifetimeUsdCents: null, holds: false, currency: "USD" },
      });
      campaigns.set(campId, camp);
    }

    // Ad set node.
    let adset = camp.children.find((c) => c.id === adsetId);
    if (!adset) {
      const ab = budgetByEntity.get(adsetId);
      adset = makeNode({
        id: adsetId,
        level: "adset",
        name: l.adset_name || "Untitled ad set",
        keyword: null,
        clientKey: l.client_key,
        clientName,
        budget: budgetInfo(ab, "adset"),
      });
      camp.children.push(adset);
    }

    // Ad (leaf) node.
    const base = leafBase(l);
    const adNode: AdsV2Node = {
      ...makeNode({
        id: l.ad_id || leafKey,
        level: "ad",
        name: l.ad_name || displayKeyword(l.keyword),
        keyword: l.keyword,
        clientKey: l.client_key,
        clientName,
        budget: null, // ads never hold a budget
      }),
      ...base,
      status: l.has_spend ? (adActive ? "active" : "finished") : "empty",
      hasSpend: l.has_spend,
      previewImageUrl: l.preview_url || null,
      videoUrl: l.video_url || null,
      hasVideo: Boolean(l.is_video),
      callDetails: callDetailsByLeaf.get(leafKey) || null,
    };
    adset.children.push(adNode);
  }

  // Roll base metrics up and set node status + short names + hover unions.
  for (const camp of campaigns.values()) {
    camp.children.sort((a, b) => b.spendCents - a.spendCents);
    let campBase = EMPTY_BASE;
    let campActive = false;
    let campHasSpend = false;
    const campBooked: CallDetail[] = [];
    const campTaken: CallDetail[] = [];
    for (const adset of camp.children) {
      adset.children.sort((a, b) => b.spendCents - a.spendCents);
      let adsetBase = EMPTY_BASE;
      let adsetActive = false;
      let adsetHasSpend = false;
      const adsetBooked: CallDetail[] = [];
      const adsetTaken: CallDetail[] = [];
      for (const ad of adset.children) {
        adsetBase = addBase(adsetBase, baseOf(ad));
        if (ad.status === "active") adsetActive = true;
        if (ad.hasSpend) adsetHasSpend = true;
        if (ad.callDetails) {
          adsetBooked.push(...ad.callDetails.booked);
          adsetTaken.push(...ad.callDetails.taken);
        }
      }
      assignBase(adset, adsetBase);
      adset.status = adsetHasSpend ? (adsetActive ? "active" : "finished") : "empty";
      adset.hasSpend = adsetHasSpend;
      adset.callDetails = { booked: adsetBooked, taken: adsetTaken };
      campBase = addBase(campBase, adsetBase);
      if (adsetActive) campActive = true;
      if (adsetHasSpend) campHasSpend = true;
      campBooked.push(...adsetBooked);
      campTaken.push(...adsetTaken);
    }
    assignBase(camp, campBase);
    camp.status = campHasSpend ? (campActive ? "active" : "finished") : "empty";
    camp.hasSpend = campHasSpend;
    camp.callDetails = { booked: campBooked, taken: campTaken };
  }

  const out = [...campaigns.values()];
  // Deterministic ordering: by client then spend.
  out.sort((a, b) => a.clientKey.localeCompare(b.clientKey) || b.spendCents - a.spendCents);
  return out;
}

function baseOf(n: AdsV2Node): BaseMetrics {
  return {
    spendCents: n.spendCents,
    impressions: n.impressions,
    clicks: n.clicks,
    messages: n.messages,
    booked: n.booked,
    taken: n.taken,
    takenPeople: n.takenPeople,
    showedPeople: n.showedPeople,
    upcoming: n.upcoming,
    newClients: n.newClients,
    collectedCents: n.collectedCents,
    contractedCents: n.contractedCents,
  };
}

function assignBase(n: AdsV2Node, b: BaseMetrics): void {
  n.spendCents = b.spendCents;
  n.impressions = b.impressions;
  n.clicks = b.clicks;
  n.messages = b.messages;
  n.booked = b.booked;
  n.taken = b.taken;
  n.takenPeople = b.takenPeople;
  n.showedPeople = b.showedPeople;
  n.upcoming = b.upcoming;
  n.newClients = b.newClients;
  n.collectedCents = b.collectedCents;
  n.contractedCents = b.contractedCents;
}

function makeNode(input: {
  id: string;
  level: AdsV2Node["level"];
  name: string;
  keyword: string | null;
  clientKey: string;
  clientName: string;
  budget: BudgetInfo | null;
}): AdsV2Node {
  return {
    ...EMPTY_BASE,
    id: input.id,
    level: input.level,
    name: input.name,
    shortName: shortenName(input.name),
    keyword: input.keyword,
    clientKey: input.clientKey,
    clientName: input.clientName,
    status: "empty",
    hasSpend: false,
    budget: input.budget,
    previewImageUrl: null,
    videoUrl: null,
    hasVideo: false,
    callDetails: null,
    children: [],
  };
}

function shortenName(name: string): string {
  // Trim the "Client - " prefix many campaign names carry, for a cleaner cell.
  return name.replace(/^[A-Za-z]+\s*[-|]\s*/, "").trim() || name;
}

async function loadHoverDetails(
  db: Db,
  clients: CreatorKey[],
  query: AdsV2Query,
): Promise<Map<string, { booked: CallDetail[]; taken: CallDetail[] }>> {
  // Booking facts fetched WIDER than the window (bounded: tens per client per
  // month) and without the organic/review filters, for two jobs:
  //   1. the booked/show-rate cohort: window-scoped, paid, reviewed, contact-id
  //      rows - filtered below to EXACTLY the rows the cell counts;
  //   2. hard-key enrichment of the taken popup: a taken sale carries no DM or
  //      booked date of its own, so we look the person's booking up by the
  //      stamped linked_subscriber_id, even when that booking sits before the
  //      window or is awaiting review (display only, never counted).
  const bookings = await fetchAllRows<{
    client_key: string;
    keyword_normalized: string | null;
    contact_id: string | null;
    person_name: string | null;
    start_time: string | null;
    created_time: string | null;
    booked_et_day: string;
    dm_et_day: string | null;
    is_upcoming: boolean;
    taken: boolean;
    status: string | null;
    is_organic: boolean;
    awaiting_review: boolean;
    linked_subscriber_id: string | null;
    evidence: { subscriber?: string | null } | null;
  }>((from, to) =>
    db
      .from("adsv2_booking_facts")
      .select(
        "client_key, keyword_normalized, contact_id, person_name, start_time, created_time, booked_et_day, dm_et_day, is_upcoming, taken, status, is_organic, awaiting_review, linked_subscriber_id, evidence",
      )
      .in("client_key", clients)
      .gte("booked_et_day", shiftDay(query.dateFrom, -60))
      .lte("booked_et_day", shiftDay(query.dateTo, 60))
      .order("booked_et_day", { ascending: false })
      .range(from, to),
  );

  // Taken sales in the window, to list the "taken" hover directly.
  const takenSales = await fetchAllRows<{
    client_key: string;
    keyword_normalized: string | null;
    prospect_name: string | null;
    subscriber_id: string | null;
    sale_et_day: string;
  }>((from, to) =>
    db
      .from("adsv2_sale_facts")
      .select("client_key, keyword_normalized, prospect_name, subscriber_id, sale_et_day")
      .in("client_key", clients)
      .gte("sale_et_day", query.dateFrom)
      .lte("sale_et_day", query.dateTo)
      .eq("call_taken", true)
      .eq("is_organic", false)
      .eq("awaiting_review", false)
      .order("sale_et_day", { ascending: false })
      .range(from, to),
  );

  // Hard-key lookup: subscriber -> that person's bookings (any keyword, any
  // date in the fetched span, review status irrelevant). Used ONLY to fill the
  // taken popup's DMed/Booked columns; never to count anything.
  const bookingsBySubscriber = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const sub = b.linked_subscriber_id || b.evidence?.subscriber || null;
    if (!sub) continue;
    const list = bookingsBySubscriber.get(sub) || [];
    list.push(b);
    bookingsBySubscriber.set(sub, list);
  }

  const takenDetailByLeaf = new Map<string, CallDetail[]>();
  for (const s of takenSales) {
    if (!s.keyword_normalized) continue;
    const key = `${s.client_key}:${s.keyword_normalized}`;
    // The person's booking, by hard key only: prefer the latest booking on or
    // before the sale day (the call the sale came from), else their earliest
    // one after it. No match -> the columns stay dashes, which is the truth:
    // no sales-calendar booking is linked to this taken call.
    let linked: (typeof bookings)[number] | null = null;
    for (const b of bookingsBySubscriber.get(s.subscriber_id || "") || []) {
      if (b.client_key !== s.client_key) continue;
      if (!linked) {
        linked = b;
        continue;
      }
      const bBefore = b.booked_et_day <= s.sale_et_day;
      const lBefore = linked.booked_et_day <= s.sale_et_day;
      if (bBefore !== lBefore) {
        if (bBefore) linked = b;
      } else if (bBefore ? b.booked_et_day > linked.booked_et_day : b.booked_et_day < linked.booked_et_day) {
        linked = b;
      }
    }
    const list = takenDetailByLeaf.get(key) || [];
    list.push({
      name: s.prospect_name || "Unknown",
      dmEtDay: linked?.dm_et_day ?? null,
      bookedEtDay: linked ? (linked.created_time ? etDay(linked.created_time) : linked.booked_et_day) : null,
      callEtDay: s.sale_et_day,
      status: "showed",
      records: 1,
    });
    takenDetailByLeaf.set(key, list);
  }

  // Booked rows carry their OWN hard-key taken flag + GHL status, so the
  // show-rate popup is the same cohort as the cell. No name matching. The
  // filters here mirror the leaves function's bk_person CTE exactly (window,
  // paid, reviewed, contact_id present), so the popup lists the same people
  // the cell counted - no more, no fewer.
  const bookingsByLeaf = new Map<string, BookingRecord[]>();
  for (const b of bookings) {
    if (!b.keyword_normalized) continue;
    if (b.booked_et_day < query.dateFrom || b.booked_et_day > query.dateTo) continue;
    if (b.is_organic || b.awaiting_review || !b.contact_id) continue;
    const key = `${b.client_key}:${b.keyword_normalized}`;
    const rec: BookingRecord = {
      contactId: b.contact_id,
      personName: b.person_name,
      keyword: b.keyword_normalized,
      startTime: b.start_time,
      createdTime: b.created_time,
      dmEtDay: b.dm_et_day,
      createdEtDay: b.created_time ? etDay(b.created_time) : null,
      bookedEtDay: b.booked_et_day,
      isUpcoming: b.is_upcoming,
      taken: Boolean(b.taken),
      ghlStatus: b.status,
    };
    const list = bookingsByLeaf.get(key) || [];
    list.push(rec);
    bookingsByLeaf.set(key, list);
  }

  const callDetailsByLeaf = new Map<string, { booked: CallDetail[]; taken: CallDetail[] }>();
  const CAP = 60;
  const leafKeys = new Set<string>([...bookingsByLeaf.keys(), ...takenDetailByLeaf.keys()]);
  for (const key of leafKeys) {
    const grouped = groupBookingsByPerson(bookingsByLeaf.get(key) || []);
    const booked: CallDetail[] = grouped.slice(0, CAP).map((g) => ({
      name: g.name,
      dmEtDay: g.dmEtDay,
      bookedEtDay: g.bookedEtDay,
      callEtDay: g.callEtDay,
      status: g.status,
      records: g.records,
    }));
    const taken = (takenDetailByLeaf.get(key) || []).slice(0, CAP);
    callDetailsByLeaf.set(key, { booked, taken });
  }

  return callDetailsByLeaf;
}

function buildNotices(_clients: CreatorKey[], _leaves: LeafRow[]): string[] {
  // No explanatory banners. Every account's rows render from whatever data
  // exists; missing funnel data simply shows as zeros and dashes.
  return [];
}

async function loadFreshness(db: Db, clients: CreatorKey[]): Promise<AdsV2Payload["freshness"]> {
  const out: AdsV2Payload["freshness"] = {};
  const now = Date.now();

  // Spend freshness.
  {
    const { data } = await db
      .from("ads_meta_insights_daily")
      .select("date, synced_at")
      .in("client_key", clients)
      .eq("raw_payload->>reporting_timezone", "America/New_York")
      .order("date", { ascending: false })
      .limit(1);
    const row = (data || [])[0] as { date?: string; synced_at?: string } | undefined;
    out.spend = staleness(row?.synced_at || null, row?.date || null, now);
  }
  // Budget freshness.
  {
    const { data } = await db
      .from("adsv2_budget_snapshots")
      .select("et_day, synced_at")
      .in("client_key", clients)
      .order("et_day", { ascending: false })
      .limit(1);
    const row = (data || [])[0] as { et_day?: string; synced_at?: string } | undefined;
    out.budget = staleness(row?.synced_at || null, row?.et_day || null, now);
  }
  return out;
}

function staleness(
  syncedAt: string | null,
  etDayStr: string | null,
  now: number,
): AdsV2Payload["freshness"][string] {
  const ageHours = syncedAt ? Math.round((now - new Date(syncedAt).getTime()) / 3_600_000) : null;
  return {
    lastEtDay: etDayStr,
    lastSyncedAt: syncedAt,
    ageHours,
    stale: ageHours != null ? ageHours > 26 : true,
  };
}

function emptyPayload(
  query: AdsV2Query,
  dataVersion: number,
  notices: string[],
  started: number,
): AdsV2Payload {
  return {
    account: query.account,
    status: query.status,
    level: query.level,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    dataVersion,
    campaigns: [],
    total: EMPTY_BASE,
    freshness: {},
    notices,
    generatedAt: new Date().toISOString(),
    computeMs: Date.now() - started,
  };
}
