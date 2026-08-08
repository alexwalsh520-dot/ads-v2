import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csvUrlForTab,
  isPublishedUrl,
  parseCsv,
  resolveSheetSource,
  spreadsheetIdFromUrl,
} from "./sheet-source";

// ── the CSV reader ────────────────────────────────────────────────────────
// This is not busywork. A sales tracker has a free-text notes column, people
// put commas in it, and a naive split(",") shifts every column after it. The
// revenue field would then quietly contain the tail of somebody's call notes.

test("a comma inside a quoted cell does not split the row", () => {
  const rows = parseCsv('A,B,C\n1,"hello, world",3\n');
  assert.deepEqual(rows[1], ["1", "hello, world", "3"]);
});

test("a newline inside a quoted cell does not split the row", () => {
  const rows = parseCsv('A,B\n1,"line one\nline two"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "line one\nline two");
});

test("a doubled quote is one literal quote", () => {
  const rows = parseCsv('A\n"she said ""yes"" on the call"\n');
  assert.equal(rows[1][0], 'she said "yes" on the call');
});

test("empty cells are preserved so column positions never shift", () => {
  const rows = parseCsv("a,,c\n");
  assert.deepEqual(rows[0], ["a", "", "c"]);
});

test("windows line endings do not leave stray carriage returns in the data", () => {
  const rows = parseCsv("a,b\r\n1,2\r\n");
  assert.deepEqual(rows[1], ["1", "2"]);
});

test("a last row with no trailing newline is not dropped", () => {
  const rows = parseCsv("a,b\n1,2");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ["1", "2"]);
});

// ── working out how to reach the sheet ────────────────────────────────────

test("a normal sheet link yields its id and supports named tabs", () => {
  const url = "https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0";
  assert.equal(spreadsheetIdFromUrl(url), "1AbC-dEf_123");

  const source = resolveSheetSource({ sheetUrl: url, apiKey: null, spreadsheetId: null, prefer: "auto" });
  assert.ok(!("error" in source));
  if ("error" in source) return;
  assert.equal(source.kind, "link");
  // Named tabs are what make a month-per-tab tracker work.
  assert.equal(source.supportsNamedTabs, true);
  assert.match(csvUrlForTab(source, "August 2026"), /gviz\/tq\?tqx=out:csv&sheet=August%202026/);
});

test("a published link is recognised and cannot do named tabs", () => {
  const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vAbc/pub?gid=0&single=true&output=csv";
  assert.equal(isPublishedUrl(url), true);
  // The /d/e/ form must not be mistaken for a spreadsheet id of "e".
  assert.equal(spreadsheetIdFromUrl(url), null);

  const source = resolveSheetSource({ sheetUrl: url, apiKey: null, spreadsheetId: null, prefer: "auto" });
  assert.ok(!("error" in source));
  if ("error" in source) return;
  assert.equal(source.kind, "published");
  assert.equal(source.supportsNamedTabs, false);
  assert.equal(csvUrlForTab(source, "anything"), url);
});

test("with only an API key and an id, the API method is chosen", () => {
  const source = resolveSheetSource({
    sheetUrl: null, apiKey: "KEY", spreadsheetId: "SHEET", prefer: "auto",
  });
  assert.ok(!("error" in source));
  if ("error" in source) return;
  assert.equal(source.kind, "api");
  assert.match(csvUrlForTab(source, "Sheet1"), /sheets\.googleapis\.com/);
});

test("nothing configured gives an instruction, not a crash", () => {
  const source = resolveSheetSource({ sheetUrl: null, apiKey: null, spreadsheetId: null, prefer: "auto" });
  assert.ok("error" in source);
  if (!("error" in source)) return;
  assert.match(source.error, /SHEET_URL/);
});

test("a link that is not a Google Sheet says so plainly", () => {
  const source = resolveSheetSource({
    sheetUrl: "https://example.com/my-sheet", apiKey: null, spreadsheetId: null, prefer: "auto",
  });
  assert.ok("error" in source);
  if (!("error" in source)) return;
  assert.match(source.error, /address bar/);
});
