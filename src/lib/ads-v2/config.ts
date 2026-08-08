// ─────────────────────────────────────────────────────────────────────────
// CONFIG — the pinned settings Ads V2 scopes to, read from adsv2.config.json
// so the serving code never guesses and nothing about your business is buried
// in source.
//
// WHICH CALENDARS COUNT is the setting people get wrong, and it is the one
// that quietly breaks trust in every booking number on the page. Only your
// SALES calendar belongs in `salesCalendarIds`. Onboarding calls, coaching
// calls, reschedule calendars and personal calendars must not be listed.
//
// Watch for NEAR-DUPLICATE calendars. CRMs make it easy to end up with
// "Strategy Session (TS)" and "Strategy Session - (TS)" side by side, and
// bookings quietly split across both. If your booked count looks low, list
// your calendars first — `npm run calendars` prints the real ids, with counts,
// straight from your own data. Pin every id that is genuinely a sales call.
// ─────────────────────────────────────────────────────────────────────────

import { loadConfig } from "@/lib/config";
import { ACTIVE_CREATORS, CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";

export interface ClientAdsV2Config {
  key: CreatorKey;
  /** Calendar ids that are sales bookings for this client. */
  salesCalendarIds: readonly string[];
}

/** The creator keys v2 serves (from the single active-creator source of truth). */
export const ADSV2_SERVED_CLIENTS: readonly CreatorKey[] = ACTIVE_CREATORS.map((c) => c.key);

/** Sales calendar ids for one client (empty if none configured yet). */
export function salesCalendarIdsForClient(key: CreatorKey): readonly string[] {
  return CREATORS_BY_KEY[key]?.salesCalendarIds ?? [];
}

/** Every sales calendar id across served clients (for one scoped fetch). */
export const ALL_SALES_CALENDAR_IDS: readonly string[] = ADSV2_SERVED_CLIENTS.flatMap((k) =>
  salesCalendarIdsForClient(k),
);

/** Which served client a sales calendar id belongs to, or null. */
export function clientForSalesCalendar(calendarId: string): CreatorKey | null {
  for (const key of ADSV2_SERVED_CLIENTS) {
    if (salesCalendarIdsForClient(key).includes(calendarId)) return key;
  }
  return null;
}

const attribution = loadConfig().attribution;

// How far back the facts pass rebuilds each sync. Must comfortably cover the
// longest display window (30 days) plus buffer; older facts are never touched.
export const FACTS_LOOKBACK_DAYS = attribution.factsLookbackDays;
// Upcoming calls can be scheduled well ahead, so booking facts reach forward.
export const FACTS_UPCOMING_DAYS = attribution.factsUpcomingDays;
// How far back to read spend when deciding a keyword's paid run + cool-down.
export const SPEND_HISTORY_DAYS = attribution.spendHistoryDays;
// A source is called stale (and shown as such) if its newest data is older.
export const STALE_HOURS = attribution.staleHours;
