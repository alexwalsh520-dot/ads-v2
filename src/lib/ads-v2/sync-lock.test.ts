// ─────────────────────────────────────────────────────────────────────────
// THE SINGLE-FLIGHT LOCK (Brick 4).
//
// Two kinds of test here, and both are needed:
//
//   * The UNIT tests below run against a constructed database and pin the
//     BEHAVIOUR of claimSyncLock: what it does with each shape of reply, and
//     that it refuses to run when it cannot read a claim at all.
//
//   * The LIVE tests at the bottom run the real function against the real
//     database and pin the thing that actually matters: that two concurrent
//     callers produce exactly ONE winner. That cannot be proved with a fake,
//     because the atomicity being tested belongs to Postgres, not to us. A
//     mock would prove only that the mock is deterministic.
//
// The bug being fixed was exactly this shape: the old acquireLock() would have
// passed any reasonable unit test, because each individual step did what it
// said. It failed only under real concurrency.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { claimSyncLock } from "./sync";
import type { Db } from "./db";

/**
 * The LIVE tests claim their OWN lock row, never the production one.
 *
 * The first version of these tests used the real 'sync_lock' row, and an
 * assertion that failed before its release call left the production lock held.
 * Every later run then failed for the wrong reason, and worse, a real cron
 * arriving in that window would have stood down for fifteen minutes because of
 * a test. A test that can wedge production is a hazard whatever it proves.
 */
const TEST_LOCK = "sync_lock_test";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY);
const skip = LIVE ? false : "no database credentials, so the concurrency proof did NOT run";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

/** A database that returns one canned rpc reply. */
function fakeDb(reply: { data?: unknown; error?: { message: string } | null }): Db {
  return {
    rpc: async () => ({ data: reply.data ?? null, error: reply.error ?? null }),
  } as unknown as Db;
}

// ─────────────────────────────────────────────────────────────────────────
// UNIT: how each reply shape is read.
// ─────────────────────────────────────────────────────────────────────────

test("a winning claim is reported as claimed", async () => {
  const c = await claimSyncLock(fakeDb({ data: [{ claimed: true, took_over: false, previous_holder: null, previous_at: null }] }), "me");
  assert.equal(c.claimed, true);
  assert.equal(c.tookOver, false);
});

test("a losing claim names who is holding it, so the skip row can say", async () => {
  const c = await claimSyncLock(
    fakeDb({ data: [{ claimed: false, took_over: false, previous_holder: "sync-abc", previous_at: "2026-08-07T09:00:00Z" }] }),
    "me",
  );
  assert.equal(c.claimed, false);
  assert.equal(c.previousHolder, "sync-abc");
  assert.equal(c.previousAt, "2026-08-07T09:00:00Z");
});

test("a TTL takeover is reported as a takeover, not as an ordinary claim", async () => {
  const c = await claimSyncLock(
    fakeDb({ data: [{ claimed: true, took_over: true, previous_holder: "sync-dead", previous_at: "2026-08-07T08:00:00Z" }] }),
    "me",
  );
  assert.equal(c.claimed, true);
  assert.equal(c.tookOver, true, "a takeover means the last run never finished, and that is worth recording");
  assert.equal(c.previousHolder, "sync-dead");
});

test("a single object, not an array, is read the same way", async () => {
  // The Supabase client returns a bare object for some RPC shapes. Reading only
  // arrays would silently report every claim as lost, which would stop the sync
  // running at all rather than let two run at once. Safe, but broken.
  const c = await claimSyncLock(fakeDb({ data: { claimed: true, took_over: false } }), "me");
  assert.equal(c.claimed, true);
});

test("a claim that cannot be READ throws, so the sync refuses to run", async () => {
  // The safe failure is to NOT run. A missed sync costs an hour of freshness;
  // two syncs rebuilding the same window concurrently is the bug this exists
  // to stop. Treating an unreadable claim as a win would reintroduce it.
  await assert.rejects(
    () => claimSyncLock(fakeDb({ error: { message: "connection refused" } }), "me"),
    /could not claim the sync lock: connection refused/,
  );
});

test("an empty reply is treated as NOT claimed, never as claimed", async () => {
  const c = await claimSyncLock(fakeDb({ data: [] }), "me");
  assert.equal(c.claimed, false, "no answer is not a yes");
});

// ─────────────────────────────────────────────────────────────────────────
// LIVE: the proof that a fake cannot give.
// ─────────────────────────────────────────────────────────────────────────

/** Claim the TEST lock row directly, so production is never touched. */
async function claimTest(db: Db, holder: string, ttl = 900) {
  const { data, error } = await db.rpc("adsv2_claim_sync_lock", {
    p_holder: holder,
    p_ttl_seconds: ttl,
    p_lock_key: TEST_LOCK,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return row;
}

async function releaseTest(db: Db, holder: string) {
  const { data } = await db.rpc("adsv2_release_sync_lock", { p_holder: holder, p_lock_key: TEST_LOCK });
  return data;
}

/** Leave the test lock free, whatever the previous test did to it. */
async function freeTestLock(db: Db): Promise<void> {
  // A zero TTL claims it whatever state it is in, and the release then leaves
  // it cleanly free. This is why every LIVE test below starts from a known
  // state rather than from whatever the last failing assertion left behind.
  const reset = `reset-${Date.now()}`;
  await claimTest(db, reset, 0);
  await releaseTest(db, reset);
}

test("LIVE: two concurrent claims produce exactly ONE winner", { skip }, async () => {
  const db = liveDb();
  await freeTestLock(db);
  const stamp = Date.now();
  const holders = Array.from({ length: 6 }, (_, i) => `test-concurrent-${stamp}-${i}`);

  // Fired together, on purpose. This is the exact race the old read-then-write
  // lock lost every hour at :25, and it is the one thing a fake cannot prove:
  // the atomicity belongs to Postgres, not to us.
  const results = await Promise.all(holders.map((h) => claimTest(db, h)));
  const winners = results.filter((r) => r.claimed === true);
  assert.equal(winners.length, 1, `exactly one of ${holders.length} concurrent callers may claim, got ${winners.length}`);

  // And every loser can name the winner, so a skip row is never anonymous.
  const winner = holders[results.findIndex((r) => r.claimed === true)];
  for (const [i, r] of results.entries()) {
    if (r.claimed === true) continue;
    assert.equal(r.previous_holder, winner, `loser ${holders[i]} must name the real winner`);
  }

  await releaseTest(db, winner);
});

test("LIVE: a claim older than its TTL is taken over, and the takeover is recorded", { skip }, async () => {
  const db = liveDb();
  await freeTestLock(db);
  const stamp = Date.now();
  const dead = `test-dead-${stamp}`;
  const rescuer = `test-rescuer-${stamp}`;

  assert.equal((await claimTest(db, dead)).claimed, true);

  // A zero-second TTL stands in for a crashed run whose claim has aged out.
  // Without this path, one killed function would block the sync forever.
  const row = await claimTest(db, rescuer, 0);
  assert.equal(row.claimed, true, "an expired claim must be takeable");
  assert.equal(row.took_over, true, "and the takeover must SAY it was a takeover");
  assert.equal(row.previous_holder, dead);

  // The zombie must NOT be able to free the lock its rescuer now holds. This is
  // the classic way a lock fix reintroduces the bug, one release call later.
  assert.ok(!(await releaseTest(db, dead)), "a holder that lost the lock must not be able to release it");
  assert.equal(await releaseTest(db, rescuer), true, "the current holder releases normally");
});

test("LIVE: a cleanly released lock is claimable at once, with no TTL wait", { skip }, async () => {
  const db = liveDb();
  await freeTestLock(db);
  const stamp = Date.now();
  const a = `test-release-a-${stamp}`;
  const b = `test-release-b-${stamp}`;

  assert.equal((await claimTest(db, a)).claimed, true);
  assert.equal((await claimTest(db, b)).claimed, false, "b must lose while a holds");
  await releaseTest(db, a);

  const after = await claimTest(db, b);
  assert.equal(after.claimed, true, "a released lock is free immediately, not after the TTL");
  assert.equal(after.took_over, false, "claiming a released lock is ordinary, never a takeover");
  await releaseTest(db, b);
});

test("LIVE: the PRODUCTION lock row is left free by this whole test file", { skip }, async () => {
  // The guard on the guard. If a future edit points a LIVE test back at the
  // real row and leaves it held, this fails and says so, instead of the next
  // hourly cron quietly standing down for fifteen minutes.
  const db = liveDb();
  const { data, error } = await db.from("adsv2_meta").select("value").eq("key", "sync_lock").maybeSingle();
  assert.equal(error, null);
  const v = (data as { value?: Record<string, unknown> } | null)?.value ?? {};
  assert.ok(
    v.released_at != null || v.at == null,
    `the production sync lock must be left free by the tests, but it reads ${JSON.stringify(v)}`,
  );
});
