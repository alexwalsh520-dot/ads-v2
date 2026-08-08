import { test } from "node:test";
import assert from "node:assert/strict";
import { columnLetter, findHeaderRow, guessColumns, letterToIndex } from "./sheet-columns";

test("column letters and indexes round-trip past Z", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(28), "AC");
  for (const i of [0, 1, 25, 26, 27, 51, 52, 100]) {
    assert.equal(letterToIndex(columnLetter(i)), i, `index ${i}`);
  }
});

test("a real sales tracker header row maps correctly", () => {
  const headers = [
    "Call #", "Date", "Name", "ManyChat Link", "Phone", "Call Taken?",
    "Call Length", "Recorded", "Outcome", "Closer", "Objection",
    "Program Length", "Total Contracted", "Cash Collected", "Payment Method",
    "Setter", "Call Notes", "Recording Link", "Offer", "Type of Call",
  ];
  const { columns, missingRequired } = guessColumns(headers);

  assert.deepEqual(missingRequired, []);
  assert.equal(columns.callNumber, "A");
  assert.equal(columns.date, "B");
  assert.equal(columns.prospectName, "C");
  assert.equal(columns.manychatLink, "D");
  assert.equal(columns.callTakenStatus, "F");
  assert.equal(columns.outcome, "I");
  assert.equal(columns.closer, "J");
  assert.equal(columns.contractedRevenue, "M");
  assert.equal(columns.collectedRevenue, "N");
  assert.equal(columns.setter, "P");
  assert.equal(columns.callType, "T");
});

test("one column is never claimed by two fields", () => {
  // "Closer Name" must not also become the prospect's name, or the closer
  // silently disappears and every prospect is named after their closer.
  const headers = ["Date", "Name", "Closer Name", "Cash Collected"];
  const { columns } = guessColumns(headers);
  assert.equal(columns.prospectName, "B");
  assert.equal(columns.closer, "C");
  assert.notEqual(columns.prospectName, columns.closer);
});

test("cash collected and total contracted are told apart", () => {
  // Getting these backwards silently overstates or understates every ROAS.
  const headers = ["Date", "Name", "Total Contracted", "Cash Collected"];
  const { columns } = guessColumns(headers);
  assert.equal(columns.contractedRevenue, "C");
  assert.equal(columns.collectedRevenue, "D");
});

test("common wordings for the same thing all land", () => {
  for (const [header, field] of [
    ["Showed Up", "callTakenStatus"],
    ["Did they show?", "callTakenStatus"],
    ["MC Chat Link", "manychatLink"],
    ["DM Link", "manychatLink"],
    ["Deposit", "collectedRevenue"],
    ["Set By", "setter"],
    ["Booked By", "setter"],
  ] as const) {
    const { columns } = guessColumns(["Date", "Name", header]);
    assert.equal(columns[field], "C", `"${header}" should map to ${field}`);
  }
});

test("a sheet with no ManyChat column is reported, not silently accepted", () => {
  const { missingHighValue } = guessColumns(["Date", "Name", "Cash Collected", "Showed"]);
  assert.ok(missingHighValue.includes("manychatLink"));
});

test("a missing required column is reported", () => {
  const { missingRequired } = guessColumns(["Closer", "Cash Collected"]);
  assert.ok(missingRequired.includes("date"));
  assert.ok(missingRequired.includes("prospectName"));
});

test("the header row is found under a title and a blank line", () => {
  const rows = [
    ["2026 SALES TRACKER"],
    [],
    ["Call #", "Date", "Name", "Cash Collected"],
    ["1", "8/1", "Sarah", "1200"],
  ];
  assert.equal(findHeaderRow(rows), 2);
  const { columns } = guessColumns(rows[findHeaderRow(rows)]);
  assert.equal(columns.date, "B");
});

test("a sheet whose headers really are on row 1 still works", () => {
  const rows = [["Date", "Name", "Cash Collected"], ["8/1", "Sarah", "1200"]];
  assert.equal(findHeaderRow(rows), 0);
});
