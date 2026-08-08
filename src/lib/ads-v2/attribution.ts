// ─────────────────────────────────────────────────────────────────────────
// ATTRIBUTION CORE — small, pure, and unit-tested. Every rule is one sentence
// you can read out loud. These functions decide, from evidence alone, which
// keyword a record belongs to and whether it is paid or organic. They touch no
// database and no clock; the facts pass feeds them rows and stores the result.
//
// Laws:
//   * Money and bookings tie to a keyword by HARD KEY only. Names never do.
//   * A paid ad running a word wins over an organic mark during the overlap
//     (and a 30 day cool-down after), so paid and organic never double count.
//   * A person decision always outranks an automatic one.
// ─────────────────────────────────────────────────────────────────────────

export type KeywordClass = "paid" | "organic" | "none";

export type LinkMethod =
  | "human" // a person resolved it in the workspace
  | "link_booking" // pasted subscriber id matched a booked call's keyword
  | "link_dm" // subscriber id matched the buyer's DM keyword
  | "origin_check" // the subscriber's ManyChat profile carried the keyword
  | "organic" // resolved to an organic keyword
  | "none"; // could not be proven

export const ORGANIC_COOLDOWN_DAYS = 30;

/**
 * Classify a record (DM, booking, or sale) on a keyword as paid, organic, or
 * neither, given when that keyword had real paid spend and whether it is on the
 * client's organic list. Paid wins whenever the event day falls inside a paid
 * ad's run plus a 30 day cool-down.
 */
export function classifyKeyword(params: {
  keyword: string | null | undefined;
  organicMarked: boolean;
  paidSpendDays: readonly string[]; // ET days this keyword had paid spend
  eventDay: string;
  cooldownDays?: number;
}): KeywordClass {
  const keyword = (params.keyword || "").trim();
  if (!keyword) return "none";

  const cooldown = params.cooldownDays ?? ORGANIC_COOLDOWN_DAYS;
  const days = params.paidSpendDays;
  if (days.length > 0) {
    const first = days[0];
    const last = days[days.length - 1];
    // Paid window: from first spend day through last spend day + cool-down.
    const windowEnd = shiftIso(last, cooldown);
    if (params.eventDay >= first && params.eventDay <= windowEnd) return "paid";
    // Outside the cool-down: an organic mark now takes over.
    if (params.organicMarked) return "organic";
    // Real paid keyword, event just sits outside the window: still paid.
    return "paid";
  }

  // No paid spend on this keyword at all.
  if (params.organicMarked) return "organic";
  return "none";
}

/**
 * Resolve which keyword a sale belongs to, using the hard-key chain in strict
 * priority order. Returns the keyword and the method that proved it. A human
 * resolution (even one that says "no keyword") wins over everything.
 */
export function resolveSaleKeyword(params: {
  humanResolution?: { keyword: string | null } | null;
  pastedSubscriberId?: string | null;
  bridgeSubscriberId?: string | null;
  bookingKeywordBySubscriber?: ReadonlyMap<string, string>;
  dmKeywordBySubscriber?: ReadonlyMap<string, string>;
  originCheckKeyword?: string | null;
  paidKeywords: ReadonlySet<string>;
}): { keyword: string | null; method: LinkMethod } {
  // 1. A person decided.
  if (params.humanResolution) {
    return { keyword: params.humanResolution.keyword, method: "human" };
  }

  // The subscriber id we can trust: pasted first, else the stored GHL bridge.
  const subscriberId = params.pastedSubscriberId || params.bridgeSubscriberId || null;

  if (subscriberId) {
    // 2. Their booked call's keyword.
    const booked = params.bookingKeywordBySubscriber?.get(subscriberId);
    if (booked) return { keyword: booked, method: "link_booking" };
    // 3. Their DM keyword.
    const dm = params.dmKeywordBySubscriber?.get(subscriberId);
    if (dm) return { keyword: dm, method: "link_dm" };
  }

  // 4. Their ManyChat profile origin keyword, only if that keyword has real
  //    paid spend (guards organic-flow words from false paid credit).
  const origin = (params.originCheckKeyword || "").trim();
  if (origin && params.paidKeywords.has(origin)) {
    return { keyword: origin, method: "origin_check" };
  }

  return { keyword: null, method: "none" };
}

// ── Evidence stamps and blank reasons ────────────────────────────────────
//
// Every fact row must end up carrying EITHER the hard key that proved its
// match or the written reason there is none. Never neither. These functions
// decide which, from evidence alone, and are pure so they can be tested.

export type EvidenceKey =
  | "subscriber_id"
  | "utm_content"
  | "share_url_token"
  | "attendee_email"
  | "meeting_url"
  | "subscriber_single_prebooking_keyword"
  | "human_resolution";

export type BlankReason =
  | "misc_chat"
  | "organic_dm"
  | "keyword_after_booking"
  | "no_utm_on_booking_link"
  | "no_keyword_ever"
  | "unknown";

export interface Stamp {
  evidenceKey: EvidenceKey | null;
  evidenceDetail: Record<string, unknown> | null;
  blankReason: BlankReason | null;
}

/**
 * A DM's proof is the ManyChat keyword event itself: the subscriber id that
 * identifies the person and the word they sent that identifies the ad.
 */
export function stampDm(
  cls: KeywordClass,
  keyword: string | null,
  subscriberId: string | null,
  eventAt: string,
): Stamp {
  if (!keyword) {
    return { evidenceKey: null, evidenceDetail: null, blankReason: "misc_chat" };
  }
  if (cls === "organic") {
    return {
      evidenceKey: null,
      evidenceDetail: { keyword, subscriber_id: subscriberId, event_at: eventAt },
      blankReason: "organic_dm",
    };
  }
  if (cls === "none") {
    // A word with no paid spend behind it and no organic mark: unprovable.
    return {
      evidenceKey: null,
      evidenceDetail: { keyword, subscriber_id: subscriberId, event_at: eventAt },
      blankReason: "unknown",
    };
  }
  return {
    evidenceKey: "subscriber_id",
    evidenceDetail: {
      source: "ads_keyword_events",
      subscriber_id: subscriberId,
      keyword,
      event_at: eventAt,
    },
    blankReason: null,
  };
}

export interface BookingStampInput {
  /** The keyword carried on the booking link itself (utm_content), if any. */
  keyword: string | null;
  cls: KeywordClass;
  /** The person's ManyChat id, only when a hard key matched them. */
  subscriberId: string | null;
  /** The MOMENT the booking was made. Not the day of the call. */
  createdTime: string | null;
  /** Every keyword this person ever sent, with the exact time they sent it. */
  personKeywords: readonly { at: string; keyword: string }[];
  /** GoHighLevel's recorded landing URL, the proof a link carried no keyword. */
  attributionUrl?: string | null;
}

/**
 * Decide a booking's stamp, including the bare-link recovery.
 *
 * The recovery rule, exactly: when the booking link carried NO keyword but the
 * person is a hard subscriber match AND they sent exactly ONE distinct keyword
 * BEFORE the moment they booked, that keyword is the only possible answer, so
 * it is stamped. Zero or several: no stamp, a written reason instead. We never
 * choose between two candidates.
 *
 * "Before the moment they booked" is load-bearing and is why createdTime is
 * used rather than the call day. On the live data (2026-07-25) the strict rule
 * recovers 0 bookings while ignoring the timing entirely would have "recovered"
 * 32, every one of them a person who booked FIRST and replied to an ad days
 * later. Those 32 would have been false credit to an ad that did not earn it.
 */
export function stampBooking(input: BookingStampInput): Stamp & { keyword: string | null } {
  const { keyword, cls, subscriberId, createdTime, personKeywords } = input;

  if (keyword) {
    if (cls === "organic") {
      return {
        keyword,
        evidenceKey: null,
        evidenceDetail: { keyword, source: "utm_content" },
        blankReason: "organic_dm",
      };
    }
    if (cls === "none") {
      return {
        keyword: null,
        evidenceKey: null,
        evidenceDetail: { rejected_keyword: keyword, why: "no paid spend and not marked organic" },
        blankReason: "unknown",
      };
    }
    return {
      keyword,
      evidenceKey: "utm_content",
      evidenceDetail: { keyword, source: "ghl_appointments.keyword_normalized", via: "booking link" },
      blankReason: null,
    };
  }

  // No keyword on the booking link. Everything below is the recovery attempt.
  const proof = input.attributionUrl ? { attribution_url: input.attributionUrl } : {};

  if (!subscriberId) {
    return {
      keyword: null,
      evidenceKey: null,
      evidenceDetail: { ...proof, why: "no ManyChat id matched this person" },
      blankReason: "no_utm_on_booking_link",
    };
  }

  if (!personKeywords.length) {
    return {
      keyword: null,
      evidenceKey: null,
      evidenceDetail: { ...proof, subscriber_id: subscriberId },
      blankReason: "no_keyword_ever",
    };
  }

  if (!createdTime) {
    return {
      keyword: null,
      evidenceKey: null,
      evidenceDetail: { ...proof, subscriber_id: subscriberId, why: "booking moment unknown" },
      blankReason: "no_utm_on_booking_link",
    };
  }

  const before = personKeywords.filter((k) => k.at < createdTime);
  const distinct = [...new Set(before.map((k) => k.keyword))];

  if (distinct.length === 1) {
    const first = before.find((k) => k.keyword === distinct[0])!;
    return {
      keyword: distinct[0],
      evidenceKey: "subscriber_single_prebooking_keyword",
      evidenceDetail: {
        subscriber_id: subscriberId,
        keyword: distinct[0],
        keyword_sent_at: first.at,
        booked_at: createdTime,
        why: "the only keyword this person sent before they booked",
      },
      blankReason: null,
    };
  }

  if (distinct.length === 0) {
    const soonestAfter = personKeywords[0];
    return {
      keyword: null,
      evidenceKey: null,
      evidenceDetail: {
        ...proof,
        subscriber_id: subscriberId,
        booked_at: createdTime,
        first_keyword_at: soonestAfter.at,
        first_keyword: soonestAfter.keyword,
        why: "every keyword this person sent arrived after they had already booked",
      },
      blankReason: "keyword_after_booking",
    };
  }

  return {
    keyword: null,
    evidenceKey: null,
    evidenceDetail: {
      ...proof,
      subscriber_id: subscriberId,
      booked_at: createdTime,
      candidates: distinct,
      why: "more than one keyword before booking, so the answer is not provable",
    },
    blankReason: "no_utm_on_booking_link",
  };
}

/** Turn a resolved sale's link method into its stamp. */
export function stampSale(
  method: LinkMethod,
  keyword: string | null,
  subscriberId: string | null,
): Stamp {
  switch (method) {
    case "human":
      return {
        evidenceKey: "human_resolution",
        evidenceDetail: { keyword, decided_by: "person" },
        blankReason: null,
      };
    case "link_booking":
    case "link_dm":
    case "origin_check":
      return {
        evidenceKey: "subscriber_id",
        evidenceDetail: { subscriber_id: subscriberId, keyword, matched_by: method },
        blankReason: null,
      };
    case "organic":
      return {
        evidenceKey: null,
        evidenceDetail: { keyword, subscriber_id: subscriberId },
        blankReason: "organic_dm",
      };
    default:
      return {
        evidenceKey: null,
        evidenceDetail: subscriberId
          ? { subscriber_id: subscriberId, why: "their id matched nothing we can prove an ad from" }
          : { why: "no ManyChat id was pasted on this sale, so there is no hard key to follow" },
        blankReason: subscriberId ? "unknown" : "no_keyword_ever",
      };
  }
}

export interface BookingRecord {
  contactId: string | null;
  personName: string | null;
  keyword: string | null;
  startTime: string | null; // ISO
  createdTime: string | null; // ISO
  dmEtDay: string | null;
  createdEtDay?: string | null; // ET day the booking was made
  bookedEtDay: string; // ET day the call is scheduled for
  isUpcoming: boolean;
  taken: boolean; // hard-key-linked taken record (drives "showed")
  ghlStatus?: string | null; // GoHighLevel appointment status (drives "no show")
}

export type PersonCallStatus = "showed" | "noshow" | "upcoming" | "no_outcome";

export interface GroupedPerson {
  name: string;
  dmEtDay: string | null;
  bookedEtDay: string | null;
  callEtDay: string | null;
  status: PersonCallStatus;
  records: number;
}

function isNoShowStatus(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase().replace(/[\s_-]/g, "");
  return s.includes("noshow");
}

/**
 * Group booking records by person so reschedules collapse to one person, with
 * the record count preserved for the hover. One person = one booked call.
 *
 * Status, cohort-true and hard-key only:
 *   upcoming    the call is in the future (excluded from the show-rate denominator)
 *   showed      a hard-key-linked taken record exists
 *   noshow      GoHighLevel marked it a no-show and there is no taken record
 *   no_outcome  the call day passed with no record either way (NEVER a show)
 */
export function groupBookingsByPerson(records: readonly BookingRecord[]): GroupedPerson[] {
  const byPerson = new Map<string, BookingRecord[]>();
  for (const r of records) {
    const key = r.contactId || `name:${(r.personName || "").toLowerCase()}`;
    const list = byPerson.get(key);
    if (list) list.push(r);
    else byPerson.set(key, [r]);
  }

  const out: GroupedPerson[] = [];
  for (const list of byPerson.values()) {
    // The person's canonical record is their latest-scheduled appointment.
    const sorted = [...list].sort((a, b) =>
      (a.startTime || "").localeCompare(b.startTime || ""),
    );
    const latest = sorted[sorted.length - 1];
    const anyUpcoming = list.some((r) => r.isUpcoming);
    const anyTaken = list.some((r) => r.taken);
    const anyNoShow = list.some((r) => isNoShowStatus(r.ghlStatus));
    const status: PersonCallStatus = anyTaken
      ? "showed"
      : anyUpcoming
        ? "upcoming"
        : anyNoShow
          ? "noshow"
          : "no_outcome";
    const callDay = latest.bookedEtDay; // ET day of the scheduled call
    out.push({
      name: latest.personName || "Unknown",
      dmEtDay: latest.dmEtDay,
      // "Booked" = the day the booking was made; fall back to the call day when
      // the created time is unknown so the column is never blank on a real call.
      bookedEtDay: latest.createdEtDay || callDay,
      callEtDay: callDay,
      status,
      records: list.length,
    });
  }
  // Deterministic ordering: most recent call day first, then name.
  out.sort(
    (a, b) =>
      (b.callEtDay || "").localeCompare(a.callEtDay || "") ||
      a.name.localeCompare(b.name),
  );
  return out;
}

// Local, dependency-free ISO day shift so this file stays pure.
function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
