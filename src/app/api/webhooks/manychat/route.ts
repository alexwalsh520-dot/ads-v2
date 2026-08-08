// ─────────────────────────────────────────────────────────────────────────
// MANYCHAT WEBHOOK — where a keyword DM enters the system.
//
// This is the single most important integration in the package. Ad spend on
// its own tells you what you paid; this endpoint tells you who answered. Point
// your ManyChat keyword automation at:
//
//     POST https://<your-app>/api/webhooks/manychat?secret=<WEBHOOK_SECRET>
//
// and send a JSON body with two things: the keyword, and the subscriber id.
// That is all. There is one business, so there is nothing to say about whose
// DM it is. Field names are flexible (see pick() below) because ManyChat lets
// you name custom fields whatever you like.
//
// Idempotent: the same event delivered twice updates one row rather than
// inventing a second DM. Webhooks retry, and a duplicated DM is a permanently
// inflated top-of-funnel number.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { BUSINESS } from "@/lib/creators";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

/** First non-empty value among several possible field names, searched shallowly. */
function pick(payload: Payload, names: string[]): string | null {
  for (const name of names) {
    const direct = payload[name];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number") return String(direct);
  }
  // ManyChat commonly nests the interesting values one level down.
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = pick(value as Payload, names);
      if (found) return found;
    }
  }
  return null;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  // No secret configured means the endpoint is closed, not open. An unguarded
  // write endpoint is a stranger's ability to invent your funnel numbers.
  if (!secret) return false;
  const url = new URL(req.url);
  return (
    url.searchParams.get("secret") === secret ||
    req.headers.get("x-webhook-secret") === secret ||
    req.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const keywordRaw = pick(payload, [
    "keyword", "Keyword", "keyword_raw", "last_input_text", "text", "trigger_keyword",
  ]);
  const keyword = normalizeKeyword(keywordRaw);

  const subscriberId = pick(payload, [
    "subscriber_id", "subscriberId", "id", "user_id", "manychat_id", "contact_id",
  ]);

  const clientKey = BUSINESS.key;

  // Both are required. A DM with no keyword cannot be tied to an ad; with no
  // subscriber it cannot be tied to the booking it later produces. Guessing
  // either one creates a number that looks real and is not, so refuse instead.
  // A 400 shows up in ManyChat's own delivery log, where someone will see it.
  const missing: string[] = [];
  if (!keyword) missing.push("keyword");
  if (!subscriberId) missing.push("subscriber_id");
  if (missing.length) {
    return NextResponse.json(
      { error: `missing or unrecognised: ${missing.join(", ")}`, received: Object.keys(payload) },
      { status: 400 },
    );
  }

  const eventAt = pick(payload, ["event_at", "timestamp", "created_at", "date"]);
  const parsedAt = eventAt ? new Date(eventAt) : new Date();
  const at = Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt;

  // The idempotency key. ManyChat may or may not send its own event id, so fall
  // back to something naturally unique: this subscriber, this keyword, this
  // minute. A genuine retry collides; a real second DM does not.
  const sourceEventId =
    pick(payload, ["event_id", "message_id"]) ??
    `manychat:${subscriberId}:${keyword}:${at.toISOString().slice(0, 16)}`;

  const db = getServiceSupabase();
  const { error } = await db.from("ads_keyword_events").upsert(
    {
      source: "manychat",
      source_event_id: sourceEventId,
      event_type: "dm_keyword",
      client_key: clientKey,
      keyword_raw: keywordRaw ? displayKeyword(keywordRaw) : null,
      keyword_normalized: keyword,
      subscriber_id: subscriberId,
      subscriber_name: pick(payload, ["name", "full_name", "first_name", "subscriber_name"]),
      setter_name: pick(payload, ["setter", "setter_name", "assigned_to", "owner"]),
      event_at: at.toISOString(),
      raw_payload: payload,
    },
    { onConflict: "source_event_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, clientKey, keyword });
}

/** A GET is how you check the endpoint is live without sending fake data. */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: "manychat keyword webhook",
    authorized: authorized(req),
    expects: ["keyword", "subscriber_id"],
  });
}
