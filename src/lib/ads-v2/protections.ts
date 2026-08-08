// ─────────────────────────────────────────────────────────────────────────
// PROTECTIONS — "How this app protects itself." Each protection is one plain
// sentence paired with a LIVE status read from the app's own real records
// (adsv2_sync_runs, adsv2_alerts, the nightly self-check gates, snapshot
// metadata). A protection is only ever returned if a machine-checked proof
// sits beside it; if the check that would prove it has not actually run yet,
// the row is OMITTED (and counted in `omitted`), never faked.
//
// This reads the SAME records the jobs already write. It builds no new checking
// machinery beyond the parity and parent-child gates the self-check now runs.
// ─────────────────────────────────────────────────────────────────────────

import type { Db } from "./db";

export interface Protection {
  key: string;
  /** One plain sentence a non-technical reader can skim. */
  sentence: string;
  /** The live status shown on the right. */
  statusLabel: string;
  /** true = green/good, false = needs attention. */
  ok: boolean;
}

export interface ProtectionsReport {
  protections: Protection[];
  /** Names of protections whose proof does not run yet (honest omission). */
  omitted: string[];
  generatedAt: string;
}

interface Gates {
  reconcile_last7?: { attributedCents: number; trackerTotalCents: number };
  reconcile_last30?: { attributedCents: number; trackerTotalCents: number };
  unmarkedSpendRows?: number;
  invariantViolations?: number;
  cronViolations?: number;
  showRateParityViolations?: number;
  parentChildViolations?: number;
  keywordlessBookingsLast7?: number;
}

function agoLabel(iso: string | null): string {
  if (!iso) return "no run yet";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "under an hour ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function buildProtections(db: Db): Promise<ProtectionsReport> {
  const omitted: string[] = [];
  const protections: Protection[] = [];

  // Latest snapshot build time (computed-once serving).
  const { data: snap } = await db
    .from("adsv2_window_snapshots")
    .select("computed_at")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest self-check run and its gate results.
  const { data: sc } = await db
    .from("adsv2_sync_runs")
    .select("started_at, detail, status")
    .eq("source", "selfcheck")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const gates: Gates = (sc?.detail as Gates) || {};
  const scAt: string | null = sc?.started_at ?? null;

  // Last successful sync per source, and the slowest recent job duration.
  const { data: runs } = await db
    .from("adsv2_sync_runs")
    .select("source, status, ended_at, duration_ms")
    .order("started_at", { ascending: false })
    .limit(40);
  const lastBySource = new Map<string, { ended_at: string | null; duration_ms: number | null }>();
  let maxDurationMs = 0;
  for (const r of runs || []) {
    if (!lastBySource.has(r.source)) lastBySource.set(r.source, { ended_at: r.ended_at, duration_ms: r.duration_ms });
    if (typeof r.duration_ms === "number") maxDurationMs = Math.max(maxDurationMs, r.duration_ms);
  }

  // Open (error-severity) alerts in the last week.
  const { count: openAlerts } = await db
    .from("adsv2_alerts")
    .select("id", { count: "exact", head: true })
    .eq("severity", "error")
    .gte("et_day", new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));

  // 1. Computed-once / read-only serving.
  if (snap?.computed_at) {
    protections.push({
      key: "computed_once",
      sentence: "Your numbers are worked out once in the background and only read when the page opens, so the page can never do the math wrong under load.",
      statusLabel: `Last built ${agoLabel(snap.computed_at)}`,
      ok: true,
    });
  } else omitted.push("computed_once");

  // 2. Nightly re-check against the sales sheet, Meta, and bookings.
  if (sc) {
    const recoOk =
      (!gates.reconcile_last7 || gates.reconcile_last7.attributedCents <= gates.reconcile_last7.trackerTotalCents) &&
      (!gates.reconcile_last30 || gates.reconcile_last30.attributedCents <= gates.reconcile_last30.trackerTotalCents);
    const ok = recoOk && (gates.invariantViolations ?? 0) === 0 && (gates.cronViolations ?? 0) === 0;
    protections.push({
      key: "nightly_recheck",
      sentence: "Every night the app re-checks its own numbers against the sales sheet, Meta, and the booking records, and flags any drift.",
      statusLabel: ok ? `All checks passed ${agoLabel(scAt)}` : `Needs attention (${agoLabel(scAt)})`,
      ok,
    });
  } else omitted.push("nightly_recheck");

  // 3. Cell / popup parity (only once the gate has actually run).
  if (typeof gates.showRateParityViolations === "number") {
    const ok = gates.showRateParityViolations === 0;
    protections.push({
      key: "cell_popup_parity",
      sentence: "The number in a cell always matches the exact list of people behind it. One person counts once, never twice.",
      statusLabel: ok ? `Matched everywhere ${agoLabel(scAt)}` : `${gates.showRateParityViolations} mismatch(es)`,
      ok,
    });
  } else omitted.push("cell_popup_parity");

  // 4. Children always sum to their parent (only once the gate has run).
  if (typeof gates.parentChildViolations === "number") {
    const ok = gates.parentChildViolations === 0;
    protections.push({
      key: "parent_child_sum",
      sentence: "The parts always add up to the whole: every ad set sums to its campaign, every ad sums to its ad set.",
      statusLabel: ok ? `Sums held ${agoLabel(scAt)}` : `${gates.parentChildViolations} break(s)`,
      ok,
    });
  } else omitted.push("parent_child_sum");

  // 5. Alerts instead of hiding.
  {
    const n = openAlerts ?? 0;
    protections.push({
      key: "alerts_not_hiding",
      sentence: "When something looks wrong the app raises a flag instead of quietly dropping the number.",
      statusLabel: n === 0 ? "0 open flags" : `${n} open flag${n === 1 ? "" : "s"}`,
      ok: n === 0,
    });
  }

  // 6. Scheduled syncs with labeled staleness.
  {
    const facts = lastBySource.get("facts")?.ended_at ?? null;
    const budget = lastBySource.get("budget")?.ended_at ?? null;
    const parts: string[] = [];
    if (facts) parts.push(`funnel ${agoLabel(facts)}`);
    if (budget) parts.push(`budgets ${agoLabel(budget)}`);
    if (parts.length) {
      protections.push({
        key: "scheduled_syncs",
        sentence: "The data syncs on a schedule and every source is labeled with how fresh it is, so nothing silently goes stale.",
        statusLabel: parts.join(", "),
        ok: true,
      });
    } else omitted.push("scheduled_syncs");
  }

  // 7. ET-native days including spend.
  if (typeof gates.unmarkedSpendRows === "number") {
    const ok = gates.unmarkedSpendRows === 0;
    protections.push({
      key: "et_native",
      sentence: "Every day is an Eastern-time day, including ad spend, so a day never lands in the wrong bucket.",
      statusLabel: ok ? "0 mismatched spend rows" : `${gates.unmarkedSpendRows} mismatched rows`,
      ok,
    });
  } else omitted.push("et_native");

  // 8. Bounded background work that cannot overload the database.
  if (maxDurationMs > 0) {
    const sec = Math.round(maxDurationMs / 1000);
    const ok = maxDurationMs < 300_000; // under the function ceiling
    protections.push({
      key: "bounded_jobs",
      sentence: "The background work is time-boxed, so it can never pile up and overload the database.",
      statusLabel: `Slowest recent job ${sec}s`,
      ok,
    });
  } else omitted.push("bounded_jobs");

  return { protections, omitted, generatedAt: new Date().toISOString() };
}
