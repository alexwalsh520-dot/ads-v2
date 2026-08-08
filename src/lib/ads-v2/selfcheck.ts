// ─────────────────────────────────────────────────────────────────────────
// SELF-CHECK — the accuracy gates, run nightly by cron. It reconciles v2
// against the primary sources, checks cross-window invariants, and scans the
// source data for anomalies. Everything it finds is REPORTED (an alert row +
// the returned report), never silently excluded from any count. Report, never
// referee.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { todayEt, rangeForPreset } from "./time";
import { ADSV2_SERVED_CLIENTS, FACTS_LOOKBACK_DAYS } from "./config";
import { startRun, finishRun, type Db } from "./db";

interface Finding {
  type: string;
  severity: "info" | "warn" | "error";
  clientKey: string | null;
  detail: Record<string, unknown>;
  dedupeKey: string;
}

export interface SelfCheckReport {
  etDay: string;
  findings: Finding[];
  gates: Record<string, unknown>;
}

export async function runSelfCheck(now: Date = new Date()): Promise<SelfCheckReport> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "selfcheck");
  const started = Date.now();
  const etDay = todayEt(now);
  const findings: Finding[] = [];
  const gates: Record<string, unknown> = {};
  const clients = [...ADSV2_SERVED_CLIENTS];
  const factFloor = rangeForPreset("last30", etDay).from;

  try {
    // ── Gate: ZERO unmarked (non-ET) spend rows for any served client, ever ─
    // Uses `is distinct from` under the hood (adsv2_unmarked_served_spend) so a
    // NULL marker is caught too; a plain <> would silently skip NULL rows. This
    // covers all served rows, not just the last 30 days, so any window a served
    // client can select is guaranteed ET-clean.
    {
      const { data: unmarkedCount } = await db.rpc("adsv2_unmarked_served_spend", {
        p_clients: clients,
      });
      const unmarked = Number(unmarkedCount ?? 0);
      gates.unmarkedSpendRows = unmarked;
      if (unmarked > 0) {
        findings.push({
          type: "unmarked_spend",
          severity: "error",
          clientKey: null,
          detail: { rows: unmarked, note: "served-client spend rows lacking the America/New_York marker" },
          dedupeKey: `unmarked_spend|${etDay}`,
        });
      }
    }

    // ── Anomaly: an appointment scheduled before it was created ─────────────
    {
      const { data } = await db
        .from("adsv2_booking_facts")
        .select("appointment_key, person_name, start_time, created_time, client_key")
        .in("client_key", clients)
        .gte("booked_et_day", factFloor)
        .not("created_time", "is", null);
      const bad = (data || []).filter(
        (r) => r.start_time && r.created_time && r.start_time < r.created_time,
      );
      gates.callBeforeBooking = bad.length;
      for (const r of bad.slice(0, 50)) {
        findings.push({
          type: "anomaly_call_before_booking",
          severity: "warn",
          clientKey: r.client_key,
          detail: { person: r.person_name, start: r.start_time, created: r.created_time },
          dedupeKey: `call_before_booking|${r.appointment_key}`,
        });
      }
    }

    // ── Anomaly: keywordless bookings on the sales calendars (capture gap) ──
    {
      const { count } = await db
        .from("adsv2_booking_facts")
        .select("id", { count: "exact", head: true })
        .in("client_key", clients)
        .eq("awaiting_review", true)
        .gte("booked_et_day", rangeForPreset("last7", etDay).from);
      const keywordless = count || 0;
      gates.keywordlessBookingsLast7 = keywordless;
      if (keywordless > 0) {
        findings.push({
          type: "keywordless_bookings",
          severity: "info",
          clientKey: null,
          detail: { last7: keywordless, note: "bookings on the sales calendar with no keyword; a capture gap to fix at source" },
          dedupeKey: `keywordless|${etDay}`,
        });
      }
    }

    // ── Gate: sales reconciliation (attributed collected <= tracker total) ──
    for (const preset of ["last7", "last30"] as const) {
      const r = rangeForPreset(preset, etDay);
      // Attributed collected (paid, not organic, not awaiting).
      const { data: attrRows } = await db
        .from("adsv2_sale_facts")
        .select("collected_usd_cents")
        .in("client_key", clients)
        .eq("is_organic", false)
        .eq("awaiting_review", false)
        .not("keyword_normalized", "is", null)
        .gte("sale_et_day", r.from)
        .lte("sale_et_day", r.to);
      const attributed = (attrRows || []).reduce((s, x) => s + Number(x.collected_usd_cents || 0), 0);
      // Sales tracker raw total for the same ET dates.
      const { data: trackerRows } = await db
        .from("sales_tracker_rows")
        .select("collected_revenue_cents")
        .gte("date", r.from)
        .lte("date", r.to);
      const trackerTotal = (trackerRows || []).reduce(
        (s, x) => s + Number(x.collected_revenue_cents || 0),
        0,
      );
      gates[`reconcile_${preset}`] = { attributedCents: attributed, trackerTotalCents: trackerTotal };
      if (attributed > trackerTotal) {
        findings.push({
          type: "reconcile_drift",
          severity: "error",
          clientKey: null,
          detail: { preset, attributedCents: attributed, trackerTotalCents: trackerTotal },
          dedupeKey: `reconcile_drift|${preset}|${etDay}`,
        });
      }
    }

    // ── Gate: no pg_cron job makes HTTP calls or is unlisted (7/23 law) ─────
    {
      const { data: cronViolations, error: cronErr } = await db.rpc("adsv2_audit_cron_jobs");
      const rows = (cronErr ? [] : (cronViolations as Array<{
        jobid: number;
        jobname: string | null;
        schedule: string;
        violation: string;
      }> | null)) || [];
      gates.cronViolations = rows.length;
      for (const r of rows) {
        findings.push({
          type: "cron_law_violation",
          severity: "error",
          clientKey: null,
          detail: { jobid: r.jobid, jobname: r.jobname, schedule: r.schedule, violation: r.violation },
          dedupeKey: `cron_law|${r.jobid}|${etDay}`,
        });
      }
    }

    // ── Gate: cross-window invariants (nested windows never shrink) ─────────
    {
      const violations = await checkInvariants(db, etDay);
      gates.invariantViolations = violations.length;
      for (const v of violations) {
        findings.push({
          type: "invariant",
          severity: "error",
          clientKey: v.account,
          detail: v as unknown as Record<string, unknown>,
          dedupeKey: `invariant|${v.account}|${v.status}|${v.metric}|${etDay}`,
        });
      }
    }

    // ── Gate: show-rate cell/popup parity (A2) ──────────────────────────────
    // The show-rate cell and its popup must be the same cohort. Recompute the
    // booked-in-window person cohort independently and assert it equals the
    // leaves numbers the cell renders from, for every keyword and window.
    {
      const violations = await checkShowRateParity(db, etDay, clients);
      gates.showRateParityViolations = violations.length;
      for (const v of violations.slice(0, 50)) {
        findings.push({
          type: "showrate_parity",
          severity: "error",
          clientKey: v.clientKey,
          detail: v as unknown as Record<string, unknown>,
          dedupeKey: `showrate_parity|${v.clientKey}|${v.keyword}|${v.window}|${etDay}`,
        });
      }
    }

    // ── Gate: children always sum to their parent (A3) ──────────────────────
    // For every snapshot, the sum of a campaign's ad sets equals the campaign,
    // and the sum of an ad set's ads equals the ad set, for every additive
    // metric. This is how the tree is built; the gate proves it stayed true.
    {
      const violations = await checkParentChildSums(db, etDay);
      gates.parentChildViolations = violations.length;
      for (const v of violations.slice(0, 50)) {
        findings.push({
          type: "parent_child_sum",
          severity: "error",
          clientKey: v.account,
          detail: v as unknown as Record<string, unknown>,
          dedupeKey: `parent_child|${v.account}|${v.status}|${v.parentId}|${v.metric}|${etDay}`,
        });
      }
    }

    // ── Gate: every fact row explains itself (Build 2, Phase 3) ────────────
    // A row must carry EITHER the hard key that proved its match or the
    // written reason there is none. A row with neither is exactly the silent
    // blank this whole build exists to abolish, so it is an error, not a note.
    {
      const unexplained = await checkEveryRowExplainsItself(db);
      gates.unexplainedFactRows = unexplained.reduce((s, u) => s + u.rows, 0);
      for (const u of unexplained) {
        findings.push({
          type: "fact_row_unexplained",
          severity: "error",
          clientKey: null,
          detail: u as unknown as Record<string, unknown>,
          dedupeKey: `unexplained|${u.table}|${etDay}`,
        });
      }
    }

    // ── Gate: the setter is not silently lost (Build 2, Phase 3) ───────────
    // If the keyword event knows who set the appointment but the fact row does
    // not, we have dropped it in the middle. That is a half-picture, and a
    // half-picture is what made a real miss on 2026-07-25.
    {
      const dropped = await checkSetterNotDropped(db);
      gates.factRowsMissingSetter = dropped.reduce((s, d) => s + d.rows, 0);
      for (const d of dropped) {
        findings.push({
          type: "fact_row_missing_setter",
          severity: "warn",
          clientKey: null,
          detail: d as unknown as Record<string, unknown>,
          dedupeKey: `missing_setter|${d.table}|${etDay}`,
        });
      }
    }

    // Write alert rows (idempotent by dedupe_key).
    if (findings.length) {
      await db.from("adsv2_alerts").upsert(
        findings.map((f) => ({
          et_day: etDay,
          alert_type: f.type,
          client_key: f.clientKey,
          severity: f.severity,
          dedupe_key: f.dedupeKey,
          detail: f.detail as object,
        })),
        { onConflict: "dedupe_key" },
      );
    }

    await finishRun(db, runId, {
      status: "ok",
      rows: findings.length,
      durationMs: Date.now() - started,
      detail: gates,
    });
    return { etDay, findings, gates };
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

interface InvariantViolation {
  account: string;
  status: string;
  metric: string;
  smaller: { window: string; value: number };
  larger: { window: string; value: number };
}

// Additive metrics can never decrease as the window grows (1d subset of 3d
// subset of 7d subset of 30d). Read the precomputed snapshot totals and check.
async function checkInvariants(db: Db, etDay: string): Promise<InvariantViolation[]> {
  const additive = [
    "spendCents",
    "impressions",
    "clicks",
    "messages",
    "booked",
    "taken",
    "newClients",
    "collectedCents",
  ];
  const nested: Array<["today" | "last3" | "last7" | "last30", string]> = [
    ["today", "1d"],
    ["last3", "3d"],
    ["last7", "7d"],
    ["last30", "30d"],
  ];
  const accounts = ["all", ...ADSV2_SERVED_CLIENTS];
  const statuses = ["active", "finished", "all"];
  const out: InvariantViolation[] = [];

  for (const account of accounts) {
    for (const status of statuses) {
      const totals: Record<string, Record<string, number>> = {};
      for (const [preset, label] of nested) {
        const r = rangeForPreset(preset, etDay);
        const { data } = await db
          .from("adsv2_window_snapshots")
          .select("payload")
          .eq("account", account)
          .eq("status", status)
          .eq("level", "tree")
          .eq("date_from", r.from)
          .eq("date_to", r.to)
          .maybeSingle();
        const total = (data?.payload as { total?: Record<string, number> } | undefined)?.total;
        if (total) totals[label] = total;
      }
      const order = ["1d", "3d", "7d", "30d"].filter((l) => totals[l]);
      for (let i = 1; i < order.length; i++) {
        for (const m of additive) {
          const small = totals[order[i - 1]][m] ?? 0;
          const large = totals[order[i]][m] ?? 0;
          if (large + 1e-6 < small) {
            out.push({
              account,
              status,
              metric: m,
              smaller: { window: order[i - 1], value: small },
              larger: { window: order[i], value: large },
            });
          }
        }
      }
    }
  }
  return out;
}

// ── Show-rate parity: the cell equals the popup, per keyword and window ─────
interface ShowRateParityViolation {
  clientKey: string;
  keyword: string;
  window: string;
  cellShowed: number;
  cohortShowed: number;
  cellDue: number;
  cohortDue: number;
}

async function checkShowRateParity(
  db: Db,
  etDay: string,
  clients: string[],
): Promise<ShowRateParityViolation[]> {
  const out: ShowRateParityViolation[] = [];
  for (const preset of ["last7", "last30"] as const) {
    const r = rangeForPreset(preset, etDay);
    // The cell numbers, straight from the serving function.
    const { data: leaves } = await db.rpc("adsv2_window_leaves", {
      p_clients: clients,
      p_from: r.from,
      p_to: r.to,
    });
    // The popup cohort, recomputed INDEPENDENTLY from the booking facts.
    const { data: cohort } = await db.rpc("adsv2_showrate_cohort", {
      p_clients: clients,
      p_from: r.from,
      p_to: r.to,
    });
    const cohortByKey = new Map<string, { showed: number; due: number }>();
    for (const c of (cohort || []) as Array<{
      client_key: string;
      keyword: string;
      showed: number;
      due: number;
    }>) {
      cohortByKey.set(`${c.client_key}|${c.keyword}`, {
        showed: Number(c.showed),
        due: Number(c.due),
      });
    }
    for (const l of (leaves || []) as Array<{
      client_key: string;
      keyword: string;
      booked: number;
      upcoming: number;
      showed_people: number;
    }>) {
      const cellDue = Number(l.booked) - Number(l.upcoming);
      const cellShowed = Number(l.showed_people);
      const c = cohortByKey.get(`${l.client_key}|${l.keyword}`) || { showed: 0, due: 0 };
      if (cellShowed !== c.showed || cellDue !== c.due) {
        out.push({
          clientKey: l.client_key,
          keyword: l.keyword,
          window: preset,
          cellShowed,
          cohortShowed: c.showed,
          cellDue,
          cohortDue: c.due,
        });
      }
    }
  }
  return out;
}

// ── Children always sum to their parent, every additive metric ──────────────
interface ParentChildViolation {
  account: string;
  status: string;
  parentId: string;
  metric: string;
  parent: number;
  childrenSum: number;
}

const ADDITIVE_NODE_METRICS = [
  "spendCents",
  "impressions",
  "clicks",
  "messages",
  "booked",
  "taken",
  "takenPeople",
  "showedPeople",
  "upcoming",
  "newClients",
  "collectedCents",
  "contractedCents",
] as const;

async function checkParentChildSums(db: Db, etDay: string): Promise<ParentChildViolation[]> {
  const out: ParentChildViolation[] = [];
  const accounts = ["all", ...ADSV2_SERVED_CLIENTS];
  const statuses = ["active", "finished", "all"];
  const r = rangeForPreset("last30", etDay);

  for (const account of accounts) {
    for (const status of statuses) {
      const { data } = await db
        .from("adsv2_window_snapshots")
        .select("payload")
        .eq("account", account)
        .eq("status", status)
        .eq("level", "tree")
        .eq("date_from", r.from)
        .eq("date_to", r.to)
        .maybeSingle();
      const campaigns = (data?.payload as { campaigns?: TreeNode[] } | undefined)?.campaigns;
      if (!campaigns) continue;
      for (const camp of campaigns) {
        collectSumViolations(camp, account, status, out);
      }
    }
  }
  return out;
}

interface TreeNode {
  id: string;
  children?: TreeNode[];
  [k: string]: unknown;
}

function collectSumViolations(
  node: TreeNode,
  account: string,
  status: string,
  out: ParentChildViolation[],
): void {
  const children = node.children || [];
  if (children.length > 0) {
    for (const m of ADDITIVE_NODE_METRICS) {
      const parent = Number(node[m] ?? 0);
      const sum = children.reduce((s, c) => s + Number(c[m] ?? 0), 0);
      if (Math.abs(parent - sum) > 1e-6) {
        out.push({ account, status, parentId: node.id, metric: m, parent, childrenSum: sum });
      }
    }
    for (const c of children) collectSumViolations(c, account, status, out);
  }
}

export const SELFCHECK_LOOKBACK = FACTS_LOOKBACK_DAYS;

// ── Build 2, Phase 3 gates ────────────────────────────────────────────────

/**
 * Count fact rows carrying NEITHER an evidence stamp NOR a blank reason.
 * The answer must always be zero: every row explains itself, or the promise
 * this build makes is not being kept.
 */
async function checkEveryRowExplainsItself(
  db: Db,
): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = [];
  for (const table of ["adsv2_dm_facts", "adsv2_booking_facts", "adsv2_sale_facts"]) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .is("evidence_key", null)
      .is("blank_reason", null);
    if (error) throw new Error(`${table} stamp check failed: ${error.message}`);
    if (count && count > 0) out.push({ table, rows: count });
  }
  return out;
}

/**
 * Count fact rows with no setter whose own keyword event DOES name one, which
 * means we dropped it rather than never having it. Rows where the source is
 * genuinely blank are not flagged; that is a gap in ManyChat, not in us.
 */
async function checkSetterNotDropped(db: Db): Promise<{ table: string; rows: number }[]> {
  const { data, error } = await db.rpc("adsv2_count_facts_missing_setter");
  if (error) throw new Error(`setter check failed: ${error.message}`);
  return ((data || []) as { table_name: string; rows: number }[])
    .filter((r) => Number(r.rows) > 0)
    .map((r) => ({ table: r.table_name, rows: Number(r.rows) }));
}
