"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";

// A one-glance health badge next to the gear: alerts from the last 7 days plus
// whether the sync is still running, coloured by the WORST of them.
//
// Renders nothing until loaded and nothing on failure, so the tab is never
// blocked or broken by its own health indicator. That also means a badge you
// cannot see is not proof of health — /api/ads-v2/health is the real answer.

const COLORS: Record<string, string> = {
  green: "#7dd3a8",
  amber: "#d4b27a",
  red: "#e89a94",
};

export default function AccuracyBadge() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ads-v2/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.counts) {
          setCounts(d.counts);
          setLastRunAt(d.lastRunAt ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!counts) return null;

  const worst =
    (counts.red || 0) + (counts.error || 0) > 0 ? "red" : (counts.amber || 0) > 0 ? "amber" : "green";
  const Icon = worst === "green" ? ShieldCheck : ShieldAlert;
  const summary = [
    counts.green ? `${counts.green} green` : null,
    counts.amber ? `${counts.amber} amber` : null,
    counts.red ? `${counts.red} red` : null,
    counts.error ? `${counts.error} errored` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const when = lastRunAt ? new Date(lastRunAt).toLocaleString() : "no sync has run yet";

  return (
    <span
      className="icon-btn"
      aria-label="Data health"
      title={`Data health: ${summary || "nothing flagged"} (last sync ${when}).`}
    >
      <Icon size={16} style={{ color: COLORS[worst] }} />
    </span>
  );
}
