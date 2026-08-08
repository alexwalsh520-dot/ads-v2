// ─────────────────────────────────────────────────────────────────────────
// READING A GOOGLE SHEET — three ways in, easiest first.
//
//   1. LINK  (default, and what almost everyone should use)
//      You share the sheet as "anyone with the link can view" and paste the
//      normal address-bar URL. Tabs are read BY NAME, so a tracker with one
//      tab per month works exactly as well as a single-tab one.
//      No Google Cloud account. No publishing. Nothing to maintain.
//
//   2. PUBLISHED CSV LINK
//      File > Share > Publish to web > one tab > .csv. A published link points
//      at ONE tab forever, so monthly tabs cannot work this way.
//
//   3. API KEY
//      A Google Cloud API key plus the spreadsheet id. More setup, but the
//      sheet never has to be link-shared.
//
// All three are READ ONLY. Nothing in this package can write to your sheet.
// ─────────────────────────────────────────────────────────────────────────

export type SheetSourceKind = "link" | "published" | "api";

export interface SheetSource {
  kind: SheetSourceKind;
  spreadsheetId: string | null;
  /** Set only for a published CSV link, which is already tab-specific. */
  publishedUrl: string | null;
  apiKey: string | null;
  /** True when tabs can be fetched by name (so monthly tabs are supported). */
  supportsNamedTabs: boolean;
}

/** The spreadsheet id out of any normal Google Sheets URL. */
export function spreadsheetIdFromUrl(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1] !== "e") return match[1];
  return null;
}

/** A published-to-web link looks like /spreadsheets/d/e/2PACX-.../pub?...  */
export function isPublishedUrl(url: string): boolean {
  return /\/spreadsheets\/d\/e\/[^/]+\/pub/.test(url);
}

/**
 * Work out how to read the sheet from whatever the user actually provided.
 * Returns a plain error string rather than throwing, because "your sheet is
 * not connected yet" is a normal state during setup, not a crash.
 */
export function resolveSheetSource(opts: {
  sheetUrl: string | null;
  apiKey: string | null;
  spreadsheetId: string | null;
  prefer: "auto" | "url" | "api";
}): SheetSource | { error: string } {
  const { sheetUrl, apiKey, spreadsheetId, prefer } = opts;

  const wantsApi = prefer === "api" || (prefer === "auto" && !sheetUrl && apiKey && spreadsheetId);
  if (wantsApi) {
    if (!apiKey || !spreadsheetId) {
      return { error: "the API key method needs both GOOGLE_SHEETS_API_KEY and a spreadsheet id" };
    }
    return { kind: "api", spreadsheetId, publishedUrl: null, apiKey, supportsNamedTabs: true };
  }

  if (!sheetUrl) {
    return {
      error:
        "no sheet connected. Paste your Google Sheet link into SHEET_URL, " +
        "and make sure the sheet is shared as 'anyone with the link can view'.",
    };
  }

  if (isPublishedUrl(sheetUrl)) {
    return {
      kind: "published",
      spreadsheetId: null,
      publishedUrl: sheetUrl,
      apiKey: null,
      // A published link is welded to one tab, so month-by-month tabs are out.
      supportsNamedTabs: false,
    };
  }

  const id = spreadsheetIdFromUrl(sheetUrl);
  if (!id) {
    return {
      error: `could not find a spreadsheet id in "${sheetUrl.slice(0, 80)}". Paste the whole link from your browser's address bar.`,
    };
  }
  return { kind: "link", spreadsheetId: id, publishedUrl: null, apiKey, supportsNamedTabs: true };
}

/** The URL that returns one tab as CSV. */
export function csvUrlForTab(source: SheetSource, tab: string): string {
  if (source.kind === "published") return source.publishedUrl as string;
  if (source.kind === "api") {
    const range = encodeURIComponent(`${tab}!A1:BZ`);
    return `https://sheets.googleapis.com/v4/spreadsheets/${source.spreadsheetId}/values/${range}?key=${source.apiKey}`;
  }
  // The visualisation endpoint. Undocumented but long-stable, and the only way
  // to read a named tab from a link-shared sheet without a Google Cloud key.
  return `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}

/**
 * A correct CSV reader. Small, but it has to handle quoted fields containing
 * commas and newlines — which is not exotic. A call-notes column with a comma
 * in it would shift every column after it by one and silently put someone's
 * notes in the revenue field.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface TabResult {
  rows: string[][];
  error?: string;
}

/** Fetch one tab as rows. A missing tab is reported, never thrown. */
export async function fetchTab(source: SheetSource, tab: string): Promise<TabResult> {
  const url = csvUrlForTab(source, tab);
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", redirect: "follow" });
  } catch (err) {
    return { rows: [], error: `could not reach Google: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    if (res.status === 404 || /Unable to parse range/i.test(body)) {
      // Normal: a monthly tracker has no tab for a month that never happened.
      return { rows: [], error: "tab not found" };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        rows: [],
        error:
          "Google refused the request. Share the sheet as 'anyone with the link can view', " +
          "or switch to the API key method.",
      };
    }
    return { rows: [], error: `Google returned ${res.status}: ${body}` };
  }

  if (source.kind === "api") {
    const json = (await res.json()) as { values?: string[][] };
    return { rows: json.values ?? [] };
  }

  const text = await res.text();

  // A link-shared sheet that is NOT actually shared returns a sign-in page
  // instead of CSV, with a 200. Detect it, or every row silently vanishes and
  // the dashboard just shows no revenue with no explanation anywhere.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    return {
      rows: [],
      error:
        "Google returned a sign-in page instead of your data. The sheet is not shared yet — " +
        "open it, click Share, and set 'anyone with the link' to Viewer.",
    };
  }

  return { rows: parseCsv(text) };
}
