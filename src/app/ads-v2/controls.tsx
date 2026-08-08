"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRESETS,
  rangeForPreset,
  rangeLabel,
  todayEt,
  type DayRange,
  type PresetId,
} from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Status } from "@/lib/ads-v2/types";
import { IcCal, IcCaret, IcCheck } from "./icons";
import { useCreators } from "./creators-context";

// ── Account dropdown, built from the configured creators ──────────────────

export function AccountDropdown({
  value,
  onChange,
}: {
  value: AdsV2Account;
  onChange: (v: AdsV2Account) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const creators = useCreators();
  const ACCOUNT_OPTIONS: { id: AdsV2Account; label: string }[] = [
    { id: "all", label: "All accounts" },
    ...creators.map((c) => ({ id: c.key as AdsV2Account, label: c.name })),
  ];
  const current = ACCOUNT_OPTIONS.find((o) => o.id === value)?.label || "All accounts";
  return (
    <div className="filter" ref={ref}>
      <button className={`filter-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="lbl">Account</span>
        <span className="val">{current}</span>
        <span className="caret">
          <IcCaret />
        </span>
      </button>
      {open && (
        <div className="pop">
          {ACCOUNT_OPTIONS.map((o) => (
            <div
              key={o.id}
              className={`pop-item${o.id === value ? " selected" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              <span className="check">
                <IcCheck />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Active / Finished / All segmented ─────────────────────────────────────
const STATUS_OPTIONS: { id: AdsV2Status; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "finished", label: "Finished" },
  { id: "all", label: "All" },
];

export function StatusSegmented({
  value,
  onChange,
}: {
  value: AdsV2Status;
  onChange: (v: AdsV2Status) => void;
}) {
  return (
    <div className="segmented">
      {STATUS_OPTIONS.map((o) => (
        <button
          key={o.id}
          className={`seg${o.id === value ? " active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Date dropdown with preset list + two-click calendar ───────────────────
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export function DateDropdown({
  preset,
  range,
  onApply,
}: {
  preset: PresetId;
  range: DayRange;
  onApply: (preset: PresetId, range: DayRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));

  const [draftPreset, setDraftPreset] = useState<PresetId>(preset);
  const [draft, setDraft] = useState<DayRange>(range);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [calMonth, setCalMonth] = useState(() => range.to.slice(0, 7));

  // Opening the picker discards any half-finished selection and starts again
  // from what is currently applied. Deliberate: a date picker that reopens
  // showing a range you abandoned last time is how people apply the wrong one.
  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setDraftPreset(preset);
      setDraft(range);
      setSelectingEnd(false);
      setCalMonth(range.to.slice(0, 7));
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, preset, range]);

  const presetLabel = PRESETS.find((p) => p.id === preset)?.label || "Custom";

  const pickPreset = (id: PresetId) => {
    if (id === "custom") {
      setDraftPreset("custom");
      setSelectingEnd(false);
      return;
    }
    const r = rangeForPreset(id, todayEt());
    onApply(id, r);
    setOpen(false);
  };

  const pickDay = (day: string) => {
    setDraftPreset("custom");
    if (!selectingEnd) {
      setDraft({ from: day, to: day });
      setSelectingEnd(true);
    } else {
      const from = day < draft.from ? day : draft.from;
      const to = day < draft.from ? draft.from : day;
      setDraft({ from, to });
      setSelectingEnd(false);
    }
  };

  const cells = buildMonth(calMonth, draft, todayEt());
  const dayCount = daysBetween(draft.from, draft.to);

  return (
    <div className="filter" ref={ref}>
      <button className={`filter-btn${open ? " open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span style={{ color: "var(--text-3)", display: "inline-flex" }}>
          <IcCal />
        </span>
        <span className="val">{presetLabel}</span>
        <span className="dim" style={{ fontSize: 11 }}>
          {" "}
          &middot; {rangeLabel(range)}
        </span>
        <span className="caret">
          <IcCaret />
        </span>
      </button>
      {open && (
        <div className="pop date-pop">
          <div className="date-presets">
            {PRESETS.map((p) => (
              <div
                key={p.id}
                className={`pop-item${draftPreset === p.id ? " selected" : ""}`}
                onClick={() => pickPreset(p.id)}
              >
                <span>{p.label}</span>
                <span className="check">
                  <IcCheck />
                </span>
              </div>
            ))}
          </div>
          <div className="date-cal">
            <div className="cal-head">
              <button className="cal-nav" onClick={() => setCalMonth(shiftMonth(calMonth, -1))}>
                &lsaquo;
              </button>
              <span>{monthLabel(calMonth)}</span>
              <button className="cal-nav" onClick={() => setCalMonth(shiftMonth(calMonth, 1))}>
                &rsaquo;
              </button>
            </div>
            <div className="cal-grid">
              {DOW.map((d, i) => (
                <div className="cal-dow" key={`h${i}`}>
                  {d}
                </div>
              ))}
              {cells.map((c, i) =>
                c.blank ? (
                  <div className={`cal-day muted${c.trail ? " trail" : ""}`} key={i} />
                ) : (
                  <button
                    key={i}
                    className={`cal-day${c.endpoint ? " endpoint" : c.inRange ? " in-range" : ""}${c.today ? " today" : ""}`}
                    onClick={() => pickDay(c.iso)}
                  >
                    {c.day}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="date-foot">
            <span className="mono" style={{ fontSize: 11 }}>
              {draft.from} &rarr; {draft.to} &middot; {dayCount} day{dayCount === 1 ? "" : "s"}
              {draftPreset === "custom" && selectingEnd ? " · pick end date" : ""}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="filter-btn"
                style={{ padding: "4px 10px" }}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="apply-btn"
                onClick={() => {
                  onApply(draftPreset, draft);
                  setOpen(false);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function useOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, cb]);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return `${dt.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${y}`;
}
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(from.split("-").map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split("-").map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000) + 1;
}

interface Cell {
  blank: boolean;
  trail: boolean;
  iso: string;
  day: number;
  inRange: boolean;
  endpoint: boolean;
  today: boolean;
}
// Matches v1's MiniCalendar: leading blanks (muted), the days, then trailing
// blanks (muted trail) to fill the last week.
function buildMonth(ym: string, range: DayRange, today: string): Cell[] {
  const [y, m] = ym.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Cell[] = [];
  const blank = (trail: boolean): Cell => ({
    blank: true,
    trail,
    iso: "",
    day: 0,
    inRange: false,
    endpoint: false,
    today: false,
  });
  for (let i = 0; i < firstDow; i++) cells.push(blank(false));
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    cells.push({
      blank: false,
      trail: false,
      iso,
      day: d,
      inRange: iso >= range.from && iso <= range.to,
      endpoint: iso === range.from || iso === range.to,
      today: iso === today,
    });
  }
  while (cells.length % 7 !== 0) cells.push(blank(true));
  return cells;
}
