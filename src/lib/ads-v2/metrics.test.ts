import { test } from "node:test";
import assert from "node:assert/strict";
import { derive } from "./metrics";
import { EMPTY_BASE, addBase, type BaseMetrics } from "./types";

function make(over: Partial<BaseMetrics>): BaseMetrics {
  return { ...EMPTY_BASE, ...over };
}

test("derive computes calc columns from base sums", () => {
  const b = make({
    spendCents: 100_00,
    impressions: 10_000,
    clicks: 100,
    messages: 50,
    booked: 10,
    taken: 8,
    takenPeople: 8,
    showedPeople: 6,
    upcoming: 2,
    newClients: 4,
    collectedCents: 400_00,
  });
  const d = derive(b);
  assert.equal(d.cpmCents, 1000); // $10.00 CPM
  assert.equal(d.ctr, 0.01);
  assert.equal(d.cpcCents, 100); // $1.00 CPC
  assert.equal(d.costPerMessageCents, 200);
  assert.equal(d.costPerBookedCents, 1000);
  assert.equal(d.showRate, 6 / (10 - 2)); // showed people (booked cohort) / (booked - upcoming)
  assert.equal(d.closeRate, 4 / 8);
  assert.equal(d.msgToCall, 10 / 50);
  assert.equal(d.collectedRoi, 4); // $400 collected / $100 spend
});

test("zero denominators return null, never NaN or Infinity", () => {
  const d = derive(EMPTY_BASE);
  assert.equal(d.cpmCents, null);
  assert.equal(d.ctr, null);
  assert.equal(d.showRate, null);
  assert.equal(d.collectedRoi, null);
});

test("cohort-true show rate never exceeds 100%", () => {
  // The numerator is people BOOKED in the window (not upcoming) who were taken,
  // so it can never be larger than (booked - upcoming). Carryover sale-cohort
  // counts (the old bug) can no longer push it past 100%.
  const d = derive(make({ booked: 8, upcoming: 2, taken: 10, takenPeople: 10, showedPeople: 6 }));
  assert.ok(d.showRate !== null && d.showRate <= 1);
  assert.equal(d.showRate, 6 / (8 - 2));
});

test("TOTAL derives from summed bases, not from summed ratios", () => {
  // Two rows with very different ROI; the true total ROI is over the union.
  const rowA = make({ spendCents: 100_00, collectedCents: 50_00 }); // 0.5x
  const rowB = make({ spendCents: 100_00, collectedCents: 350_00 }); // 3.5x
  const union = addBase(rowA, rowB);
  const total = derive(union);
  // Union: $400 collected / $200 spend = 2.0x. NOT (0.5 + 3.5)/2 = 2.0 here by
  // coincidence, so use an asymmetric case to prove the point:
  const rowC = make({ spendCents: 300_00, collectedCents: 300_00 }); // 1.0x
  const union2 = addBase(rowA, rowC); // $350 / $400 = 0.875x
  const avgOfRatios = (0.5 + 1.0) / 2; // 0.75x -> the WRONG way
  assert.equal(total.collectedRoi, 2);
  assert.equal(derive(union2).collectedRoi, 350_00 / 400_00);
  assert.notEqual(derive(union2).collectedRoi, avgOfRatios);
});
