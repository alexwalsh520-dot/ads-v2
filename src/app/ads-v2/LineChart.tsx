"use client";

// v1's LineChart, ported from public/ads-tracker-export.html (function LineChart,
// line 4228, and smoothPath, line 4210). Same rendering output: multi-series with
// an optional right axis, 4 gridline ticks, a soft gradient fill under the primary
// series, a hover crosshair with per-series dots, and the lc-tooltip readout.

import { useState } from "react";

export interface LineSeries {
  name: string;
  /** Null = no data that day: the line breaks into a gap there. */
  values: (number | null)[];
  color: string;
  dashed?: boolean;
  isPrimary?: boolean;
  fmt?: (v: number) => string;
  axis?: "left" | "right";
}

interface Pt {
  x: number;
  y: number;
}

// Monotone cubic interpolation (Fritsch-Carlsson). Unlike the old Catmull-Rom
// smoothing, the curve can NEVER overshoot the data: a series of 100% days
// followed by a 0% day draws a curve that stays inside [0%, 100%] instead of
// bulging above the top and dipping below the floor.
function smoothPath(points: Pt[]): string {
  if (points.length < 2) return "";
  const n = points.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1].x - points[i].x;
    dx.push(h);
    slope.push((points[i + 1].y - points[i].y) / (h || 1));
  }
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent.push(0);
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
    }
  }
  tangent.push(slope[n - 2]);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = points[i].x + h / 3;
    const c1y = points[i].y + (tangent[i] * h) / 3;
    const c2x = points[i + 1].x - h / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * h) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return d;
}

// Consecutive non-null points, so a null day splits the line into segments
// with a visible gap instead of pretending a value existed.
function runsOf(points: (Pt | null)[]): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of points) {
    if (p) {
      cur.push(p);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export default function LineChart({
  series,
  labels,
  height = 200,
  width = 640,
  fmt = (v: number) => String(v),
  fmtRight,
  idBase,
  leftMax,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  width?: number;
  fmt?: (v: number) => string;
  fmtRight?: (v: number) => string;
  /** Unique per card, so the gradient ids never collide across cards. */
  idBase: string;
  /** Hard ceiling for the left axis (e.g. 1 for a share): the scale never
   *  shows headroom above a value the metric cannot reach. */
  leftMax?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hasRight = series.some((s) => s.axis === "right");
  const pad = { t: hasRight ? 30 : 22, r: hasRight ? 52 : 16, b: 28, l: 46 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = labels.length;

  const buildScale = (vals: number[], cap?: number) => {
    const minV = Math.min(...vals, 0);
    const maxV = Math.max(...vals);
    const range = Math.max(maxV - minV, 1);
    let yMax = maxV + range * 0.18;
    // A capped axis (a share) never shows headroom past its ceiling. If the
    // data somehow exceeded the cap, the data wins so nothing clips.
    if (cap != null) yMax = Math.min(yMax, Math.max(cap, maxV));
    const yMin = Math.max(0, minV - range * 0.12);
    const yR = Math.max(yMax - yMin, cap != null ? 1e-6 : 1);
    return { yMin, yMax, yR };
  };
  const notNull = (vals: (number | null)[]) => vals.filter((v): v is number => v != null && Number.isFinite(v));
  const leftVals = notNull(series.filter((s) => s.axis !== "right").flatMap((s) => s.values));
  const rightVals = notNull(series.filter((s) => s.axis === "right").flatMap((s) => s.values));
  const leftScale = buildScale(leftVals.length ? leftVals : [0, 1], leftMax);
  const rightScale = hasRight ? buildScale(rightVals.length ? rightVals : [0, 1]) : leftScale;
  const scaleFor = (s: LineSeries) => (s.axis === "right" ? rightScale : leftScale);
  const xOf = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yOfScale = (v: number, sc: { yMin: number; yR: number }) =>
    pad.t + innerH - ((v - sc.yMin) / sc.yR) * innerH;
  const yOf = (v: number, s: LineSeries) => yOfScale(v, scaleFor(s));
  const pointsFor = (s: LineSeries): (Pt | null)[] =>
    s.values.map((v, i) => (v == null || !Number.isFinite(v) ? null : { x: xOf(i), y: yOf(v, s) }));

  const tickFractions = [0, 0.33, 0.66, 1];
  const leftTicks = tickFractions.map((t) => leftScale.yMin + t * leftScale.yR);
  const rightTicks = tickFractions.map((t) => rightScale.yMin + t * rightScale.yR);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    if (x < pad.l - 8 || x > pad.l + innerW + 8) {
      setHoverIdx(null);
      return;
    }
    const rel = (x - pad.l) / innerW;
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  if (n === 0) return <div className="lc-wrap" />;

  const leftColor = series.find((s) => s.axis !== "right")?.color || "var(--text-4)";
  const rightColor = series.find((s) => s.axis === "right")?.color || "var(--text-4)";

  return (
    <div className="lc-wrap">
      <svg
        className="lc-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          {series.map(
            (s, i) =>
              s.isPrimary && (
                <linearGradient key={`g${i}`} id={`lc-fade-${idBase}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                  <stop offset="60%" stopColor={s.color} stopOpacity="0.08" />
                  <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ),
          )}
        </defs>
        {leftTicks.map((t, i) => {
          const y = yOfScale(t, leftScale);
          return (
            <g key={`lt${i}`}>
              <line x1={pad.l} x2={pad.l + innerW} y1={y} y2={y} stroke="var(--panel-2)" strokeWidth="1" />
              <text
                x={pad.l - 8}
                y={y + 3}
                textAnchor="end"
                fontSize="9.5"
                fill={hasRight ? leftColor : "var(--text-4)"}
                fillOpacity={hasRight ? 0.7 : 1}
                fontFamily="'JetBrains Mono',monospace"
              >
                {fmt(t)}
              </text>
            </g>
          );
        })}
        {hasRight &&
          rightTicks.map((t, i) => {
            const y = yOfScale(t, rightScale);
            return (
              <text
                key={`rt${i}`}
                x={pad.l + innerW + 8}
                y={y + 3}
                textAnchor="start"
                fontSize="9.5"
                fill={rightColor}
                fillOpacity="0.7"
                fontFamily="'JetBrains Mono',monospace"
              >
                {(fmtRight || fmt)(t)}
              </text>
            );
          })}
        {hasRight && (
          <>
            <text
              x={pad.l - 8}
              y={pad.t - 8}
              textAnchor="end"
              fontSize="8.5"
              fill={leftColor}
              fillOpacity="0.8"
              fontFamily="'JetBrains Mono',monospace"
              letterSpacing="0.05em"
            >
              {(series.find((s) => s.axis !== "right")?.name || "").toUpperCase()}
            </text>
            <text
              x={pad.l + innerW + 8}
              y={pad.t - 8}
              textAnchor="start"
              fontSize="8.5"
              fill={rightColor}
              fillOpacity="0.8"
              fontFamily="'JetBrains Mono',monospace"
              letterSpacing="0.05em"
            >
              {(series.find((s) => s.axis === "right")?.name || "").toUpperCase()}
            </text>
          </>
        )}
        {labels.map((l, i) => {
          const step = n > 10 ? Math.ceil(n / 8) : 1;
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text
              key={i}
              x={xOf(i)}
              y={height - 10}
              textAnchor="middle"
              fontSize="9.5"
              fill="var(--text-4)"
              fontFamily="'JetBrains Mono',monospace"
            >
              {l}
            </text>
          );
        })}
        {series.map((s, i) => {
          if (!s.isPrimary) return null;
          const baseline = yOfScale(scaleFor(s).yMin, scaleFor(s));
          return runsOf(pointsFor(s)).map((run, r) => {
            if (run.length < 2) return null;
            const d =
              smoothPath(run) + ` L ${run[run.length - 1].x} ${baseline} L ${run[0].x} ${baseline} Z`;
            return <path key={`f${i}-${r}`} d={d} fill={`url(#lc-fade-${idBase}-${i})`} />;
          });
        })}
        {series.map((s, i) =>
          runsOf(pointsFor(s)).map((run, r) =>
            run.length >= 2 ? (
              <path
                key={`l${i}-${r}`}
                d={smoothPath(run)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.isPrimary ? 2 : 1.5}
                strokeDasharray={s.dashed ? "4 4" : undefined}
                strokeOpacity={s.isPrimary ? 1 : 0.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              // A single day of data between gaps still shows as a dot.
              <circle
                key={`l${i}-${r}`}
                cx={run[0].x}
                cy={run[0].y}
                r={s.isPrimary ? 3 : 2.5}
                fill={s.color}
                fillOpacity={s.isPrimary ? 1 : 0.6}
              />
            ),
          ),
        )}
        {hoverIdx !== null && (
          <g>
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={pad.t}
              y2={pad.t + innerH}
              stroke="var(--border-2)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            {series.map((s, i) => {
              const v = s.values[hoverIdx];
              if (v == null || !Number.isFinite(v)) return null;
              return (
                <circle
                  key={`d${i}`}
                  cx={xOf(hoverIdx)}
                  cy={yOf(v, s)}
                  r={s.isPrimary ? 4 : 3}
                  fill="var(--bg)"
                  stroke={s.color}
                  strokeWidth="2"
                />
              );
            })}
          </g>
        )}
      </svg>
      {hoverIdx !== null &&
        (() => {
          const pct = (xOf(hoverIdx) / width) * 100;
          const transform =
            pct > 82 ? "translate(-100%, -6px)" : pct < 18 ? "translate(0, -6px)" : "translate(-50%, -6px)";
          return (
            <div className="lc-tooltip" style={{ left: `${pct}%`, transform }}>
              <div className="lc-tt-date">{labels[hoverIdx]}</div>
              {series.map((s, i) => {
                const v = s.values[hoverIdx];
                return (
                  <div key={i} className="lc-tt-row">
                    <span className="lc-tt-sw" style={{ background: s.color, opacity: s.isPrimary ? 1 : 0.6 }} />
                    <span className="lc-tt-name">{s.name}</span>
                    <span className="lc-tt-val mono">
                      {v == null || !Number.isFinite(v) ? "no data" : (s.fmt || fmt)(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
    </div>
  );
}
