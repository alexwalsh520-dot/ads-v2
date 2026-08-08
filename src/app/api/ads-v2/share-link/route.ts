// ─────────────────────────────────────────────────────────────────────────
// OPERATOR share-link management for Ads v2 (auth-gated; NOT on the public
// allow-list). One link per served client, kind 'ads_v2':
//   GET               list the current link (if any) for each served client
//   POST mint         create a link for a client if none is active
//   POST rotate       revoke the current link and mint a fresh one
//   POST revoke       revoke the current link
// The client of a link is fixed at mint time and is one of the served creators.
// Tokens are the only credential; they are unguessable and revocable.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";

export const dynamic = "force-dynamic";

const KIND = "ads_v2";

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function urlFor(req: NextRequest, token: string): string {
  return `${req.nextUrl.origin}/p/ads-v2/${token}`;
}

function isServed(client: string): client is CreatorKey {
  return (ADSV2_SERVED_CLIENTS as readonly string[]).includes(client);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getServiceSupabase();
  const { data } = await sb
    .from("public_share_links")
    .select("client_key, token, revoked, created_at")
    .eq("kind", KIND)
    .eq("revoked", false)
    .order("created_at", { ascending: false });

  const activeByClient = new Map<string, string>();
  for (const row of data || []) {
    if (!activeByClient.has(row.client_key)) activeByClient.set(row.client_key, row.token);
  }

  const links = ADSV2_SERVED_CLIENTS.map((key) => {
    const token = activeByClient.get(key) || null;
    return {
      clientKey: key,
      clientName: CREATORS_BY_KEY[key]?.name || key,
      token,
      url: token ? urlFor(req, token) : null,
    };
  });
  return NextResponse.json({ links });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; client?: string };
  const action = body.action;
  const client = body.client;
  if (!client || !isServed(client)) {
    return NextResponse.json({ error: "Unknown client" }, { status: 400 });
  }

  const sb = getServiceSupabase();

  // Revoke every active link for this client (used by revoke and rotate).
  async function revokeActive() {
    await sb
      .from("public_share_links")
      .update({ revoked: true })
      .eq("kind", KIND)
      .eq("client_key", client)
      .eq("revoked", false);
  }

  async function mint() {
    const token = newToken();
    await sb.from("public_share_links").insert({
      token,
      kind: KIND,
      client_key: client,
      label: `Ads v2 - ${CREATORS_BY_KEY[client as CreatorKey]?.name || client}`,
      revoked: false,
    });
    return token;
  }

  if (action === "revoke") {
    await revokeActive();
    return NextResponse.json({ ok: true });
  }

  if (action === "rotate") {
    await revokeActive();
    const token = await mint();
    return NextResponse.json({ ok: true, url: urlFor(req, token) });
  }

  if (action === "mint") {
    // Reuse an existing active link if one is already there (get-or-mint).
    const { data: existing } = await sb
      .from("public_share_links")
      .select("token")
      .eq("kind", KIND)
      .eq("client_key", client)
      .eq("revoked", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const token = existing?.token || (await mint());
    return NextResponse.json({ ok: true, url: urlFor(req, token) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
