import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNS,
  COLUMN_BY_KEY,
  DISPLAY_COLUMN_KEYS,
  buildHowItWorks,
  ET_NOTE,
  REVENUE_CHAIN,
} from "./definitions";

// The heart of the "shared registry" guarantee: every column the table
// displays MUST have a definition here, or the build fails. This is the same
// list the CampaignTable renders, kept in one place.
const RENDERED_COLUMN_KEYS = [
  "name",
  "budget",
  "spend",
  "impressions",
  "cpm",
  "clicks",
  "ctr",
  "cpc",
  "messages",
  "costPerMessage",
  "booked",
  "costPerBooked",
  "taken",
  "costPerTaken",
  "showRate",
  "newClients",
  "closeRate",
  "msgToCall",
  "collected",
  "costPerClient",
  "collectedRoi",
];

test("every displayed column has a registry entry", () => {
  for (const key of RENDERED_COLUMN_KEYS) {
    assert.ok(COLUMN_BY_KEY[key], `missing registry entry for column "${key}"`);
  }
});

test("registry and display order agree exactly", () => {
  assert.deepEqual([...DISPLAY_COLUMN_KEYS], RENDERED_COLUMN_KEYS);
});

test("every column has a non-empty one-sentence rule and a source", () => {
  for (const col of COLUMNS) {
    assert.ok(col.sentence.trim().length > 0, `${col.key} needs a sentence`);
    assert.ok(col.source.trim().length > 0, `${col.key} needs a source`);
    // Plain language rules: no em dashes, no en dashes in UI copy.
    assert.ok(!col.sentence.includes("—"), `${col.key} sentence has an em dash`);
    assert.ok(!col.sentence.includes("–"), `${col.key} sentence has an en dash`);
    assert.ok(!col.source.includes("—"), `${col.key} source has an em dash`);
  }
});

test("the gear panel is built from the same registry", () => {
  const how = buildHowItWorks();
  // Panel lists every metric column (all but the label column).
  assert.equal(how.columns.length, COLUMNS.length - 1);
  assert.ok(how.revenueChain === REVENUE_CHAIN);
  assert.ok(how.etNote === ET_NOTE);
  // The required Eastern-time sentence is present verbatim.
  assert.match(how.etNote, /Days are Eastern time\./);
});

test("no em or en dashes anywhere in the panel copy", () => {
  const how = buildHowItWorks();
  const blobs = [how.etNote, how.scopeNote, ...how.revenueChain];
  for (const s of blobs) {
    assert.ok(!s.includes("—"), `em dash in "${s}"`);
    assert.ok(!s.includes("–"), `en dash in "${s}"`);
  }
});
