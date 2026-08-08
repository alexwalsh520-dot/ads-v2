// ─────────────────────────────────────────────────────────────────────────
// DEFINITIONS REGISTRY — the ONE place every rule lives, in one plain sentence.
//
// This single registry powers BOTH the column info-hovers AND the gear panel's
// "How your numbers work". Because they share this source, any future rule that
// is added or changed shows up in both automatically. A build-time unit test
// fails if any column the table displays lacks an entry here.
//
// Plain language, no em dashes, no italics. Written for a non-technical owner.
// ─────────────────────────────────────────────────────────────────────────

export type ColumnFormat =
  | "text"
  | "int"
  | "usd"
  | "usd2"
  | "cpm"
  | "ratio2"
  | "pct"
  | "budget";

export interface ColumnDef {
  /** Stable key used by the row payload and by column sorting. */
  key: string;
  /** Header text shown in the table. */
  label: string;
  /** The one-sentence rule shown in the info-hover and the gear panel. */
  sentence: string;
  /** Where the number comes from, in plain English. */
  source: string;
  /** How to format the value at render time. */
  format: ColumnFormat;
  /** Derived (calc) columns get a tinted background, like v1. */
  calc?: boolean;
  /** Funnel-count columns (people/actions), styled slightly dimmer in v1. */
  logged?: boolean;
  /** Left-aligned label column (the first column). */
  isLabel?: boolean;
}

// The columns the table renders, in display order. The first is the label
// column; the rest are metrics. Every one has an info-hover from `sentence`.
export const COLUMNS: readonly ColumnDef[] = [
  {
    key: "name",
    label: "Campaign / Ad set / Ad",
    sentence: "The campaign, ad set, or ad this row describes.",
    source: "Meta. An ad's name is also its keyword.",
    format: "text",
    isLabel: true,
  },
  {
    key: "budget",
    label: "Daily budget",
    sentence:
      "The daily budget set in Meta at that time. Ad sets hold budgets in ABO; campaigns only when CBO; ads never do.",
    source: "Meta budget settings, saved once per Eastern-time day.",
    format: "budget",
  },
  {
    key: "spend",
    label: "Ad spend",
    sentence: "How much Meta charged to run this ad across the selected days.",
    source: "Meta, bucketed to Eastern-time days.",
    format: "usd",
  },
  {
    key: "impressions",
    label: "Impressions",
    sentence: "How many times the ad was shown.",
    source: "Meta.",
    format: "int",
  },
  {
    key: "cpm",
    label: "CPM",
    sentence: "The cost for every one thousand times the ad was shown.",
    source: "Ad spend divided by impressions, times one thousand.",
    format: "cpm",
    calc: true,
  },
  {
    key: "clicks",
    label: "Link clicks",
    sentence: "How many times people clicked the ad's link.",
    source: "Meta.",
    format: "int",
  },
  {
    key: "ctr",
    label: "CTR",
    sentence: "The share of times the ad was shown that led to a link click.",
    source: "Link clicks divided by impressions.",
    format: "pct",
    calc: true,
  },
  {
    key: "cpc",
    label: "CPC",
    sentence: "The average cost of one link click.",
    source: "Ad spend divided by link clicks.",
    format: "usd2",
    calc: true,
  },
  {
    key: "messages",
    label: "DMs",
    sentence: "How many different people sent this ad's keyword in a DM.",
    source: "ManyChat keyword events, counted as distinct people.",
    format: "int",
    logged: true,
  },
  {
    key: "costPerMessage",
    label: "Cost / DM",
    sentence: "The average ad spend behind one DM.",
    source: "Ad spend divided by DMs.",
    format: "usd2",
    calc: true,
  },
  {
    key: "booked",
    label: "Calls booked",
    sentence:
      "How many different people booked a strategy call from this ad's keyword.",
    source:
      "GoHighLevel sales-calendar bookings that carry the keyword, counted as distinct people, with reschedules grouped under one person.",
    format: "int",
    logged: true,
  },
  {
    key: "costPerBooked",
    label: "Cost / booked",
    sentence: "The average ad spend behind one booked call.",
    source: "Ad spend divided by calls booked.",
    format: "usd2",
    calc: true,
  },
  {
    key: "taken",
    label: "Calls taken",
    sentence:
      "How many strategy calls took place in this window, counted on the day the call happened, including ones booked earlier.",
    source:
      "The sales tracker, which only lists calls that took place. Counted by call day, so this can differ from the show-rate group, which counts people booked in this window.",
    format: "int",
    logged: true,
  },
  {
    key: "costPerTaken",
    label: "Cost / call taken",
    sentence: "The average ad spend behind one call taken.",
    source: "Ad spend divided by calls taken.",
    format: "usd2",
    calc: true,
  },
  {
    key: "showRate",
    label: "Show rate",
    sentence:
      "Of the people who booked a call in this window, the share who actually showed up. Upcoming calls are set aside, not counted for or against it.",
    source:
      "People booked in this window who have a matching taken record, divided by people booked in this window minus upcoming. The same people the popup lists, so the cell and the popup always agree. It never passes 100%.",
    format: "pct",
    calc: true,
  },
  {
    key: "newClients",
    label: "New clients",
    sentence: "How many of those calls became a paying client.",
    source: "The sales tracker wins.",
    format: "int",
    logged: true,
  },
  {
    key: "closeRate",
    label: "Close rate",
    sentence: "The share of calls taken that became a client.",
    source: "New clients divided by calls taken.",
    format: "pct",
    calc: true,
  },
  {
    key: "msgToCall",
    label: "DM to call",
    sentence: "The share of DMs that became a booked call.",
    source: "Calls booked divided by DMs.",
    format: "pct",
    calc: true,
  },
  {
    key: "collected",
    label: "Collected revenue",
    sentence: "Cash actually collected from clients tied to this ad's keyword.",
    source: "The sales tracker, tied to a keyword by hard key only.",
    format: "usd",
    logged: true,
  },
  {
    key: "costPerClient",
    label: "Cost / client",
    sentence: "The average ad spend behind one new client.",
    source: "Ad spend divided by new clients.",
    format: "usd",
    calc: true,
  },
  {
    key: "collectedRoi",
    label: "Collected ROAS",
    sentence: "The cash collected for every dollar of ad spend, shown as a multiple.",
    source: "Collected revenue divided by ad spend.",
    format: "ratio2",
    calc: true,
  },
];

export const COLUMN_BY_KEY: Record<string, ColumnDef> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c]),
);

/** The keys the table renders, in order. The build-time test checks this set. */
export const DISPLAY_COLUMN_KEYS: readonly string[] = COLUMNS.map((c) => c.key);

// The revenue linking chain, in priority order, exactly as the engine applies
// it. A person decision in the attribution workspace outranks everything here.
export const REVENUE_CHAIN: readonly string[] = [
  "First, the ManyChat subscriber id pasted on the sale row.",
  "Then, the stored GoHighLevel to ManyChat bridge for that contact.",
  "Then, the subscriber's own ManyChat profile showing the keyword, accepted only for keywords with real paid spend.",
  "A person decision in the attribution workspace outranks all of these.",
  "Matching by name is never used to tie money to a keyword. Names are shown for reading only.",
];

// The exact Eastern-time note the spend hover carries.
export const ET_NOTE =
  "Days are Eastern time. Meta Ads Manager shows this account's own timezone, so single days there can differ slightly; multi-day totals match.";

// A short statement of what this view shows and what it hides, for the panel.
export const SCOPE_NOTE =
  "This view shows paid ads only. Organic revenue, organic keywords, bookings with no keyword, and anything we cannot prove are not shown here. Every number is built up from individual records, never guessed.";

export interface HowItWorks {
  columns: ColumnDef[];
  revenueChain: readonly string[];
  etNote: string;
  scopeNote: string;
}

/** The content for the gear panel, built from this same registry. */
export function buildHowItWorks(): HowItWorks {
  return {
    columns: COLUMNS.filter((c) => !c.isLabel),
    revenueChain: REVENUE_CHAIN,
    etNote: ET_NOTE,
    scopeNote: SCOPE_NOTE,
  };
}
