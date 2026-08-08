// ─────────────────────────────────────────────────────────────────────────
// READING A SHEET'S HEADER ROW — works out which column is which.
//
// Nobody should be asked to type out their own column names. This reads the
// header row and proposes a mapping for a human to confirm.
//
// It proposes. It never decides. A wrong guess accepted silently would put
// somebody's call notes in the revenue column and every number after that
// would be confidently wrong, so the output of this is always shown to a
// person before it is saved.
// ─────────────────────────────────────────────────────────────────────────

/** "A", "B", … "AA" for a zero-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "A" → 0, "AC" → 28. */
export function letterToIndex(letter: string): number {
  return letter.toUpperCase().split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

/**
 * What each field tends to be called in a real sales tracker.
 *
 * Order matters twice over. The list runs most-specific field first, so
 * `manychatLink` claims a column named "ManyChat Link" before `prospectName`
 * can match the word "name" in something else. And within a field, the tighter
 * patterns come first so an exact "Date" beats a loose "date booked".
 */
const FIELD_HINTS: Array<[string, RegExp[]]> = [
  ["manychatLink", [/manychat/i, /\bmc\b.*link/i, /chat\s*link/i, /\bdm\s*link/i]],
  ["callNumber", [/call\s*#/i, /call\s*number/i, /^#$/i]],
  ["date", [/^date$/i, /call\s*date/i, /^day$/i, /\bdate\b/i]],
  ["prospectName", [/prospect/i, /^name$/i, /client\s*name/i, /lead\s*name/i, /\bname\b/i]],
  ["callTakenStatus", [/show(ed)?\s*(up)?/i, /\btaken\b/i, /attended/i, /no[-\s]?show/i]],
  ["callLength", [/length/i, /duration/i]],
  ["outcome", [/outcome/i, /result/i, /^status$/i, /won|lost/i]],
  ["closer", [/closer/i, /closed\s*by/i]],
  ["setter", [/setter/i, /set\s*by/i, /booked\s*by/i]],
  ["objection", [/objection/i]],
  ["programLength", [/program/i, /package/i]],
  ["collectedRevenue", [/cash\s*collect/i, /collected/i, /deposit/i, /down\s*payment/i, /\bpaid\b/i]],
  ["contractedRevenue", [/contract/i, /total\s*(deal|value|revenue)/i, /^revenue$/i, /\bpif\b/i]],
  ["paymentMethod", [/payment\s*method/i, /^method$/i, /^payment$/i]],
  ["callNotes", [/notes?/i, /comments?/i]],
  ["recordingLink", [/recording/i, /fathom/i]],
  ["offer", [/^offer$/i, /^coach$/i, /^product$/i]],
  ["callType", [/type\s*of\s*call/i, /call\s*type/i]],
];

export const REQUIRED_FIELDS = ["date", "prospectName"] as const;
export const HIGH_VALUE_FIELDS = ["manychatLink", "collectedRevenue", "callTakenStatus"] as const;

export interface HeaderGuess {
  /** field name → column letter */
  columns: Record<string, string>;
  /** field name → the header text it matched, for showing a human */
  matchedHeaders: Record<string, string>;
  missingRequired: string[];
  missingHighValue: string[];
}

/**
 * Find the header row. Trackers regularly have a title, a blank line, or a
 * merged banner above the real headings, so "row 1" is not safe to assume.
 * The first row with three or more filled cells is.
 */
export function findHeaderRow(rows: string[][], searchDepth = 10): number {
  for (let i = 0; i < Math.min(rows.length, searchDepth); i += 1) {
    const filled = (rows[i] || []).filter((c) => c && c.trim()).length;
    if (filled >= 3) return i;
  }
  return 0;
}

export function guessColumns(headers: string[]): HeaderGuess {
  const columns: Record<string, string> = {};
  const matchedHeaders: Record<string, string> = {};
  // One column can only be one field. Without this, a sheet with "Name" and
  // "Closer Name" maps both to prospectName and the closer silently vanishes.
  const claimed = new Set<number>();

  for (const [field, patterns] of FIELD_HINTS) {
    for (const pattern of patterns) {
      const index = headers.findIndex(
        (h, i) => !claimed.has(i) && !!h && pattern.test(h.trim()),
      );
      if (index >= 0) {
        columns[field] = columnLetter(index);
        matchedHeaders[field] = headers[index].trim();
        claimed.add(index);
        break;
      }
    }
  }

  return {
    columns,
    matchedHeaders,
    missingRequired: REQUIRED_FIELDS.filter((f) => !columns[f]),
    missingHighValue: HIGH_VALUE_FIELDS.filter((f) => !columns[f]),
  };
}
