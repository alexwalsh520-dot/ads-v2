"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rangeForPreset, todayEt, type DayRange, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Level, AdsV2Payload, AdsV2Status } from "@/lib/ads-v2/types";
import { AccountDropdown, DateDropdown, StatusSegmented } from "./controls";
import CampaignTable from "./CampaignTable";
import MetricsBoard from "./MetricsBoard";
import SettingsGear from "./SettingsGear";
import AccuracyBadge from "./AccuracyBadge";
import { CreatorsProvider, type UiCreator } from "./creators-context";

function keyOf(account: AdsV2Account, status: AdsV2Status, range: DayRange): string {
  return `${account}|${status}|${range.from}|${range.to}`;
}

// In public (share-link) mode the token locks the client server-side, so there
// is no account dropdown and every fetch goes through the token-scoped public
// API. Everything else (table, levels, sorting, hovers, popups, colors, speed)
// is identical to the authed tab.
export interface AdsV2ClientProps {
  publicToken?: string;
  lockedAccount?: AdsV2Account;
  /** The configured creators, read from adsv2.config.json by the server page. */
  creators?: UiCreator[];
}

export default function AdsV2Client({ publicToken, lockedAccount, creators = [] }: AdsV2ClientProps = {}) {
  const isPublic = !!publicToken;
  const [account, setAccount] = useState<AdsV2Account>(lockedAccount ?? "all");
  const [status, setStatus] = useState<AdsV2Status>("active");
  const [level, setLevel] = useState<AdsV2Level>("campaign");
  const [preset, setPreset] = useState<PresetId>("last7");
  const [range, setRange] = useState<DayRange>(() => rangeForPreset("last7", todayEt()));

  const [payload, setPayload] = useState<AdsV2Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cache = useRef<Map<string, AdsV2Payload>>(new Map());
  // Guard against a slow response for a stale selection overwriting a newer one.
  const activeKey = useRef<string>("");

  const fetchWindow = useCallback(
    async (acc: AdsV2Account, st: AdsV2Status, r: DayRange, opts?: { background?: boolean }) => {
      const key = keyOf(acc, st, r);
      // Public mode: the token derives the client server-side, so we send no
      // account. Authed mode: the account is a request param as before.
      const url = isPublic
        ? `/api/public/ads-v2/${publicToken}?status=${st}&dateFrom=${r.from}&dateTo=${r.to}`
        : `/api/ads-v2?account=${acc}&status=${st}&dateFrom=${r.from}&dateTo=${r.to}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as AdsV2Payload;
        // Never cache a "preparing" placeholder as if it were the real numbers;
        // that would pin the window to the placeholder on the instant-switch path.
        if (!data.preparing) cache.current.set(key, data);
        // Only paint if this is still the selection the user is looking at.
        if (!opts?.background && activeKey.current === key) {
          setPayload(data);
          setLoading(false);
          setError(null);
        }
        return data;
      } catch (err) {
        if (!opts?.background && activeKey.current === key) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setLoading(false);
        }
        return null;
      }
    },
    [isPublic, publicToken],
  );

  // Load on selection change: cached shows instantly + revalidates; else loads.
  useEffect(() => {
    const key = keyOf(account, status, range);
    activeKey.current = key;
    const cached = cache.current.get(key);
    if (cached) {
      setPayload(cached);
      setLoading(false);
      setError(null);
      fetchWindow(account, status, range, { background: true }); // revalidate
    } else {
      setLoading(true);
      setPayload(null);
      fetchWindow(account, status, range);
    }
  }, [account, status, range, fetchWindow]);

  // After first paint, warm adjacent accounts + presets so switching is instant.
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      // Public mode is locked to one client, so only warm presets (no accounts).
      const accounts: AdsV2Account[] = isPublic ? [] : ["all", ...creators.map((c) => c.key)];
      for (const acc of accounts) {
        if (acc !== account) {
          const k = keyOf(acc, status, range);
          if (!cache.current.has(k)) fetchWindow(acc, status, range, { background: true });
        }
      }
      const presets: PresetId[] = ["today", "last7", "last30"];
      for (const p of presets) {
        const r = rangeForPreset(p, todayEt());
        const k = keyOf(account, status, r);
        if (!cache.current.has(k)) fetchWindow(account, status, r, { background: true });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [loading, account, status, range, fetchWindow, isPublic, creators]);

  // If the window is still preparing (no snapshot yet), poll until it lands.
  // The background build was scheduled by the request; we just re-read.
  useEffect(() => {
    if (!payload?.preparing) return;
    const timer = setTimeout(() => {
      fetchWindow(account, status, range);
    }, 2500);
    return () => clearTimeout(timer);
  }, [payload, account, status, range, fetchWindow]);

  const applyDate = (p: PresetId, r: DayRange) => {
    setPreset(p);
    setRange(r);
  };

  return (
    <CreatorsProvider creators={creators}>
    <div className="adsv2">
      <div className="av2-head">
        <div>
          <div className="av2-title">
            Ads<span className="av2-tag">v2</span>
          </div>
        </div>
        <div className="av2-head-actions">
          {!isPublic && <AccuracyBadge />}
          <SettingsGear payload={payload} publicMode={isPublic} publicToken={publicToken} />
        </div>
      </div>

      <div className="filter-bar">
        {!isPublic && <AccountDropdown value={account} onChange={setAccount} />}
        <StatusSegmented value={status} onChange={setStatus} />
        <span className="filter-divider" />
        <DateDropdown preset={preset} range={range} onApply={applyDate} />
      </div>

      {payload && !payload.preparing
        ? payload.notices?.map((n, i) => (
            <div className="notice-bar" key={i}>
              {n}
            </div>
          ))
        : null}

      {loading ? (
        <div className="panel">
          <div className="loading">Loading paid ads...</div>
        </div>
      ) : error ? (
        <div className="panel">
          <div className="empty-state">Could not load: {error}</div>
        </div>
      ) : payload?.preparing ? (
        <div className="panel">
          <div className="preparing-state">
            Preparing this window<span className="dots">...</span>
            <br />
            It will appear in a moment.
          </div>
        </div>
      ) : payload && payload.campaigns.length > 0 ? (
        <>
          <CampaignTable payload={payload} level={level} onLevelChange={setLevel} />
          <MetricsBoard
            publicToken={publicToken}
            account={account}
            status={status}
            dateFrom={range.from}
            dateTo={range.to}
            tableVersion={payload.dataVersion}
          />
        </>
      ) : (
        <div className="panel">
          <div className="empty-state">
            No paid ad data for this view.
          </div>
        </div>
      )}
    </div>
    </CreatorsProvider>
  );
}
