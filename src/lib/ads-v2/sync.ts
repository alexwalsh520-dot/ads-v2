// ─────────────────────────────────────────────────────────────────────────
// SYNC ORCHESTRATOR — the one background job the cron calls. In order:
//   1. Snapshot today's Meta budget settings.
//   2. Run the deterministic facts pass over the rolling window.
//   3. Bump the data version (invalidates cached snapshots).
//   4. Precompute the standard matrix so the page opens instantly.
//   5. Store durable copies of video creative.
//
// Each source runs isolated: budget failing never blocks facts, and facts is
// what the version bump depends on, so a facts failure leaves the last good
// snapshots served (stale, never corrupt). A lightweight lock prevents two runs
// from overlapping.
//
// Step 5 feeds nothing the tab reads, so it runs AFTER the numbers are already
// served, under its own wall-clock budget with its own try/catch. A slow Meta
// can therefore never delay, corrupt, or take down the spend sync.
// ─────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { runBudgetSnapshot } from "./budget-sync";
import { runFactsPass } from "./facts";
import { runMediaSync } from "./media-sync";
import { precomputeStandard } from "./precompute";
import { todayEt } from "./time";
import { bumpDataVersion, finishRun, startRun, type Db } from "./db";

// How long a claim stays valid without being released. A run that has been
// holding the lock longer than this is presumed dead and may be taken over,
// which is what stops one killed function from blocking the sync forever.
const LOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Run one optional sync step under its OWN wall-clock budget, and never let it
 * hurt anything else. A step that hangs is abandoned; a step that throws is
 * recorded. Either way the failure lands in adsv2_alerts and the sync carries
 * on to the next step.
 *
 * This exists because of a real outage: the content pipeline was a 12-step
 * chain with no per-step timeout, so one slow step blew the whole function's
 * limit and silently killed every later step for 9 days. No step added here
 * can ever do that to the spend sync.
 */
async function runIsolatedStep<T>(
  db: Db,
  name: string,
  budgetMs: number,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} exceeded its ${Math.round(budgetMs / 1000)}s budget`)),
          budgetMs,
        );
      }),
    ]);
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.from("adsv2_alerts").upsert(
        {
          et_day: todayEt(),
          alert_type: "sync_step_failed",
          client_key: null,
          severity: "error",
          dedupe_key: `sync_step|${name}|${todayEt()}`,
          detail: { step: name, error: message, ms: Date.now() - started } as object,
        },
        { onConflict: "dedupe_key" },
      );
    } catch {
      // Alerting must never itself break the sync.
    }
    return { ok: false, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SINGLE FLIGHT (Brick 4).
//
// The lock this replaced was a READ, then a WRITE: select the row, decide it
// was free, upsert it. Two runners arriving inside the same few milliseconds
// both read a free lock and both proceeded. It never prevented a double entry;
// it only made the window small enough to look like it had.
//
// The real evidence, from adsv2_sync_runs on 2026-07-31: twin budget rows 6ms
// apart every hour at :25, and the losing twin dying mid-facts on a duplicate
// key insert.
//
// The decision now happens inside ONE database statement, under a row lock
// (adsv2_claim_sync_lock, migration 081). There is no window between the read
// and the write because there is no separate read.
//
// The duplicate-key alarm on the facts inserts is deliberately left armed. It
// is a CORRECT alarm for concurrent execution, and silencing it with an upsert
// would hide the next concurrency bug behind a green run. This removes the
// cause and leaves the alarm.
// ─────────────────────────────────────────────────────────────────────────

export interface LockClaim {
  claimed: boolean;
  tookOver: boolean;
  previousHolder: string | null;
  previousAt: string | null;
}

/** Claim the sync, atomically. Exactly one concurrent caller gets claimed. */
export async function claimSyncLock(db: Db, holder: string): Promise<LockClaim> {
  const { data, error } = await db.rpc("adsv2_claim_sync_lock", {
    p_holder: holder,
    p_ttl_seconds: Math.round(LOCK_TTL_MS / 1000),
  });
  if (error) {
    // A claim that cannot be READ is not a claim. Refusing to run is the safe
    // failure: a missed sync costs one hour of freshness, while two concurrent
    // syncs rebuilding the same window is the bug this exists to stop.
    throw new Error(`could not claim the sync lock: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { claimed?: boolean; took_over?: boolean; previous_holder?: string | null; previous_at?: string | null }
    | undefined;
  return {
    claimed: Boolean(row?.claimed),
    tookOver: Boolean(row?.took_over),
    previousHolder: row?.previous_holder ?? null,
    previousAt: row?.previous_at ?? null,
  };
}

/**
 * Leave one row in the sync history saying what happened, and never let writing
 * it change the outcome.
 *
 * The loser's whole job is to stand down cheaply. If its bookkeeping write
 * threw, the twin would come back as a 500 instead of a clean skip, and the
 * cron would look broken on exactly the runs where the lock was working
 * perfectly. Same law as the door's two logs: losing a log line is a cost worth
 * paying; losing the correct outcome to save a log line is not.
 */
async function note(db: Db, source: string, detail: Record<string, unknown>): Promise<void> {
  try {
    const id = await startRun(db, source);
    await finishRun(db, id, { status: "ok", durationMs: 0, detail });
  } catch {
    // Deliberately silent.
  }
}

/** Release, holder-scoped. A runner that lost its lock to a TTL takeover must
 *  never free the lock the new runner is holding. */
async function releaseSyncLock(db: Db, holder: string): Promise<void> {
  try {
    await db.rpc("adsv2_release_sync_lock", { p_holder: holder });
  } catch {
    // A release that fails is survivable: the TTL takes the lock back. Letting
    // this throw out of a finally block would replace the sync's real result,
    // including its real error, with a bookkeeping failure.
  }
}

export interface SyncResult {
  ran: boolean;
  /** Brick 4. True when another runner already held the lock and this one
   *  stood down before fetching or writing anything at all. */
  skipped?: boolean;
  reason?: string;
  budget?: unknown;
  budgetError?: string;
  facts?: unknown;
  factsError?: string;
  version?: number;
  precompute?: unknown;
  media?: unknown;
  mediaError?: string;
}

export async function runAdsV2Sync(
  now: Date = new Date(),
  opts: { factsOnly?: boolean } = {},
): Promise<SyncResult> {
  const db = getServiceSupabase();

  // A holder id per invocation, so the release can be holder-scoped and a
  // takeover names who it took over from. Never reused across runs.
  const holder = `sync-${randomUUID()}`;
  const claim = await claimSyncLock(db, holder);
  if (!claim.claimed) {
    // The loser stands down BEFORE any fetch and before any write, and leaves
    // one row behind saying so. A twin that vanishes silently is a twin nobody
    // can prove stopped happening, and proving it is the point.
    const reason = `a sync is already running (holder ${claim.previousHolder ?? "unknown"}, claimed at ${claim.previousAt ?? "an unknown time"}). This runner stopped before fetching or writing anything.`;
    await note(db, "skipped", { reason, holder, held_by: claim.previousHolder, held_since: claim.previousAt });
    return { ran: false, skipped: true, reason };
  }
  if (claim.tookOver) {
    // A takeover means the previous run never released, which means it died.
    // It is recorded rather than passed over: a sync that has to be recovered
    // from is a fact about the system, not an implementation detail.
    await note(db, "lock_takeover", {
      reason: `the previous sync (holder ${claim.previousHolder}) never released its lock and its claim had aged past the ${Math.round(LOCK_TTL_MS / 60000)} minute limit, so this run took it over. The previous run did not finish.`,
      took_over_from: claim.previousHolder,
      took_over_at: claim.previousAt,
    });
  }

  const result: SyncResult = { ran: true };
  try {
    // Dry-run mode: rebuild the facts, but do NOT bump the version or
    // precompute. The tab keeps serving the snapshots it already has, so the
    // new facts can be compared against the old numbers before anything the
    // owner looks at is allowed to change.
    if (opts.factsOnly) {
      result.facts = await runFactsPass(now);
      return result;
    }

    // 1. Budget (isolated).
    try {
      result.budget = await runBudgetSnapshot(now);
    } catch (err) {
      result.budgetError = err instanceof Error ? err.message : String(err);
    }

    // 2. Facts (the source the version bump depends on).
    try {
      result.facts = await runFactsPass(now);
    } catch (err) {
      result.factsError = err instanceof Error ? err.message : String(err);
      // Do NOT bump the version or precompute on a facts failure — keep serving
      // the last good snapshots rather than half-built ones.
      return result;
    }

    // 3. Invalidate caches.
    result.version = await bumpDataVersion(db);

    // 4. Warm the standard matrix.
    result.precompute = await precomputeStandard(now);

    // 5. Video media (isolated + budgeted). Downloads active video ads' durable
    //    thumbnail + video file into our storage. Best-effort: a failure here
    //    never affects the numbers already served, and it resumes next run.
    //    It budgets itself between files, but one hung download would sail past
    //    that, so the whole step also runs under an outer wall clock.
    const media = await runIsolatedStep(db, "media_sync", 120_000, () => runMediaSync(now));
    if (media.ok) result.media = media.value;
    else result.mediaError = media.error;

    return result;
  } finally {
    await releaseSyncLock(db, holder);
  }
}
