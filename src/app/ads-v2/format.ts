// Client-side cell formatting. Every derived value comes from the SAME
// derive() the server and tests use, computed over the node's base metrics, so
// a campaign row, an ad row, and the TOTAL row are all one formula over sums.

import { derive } from "@/lib/ads-v2/metrics";
import { formatUsd } from "@/lib/ads-v2/money";
import { COLUMN_BY_KEY } from "@/lib/ads-v2/definitions";
import type { AdsV2Node, BaseMetrics } from "@/lib/ads-v2/types";

export type CellClass = "" | "pos" | "neg" | "dim";

export interface Cell {
  text: string;
  cls: CellClass;
  isCalc: boolean;
}

const DASH = "-";

// Month/day, no year, no leading zeros: "2026-07-23" -> "7/23". Formats
// directly from the stored Eastern-time day STRING by splitting the text, never
// through a Date object (which would shift the day by the viewer's timezone).
export function fmtMD(etDay: string | null | undefined): string {
  if (!etDay) return DASH;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(etDay);
  if (!m) return etDay;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function pct(v: number | null): string {
  return v == null ? DASH : `${(v * 100).toFixed(1)}%`;
}
function money(cents: number | null): string {
  return cents == null ? DASH : formatUsd(cents);
}
function money2(cents: number | null): string {
  return cents == null ? DASH : formatUsd(cents, { decimals: 2 });
}
function int(n: number): string {
  return n.toLocaleString("en-US");
}

// Per-column color thresholds ported verbatim from v1's `cols` array (the cls
// functions in public/ads-tracker-export.html), converted to v2 units:
// v1 dollars -> cents, v1 percent (0-100) -> fraction (0-1), ROAS multiple as-is.
// So every column's text color matches v1 at every level.
function classFor(key: string, node: AdsV2Node): CellClass {
  const d = derive(node);
  switch (key) {
    case "cpm": // v1: <=$7 pos, >=$10 neg, else dim
      return d.cpmCents == null ? "dim" : d.cpmCents <= 700 ? "pos" : d.cpmCents >= 1000 ? "neg" : "dim";
    case "ctr": // v1: >=2% pos, <1.7% neg
      return d.ctr == null ? "" : d.ctr >= 0.02 ? "pos" : d.ctr < 0.017 ? "neg" : "";
    case "cpc": // v1: <=$0.35 pos, >=$0.45 neg
      return d.cpcCents == null ? "" : d.cpcCents <= 35 ? "pos" : d.cpcCents >= 45 ? "neg" : "";
    case "costPerMessage": // v1 cpMsg: <=$5 pos, >=$6.5 neg
      return d.costPerMessageCents == null
        ? ""
        : d.costPerMessageCents <= 500
          ? "pos"
          : d.costPerMessageCents >= 650
            ? "neg"
            : "";
    case "costPerBooked": // v1 cpCall: <=$30 pos, >=$40 neg (only when set)
      return d.costPerBookedCents
        ? d.costPerBookedCents <= 3000
          ? "pos"
          : d.costPerBookedCents >= 4000
            ? "neg"
            : ""
        : "";
    case "costPerTaken": // v1 cpTaken: <=$45 pos, >=$70 neg (only when set)
      return d.costPerTakenCents
        ? d.costPerTakenCents <= 4500
          ? "pos"
          : d.costPerTakenCents >= 7000
            ? "neg"
            : ""
        : "";
    case "showRate": {
      // v1: due = booked - upcoming; if due<=0 return ""; v = min(100, showed/due*100)
      const due = node.booked - node.upcoming;
      if (due <= 0) return "";
      const v = Math.min(1, (node.showedPeople ?? 0) / due);
      return v >= 0.5 ? "pos" : v < 0.3 ? "neg" : "";
    }
    case "newClients": // v1 clients: >=5 pos, <=2 neg
      return node.newClients >= 5 ? "pos" : node.newClients <= 2 ? "neg" : "";
    case "closeRate": // v1 closing: >=40% pos, <=25% neg
      return d.closeRate == null ? "" : d.closeRate >= 0.4 ? "pos" : d.closeRate <= 0.25 ? "neg" : "";
    case "msgToCall": // v1 msgConv: >=15% pos, <=12% neg
      return d.msgToCall == null ? "" : d.msgToCall >= 0.15 ? "pos" : d.msgToCall <= 0.12 ? "neg" : "";
    case "collected": // v1: always green
      return "pos";
    case "costPerClient": // v1 cpClient: <=$80 pos, >=$120 neg (only when set)
      return d.costPerClientCents
        ? d.costPerClientCents <= 8000
          ? "pos"
          : d.costPerClientCents >= 12000
            ? "neg"
            : ""
        : "";
    case "collectedRoi": // v1 collectedRoi: >=20 pos, <=10 neg
      return d.collectedRoi == null ? "" : d.collectedRoi >= 20 ? "pos" : d.collectedRoi <= 10 ? "neg" : "";
    default: // spend, impressions, clicks, messages, booked, taken, budget, name
      return "";
  }
}

export function formatCell(key: string, node: AdsV2Node): Cell {
  const col = COLUMN_BY_KEY[key];
  const isCalc = !!col?.calc;
  const base: BaseMetrics = node;
  const d = derive(base);

  let text = DASH;
  switch (key) {
    case "budget": {
      const b = node.budget;
      if (!b || !b.holds || b.dailyUsdCents == null) {
        // Lifetime budget shows if there is no daily one.
        if (b?.holds && b.lifetimeUsdCents != null) text = `${formatUsd(b.lifetimeUsdCents)} total`;
        else text = DASH;
      } else {
        text = `${formatUsd(b.dailyUsdCents)}/day`;
      }
      break;
    }
    case "spend":
      text = money(node.spendCents);
      break;
    case "impressions":
      text = int(node.impressions);
      break;
    case "cpm":
      text = money2(d.cpmCents);
      break;
    case "clicks":
      text = int(node.clicks);
      break;
    case "ctr":
      text = pct(d.ctr);
      break;
    case "cpc":
      text = money2(d.cpcCents);
      break;
    case "messages":
      text = int(node.messages);
      break;
    case "costPerMessage":
      text = money2(d.costPerMessageCents);
      break;
    case "booked":
      text = int(node.booked);
      break;
    case "costPerBooked":
      text = money2(d.costPerBookedCents);
      break;
    case "taken":
      text = int(node.taken);
      break;
    case "costPerTaken":
      text = money2(d.costPerTakenCents);
      break;
    case "showRate":
      text = pct(d.showRate);
      break;
    case "newClients":
      text = int(node.newClients);
      break;
    case "closeRate":
      text = pct(d.closeRate);
      break;
    case "msgToCall":
      text = pct(d.msgToCall);
      break;
    case "collected":
      text = money(node.collectedCents);
      break;
    case "costPerClient":
      text = money(d.costPerClientCents);
      break;
    case "collectedRoi":
      text = d.collectedRoi == null ? DASH : `${d.collectedRoi.toFixed(2)}x`;
      break;
    default:
      text = DASH;
  }

  // v1 applies each column's cls regardless of whether the value is a dash, so
  // the color logic (which already handles nulls per column) decides directly.
  const cls = classFor(key, node);
  return { text, cls, isCalc };
}

// The numeric value used for sorting a column (nulls sort last).
export function sortValue(key: string, node: AdsV2Node): number {
  const d = derive(node);
  switch (key) {
    case "budget":
      return node.budget?.dailyUsdCents ?? node.budget?.lifetimeUsdCents ?? -1;
    case "spend":
      return node.spendCents;
    case "impressions":
      return node.impressions;
    case "cpm":
      return d.cpmCents ?? -1;
    case "clicks":
      return node.clicks;
    case "ctr":
      return d.ctr ?? -1;
    case "cpc":
      return d.cpcCents ?? -1;
    case "messages":
      return node.messages;
    case "costPerMessage":
      return d.costPerMessageCents ?? -1;
    case "booked":
      return node.booked;
    case "costPerBooked":
      return d.costPerBookedCents ?? -1;
    case "taken":
      return node.taken;
    case "costPerTaken":
      return d.costPerTakenCents ?? -1;
    case "showRate":
      return d.showRate ?? -1;
    case "newClients":
      return node.newClients;
    case "closeRate":
      return d.closeRate ?? -1;
    case "msgToCall":
      return d.msgToCall ?? -1;
    case "collected":
      return node.collectedCents;
    case "costPerClient":
      return d.costPerClientCents ?? -1;
    case "collectedRoi":
      return d.collectedRoi ?? -1;
    default:
      return 0;
  }
}
