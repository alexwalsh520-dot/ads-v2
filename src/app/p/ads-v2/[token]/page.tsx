// Public, no-login client share view for the Ads v2 tab.
//
// A creator opens https://<your-app>/p/ads-v2/<token>. We
// resolve the token -> client SERVER-SIDE here, then render the EXACT same Ads
// v2 UI in public mode: no account dropdown (the token locks the client), the
// gear opens only "How your numbers work", no sidebar, no other CCOS chrome.
// The data boundary is enforced by /api/public/ads-v2/<token>; this page only
// decides what to render. Missing / revoked tokens get a clean, dataless page.
import type { Metadata } from "next";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS_BY_KEY, isCreatorKey } from "@/lib/creators";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import type { AdsV2Account } from "@/lib/ads-v2/types";
import "../../../ads-v2/ads-v2.css";
import AdsV2Client from "../../../ads-v2/AdsV2Client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Ads",
  robots: { index: false, follow: false },
};

async function resolveToken(token: string): Promise<{ clientKey: AdsV2Account } | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();
    if (error || !data) return null;
    if (data.revoked || data.kind !== "ads_v2") return null;
    if (!isCreatorKey(data.client_key)) return null;
    if (!ADSV2_SERVED_CLIENTS.includes(data.client_key)) return null;
    return { clientKey: data.client_key as AdsV2Account };
  } catch {
    return null;
  }
}

function NotAvailable() {
  return (
    <main className="pub-unavailable">
      <div className="pub-unavailable-card">
        <h1>Link not available</h1>
        <p>This share link is no longer active. Ask your contact for a fresh link.</p>
      </div>
    </main>
  );
}

export default async function PublicAdsV2Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveToken(token);
  if (!resolved) return <NotAvailable />;

  return (
    <main className="pub-ads-v2-page" aria-label="Ads">
      <AdsV2Client
        publicToken={token}
        lockedAccount={resolved.clientKey}
        // A share link is locked to ONE creator, so this page hands over that
        // creator and no other. The visitor must never learn who else exists.
        creators={[
          {
            key: resolved.clientKey,
            name: CREATORS_BY_KEY[resolved.clientKey]?.name ?? resolved.clientKey,
          },
        ]}
      />
    </main>
  );
}
