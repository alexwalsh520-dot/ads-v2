// Cohort-true show rate (Part A2). These tests pin the ONE law: the show-rate
// cell and its popup are computed from the SAME booked-in-window people. The
// numerator is people booked in the window with a hard-key-linked taken record;
// the denominator is booked minus upcoming. "No outcome yet" is never a show.

import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBookingsByPerson, type BookingRecord } from "./attribution";
import { derive } from "./metrics";
import { EMPTY_BASE } from "./types";

function booking(over: Partial<BookingRecord>): BookingRecord {
  return {
    contactId: "c1",
    personName: "A",
    keyword: "fit",
    startTime: "2026-07-20T15:00:00Z",
    createdTime: "2026-07-15T12:00:00Z",
    dmEtDay: "2026-07-10",
    bookedEtDay: "2026-07-15",
    callEtDay: "2026-07-20",
    isUpcoming: false,
    taken: false,
    ghlStatus: null,
    ...over,
  };
}

test("status: showed requires a hard-key taken record", () => {
  const [p] = groupBookingsByPerson([booking({ contactId: "c1", taken: true })]);
  assert.equal(p.status, "showed");
});

test("status: GHL no-show with no taken record is noshow", () => {
  const [p] = groupBookingsByPerson([
    booking({ contactId: "c2", taken: false, ghlStatus: "noshow" }),
  ]);
  assert.equal(p.status, "noshow");
});

test("status: time passed with no record either way is no_outcome, never showed", () => {
  const [p] = groupBookingsByPerson([
    booking({ contactId: "c3", taken: false, ghlStatus: "confirmed", isUpcoming: false }),
  ]);
  assert.equal(p.status, "no_outcome");
  assert.notEqual(p.status, "showed");
});

test("status: a future appointment is upcoming (excluded from the denominator)", () => {
  const [p] = groupBookingsByPerson([booking({ contactId: "c4", isUpcoming: true })]);
  assert.equal(p.status, "upcoming");
});

test("a taken call outranks an upcoming reschedule (showed wins, one person)", () => {
  const grouped = groupBookingsByPerson([
    booking({ contactId: "c5", taken: true, isUpcoming: false, startTime: "2026-07-18T15:00:00Z" }),
    booking({ contactId: "c5", taken: false, isUpcoming: true, startTime: "2026-08-01T15:00:00Z" }),
  ]);
  assert.equal(grouped.length, 1); // reschedules collapse to one person
  assert.equal(grouped[0].status, "showed");
  assert.equal(grouped[0].records, 2);
});

test("cell numerator/denominator equal the popup row counts (parity)", () => {
  // Five distinct booked people: 2 showed, 1 no-show, 1 no-outcome, 1 upcoming.
  const records: BookingRecord[] = [
    booking({ contactId: "p1", taken: true }),
    booking({ contactId: "p2", taken: true }),
    booking({ contactId: "p3", taken: false, ghlStatus: "noshow" }),
    booking({ contactId: "p4", taken: false, ghlStatus: "confirmed" }),
    booking({ contactId: "p5", taken: false, isUpcoming: true }),
  ];
  const grouped = groupBookingsByPerson(records);

  // Popup row counts.
  const showedRows = grouped.filter((g) => g.status === "showed").length;
  const upcomingRows = grouped.filter((g) => g.status === "upcoming").length;
  const dueRows = grouped.length - upcomingRows;

  // The cell, computed from the base metrics the leaves function would emit for
  // this same cohort: booked=5, upcoming=1, showedPeople=2.
  const base = { ...EMPTY_BASE, booked: 5, upcoming: 1, showedPeople: 2 };
  const d = derive(base);
  const cellDue = base.booked - base.upcoming;

  assert.equal(showedRows, base.showedPeople); // numerator matches
  assert.equal(dueRows, cellDue); // denominator matches
  assert.equal(d.showRate, showedRows / dueRows); // and so does the ratio
  assert.ok(d.showRate !== null && d.showRate <= 1);
});
