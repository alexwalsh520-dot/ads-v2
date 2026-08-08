import { test } from "node:test";
import assert from "node:assert/strict";
import {
  etDay,
  shiftDay,
  daysBetween,
  firstOfMonth,
  lastOfMonth,
  rangeForPreset,
  rangeLabel,
} from "./time";

test("etDay buckets to the America/New_York calendar day", () => {
  // 2026-07-23 01:30 UTC is still 2026-07-22 in Eastern time (UTC-4 in July).
  assert.equal(etDay("2026-07-23T01:30:00Z"), "2026-07-22");
  // 2026-07-23 12:00 UTC is 2026-07-23 in Eastern time.
  assert.equal(etDay("2026-07-23T12:00:00Z"), "2026-07-23");
});

test("shiftDay does correct calendar math across month ends", () => {
  assert.equal(shiftDay("2026-07-01", -1), "2026-06-30");
  assert.equal(shiftDay("2026-07-31", 1), "2026-08-01");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
});

test("daysBetween is inclusive", () => {
  assert.equal(daysBetween("2026-07-01", "2026-07-07"), 7);
  assert.equal(daysBetween("2026-07-23", "2026-07-23"), 1);
});

test("month helpers", () => {
  assert.equal(firstOfMonth("2026-07-23"), "2026-07-01");
  assert.equal(lastOfMonth("2026-07-23"), "2026-07-31");
  assert.equal(lastOfMonth("2026-02-10"), "2026-02-28");
});

test("presets resolve to the right inclusive ET ranges", () => {
  const anchor = "2026-07-23";
  assert.deepEqual(rangeForPreset("today", anchor), { from: "2026-07-23", to: "2026-07-23" });
  assert.deepEqual(rangeForPreset("yesterday", anchor), {
    from: "2026-07-22",
    to: "2026-07-22",
  });
  assert.deepEqual(rangeForPreset("last7", anchor), { from: "2026-07-17", to: "2026-07-23" });
  assert.deepEqual(rangeForPreset("last30", anchor), { from: "2026-06-24", to: "2026-07-23" });
  assert.deepEqual(rangeForPreset("mtd", anchor), { from: "2026-07-01", to: "2026-07-23" });
  assert.deepEqual(rangeForPreset("lmtd", anchor), { from: "2026-06-01", to: "2026-06-30" });
});

test("nested windows: last7 contains last3 contains today (monotonic bounds)", () => {
  const anchor = "2026-07-23";
  const d1 = rangeForPreset("today", anchor);
  const d3 = rangeForPreset("last3", anchor);
  const d7 = rangeForPreset("last7", anchor);
  assert.ok(d7.from <= d3.from && d3.from <= d1.from);
  assert.ok(d1.to === d3.to && d3.to === d7.to);
});

test("rangeLabel reads naturally", () => {
  assert.equal(rangeLabel({ from: "2026-07-23", to: "2026-07-23" }), "Jul 23, 2026");
  assert.equal(rangeLabel({ from: "2026-07-01", to: "2026-07-23" }), "Jul 1 - Jul 23, 2026");
});
