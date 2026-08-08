import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stampDm,
  stampBooking,
  stampSale,
  classifyKeyword,
  resolveSaleKeyword,
  groupBookingsByPerson,
  type BookingRecord,
} from "./attribution";

// ── classifyKeyword ───────────────────────────────────────────────────────

test("no keyword is always none", () => {
  assert.equal(
    classifyKeyword({ keyword: "", organicMarked: true, paidSpendDays: [], eventDay: "2026-07-23" }),
    "none",
  );
});

test("a keyword with paid spend on the event day is paid", () => {
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: false,
      paidSpendDays: ["2026-07-20", "2026-07-22"],
      eventDay: "2026-07-22",
    }),
    "paid",
  );
});

test("paid wins over an organic mark during the run and cool-down", () => {
  // Marked organic, but the ad ran through 07-22; a DM on 07-25 (within 30d) is paid.
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: true,
      paidSpendDays: ["2026-07-20", "2026-07-22"],
      eventDay: "2026-07-25",
    }),
    "paid",
  );
});

test("organic only takes over after the 30 day cool-down", () => {
  // Last spend 07-22, cool-down ends 08-21; an organic-marked event on 09-01 is organic.
  assert.equal(
    classifyKeyword({
      keyword: "fit",
      organicMarked: true,
      paidSpendDays: ["2026-07-22"],
      eventDay: "2026-09-01",
    }),
    "organic",
  );
});

test("organic-marked word that never had paid spend is organic", () => {
  assert.equal(
    classifyKeyword({
      keyword: "locked",
      organicMarked: true,
      paidSpendDays: [],
      eventDay: "2026-07-23",
    }),
    "organic",
  );
});

test("a word with no spend and no organic mark is none", () => {
  assert.equal(
    classifyKeyword({
      keyword: "mystery",
      organicMarked: false,
      paidSpendDays: [],
      eventDay: "2026-07-23",
    }),
    "none",
  );
});

// ── resolveSaleKeyword ────────────────────────────────────────────────────

const paid = new Set(["fit", "gym", "edge"]);

test("human resolution wins over everything, even saying no keyword", () => {
  const r = resolveSaleKeyword({
    humanResolution: { keyword: null },
    pastedSubscriberId: "sub1",
    bookingKeywordBySubscriber: new Map([["sub1", "fit"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: null, method: "human" });
});

test("pasted subscriber id resolves via the booked call first", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: "sub1",
    bookingKeywordBySubscriber: new Map([["sub1", "fit"]]),
    dmKeywordBySubscriber: new Map([["sub1", "gym"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "fit", method: "link_booking" });
});

test("falls to the DM keyword when there is no booked call", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: "sub1",
    dmKeywordBySubscriber: new Map([["sub1", "gym"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "gym", method: "link_dm" });
});

test("uses the stored GHL bridge subscriber when nothing was pasted", () => {
  const r = resolveSaleKeyword({
    pastedSubscriberId: null,
    bridgeSubscriberId: "sub2",
    bookingKeywordBySubscriber: new Map([["sub2", "edge"]]),
    paidKeywords: paid,
  });
  assert.deepEqual(r, { keyword: "edge", method: "link_booking" });
});

test("origin-check keyword is accepted only when it has real paid spend", () => {
  const ok = resolveSaleKeyword({ originCheckKeyword: "edge", paidKeywords: paid });
  assert.deepEqual(ok, { keyword: "edge", method: "origin_check" });
  const rejected = resolveSaleKeyword({ originCheckKeyword: "locked", paidKeywords: paid });
  assert.deepEqual(rejected, { keyword: null, method: "none" });
});

test("nothing proves it -> none (never a name guess)", () => {
  const r = resolveSaleKeyword({ pastedSubscriberId: "ghost", paidKeywords: paid });
  assert.deepEqual(r, { keyword: null, method: "none" });
});

// ── groupBookingsByPerson ─────────────────────────────────────────────────

test("reschedules collapse to one person with a record count", () => {
  const recs: BookingRecord[] = [
    {
      contactId: "c1",
      personName: "Sam Lee",
      keyword: "fit",
      startTime: "2026-07-20T15:00:00Z",
      createdTime: "2026-07-15T00:00:00Z",
      dmEtDay: "2026-07-14",
      bookedEtDay: "2026-07-20",
      isUpcoming: false,
      taken: false,
    },
    {
      contactId: "c1",
      personName: "Sam Lee",
      keyword: "fit",
      startTime: "2026-07-23T15:00:00Z",
      createdTime: "2026-07-21T00:00:00Z",
      dmEtDay: "2026-07-14",
      bookedEtDay: "2026-07-23",
      isUpcoming: false,
      taken: true,
    },
  ];
  const grouped = groupBookingsByPerson(recs);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].records, 2);
  assert.equal(grouped[0].status, "showed"); // any record taken -> showed
  assert.equal(grouped[0].name, "Sam Lee");
});

test("two different people stay separate; ordering is deterministic", () => {
  const recs: BookingRecord[] = [
    {
      contactId: "a",
      personName: "Aaron",
      keyword: "fit",
      startTime: "2026-07-21T15:00:00Z",
      createdTime: null,
      dmEtDay: null,
      bookedEtDay: "2026-07-21",
      isUpcoming: true,
      taken: false,
    },
    {
      contactId: "b",
      personName: "Bea",
      keyword: "fit",
      startTime: "2026-07-22T15:00:00Z",
      createdTime: null,
      dmEtDay: null,
      bookedEtDay: "2026-07-22",
      isUpcoming: false,
      taken: false,
    },
  ];
  const grouped = groupBookingsByPerson(recs);
  assert.equal(grouped.length, 2);
  // Most recent call day first.
  assert.equal(grouped[0].name, "Bea");
  // Bea's call day passed with no taken record and no GHL no-show status, so she
  // is "no outcome yet" (never counted as a show), not a no-show.
  assert.equal(grouped[0].status, "no_outcome");
  assert.equal(grouped[1].status, "upcoming");
});

// ── Evidence stamps and blank reasons (Build 2, Phase 3) ──────────────────

test("a DM with no keyword is misc chat, not a mystery", () => {
  const s = stampDm("none", null, "sub_1", "2026-07-01T10:00:00Z");
  assert.equal(s.evidenceKey, null);
  assert.equal(s.blankReason, "misc_chat");
});

test("a paid DM is stamped with the subscriber hard key", () => {
  const s = stampDm("paid", "fit", "sub_1", "2026-07-01T10:00:00Z");
  assert.equal(s.evidenceKey, "subscriber_id");
  assert.equal(s.blankReason, null);
  assert.equal((s.evidenceDetail as Record<string, unknown>).keyword, "fit");
});

test("an organic DM says organic rather than going blank", () => {
  assert.equal(stampDm("organic", "grow", "sub_1", "2026-07-01T10:00:00Z").blankReason, "organic_dm");
});

test("a booking whose link carried the keyword is stamped utm_content", () => {
  const s = stampBooking({
    keyword: "fit",
    cls: "paid",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [],
  });
  assert.equal(s.evidenceKey, "utm_content");
  assert.equal(s.keyword, "fit");
});

// THE RULE THAT PROTECTS THE MONEY. On the live data these two cases are the
// difference between 0 recovered bookings and 32 falsely credited ones.
test("a bare link recovers the ONE keyword sent before the booking moment", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [{ at: "2026-07-10T09:30:00Z", keyword: "fit" }],
  });
  assert.equal(s.evidenceKey, "subscriber_single_prebooking_keyword");
  assert.equal(s.keyword, "fit");
});

test("a keyword sent AFTER booking never earns credit for that booking", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    // Real shape: booked first, replied to an ad two days later.
    personKeywords: [{ at: "2026-07-12T18:00:00Z", keyword: "loaded" }],
  });
  assert.equal(s.keyword, null);
  assert.equal(s.evidenceKey, null);
  assert.equal(s.blankReason, "keyword_after_booking");
});

test("a keyword sent LATER THE SAME DAY still does not count", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [{ at: "2026-07-10T23:59:00Z", keyword: "loaded" }],
  });
  assert.equal(s.blankReason, "keyword_after_booking");
});

test("two possible keywords before booking is never guessed between", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [
      { at: "2026-07-08T09:00:00Z", keyword: "fit" },
      { at: "2026-07-09T09:00:00Z", keyword: "focus" },
    ],
  });
  assert.equal(s.keyword, null);
  assert.equal(s.blankReason, "no_utm_on_booking_link");
  assert.deepEqual((s.evidenceDetail as { candidates: string[] }).candidates, ["fit", "focus"]);
});

test("the same person sending one keyword twice before booking still recovers it", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: "sub_1",
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [
      { at: "2026-07-08T09:00:00Z", keyword: "fit" },
      { at: "2026-07-09T09:00:00Z", keyword: "fit" },
    ],
  });
  assert.equal(s.evidenceKey, "subscriber_single_prebooking_keyword");
  assert.equal(s.keyword, "fit");
});

test("no ManyChat match keeps the GHL landing URL as the proof", () => {
  const s = stampBooking({
    keyword: null,
    cls: "none",
    subscriberId: null,
    createdTime: "2026-07-10T12:00:00Z",
    personKeywords: [],
    attributionUrl: "https://link.example-coach.com/widget/booking/abc",
  });
  assert.equal(s.blankReason, "no_utm_on_booking_link");
  assert.equal(
    (s.evidenceDetail as { attribution_url: string }).attribution_url,
    "https://link.example-coach.com/widget/booking/abc",
  );
});

test("a sale linked by subscriber is stamped, an unprovable one gives a reason", () => {
  assert.equal(stampSale("link_booking", "fit", "sub_1").evidenceKey, "subscriber_id");
  assert.equal(stampSale("organic", "grow", "sub_1").blankReason, "organic_dm");
  assert.equal(stampSale("none", null, null).blankReason, "no_keyword_ever");
  assert.equal(stampSale("none", null, "sub_1").blankReason, "unknown");
});

test("every stamp gives exactly one of: evidence key, or blank reason", () => {
  const stamps = [
    stampDm("paid", "fit", "s", "2026-07-01T00:00:00Z"),
    stampDm("none", null, "s", "2026-07-01T00:00:00Z"),
    stampDm("organic", "g", "s", "2026-07-01T00:00:00Z"),
    stampSale("human", "fit", "s"),
    stampSale("link_dm", "fit", "s"),
    stampSale("origin_check", "fit", "s"),
    stampSale("none", null, "s"),
    stampBooking({ keyword: "fit", cls: "paid", subscriberId: "s", createdTime: null, personKeywords: [] }),
    stampBooking({ keyword: null, cls: "none", subscriberId: null, createdTime: null, personKeywords: [] }),
    stampBooking({ keyword: null, cls: "none", subscriberId: "s", createdTime: null, personKeywords: [{ at: "2026-07-01T00:00:00Z", keyword: "fit" }] }),
  ];
  for (const s of stamps) {
    assert.equal(
      (s.evidenceKey === null) !== (s.blankReason === null),
      true,
      `a stamp must have a key OR a reason, never both and never neither: ${JSON.stringify(s)}`,
    );
  }
});
