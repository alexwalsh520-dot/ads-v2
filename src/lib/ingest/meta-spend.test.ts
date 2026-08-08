import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows } from "./meta-spend";
import type { MetaAdEntity, MetaAdInsight } from "./meta";
import type { Creator } from "@/lib/creators";

// The day-boundary conversion is the part of this pipeline most likely to be
// wrong and least likely to be noticed: a row landing on the wrong day still
// looks like a perfectly ordinary row. So it gets tested directly.

const NY: Creator = {
  key: "ny",
  name: "New York",
  active: true,
  timezone: "America/New_York",
  adAccountEnv: ["X"],
  tokenEnv: ["Y"],
  salesCalendarIds: [],
  matchTokens: [],
};

const SYDNEY: Creator = { ...NY, key: "syd", name: "Sydney", timezone: "Australia/Sydney" };

const noStatuses = new Map<string, MetaAdEntity>();

function hourly(date: string, hour: number, spend: string): MetaAdInsight {
  return {
    ad_id: "ad1",
    ad_name: "Campaign | v1 | KEYWORD",
    date_start: date,
    spend,
    impressions: "10",
    inline_link_clicks: "1",
    hourly_stats_aggregated_by_advertiser_time_zone: `${String(hour).padStart(2, "0")}:00:00 - ${String(hour).padStart(2, "0")}:59:59`,
  };
}

test("an account already reporting in the reporting timezone is stored day-for-day", () => {
  const rows = buildRows(
    NY,
    "act_1",
    [{ ad_id: "ad1", ad_name: "Ad | v2 | FOCUS", date_start: "2026-08-05", spend: "12.34", impressions: "100", inline_link_clicks: "5" }],
    "2026-08-01",
    "2026-08-07",
    "2026-08-07T00:00:00.000Z",
    noStatuses,
    true,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-08-05");
  assert.equal(rows[0].spend_cents, 1234);
  assert.equal(rows[0].keyword_normalized, "focus");
});

test("EVERY row carries the reporting-timezone stamp, including the same-timezone path", () => {
  // The reader filters on this stamp. An unstamped row is a row that exists,
  // looks fine, and silently contributes nothing to a single number on screen.
  const rows = buildRows(
    NY,
    "act_1",
    [{ ad_id: "ad1", ad_name: "Ad | v2 | FOCUS", date_start: "2026-08-05", spend: "1" }],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows[0].raw_payload.reporting_timezone, "America/New_York");
});

test("a Sydney account's hours are re-cut onto New York days", () => {
  // Sydney is UTC+10 in August (no DST). 2026-08-06 09:00 Sydney is
  // 2026-08-05 23:00 UTC, which is 2026-08-05 19:00 in New York — the day
  // BEFORE the one Meta reported it under.
  const rows = buildRows(
    SYDNEY,
    "act_2",
    [hourly("2026-08-06", 9, "10.00")],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-08-05");
  assert.equal(rows[0].spend_cents, 1000);
  assert.equal(rows[0].raw_payload.reporting_timezone, "America/New_York");
  assert.equal(rows[0].raw_payload.account_timezone, "Australia/Sydney");
});

test("hours landing on the same New York day are summed, not duplicated", () => {
  // 2026-08-06 15:00 and 16:00 Sydney are both 2026-08-06 in New York.
  const rows = buildRows(
    SYDNEY,
    "act_2",
    [hourly("2026-08-06", 15, "3.00"), hourly("2026-08-06", 16, "4.50")],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-08-06");
  assert.equal(rows[0].spend_cents, 750);
  assert.equal(rows[0].impressions, 20);
});

test("an hourly row with no parsable hour is dropped, never guessed onto a day", () => {
  const rows = buildRows(
    SYDNEY,
    "act_2",
    [{ ad_id: "ad1", ad_name: "Ad | v1 | X", date_start: "2026-08-06", spend: "99.00" }],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows.length, 0);
});

test("hours that shift outside the requested window are dropped", () => {
  // 2026-08-01 09:00 Sydney is 2026-07-31 in New York, which is before the
  // window opens. Keeping it would write a partial day nobody asked for.
  const rows = buildRows(
    SYDNEY,
    "act_2",
    [hourly("2026-08-01", 9, "5.00")],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows.length, 0);
});

test("the daylight-saving boundary does not move spend into the wrong day", () => {
  // US DST ends 2026-11-01. Los Angeles is UTC-7 before it and UTC-8 after.
  // 2026-11-01 23:00 LA is 2026-11-02 07:00 UTC = 2026-11-02 02:00 New York:
  // the NEXT day. A fixed-offset calculation gets this an hour wrong.
  const la: Creator = { ...NY, key: "la", timezone: "America/Los_Angeles" };
  const rows = buildRows(
    la,
    "act_3",
    [hourly("2026-11-01", 23, "1.00")],
    "2026-10-25",
    "2026-11-05",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-11-02");
});

test("THE NAMING RULE: the keyword is the last word of the ad name", () => {
  // This is the entire join between money and DMs, so it is worth stating in a
  // test rather than only in a doc. The name is split on | : ( ) [ ] { } _ -
  // and the last word of the last piece wins.
  const cases: Array<[string, string]> = [
    ["Campaign | v1 | FOCUS", "focus"],
    ["TEST - Direct CTA - TRIM", "trim"],
    ["Q3 Scaling (PRIMED)", "primed"],
    ["BADGE", "badge"],
    ["Lead Magnet | 50 | Tempo", "tempo"],
  ];
  for (const [adName, expected] of cases) {
    const rows = buildRows(
      NY, "act_1",
      [{ ad_id: "a", ad_name: adName, date_start: "2026-08-05", spend: "1" }],
      "2026-08-01", "2026-08-07", "now", noStatuses, true,
    );
    assert.equal(rows[0].keyword_normalized, expected, adName);
  }
});

test("an ad with a nameless keyword still syncs — the spend is never hidden", () => {
  // Whatever the name is, the money happened. A row that cannot be credited to
  // anything must still appear, because unattributed spend you can see is a
  // problem you can fix and spend you cannot see is not.
  const rows = buildRows(
    NY,
    "act_1",
    [{ ad_id: "ad9", ad_name: "", date_start: "2026-08-05", spend: "7.00" }],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spend_cents, 700);
  assert.equal(rows[0].keyword_normalized, null);
});

test("clicks fall back to total clicks when Meta reports no inline link clicks", () => {
  const rows = buildRows(
    NY,
    "act_1",
    [{ ad_id: "ad1", ad_name: "Ad | v1 | FOCUS", date_start: "2026-08-05", spend: "1", clicks: "42" }],
    "2026-08-01",
    "2026-08-07",
    "now",
    noStatuses,
    true,
  );
  assert.equal(rows[0].link_clicks, 42);
});
