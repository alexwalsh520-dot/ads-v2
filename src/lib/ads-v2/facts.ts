// ─────────────────────────────────────────────────────────────────────────
// FACTS PASS — the ONE deterministic attribution pass. It reads the source
// tables over a rolling recent window, runs the pure attribution core on each
// individual record, and writes one fact row per DM, booking, and sale into
// the facts store. Requests never do this; only background sync does.
//
// Idempotent by construction: it replaces exactly the rolling window it just
// recomputed (delete-then-insert per served client), so a re-run, a crash, or
// an overlapping run can never duplicate or corrupt. Facts older than the
// window are never touched, so history stays immutable.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { creatorCurrency, loadUsdRateMap, convertCentsToUsd } from "@/lib/fx/rates";
import { etDay, todayEt, shiftDay } from "./time";
import { normalizeKeyword } from "./keyword";
import {
  classifyKeyword,
  resolveSaleKeyword,
  stampDm,
  stampBooking,
  stampSale,
  type LinkMethod,
} from "./attribution";
import {
  ADSV2_SERVED_CLIENTS,
  ALL_SALES_CALENDAR_IDS,
  clientForSalesCalendar,
  FACTS_LOOKBACK_DAYS,
  FACTS_UPCOMING_DAYS,
  SPEND_HISTORY_DAYS,
} from "./config";
import { fetchAllRows, startRun, finishRun, type Db } from "./db";

interface FactsResult {
  dm: number;
  bookings: number;
  sales: number;
  windowFrom: string;
  windowTo: string;
}

export async function runFactsPass(now: Date = new Date()): Promise<FactsResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "facts");
  const started = Date.now();
  try {
    const result = await computeAndWriteFacts(db, now);
    await finishRun(db, runId, {
      status: "ok",
      rows: result.dm + result.bookings + result.sales,
      durationMs: Date.now() - started,
      detail: result,
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

async function computeAndWriteFacts(db: Db, now: Date): Promise<FactsResult> {
  const today = todayEt(now);
  const factFrom = shiftDay(today, -FACTS_LOOKBACK_DAYS);
  const saleTo = today;
  const bookTo = shiftDay(today, FACTS_UPCOMING_DAYS);
  const served = new Set<string>(ADSV2_SERVED_CLIENTS);
  const spendFrom = shiftDay(today, -SPEND_HISTORY_DAYS);

  // FX rates for any served client whose ad account bills in something other than USD.
  const rateMap = await loadUsdRateMap(
    db,
    ADSV2_SERVED_CLIENTS.map((k) => creatorCurrency(k)),
    spendFrom,
    bookTo,
  );

  // ── Reference data ───────────────────────────────────────────────────────

  // Paid spend days per keyword (which keyword had real spend, and when).
  const spendRows = await fetchAllRows<{
    client_key: string;
    keyword_normalized: string | null;
    date: string;
    spend_cents: number | null;
  }>((from, to) =>
    db
      .from("ads_meta_insights_daily")
      .select("client_key, keyword_normalized, date, spend_cents")
      .in("client_key", [...served])
      .gt("spend_cents", 0)
      .eq("raw_payload->>reporting_timezone", "America/New_York")
      .gte("date", spendFrom)
      .order("date", { ascending: true })
      .range(from, to),
  );
  // client -> keyword -> sorted unique spend days
  const spendDays = new Map<string, Map<string, string[]>>();
  const keywordToClient = new Map<string, string>();
  for (const r of spendRows) {
    const kw = normalizeKeyword(r.keyword_normalized);
    if (!kw) continue;
    keywordToClient.set(kw, r.client_key);
    let byKw = spendDays.get(r.client_key);
    if (!byKw) spendDays.set(r.client_key, (byKw = new Map()));
    const list = byKw.get(kw);
    if (list) {
      if (list[list.length - 1] !== r.date) list.push(r.date);
    } else byKw.set(kw, [r.date]);
  }
  const paidKeywordsAll = new Set<string>(keywordToClient.keys());

  // Organic keyword marks per client.
  const organicRows = await fetchAllRows<{ client_key: string; keyword_normalized: string }>((from, to) =>
    db
      .from("organic_keywords")
      .select("client_key, keyword_normalized")
      .in("client_key", [...served])
      .order("keyword_normalized", { ascending: true })
      .range(from, to),
  );
  const organicSet = new Map<string, Set<string>>();
  for (const r of organicRows) {
    const kw = normalizeKeyword(r.keyword_normalized);
    if (!kw) continue;
    if (!organicSet.has(r.client_key)) organicSet.set(r.client_key, new Set());
    organicSet.get(r.client_key)!.add(kw);
  }

  const isOrganicMarked = (client: string, kw: string) =>
    organicSet.get(client)?.has(kw) ?? false;
  const spendDaysFor = (client: string, kw: string) => spendDays.get(client)?.get(kw) ?? [];

  // GHL contact_id -> ManyChat subscriber_id bridge. Deliberately NOT filtered
  // by client. Whatever writes manychat_contact_links tends to store its own
  // idea of the client name — a long form, a page name, a label with a space in
  // it — which will not equal your short creator key. Filtering on it once
  // matched nothing and left dm_et_day null on every single booking, with no
  // error anywhere. A ghl_contact_id is globally unique, so bridge on that.
  const bridgeRows = await fetchAllRows<{ ghl_contact_id: string | null; subscriber_id: string | null }>(
    (from, to) =>
      db
        .from("manychat_contact_links")
        .select("ghl_contact_id, subscriber_id")
        .order("ghl_contact_id", { ascending: true })
        .range(from, to),
  );
  const contactToSubscriber = new Map<string, string>();
  for (const r of bridgeRows) {
    if (r.ghl_contact_id && r.subscriber_id) contactToSubscriber.set(r.ghl_contact_id, r.subscriber_id);
  }

  // ── DM facts ─────────────────────────────────────────────────────────────
  const dmRows = await fetchAllRows<{
    id: string;
    client_key: string;
    subscriber_id: string | null;
    subscriber_name: string | null;
    keyword_normalized: string | null;
    event_at: string;
    setter_name: string | null;
  }>((from, to) =>
    db
      .from("ads_keyword_events")
      .select("id, client_key, subscriber_id, subscriber_name, keyword_normalized, event_at, setter_name")
      .in("client_key", [...served])
      .eq("event_type", "dm_keyword")
      .gte("event_at", `${shiftDay(factFrom, -1)}T00:00:00Z`)
      .order("event_at", { ascending: true })
      .range(from, to),
  );

  // subscriber -> sorted [(day, at, keyword, setter)]. The exact `at` matters:
  // the bare-link rule compares against the MOMENT a booking was made, not the
  // day, and those give different answers (see stampBooking below).
  const dmBySubscriber = new Map<
    string,
    { day: string; at: string; keyword: string; setter: string | null }[]
  >();
  // subscriber -> the setter who handled them, from the authoritative source.
  const setterBySubscriber = new Map<string, string>();
  const dmFacts: Record<string, unknown>[] = [];
  for (const r of dmRows) {
    const day = etDay(r.event_at);
    if (!day || day < factFrom || day > today) continue;
    const kw = normalizeKeyword(r.keyword_normalized);
    const cls = classifyKeyword({
      keyword: kw,
      organicMarked: kw ? isOrganicMarked(r.client_key, kw) : false,
      paidSpendDays: kw ? spendDaysFor(r.client_key, kw) : [],
      eventDay: day,
    });
    const setter = (r.setter_name || "").trim() || null;
    // A DM's proof is the ManyChat keyword event itself: their subscriber id
    // and the word they sent. No keyword means it was never an ad reply.
    const stamp = stampDm(cls, kw, r.subscriber_id, r.event_at);
    dmFacts.push({
      event_key: r.id,
      client_key: r.client_key,
      subscriber_id: r.subscriber_id,
      subscriber_name: r.subscriber_name,
      keyword_normalized: kw,
      is_organic: cls === "organic",
      awaiting_review: cls === "none",
      et_day: day,
      setter_name: setter,
      evidence: { source: "ads_keyword_events", event_type: "dm_keyword", classified: cls },
      evidence_key: stamp.evidenceKey,
      evidence_detail: stamp.evidenceDetail,
      blank_reason: stamp.blankReason,
    });
    if (r.subscriber_id) {
      if (setter && !setterBySubscriber.has(r.subscriber_id)) {
        setterBySubscriber.set(r.subscriber_id, setter);
      }
      if (kw) {
        const list = dmBySubscriber.get(r.subscriber_id) || [];
        list.push({ day, at: r.event_at, keyword: kw, setter });
        dmBySubscriber.set(r.subscriber_id, list);
      }
    }
  }
  for (const list of dmBySubscriber.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  // ── Booking facts ────────────────────────────────────────────────────────
  // Recorded human resolutions outrank every machine guess (the signed
  // resolution-order rule). Small table: one row per corrected appointment.
  const resolutionRows = await fetchAllRows<{
    appointment_key: string;
    keyword_normalized: string | null;
    subscriber_id: string | null;
    resolved_by: string;
    reason: string;
  }>((from, to) =>
    db
      .from("adsv2_booking_resolutions")
      .select("appointment_key, keyword_normalized, subscriber_id, resolved_by, reason")
      .order("appointment_key", { ascending: true })
      .range(from, to),
  );
  const resolutionByAppointment = new Map(resolutionRows.map((r) => [r.appointment_key, r]));

  const nowIso = now.toISOString();
  const apptRows = ALL_SALES_CALENDAR_IDS.length
    ? await fetchAllRows<{
        appointment_id: string;
        contact_id: string | null;
        contact_name: string | null;
        keyword_normalized: string | null;
        calendar_id: string | null;
        calendar_name: string | null;
        start_time: string | null;
        created_at: string | null;
        status: string | null;
        raw_payload: { contact?: { attributionSource?: { url?: string } } } | null;
      }>((from, to) =>
        db
          .from("ghl_appointments")
          .select(
            "appointment_id, contact_id, contact_name, keyword_normalized, calendar_id, calendar_name, start_time, created_at, status, raw_payload",
          )
          .in("calendar_id", [...ALL_SALES_CALENDAR_IDS])
          .gte("start_time", `${shiftDay(factFrom, -1)}T00:00:00Z`)
          .lte("start_time", `${shiftDay(bookTo, 1)}T00:00:00Z`)
          .order("start_time", { ascending: true })
          .range(from, to),
      )
    : [];

  // subscriber -> booked keyword (via the bridge from contact_id).
  const bookingKeywordBySubscriber = new Map<string, string>();
  const bookingFacts: Record<string, unknown>[] = [];
  for (const r of apptRows) {
    const client = r.calendar_id ? clientForSalesCalendar(r.calendar_id) : null;
    if (!client) continue;
    const day = r.start_time ? etDay(r.start_time) : "";
    if (!day || day < factFrom || day > bookTo) continue;
    const resolution = resolutionByAppointment.get(r.appointment_id) || null;
    const kw = normalizeKeyword(r.keyword_normalized);
    const subscriber =
      resolution?.subscriber_id ||
      (r.contact_id ? contactToSubscriber.get(r.contact_id) || null : null);
    const dmDay = subscriber ? dmBySubscriber.get(subscriber)?.[0]?.day ?? null : null;
    const cls = classifyKeyword({
      keyword: kw,
      organicMarked: kw ? isOrganicMarked(client, kw) : false,
      paidSpendDays: kw ? spendDaysFor(client, kw) : [],
      eventDay: day,
    });
    const isUpcoming = !!r.start_time && r.start_time > nowIso;
    const cancelled = (r.status || "").toLowerCase().includes("cancel");

    // Stamp it: the hard key that proved the match, or the written reason there
    // is none. This is also where a bare booking link can legitimately recover
    // its keyword, but only when the answer is the only possible one.
    const personKeywords = subscriber ? dmBySubscriber.get(subscriber) ?? [] : [];
    const stamp = stampBooking({
      keyword: kw,
      cls,
      subscriberId: subscriber,
      createdTime: r.created_at,
      personKeywords,
      attributionUrl: r.raw_payload?.contact?.attributionSource?.url ?? null,
    });

    // A recovered keyword must clear the same paid/organic test as any other,
    // so recovery can never smuggle in a word with no spend behind it.
    let finalKeyword = stamp.keyword;
    let finalCls = cls;
    let finalStamp = stamp;
    if (stamp.evidenceKey === "subscriber_single_prebooking_keyword" && finalKeyword) {
      finalCls = classifyKeyword({
        keyword: finalKeyword,
        organicMarked: isOrganicMarked(client, finalKeyword),
        paidSpendDays: spendDaysFor(client, finalKeyword),
        eventDay: day,
      });
      if (finalCls !== "paid") {
        finalKeyword = null;
        finalStamp = {
          keyword: null,
          evidenceKey: null,
          evidenceDetail: {
            ...(stamp.evidenceDetail || {}),
            why: "the only pre-booking keyword has no paid spend behind it",
          },
          blankReason: finalCls === "organic" ? "organic_dm" : "unknown",
        };
      }
    }

    // A recorded human resolution outranks everything above: the corrected
    // keyword is re-classified like any other (so it still can't smuggle in a
    // no-spend word) and the row carries who decided and why.
    if (resolution?.keyword_normalized) {
      const resolvedKw = normalizeKeyword(resolution.keyword_normalized);
      if (resolvedKw) {
        finalKeyword = resolvedKw;
        finalCls = classifyKeyword({
          keyword: resolvedKw,
          organicMarked: isOrganicMarked(client, resolvedKw),
          paidSpendDays: spendDaysFor(client, resolvedKw),
          eventDay: day,
        });
        finalStamp = {
          keyword: resolvedKw,
          evidenceKey: "human_resolution",
          evidenceDetail: {
            resolved_by: resolution.resolved_by,
            reason: resolution.reason,
            machine_keyword: kw,
            subscriber_id: resolution.subscriber_id,
          },
          blankReason: null,
        };
      }
    }

    bookingFacts.push({
      appointment_key: r.appointment_id,
      client_key: client,
      contact_id: r.contact_id,
      person_name: r.contact_name,
      keyword_normalized: finalKeyword,
      is_organic: finalCls === "organic",
      // A booking with no keyword (or an unattributable one) is awaiting review
      // and never shown in the paid view; cancelled ones too.
      awaiting_review: !finalKeyword || finalCls === "none" || cancelled,
      calendar_id: r.calendar_id,
      calendar_name: r.calendar_name,
      booked_et_day: day,
      dm_et_day: dmDay,
      is_upcoming: isUpcoming,
      status: r.status,
      start_time: r.start_time,
      created_time: r.created_at,
      setter_name: subscriber ? setterBySubscriber.get(subscriber) ?? null : null,
      evidence: { source: "ghl_appointments", calendar_id: r.calendar_id, classified: finalCls, subscriber },
      evidence_key: finalStamp.evidenceKey,
      evidence_detail: finalStamp.evidenceDetail,
      blank_reason: finalStamp.blankReason,
    });
    if (subscriber && finalKeyword && finalCls === "paid" && !bookingKeywordBySubscriber.has(subscriber)) {
      bookingKeywordBySubscriber.set(subscriber, finalKeyword);
    }
  }

  // ── Sale facts ───────────────────────────────────────────────────────────
  const saleRows = await fetchAllRows<{
    id: string;
    sheet_row_key: string | null;
    date: string;
    prospect_name: string | null;
    call_taken_status: string | null;
    outcome: string | null;
    closer: string | null;
    contracted_revenue_cents: number | null;
    collected_revenue_cents: number | null;
    manychat_subscriber_id: string | null;
    setter: string | null;
    call_type: string | null;
  }>((from, to) =>
    db
      .from("sales_tracker_rows")
      .select(
        "id, sheet_row_key, date, prospect_name, call_taken_status, outcome, closer, contracted_revenue_cents, collected_revenue_cents, manychat_subscriber_id, setter, call_type:raw_payload->>callType",
      )
      .gte("date", factFrom)
      .lte("date", saleTo)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  // Origin-check keyword per subscriber (ad-origin evidence).
  const originRows = await fetchAllRows<{
    subscriber_id: string | null;
    origin_keyword: string | null;
    from_ad: boolean | null;
    is_control: boolean | null;
  }>((from, to) =>
    db
      .from("manychat_origin_checks")
      .select("subscriber_id, origin_keyword, from_ad, is_control")
      .eq("from_ad", true)
      .order("subscriber_id", { ascending: true })
      .range(from, to),
  );
  const originBySubscriber = new Map<string, string>();
  for (const r of originRows) {
    if (r.subscriber_id && !r.is_control && r.origin_keyword) {
      const kw = normalizeKeyword(r.origin_keyword);
      if (kw && !originBySubscriber.has(r.subscriber_id)) originBySubscriber.set(r.subscriber_id, kw);
    }
  }

  const saleFacts: Record<string, unknown>[] = [];
  for (const r of saleRows) {
    const saleDay = r.date;
    const pasted = (r.manychat_subscriber_id || "").trim() || null;
    // DM keyword on or before the sale day, for this subscriber.
    const dmKeywordBySubscriber = new Map<string, string>();
    if (pasted) {
      const list = dmBySubscriber.get(pasted);
      if (list) {
        const eligible = list.filter((e) => e.day <= saleDay);
        const chosen = (eligible.length ? eligible : list).at(-1);
        if (chosen) dmKeywordBySubscriber.set(pasted, chosen.keyword);
      }
    }
    const resolved = resolveSaleKeyword({
      humanResolution: null, // human workspace is a later piece; store supports it
      pastedSubscriberId: pasted,
      bridgeSubscriberId: null,
      bookingKeywordBySubscriber,
      dmKeywordBySubscriber,
      originCheckKeyword: pasted ? originBySubscriber.get(pasted) ?? null : null,
      paidKeywords: paidKeywordsAll,
    });

    let keyword = resolved.keyword ? normalizeKeyword(resolved.keyword) : null;
    let method: LinkMethod = resolved.method;
    const client = keyword ? keywordToClient.get(keyword) ?? null : null;
    let isOrganic = false;
    let awaiting = method === "none";

    if (keyword && client) {
      const cls = classifyKeyword({
        keyword,
        organicMarked: isOrganicMarked(client, keyword),
        paidSpendDays: spendDaysFor(client, keyword),
        eventDay: saleDay,
      });
      if (cls === "organic") {
        isOrganic = true;
        method = "organic";
      } else if (cls === "none") {
        // Resolved to a keyword with no paid spend and not organic: unprovable.
        keyword = null;
        method = "none";
        awaiting = true;
      }
    } else if (keyword && !client) {
      // Keyword has no paid spend anywhere -> cannot be a paid attribution.
      keyword = null;
      method = "none";
      awaiting = true;
    }

    // The sales tracker is ONE team-wide sheet written in USD (US closers, US
    // ticket prices), no matter which creator the sale belongs to. A creator's
    // `currency` describes what META BILLS THEIR AD ACCOUNT (spend side only);
    // applying it here shaved a $1,200 sale to $842 by "converting" USD
    // as if it were AUD. Tracker money is USD. Full stop.
    const currency = "USD";
    const contracted = Number(r.contracted_revenue_cents || 0);
    const collected = Number(r.collected_revenue_cents || 0);
    saleFacts.push({
      sale_key: r.sheet_row_key || r.id,
      client_key: client,
      keyword_normalized: keyword,
      method,
      is_organic: isOrganic,
      awaiting_review: awaiting,
      call_taken: (r.call_taken_status || "").toLowerCase() === "yes",
      is_win: (r.outcome || "").toUpperCase() === "WIN",
      currency,
      collected_cents: collected,
      contracted_cents: contracted,
      collected_usd_cents: convertCentsToUsd(collected, currency, saleDay, rateMap),
      contracted_usd_cents: convertCentsToUsd(contracted, currency, saleDay, rateMap),
      prospect_name: r.prospect_name,
      subscriber_id: pasted,
      closer: r.closer,
      sale_et_day: saleDay,
      // The tracker's human-written origin label ("Miscellaneous Chat", ...),
      // carried verbatim so revenue category cards read facts, not raw tables.
      call_type: (r.call_type || "").trim() || null,
      // A sale inherits its setter and closer from the sales tracker, which is
      // where a human wrote them down; the DM-side setter is a fallback when
      // the sheet is blank but their ManyChat id is known.
      setter_name:
        (r.setter || "").trim() || (pasted ? setterBySubscriber.get(pasted) ?? null : null) || null,
      evidence: { source: "sales_tracker_rows", method, keyword, sale_day: saleDay },
      ...(() => {
        const s = stampSale(method, keyword, pasted);
        return { evidence_key: s.evidenceKey, evidence_detail: s.evidenceDetail, blank_reason: s.blankReason };
      })(),
    });
  }

  // ── Replace the rolling window atomically per table ──────────────────────
  // Delete the window we just recomputed, then insert fresh. Facts outside the
  // window are never touched. Chunked inserts keep payloads small.
  await replaceWindow(db, "adsv2_dm_facts", "et_day", factFrom, today, [...served], "client_key", dmFacts);
  await replaceWindow(
    db,
    "adsv2_booking_facts",
    "booked_et_day",
    factFrom,
    bookTo,
    [...served],
    "client_key",
    bookingFacts,
  );
  // Sales are keyed on the resolved client (may be null), so replace the whole
  // sale-day window regardless of client to avoid orphaning re-attributed rows.
  await replaceWindowAllClients(db, "adsv2_sale_facts", "sale_et_day", factFrom, saleTo, saleFacts);

  // Stamp DMed dates + the hard-key taken link on the bookings we just wrote,
  // set-based in the database (hard-key ladder + all-time earliest DM). This is
  // authoritative for dm_et_day and `taken`; it must run after both booking and
  // sale facts exist for the window.
  await db.rpc("adsv2_stamp_booking_links", { p_from: factFrom, p_to: bookTo });

  // Fill any booking setter the in-memory lookup could not see. That lookup is
  // built from keyword events inside the rolling window, so a person who first
  // messaged BEFORE the window and booked inside it would otherwise lose their
  // setter. Done in the database, the window stops mattering.
  await db.rpc("adsv2_stamp_facts_setters", { p_from: factFrom, p_to: bookTo });

  // Correct sale origins, windowless and set-based in the database: sales whose
  // keyword came through a page outside the active roster get the honest label
  // 'former_creator_ad' instead of 'unknown', and a sale whose subscriber sent
  // exactly ONE keyword through exactly ONE active-roster page before buying is
  // stamped with that evidence no matter how long ago the keyword was sent.
  await db.rpc("adsv2_label_sale_origins", {
    p_from: factFrom,
    p_to: saleTo,
    p_active_clients: [...served],
  });

  return {
    dm: dmFacts.length,
    bookings: bookingFacts.length,
    sales: saleFacts.length,
    windowFrom: factFrom,
    windowTo: bookTo,
  };
}

async function replaceWindow(
  db: Db,
  table: string,
  dayColumn: string,
  from: string,
  to: string,
  clients: string[],
  clientColumn: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await db.from(table).delete().in(clientColumn, clients).gte(dayColumn, from).lte(dayColumn, to);
  await insertChunked(db, table, rows);
}

async function replaceWindowAllClients(
  db: Db,
  table: string,
  dayColumn: string,
  from: string,
  to: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await db.from(table).delete().gte(dayColumn, from).lte(dayColumn, to);
  await insertChunked(db, table, rows);
}

async function insertChunked(db: Db, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await db.from(table).insert(slice);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}
