// ─────────────────────────────────────────────────────────────────────────
// TIME — one shared Eastern-time bucketing function for all of Ads v2.
//
// Every window boundary and every "today" in v2 is midnight-to-midnight
// America/New_York. Spend already arrives ET-native; every other source is
// bucketed to an ET day through etDay() here, and nothing else. No computation
// or display ever uses an account's own timezone.
// ─────────────────────────────────────────────────────────────────────────

export const ET_ZONE = "America/New_York";

const ET_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Eastern-time calendar day (YYYY-MM-DD) an instant falls on. */
export function etDay(instant: Date | string | number): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA formats as YYYY-MM-DD.
  return ET_DAY_FMT.format(d);
}

/** Today's Eastern-time day (YYYY-MM-DD). */
export function todayEt(now: Date = new Date()): string {
  return etDay(now);
}

/** Shift an ISO day (YYYY-MM-DD) by a whole number of days. Pure string math. */
export function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive whole-day count between two ISO days. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(...(fromIso.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(toIso.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000) + 1;
}

/** First ET day of the month that `iso` belongs to. */
export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last ET day of the month that `iso` belongs to. */
export function lastOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  // Day 0 of next month is the last day of this month.
  const dt = new Date(Date.UTC(y, m, 0));
  return dt.toISOString().slice(0, 10);
}

export type PresetId =
  | "today"
  | "yesterday"
  | "last3"
  | "last7"
  | "last14"
  | "last30"
  | "mtd"
  | "lmtd"
  | "custom";

export interface Preset {
  id: PresetId;
  label: string;
}

// The presets v1 offers, in the same order and with the same day math.
export const PRESETS: readonly Preset[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last3", label: "Last 3 days" },
  { id: "last7", label: "Last 7 days" },
  { id: "last14", label: "Last 14 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "mtd", label: "This month" },
  { id: "lmtd", label: "Last month" },
  { id: "custom", label: "Custom" },
];

export interface DayRange {
  from: string;
  to: string;
}

/**
 * Resolve a preset to an inclusive Eastern-time day range, anchored on
 * `anchor` (default: today ET). Custom falls back to Last 7 days.
 */
export function rangeForPreset(id: PresetId, anchor: string = todayEt()): DayRange {
  switch (id) {
    case "today":
      return { from: anchor, to: anchor };
    case "yesterday": {
      const y = shiftDay(anchor, -1);
      return { from: y, to: y };
    }
    case "last3":
      return { from: shiftDay(anchor, -2), to: anchor };
    case "last7":
      return { from: shiftDay(anchor, -6), to: anchor };
    case "last14":
      return { from: shiftDay(anchor, -13), to: anchor };
    case "last30":
      return { from: shiftDay(anchor, -29), to: anchor };
    case "mtd":
      return { from: firstOfMonth(anchor), to: anchor };
    case "lmtd": {
      const lastMonthAnchor = shiftDay(firstOfMonth(anchor), -1);
      return { from: firstOfMonth(lastMonthAnchor), to: lastOfMonth(lastMonthAnchor) };
    }
    default:
      return { from: shiftDay(anchor, -6), to: anchor };
  }
}

/** A short label like "Jul 1 - Jul 23, 2026" for a range. */
export function rangeLabel(range: DayRange): string {
  const fmt = (iso: string, withYear: boolean) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const month = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return withYear ? `${month} ${d}, ${y}` : `${month} ${d}`;
  };
  if (range.from === range.to) return fmt(range.from, true);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return `${fmt(range.from, !sameYear)} - ${fmt(range.to, true)}`;
}
