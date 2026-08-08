"use client";

import { useEffect, useState } from "react";
import { useCreators } from "./creators-context";
import { buildHowItWorks } from "@/lib/ads-v2/definitions";
import { CARD_DEFS } from "@/lib/ads-v2/cards";
import type { AdsV2Payload } from "@/lib/ads-v2/types";
import { IcGear } from "./icons";

interface OrganicKeyword {
  id: number;
  client_key: string;
  keyword_display: string;
}


type GearTab = "organic" | "how" | "share" | "protects";

export default function SettingsGear({
  payload,
  publicMode = false,
  publicToken,
}: {
  payload: AdsV2Payload | null;
  publicMode?: boolean;
  publicToken?: string;
}) {
  const [open, setOpen] = useState(false);
  // Public (share-link) mode gets "How your numbers work" and "How this app
  // protects itself" only. No organic keywords, no share management: the token
  // locks the client, so nothing here can reach another client's data.
  const [tab, setTab] = useState<GearTab>(publicMode ? "how" : "organic");

  return (
    <>
      <button
        className="icon-btn gear-btn"
        title="How your numbers work"
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <IcGear />
      </button>
      {open && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">{publicMode ? "How your numbers work" : "Ads v2 settings"}</div>
              <button className="modal-close" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="gear-tabs">
                {!publicMode && (
                  <button
                    className={`gear-tab${tab === "organic" ? " active" : ""}`}
                    onClick={() => setTab("organic")}
                  >
                    Organic keywords
                  </button>
                )}
                <button className={`gear-tab${tab === "how" ? " active" : ""}`} onClick={() => setTab("how")}>
                  How your numbers work
                </button>
                <button
                  className={`gear-tab${tab === "protects" ? " active" : ""}`}
                  onClick={() => setTab("protects")}
                >
                  How this app protects itself
                </button>
                {!publicMode && (
                  <button
                    className={`gear-tab${tab === "share" ? " active" : ""}`}
                    onClick={() => setTab("share")}
                  >
                    Share links
                  </button>
                )}
              </div>
              {!publicMode && tab === "organic" ? (
                <OrganicManager />
              ) : !publicMode && tab === "share" ? (
                <ShareManager />
              ) : tab === "protects" ? (
                <Protections publicToken={publicToken} />
              ) : (
                <HowItWorks payload={payload} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface Protection {
  key: string;
  sentence: string;
  statusLabel: string;
  ok: boolean;
}

// Live proofs, never promises. Each protection is one sentence with a live
// status read from the app's real records. Read-only in every view.
function Protections({ publicToken }: { publicToken?: string }) {
  const [items, setItems] = useState<Protection[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const url = publicToken
      ? `/api/public/ads-v2/${publicToken}?section=protections`
      : "/api/ads-v2/protections";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setItems(d.protections || []))
      .catch(() => setError(true));
  }, [publicToken]);

  return (
    <div className="protects">
      <div className="how-note">
        These are not promises. Each line is checked against the app&apos;s own
        records, with the live result on the right.
      </div>
      {error && <div className="freshness">Could not load the live status right now.</div>}
      {items?.map((p) => (
        <div className="protect-row" key={p.key}>
          <div className="protect-sentence">{p.sentence}</div>
          <div className={`protect-status${p.ok ? " ok" : " warn"}`}>
            <span className="protect-dot" />
            {p.statusLabel}
          </div>
        </div>
      ))}
      {items && items.length === 0 && !error && (
        <div className="freshness">Live status is warming up. Check back shortly.</div>
      )}
    </div>
  );
}

function OrganicManager() {
  const creators = useCreators();
  const [keywords, setKeywords] = useState<OrganicKeyword[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/organic-keywords");
    if (res.ok) {
      const data = await res.json();
      setKeywords(data.keywords || []);
    }
  };
  useEffect(() => {
    // Fetch on mount. The lint rule cannot see that `load` only sets state
    // after an await, so nothing here renders synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const add = async (client: string) => {
    const keyword = (drafts[client] || "").trim();
    if (!keyword) return;
    setBusy(true);
    await fetch("/api/organic-keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client, keyword }),
    });
    setDrafts((d) => ({ ...d, [client]: "" }));
    await load();
    setBusy(false);
  };

  const remove = async (id: number) => {
    setBusy(true);
    await fetch("/api/organic-keywords", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await load();
    setBusy(false);
  };

  return (
    <div>
      <div className="how-note">
        Organic keywords are tracked quietly through the same chain as ads and saved for a later Metrics
        card. Nothing organic shows in this paid ads view. If a word is marked organic while a paid ad is
        running it, the paid side wins during the overlap.
      </div>
      {creators.map((c) => {
        const list = keywords.filter((k) => k.client_key === c.key);
        return (
          <div key={c.key}>
            <div className="sec-title">{c.name}</div>
            <div className="kw-row">
              {list.length === 0 && <span className="freshness">No organic keywords yet.</span>}
              {list.map((k) => (
                <span className="kw-chip" key={k.id}>
                  {k.keyword_display}
                  <button onClick={() => remove(k.id)} disabled={busy} aria-label="Remove">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="kw-row">
              <input
                className="kw-input"
                placeholder="Add a keyword"
                value={drafts[c.key] || ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && add(c.key)}
              />
              <button className="ghost-btn" onClick={() => add(c.key)} disabled={busy}>
                Add
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ShareLink {
  clientKey: string;
  clientName: string;
  url: string | null;
  token: string | null;
}

// Operator-only. One share link per configured creator: view + copy, Rotate
// (revoke + mint a fresh token, confirmed), Revoke. The owner never touches
// tokens by hand; this is the only place they are minted or killed.
function ShareManager() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/ads-v2/share-link");
    if (res.ok) {
      const data = await res.json();
      setLinks(data.links || []);
    }
  };
  useEffect(() => {
    // Fetch on mount. The lint rule cannot see that `load` only sets state
    // after an await, so nothing here renders synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const mint = async (client: string) => {
    setBusy(true);
    await fetch("/api/ads-v2/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mint", client }),
    });
    await load();
    setBusy(false);
  };

  const rotate = async (client: string) => {
    if (!confirm("Rotate this link? The current link stops working immediately and a new one is created.")) return;
    setBusy(true);
    await fetch("/api/ads-v2/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate", client }),
    });
    await load();
    setBusy(false);
  };

  const revoke = async (client: string) => {
    if (!confirm("Revoke this link? Anyone with it loses access immediately.")) return;
    setBusy(true);
    await fetch("/api/ads-v2/share-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", client }),
    });
    await load();
    setBusy(false);
  };

  const copy = async (url: string, client: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(client);
      setTimeout(() => setCopied((c) => (c === client ? null : c)), 1500);
    } catch {
      /* clipboard blocked; the link is visible to copy by hand */
    }
  };

  return (
    <div>
      <div className="how-note">
        A share link lets a client see only their own Ads v2 numbers, with no
        login and no access to anything else. Rotate if a link leaks; revoke to
        cut access. The link always shows the client this button is next to.
      </div>
      {links.map((l) => (
        <div key={l.clientKey}>
          <div className="sec-title">{l.clientName}</div>
          {l.url ? (
            <div className="share-row">
              <input className="share-url" readOnly value={l.url} onFocus={(e) => e.currentTarget.select()} />
              <button className="ghost-btn" onClick={() => copy(l.url!, l.clientKey)} disabled={busy}>
                {copied === l.clientKey ? "Copied" : "Copy"}
              </button>
              <button className="ghost-btn" onClick={() => rotate(l.clientKey)} disabled={busy}>
                Rotate
              </button>
              <button className="ghost-btn danger" onClick={() => revoke(l.clientKey)} disabled={busy}>
                Revoke
              </button>
            </div>
          ) : (
            <div className="share-row">
              <span className="freshness">No active link.</span>
              <button className="ghost-btn" onClick={() => mint(l.clientKey)} disabled={busy}>
                Create link
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function HowItWorks({ payload }: { payload: AdsV2Payload | null }) {
  const how = buildHowItWorks();
  const freshness = payload && !payload.preparing ? Object.entries(payload.freshness) : [];
  return (
    <div className="how-legend">
      <p className="legend-intro">{how.scopeNote}</p>

      <section className="legend-section">
        <h4 className="legend-h">What each column means</h4>
        {how.columns.map((col) => (
          <div className="legend-row" key={col.key}>
            <div className="legend-term">{col.label}</div>
            <div className="legend-def">
              {col.sentence}
              <span className="legend-src">Source: {col.source}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="legend-section">
        <h4 className="legend-h">What each metrics card means</h4>
        {CARD_DEFS.map((card) => (
          <div className="legend-row" key={card.id}>
            <div className="legend-term">{card.label}</div>
            <div className="legend-def">
              {card.sentence}
              <span className="legend-src">Source: {card.source}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="legend-section">
        <h4 className="legend-h">How revenue gets tied to an ad</h4>
        <ol className="legend-chain">
          {how.revenueChain.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="legend-section">
        <h4 className="legend-h">Time and freshness</h4>
        <p className="legend-note">{how.etNote}</p>
        {freshness.length > 0 && (
          <div className="legend-fresh">
            {freshness.map(([source, f]) => (
              <div key={source}>
                {source}: last data {f.lastEtDay || "unknown"}
                {f.ageHours != null ? `, synced ${f.ageHours}h ago` : ""}
                {f.stale ? <span className="stale"> (stale)</span> : ""}
              </div>
            ))}
            {payload && <div>Data version {payload.dataVersion}</div>}
          </div>
        )}
      </section>
    </div>
  );
}
