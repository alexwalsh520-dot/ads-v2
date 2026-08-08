"use client";

// v1's LineChart, ported from public/ads-tracker-export.html (function LineChart,
// line 4228, and smoothPath, line 4210). Same rendering output: multi-series with
// an optional right axis, 4 gridline ticks, a soft gradient fill under the primary
// series, a hover crosshair with per-series dots, and the lc-tooltip readout.

import { useState } from "react";

export interface LineSeries {
  name: string;
  values: number[];
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

function smoothPath(points: Pt[]): string {
  if (points.length < 2) return "";
  const p = points;
  let d = `M ${p[0].x} ${p[0].y}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export default function LineChart({
  series,
  labels,
  height = 200,
  width = 640,
  fmt = (v: number) => String(v),
  fmtRight,
  idBase,
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  width?: number;
  fmt?: (v: number) => string;
  fmtRight?: (v: number) => string;
  /** Unique per card, so the gradient ids never collide across cards. */
  idBase: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hasRight = series.some((s) => s.axis === "right");
  const pad = { t: hasRight ? 30 : 22, r: hasRight ? 52 : 16, b: 28, l: 46 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const n = labels.length;

  const buildScale = (vals: number[]) => {
    const minV = Math.min(...vals, 0);
    const maxV = Math.max(...vals);
    const range = Math.max(maxV - minV, 1);
    const yMax = maxV + range * 0.18;
    const yMin = Math.max(0, minV - range * 0.12);
    const yR = Math.max(yMax - yMin, 1);
    return { yMin, yMax, yR };
  };
  const leftVals = series.filter((s) => s.axis !== "right").flatMap((s) => s.values);
  const rightVals = series.filter((s) => s.axis === "right").flatMap((s) => s.values);
  const leftScale = buildScale(leftVals.length ? leftVals : [0, 1]);
  const rightScale = hasRight ? buildScale(rightVals) : leftScale;
  const scaleFor = (s: LineSeries) => (s.axis === "right" ? rightScale : leftScale);
  const xOf = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yOfScale = (v: number, sc: { yMin: number; yR: number }) =>
    pad.t + innerH - ((v - sc.yMin) / sc.yR) * innerH;
  const yOf = (v: number, s: LineSeries) => yOfScale(v, scaleFor(s));
  const pointsFor = (s: LineSeries): Pt[] => s.values.map((v, i) => ({ x: xOf(i), y: yOf(v, s) }));

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
          const pts = pointsFor(s);
          if (pts.length < 2) return null;
          const baseline = yOfScale(scaleFor(s).yMin, scaleFor(s));
          const d =
            smoothPath(pts) + ` L ${pts[pts.length - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z`;
          return <path key={`f${i}`} d={d} fill={`url(#lc-fade-${idBase}-${i})`} />;
        })}
        {series.map((s, i) => (
          <path
            key={`l${i}`}
            d={smoothPath(pointsFor(s))}
            fill="none"
            stroke={s.color}
            strokeWidth={s.isPrimary ? 2 : 1.5}
            strokeDasharray={s.dashed ? "4 4" : undefined}
            strokeOpacity={s.isPrimary ? 1 : 0.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
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
            {series.map((s, i) => (
              <circle
                key={`d${i}`}
                cx={xOf(hoverIdx)}
                cy={yOf(s.values[hoverIdx], s)}
                r={s.isPrimary ? 4 : 3}
                fill="var(--bg)"
                stroke={s.color}
                strokeWidth="2"
              />
            ))}
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
              {series.map((s, i) => (
                <div key={i} className="lc-tt-row">
                  <span className="lc-tt-sw" style={{ background: s.color, opacity: s.isPrimary ? 1 : 0.6 }} />
                  <span className="lc-tt-name">{s.name}</span>
                  <span className="lc-tt-val mono">{(s.fmt || fmt)(s.values[hoverIdx])}</span>
                </div>
              ))}
            </div>
          );
        })()}
    </div>
  );
}
