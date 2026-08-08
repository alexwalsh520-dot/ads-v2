// Coverage for the metric-card registry (Part D6): every card carries a
// sentence + a source + a working computation, and every default card exists.
// This is the cards' half of the definitions coverage test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_DEFS, CARD_BY_ID, DEFAULT_CARD_IDS } from "./cards";
import { EMPTY_BASE, type MetricsDay } from "./types";

const sampleDay: MetricsDay = {
  day: "2026-07-20",
  spendCents: 10_000,
  impressions: 5_000,
  clicks: 80,
  messages: 20,
  booked: 5,
  taken: 3,
  newClients: 1,
  collectedCents: 120_000,
};

test("every card has a plain sentence and a source", () => {
  for (const c of CARD_DEFS) {
    assert.ok(c.sentence.trim().length > 0, `${c.id} missing sentence`);
    assert.ok(c.source.trim().length > 0, `${c.id} missing source`);
    assert.ok(!/[—–]/.test(c.sentence), `${c.id} sentence has an em/en dash`);
    assert.ok(!/[—–]/.test(c.source), `${c.id} source has an em/en dash`);
  }
});

test("every card computes a value and a point without throwing", () => {
  const total = { ...EMPTY_BASE, spendCents: 100_00, impressions: 10_000, clicks: 100, messages: 50, booked: 10, taken: 8, newClients: 4, collectedCents: 400_00 };
  for (const c of CARD_DEFS) {
    const v = c.value(total);
    assert.ok(v === null || Number.isFinite(v), `${c.id} value not finite`);
    // Null is a legal point: it means "no data that day" and the chart draws
    // a gap there.
    const p = c.point(sampleDay);
    assert.ok(p === null || Number.isFinite(p), `${c.id} point not finite or null`);
  }
});

test("attribution coverage: a day with no tracker cash is 100%, never 0%", () => {
  // Owner call (Alex 2026-08-08): the card answers "is attribution missing
  // money?". A day with no cash has zero misses, so it reads 100%. A dip
  // below 100% always means real cash came in with no recorded origin.
  const cov = CARD_BY_ID["attribution_coverage"];
  assert.equal(cov.point({ ...sampleDay, trackerAllCents: 0 }), 1);
  assert.equal(cov.point(sampleDay), 1); // field absent entirely
  const day = { ...sampleDay, trackerAllCents: 200_000, adsAllCents: 100_000, organicAllCents: 0, miscChatCents: 50_000, otherOriginAllCents: 0 };
  assert.equal(cov.point(day), 0.75);
});

test("card ids are unique and every default card exists", () => {
  const ids = new Set(CARD_DEFS.map((c) => c.id));
  assert.equal(ids.size, CARD_DEFS.length, "duplicate card id");
  for (const id of DEFAULT_CARD_IDS) {
    assert.ok(CARD_BY_ID[id], `default card ${id} not in registry`);
  }
});

test("Potential ROAS is NOT in this build", () => {
  assert.ok(!CARD_BY_ID["potential_roas"], "potential_roas must not exist in v2");
});
