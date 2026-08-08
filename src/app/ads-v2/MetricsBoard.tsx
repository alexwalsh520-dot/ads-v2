"use client";

// The Metrics section, rebuilt to v1's structure (public/ads-tracker-export.html):
// metric-board-head, a grid-charts metric-grid of two chart-columns, each card a
// metric-card-shell wrapping a panel chart-card, and v1's pointer-drag reorder
// with a floating card and a drop placeholder. The data wiring is unchanged: same
// API payload, same CARD_DEFS, same storage key and format.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CARD_BY_ID, CARD_DEFS, DEFAULT_CARD_IDS, type CardDef, type CardFormat } from "@/lib/ads-v2/cards";
import type { AdsV2MetricsPayload, BaseMetrics, MetricsDay, RevenueCategories } from "@/lib/ads-v2/types";
import { IcCheck, IcEdit, IcPlus } from "./icons";
import { fmtMD } from "./format";
import LineChart from "./LineChart";

const STORE_KEY = "ccos.adsv2.metricCards.v1";
// One-time additions to ALREADY-SAVED layouts. A saved layout predating these
// cards gets them appended once (flagged below); deleting them after that
// sticks like any other card.
const APPENDED_ONCE_KEY = "ccos.adsv2.metricCards.appended.revenueCards";
const APPEND_ONCE_IDS = ["organic_revenue", "misc_chat_revenue", "attribution_coverage"];

function loadLayout(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_CARD_IDS];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [...DEFAULT_CARD_IDS];
    let ids = (JSON.parse(raw) as string[]).filter((id) => CARD_BY_ID[id]);
    if (!ids.length) return [...DEFAULT_CARD_IDS];
    if (!window.localStorage.getItem(APPENDED_ONCE_KEY)) {
      ids = [...ids, ...APPEND_ONCE_IDS.filter((id) => !ids.includes(id))];
      window.localStorage.setItem(APPENDED_ONCE_KEY, "1");
      saveLayout(ids);
    }
    return ids;
  } catch {
    return [...DEFAULT_CARD_IDS];
  }
}

function saveLayout(ids: string[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(ids));
  } catch {
    /* storage blocked; the order still holds for this session */
  }
}

function formatValue(v: number | null, fmt: CardFormat): string {
  if (v == null || !Number.isFinite(v)) return "-";
  switch (fmt) {
    case "usd":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "usd2":
      return `$${v.toFixed(2)}`;
    case "cpm":
      return `$${v.toFixed(2)}`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "ratio2":
      return `${v.toFixed(2)}x`;
    default:
      return String(v);
  }
}

// Axis ticks are the same number in the same format as the big number, kept
// short so four of them fit the gutter.
function axisFormat(fmt: CardFormat) {
  return (v: number) => {
    if (!Number.isFinite(v)) return "";
    if (fmt === "usd") {
      const abs = Math.abs(v);
      if (abs >= 1000) return `$${Math.round((v / 1000) * 10) / 10}k`;
      return `$${Math.round(v)}`;
    }
    // Whole-number percent ticks: "67%", never "66.7%".
    if (fmt === "pct") return `${Math.round(v * 100)}%`;
    return formatValue(v, fmt);
  };
}

interface DragInfo {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface SlotRect {
  id: string;
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

export default function MetricsBoard({
  publicToken,
  account,
  status,
  dateFrom,
  dateTo,
  tableVersion,
}: {
  publicToken?: string;
  account: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  // The table's data_version, so the board only paints numbers from the SAME
  // snapshot the table is showing (never a mismatched pair).
  tableVersion: number;
}) {
  const [metrics, setMetrics] = useState<AdsV2MetricsPayload | null>(null);
  const [layout, setLayout] = useState<string[]>(() => loadLayout());
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const cache = useRef<Map<string, AdsV2MetricsPayload>>(new Map());

  const key = `${account}|${status}|${dateFrom}|${dateTo}`;

  const load = useCallback(async () => {
    const url = publicToken
      ? `/api/public/ads-v2/${publicToken}?section=metrics&status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`
      : `/api/ads-v2/metrics?account=${account}&status=${status}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AdsV2MetricsPayload;
      if (!data.preparing) cache.current.set(key, data);
      setMetrics(data);
    } catch {
      /* the table already surfaced any load error */
    }
  }, [publicToken, account, status, dateFrom, dateTo, key]);

  // Lazily fetch the slice AFTER the table paints (a short defer), and re-poll
  // once if it is still preparing.
  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) setMetrics(cached);
    const t = setTimeout(load, cached ? 0 : 250);
    return () => clearTimeout(t);
  }, [key, load]);

  useEffect(() => {
    if (!metrics?.preparing) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [metrics, load]);

  const ready = metrics && !metrics.preparing && metrics.dataVersion === tableVersion;
  const total: BaseMetrics | null = ready ? metrics!.total : null;
  const days: MetricsDay[] = ready ? metrics!.days : [];
  const revenue: RevenueCategories | undefined = ready ? metrics!.revenue : undefined;

  // Client share links never show tracker-wide money (misc chats, coverage):
  // those numbers span the whole team, not the creator holding the link.
  const cardAllowed = useCallback(
    (id: string) => Boolean(CARD_BY_ID[id]) && !(publicToken && CARD_BY_ID[id].trackerWide),
    [publicToken],
  );
  const visibleLayout = useMemo(() => layout.filter(cardAllowed), [layout, cardAllowed]);
  const visibleLayoutKey = visibleLayout.join("|");
  const leftLayout = visibleLayout.filter((_, i) => i % 2 === 0);
  const rightLayout = visibleLayout.filter((_, i) => i % 2 === 1);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingRects = useRef<Record<string, { left: number; top: number }> | null>(null);
  const visibleLayoutRef = useRef(visibleLayout);
  const dragInfoRef = useRef<DragInfo | null>(null);
  const dragSlotRectsRef = useRef<SlotRect[]>([]);
  const draggingId = dragInfo?.id || null;

  useLayoutEffect(() => {
    visibleLayoutRef.current = visibleLayout;
  }, [visibleLayout]);

  useEffect(() => {
    dragInfoRef.current = dragInfo;
  }, [dragInfo]);

  // Persist the chosen cards and their order. Same key, same format as before.
  useEffect(() => {
    saveLayout(visibleLayoutRef.current);
  }, [visibleLayoutKey]);

  useEffect(() => {
    document.body.classList.toggle("metric-dragging", Boolean(dragInfo));
    return () => document.body.classList.remove("metric-dragging");
  }, [dragInfo]);

  const measureCards = () => {
    const rects: Record<string, { left: number; top: number }> = {};
    visibleLayoutRef.current.forEach((id) => {
      const node = cardRefs.current[id];
      if (node) {
        const rect = node.getBoundingClientRect();
        rects[id] = { left: rect.left, top: rect.top };
      }
    });
    return rects;
  };

  const setLayoutWithAnimation = (updater: (prev: string[]) => string[]) => {
    pendingRects.current = measureCards();
    setLayout((prev) => {
      const next = updater(prev);
      visibleLayoutRef.current = next.filter((id) => CARD_BY_ID[id]);
      return next;
    });
  };

  // FLIP: cards slide from where they were to where they now are.
  useLayoutEffect(() => {
    const before = pendingRects.current;
    if (!before) return;
    pendingRects.current = null;
    visibleLayout.forEach((id) => {
      if (id === draggingId) return;
      const node = cardRefs.current[id];
      const prev = before[id];
      if (!node || !prev) return;
      const rect = node.getBoundingClientRect();
      const dx = prev.left - rect.left;
      const dy = prev.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      node.getBoundingClientRect();
      requestAnimationFrame(() => {
        node.style.transition = "transform 320ms cubic-bezier(.22,.72,.2,1)";
        node.style.transform = "";
        window.setTimeout(() => {
          node.style.transition = "";
        }, 370);
      });
    });
  }, [visibleLayoutKey, draggingId, visibleLayout]);

  const deleteCard = (id: string) => setLayout((prev) => prev.filter((cardId) => cardId !== id));

  const applyPicker = (next: string[]) => {
    setLayout(next.filter((id) => CARD_BY_ID[id]));
    setPickerOpen(false);
  };

  const registerRef = (id: string, node: HTMLDivElement | null) => {
    if (node) cardRefs.current[id] = node;
    else delete cardRefs.current[id];
  };

  const beginPointerDrag = (event: React.PointerEvent, id: string) => {
    if (!editing || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,input,select,textarea")) return;
    const node = cardRefs.current[id];
    if (!node) return;
    const rect = node.getBoundingClientRect();
    event.preventDefault();
    setDropTargetId(null);
    dragSlotRectsRef.current = visibleLayoutRef.current
      .map((cardId, index) => {
        const slotNode = cardRefs.current[cardId];
        if (!slotNode) return null;
        const r = slotNode.getBoundingClientRect();
        return {
          id: cardId,
          index,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          centerX: r.left + r.width / 2,
          centerY: r.top + r.height / 2,
        };
      })
      .filter(Boolean) as SlotRect[];
    const nextDrag: DragInfo = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    dragInfoRef.current = nextDrag;
    setDragInfo(nextDrag);
  };

  const reorderTowardPointer = (clientX: number, clientY: number) => {
    const activeDrag = dragInfoRef.current;
    if (!activeDrag) return;
    const candidates = dragSlotRectsRef.current
      .map((slot) => {
        if (clientX < slot.left || clientX > slot.right || clientY < slot.top || clientY > slot.bottom)
          return null;
        return { ...slot, distance: Math.hypot(clientX - slot.centerX, clientY - slot.centerY) };
      })
      .filter(Boolean)
      .sort((a, b) => a!.distance - b!.distance);
    const targetSlot = candidates[0];
    if (!targetSlot) {
      setDropTargetId(null);
      return;
    }
    const currentLayout = visibleLayoutRef.current;
    if (currentLayout.indexOf(activeDrag.id) === targetSlot.index) return;
    setDropTargetId(currentLayout[targetSlot.index]);
    setLayoutWithAnimation((prev) => moveCardToIndex(prev, activeDrag.id, targetSlot.index));
  };

  useEffect(() => {
    if (!dragInfo) return;
    const onMove = (event: PointerEvent) => {
      const activeDrag = dragInfoRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      const nextDrag = { ...activeDrag, x: event.clientX, y: event.clientY };
      dragInfoRef.current = nextDrag;
      setDragInfo(nextDrag);
      reorderTowardPointer(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      const activeDrag = dragInfoRef.current;
      if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
      dragInfoRef.current = null;
      dragSlotRectsRef.current = [];
      setDragInfo(null);
      setDropTargetId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(dragInfo)]);

  const floatingDef = dragInfo ? CARD_BY_ID[dragInfo.id] : null;
  const floatingStyle = dragInfo
    ? { left: dragInfo.x - dragInfo.offsetX, top: dragInfo.y - dragInfo.offsetY, width: dragInfo.width }
    : undefined;

  const renderCard = (id: string) => {
    const def = CARD_BY_ID[id];
    if (!def) return null;
    return (
      <MetricCardShell
        key={id}
        id={id}
        editing={editing}
        draggingId={draggingId}
        dropTargetId={dropTargetId}
        dragHeight={dragInfo?.id === id ? dragInfo.height : null}
        onDelete={deleteCard}
        onPointerDown={beginPointerDrag}
        registerRef={registerRef}
      >
        <MetricChartCard def={def} total={total} days={days} revenue={revenue} />
      </MetricCardShell>
    );
  };

  return (
    <>
      <div className="metric-board-head">
        <h2 className="metric-board-title">Metrics</h2>
        <div className="metric-board-actions">
          <button className="metric-board-btn" onClick={() => setPickerOpen(true)}>
            <IcPlus /> Add
          </button>
          <button
            className={`metric-board-btn ${editing ? "active" : ""}`}
            onClick={() => setEditing((v) => !v)}
          >
            <IcEdit /> {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>
      <div className={`grid-charts metric-grid ${editing ? "editing" : ""}`}>
        <div className="chart-column">{leftLayout.map(renderCard)}</div>
        <div className="chart-column">{rightLayout.map(renderCard)}</div>
      </div>
      {floatingDef && (
        <div className="metric-floating-card" style={floatingStyle}>
          <MetricChartCard def={floatingDef} total={total} days={days} revenue={revenue} />
        </div>
      )}
      {pickerOpen && (
        <MetricAddModal
          layout={visibleLayout}
          cardAllowed={cardAllowed}
          onApply={applyPicker}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function moveCardToIndex(layout: string[], id: string, index: number): string[] {
  const from = layout.indexOf(id);
  if (from < 0 || from === index) return layout;
  const next = [...layout];
  next.splice(from, 1);
  next.splice(index, 0, id);
  return next;
}

function MetricCardShell({
  id,
  editing,
  draggingId,
  dropTargetId,
  dragHeight,
  onDelete,
  onPointerDown,
  registerRef,
  children,
}: {
  id: string;
  editing: boolean;
  draggingId: string | null;
  dropTargetId: string | null;
  dragHeight: number | null;
  onDelete: (id: string) => void;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  registerRef: (id: string, node: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const isDragging = draggingId === id;
  const isDropTarget = dropTargetId === id && draggingId !== id;
  return (
    <div
      ref={(node) => registerRef(id, node)}
      className={
        "metric-card-shell " +
        (editing ? "editing " : "") +
        (isDragging ? "dragging " : "") +
        (isDropTarget ? "drop-target" : "")
      }
      onPointerDown={(e) => onPointerDown(e, id)}
      style={isDragging && dragHeight ? { height: dragHeight } : undefined}
    >
      {isDragging ? (
        <div className="metric-drag-placeholder" />
      ) : (
        <>
          {editing && (
            <button
              className="metric-delete"
              title="Delete card"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
            >
              ×
            </button>
          )}
          {children}
        </>
      )}
    </div>
  );
}

// One card: v1's panel chart-card shape. The big number is the window total and
// the line is the day series, exactly as before.
function MetricChartCard({
  def,
  total,
  days,
  revenue,
}: {
  def: CardDef;
  total: BaseMetrics | null;
  days: MetricsDay[];
  revenue?: RevenueCategories;
}) {
  const [tip, setTip] = useState(false);
  const value = total ? def.value(total, revenue) : null;
  const values = days.map((d) => def.point(d));
  const labels = days.map((d) => fmtMD(d.day));
  const axisFmt = axisFormat(def.format);

  return (
    <div className="panel chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-title">
            {def.label}
            <span
              className="chart-title-info"
              onMouseEnter={() => setTip(true)}
              onMouseLeave={() => setTip(false)}
            >
              <span className="info-dot">ⓘ</span>
              {tip && (
                <span className="metric-tip">
                  {def.sentence}
                  <span className="metric-tip-src">Source: {def.source}</span>
                </span>
              )}
            </span>
          </div>
          <div className="chart-subtitle">
            <span className="chart-big">{formatValue(value, def.format)}</span>
            <span className="chart-sub-label">{def.meta}</span>
          </div>
        </div>
      </div>
      <LineChart
        idBase={def.id}
        labels={labels}
        series={[
          {
            name: def.label,
            values,
            color: "var(--gold)",
            isPrimary: true,
            fmt: (v) => formatValue(v, def.format),
          },
        ]}
        fmt={axisFmt}
        // A share can never pass 100%: the axis stops there instead of
        // drawing headroom above an impossible value.
        leftMax={def.format === "pct" ? 1 : undefined}
      />
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-sw" style={{ background: "var(--gold)" }} />
          {def.label}
        </span>
      </div>
    </div>
  );
}

// v1's picker: a metric-add-grid of metric-pick-card tiles. Apply keeps the
// existing-selected order, then appends the newly picked ones.
function MetricAddModal({
  layout,
  cardAllowed,
  onApply,
  onClose,
}: {
  layout: string[];
  cardAllowed: (id: string) => boolean;
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(layout));
  const pickableDefs = CARD_DEFS.filter((def) => cardAllowed(def.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const apply = () => {
    const kept = layout.filter((id) => selected.has(id));
    const added = pickableDefs.map((def) => def.id).filter((id) => selected.has(id) && !kept.includes(id));
    onApply([...kept, ...added]);
  };

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">Add cards</div>
            <div className="modal-sub">Choose which campaign metrics are visible in this chart section.</div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="metric-add-grid">
            {pickableDefs.map((def) => {
              const isSelected = selected.has(def.id);
              return (
                <button
                  key={def.id}
                  className={`metric-pick-card ${isSelected ? "selected" : ""}`}
                  onClick={() => toggle(def.id)}
                >
                  <span>
                    <div className="metric-pick-label">{def.label}</div>
                    <div className="metric-pick-meta">{def.meta}</div>
                  </span>
                  <span className="metric-pick-icon">{isSelected ? <IcCheck /> : <IcPlus />}</span>
                </button>
              );
            })}
          </div>
          <div className="metric-add-foot">
            <button className="ghost-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="apply-btn" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
