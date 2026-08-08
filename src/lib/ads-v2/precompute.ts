// ─────────────────────────────────────────────────────────────────────────
// PRECOMPUTE — after a sync, warm the standard matrix (accounts x presets x
// statuses) so the page opens instantly. Custom windows are built on demand by
// serve.ts. Level is a view concern, so it is not part of the matrix.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { PRESETS, rangeForPreset, todayEt, type PresetId } from "./time";
import { ADSV2_SERVED_CLIENTS } from "./config";
import { computeAndStore } from "./serve";
import { getDataVersion, startRun, finishRun } from "./db";
import type { AdsV2Account, AdsV2Status } from "./types";

// Every configured creator, plus the roll-up. Naming creators here would
// silently warm nothing for anyone else, and a creator with no precomputed
// snapshot shows an endless "preparing" panel rather than an error.
const ACCOUNTS: AdsV2Account[] = ["all", ...ADSV2_SERVED_CLIENTS];
const STATUSES: AdsV2Status[] = ["active", "finished", "all"];
const MATRIX_PRESETS: PresetId[] = PRESETS.map((p) => p.id).filter(
  (id) => id !== "custom",
) as PresetId[];

// Stop warming after this long so the cron can never approach its limit; any
// windows not warmed are built on demand (a couple of seconds) and then cached.
const PRECOMPUTE_BUDGET_MS = 180_000;

export async function precomputeStandard(now: Date = new Date()): Promise<{ windows: number; skipped: number }> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "precompute");
  const started = Date.now();
  const anchor = todayEt(now);
  const version = await getDataVersion(db);
  let count = 0;
  let skipped = 0;
  try {
    // Most-recent presets first so the windows users hit most are warm even if
    // the budget runs out. active status first for the same reason.
    for (const presetId of MATRIX_PRESETS) {
      const range = rangeForPreset(presetId, anchor);
      for (const account of ACCOUNTS) {
        for (const status of STATUSES) {
          if (Date.now() - started > PRECOMPUTE_BUDGET_MS) {
            skipped++;
            continue;
          }
          await computeAndStore(
            db,
            { account, status, level: "campaign", dateFrom: range.from, dateTo: range.to },
            version,
          );
          count++;
        }
      }
    }
    await finishRun(db, runId, {
      status: "ok",
      rows: count,
      durationMs: Date.now() - started,
      detail: { warmed: count, skipped },
    });
    return { windows: count, skipped };
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      rows: count,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
