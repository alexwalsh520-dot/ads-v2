// ─────────────────────────────────────────────────────────────────────────
// ORGANIC KEYWORDS — the words used in organic content rather than paid ads.
// Managed from the gear panel on the dashboard.
//
// A sale on one of these is real revenue but NOT ad revenue, so it is kept out
// of ROAS while staying in total revenue.
//
// TWO TABLES, ON PURPOSE. `organic_keywords` is what the DM and booking passes
// read; `registry_keywords` (type='organic') is what the sale labeller reads.
// Every write here goes to both, because a keyword marked organic in the UI
// that only reached one of them would keep some numbers right and quietly
// leave others wrong — which is worse than not offering the button at all.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeKeyword, displayKeyword } from "@/lib/ads-tracker/normalize";
import { isCreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";

async function authed() {
  const session = await auth();
  return !!session?.user;
}

/** List every registered organic keyword, per creator. */
export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("organic_keywords")
    .select("id,client_key,keyword_normalized,note,created_at")
    .order("client_key", { ascending: true })
    .order("keyword_normalized", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const keywords = (data || []).map((r) => ({
    ...r,
    keyword_display: displayKeyword(r.keyword_normalized),
  }));
  return NextResponse.json({ keywords });
}

/** Mark a keyword organic for a creator. Body: { client, keyword, note? } */
export async function POST(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const client = typeof body.client === "string" ? body.client.trim().toLowerCase() : "";
  const keyword = normalizeKeyword(body.keyword);
  const note = typeof body.note === "string" ? body.note.trim() || null : null;
  if (!isCreatorKey(client)) return NextResponse.json({ error: "Invalid creator key" }, { status: 400 });
  if (!keyword) return NextResponse.json({ error: "Invalid keyword" }, { status: 400 });

  const sb = getServiceSupabase();
  const { error } = await sb
    .from("organic_keywords")
    .upsert(
      { client_key: client, keyword_normalized: keyword, note },
      { onConflict: "client_key,keyword_normalized" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: registryError } = await sb.from("registry_keywords").upsert(
    {
      keyword_normalized: keyword,
      client_key: client,
      type: "organic",
      status: "active",
      source_evidence: { marked_by: "organic-keywords api", note },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "keyword_normalized,client_key,type" },
  );
  // Reported, never swallowed. A half-applied mark is exactly the state that
  // makes some numbers right and others wrong with no visible sign.
  if (registryError) {
    return NextResponse.json(
      { error: `saved to organic_keywords but not to the registry: ${registryError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    client_key: client,
    keyword_normalized: keyword,
    keyword_display: displayKeyword(keyword),
  });
}

/** Un-mark a keyword. Body: { id } OR { client, keyword } */
export async function DELETE(req: NextRequest) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sb = getServiceSupabase();

  let client = typeof body.client === "string" ? body.client.trim().toLowerCase() : "";
  let keyword = normalizeKeyword(body.keyword);

  if (typeof body.id === "number") {
    // Resolve the id to its pair first, so the registry row can be removed too.
    const { data } = await sb
      .from("organic_keywords")
      .select("client_key,keyword_normalized")
      .eq("id", body.id)
      .maybeSingle();
    if (data) {
      client = data.client_key;
      keyword = data.keyword_normalized;
    }
    const { error } = await sb.from("organic_keywords").delete().eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    if (!client || !keyword) {
      return NextResponse.json({ error: "id or (client + keyword) required" }, { status: 400 });
    }
    const { error } = await sb
      .from("organic_keywords")
      .delete()
      .eq("client_key", client)
      .eq("keyword_normalized", keyword);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (client && keyword) {
    await sb
      .from("registry_keywords")
      .delete()
      .eq("client_key", client)
      .eq("keyword_normalized", keyword)
      .eq("type", "organic");
  }

  return NextResponse.json({ ok: true });
}
