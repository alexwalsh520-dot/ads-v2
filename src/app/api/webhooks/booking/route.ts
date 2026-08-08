// ─────────────────────────────────────────────────────────────────────────
// BOOKING WEBHOOK — where a booked call enters the system.
//
// Point your CRM's appointment automation (GoHighLevel, Calendly, anything
// that can POST JSON) at:
//
//     POST https://<your-app>/api/webhooks/booking?secret=<WEBHOOK_SECRET>
//
// Two things get written:
//   ghl_appointments       the booking itself
//   manychat_contact_links the subscriber ↔ contact bridge, when the payload
//                          carries a subscriber id
//
// That second write is the quiet hero. Without it, the DM and the call it
// produced are two unrelated people, and every booking shows as unattributed
// no matter how good the ad was. If your CRM can carry the ManyChat subscriber
// id through on the booking (a hidden field on the booking form, or a UTM on
// the booking link), send it — it is worth more than every other optional
// field combined.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { creatorKeyFromText, isCreatorKey } from "@/lib/creators";
import { clientForSalesCalendar } from "@/lib/ads-v2/config";
import {
  displayKeyword,
  extractKeywordFromPayload,
  normalizeKeyword,
} from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

function pick(payload: Payload, names: string[]): string | null {
  for (const name of names) {
    const direct = payload[name];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (typeof direct === "number") return String(direct);
  }
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

  const appointmentId = pick(payload, [
    "appointment_id", "appointmentId", "id", "event_id", "uuid",
  ]);
  if (!appointmentId) {
    return NextResponse.json(
      { error: "missing appointment id", received: Object.keys(payload) },
      { status: 400 },
    );
  }

  const calendarId = pick(payload, ["calendar_id", "calendarId", "calendar"]);
  const calendarName = pick(payload, ["calendar_name", "calendarName", "event_title", "title"]);

  // Which creator this booking belongs to, best evidence first: the calendar id
  // you pinned in the config beats any name matching, because a pinned id is a
  // decision someone made and a name match is a guess that happened to work.
  const clientRaw = pick(payload, ["client", "client_key", "creator", "assigned_to_creator"]);
  const clientKey =
    (calendarId ? clientForSalesCalendar(calendarId) : null) ??
    (isCreatorKey(clientRaw) ? clientRaw : null) ??
    creatorKeyFromText(clientRaw, calendarName, pick(payload, ["tags", "source", "offer"]));

  const keywordRaw =
    pick(payload, ["keyword", "Keyword", "utm_content"]) ?? extractKeywordFromPayload(payload);
  const keyword = normalizeKeyword(keywordRaw);

  const subscriberId = pick(payload, [
    "manychat_user_id", "manychat_subscriber_id", "subscriber_id", "subscriberId",
  ]);
  const contactId = pick(payload, ["contact_id", "contactId", "invitee_id"]);

  const startTime = pick(payload, ["start_time", "startTime", "start", "scheduled_at"]);
  const endTime = pick(payload, ["end_time", "endTime", "end"]);

  const db = getServiceSupabase();

  const { error } = await db.from("ghl_appointments").upsert(
    {
      appointment_id: appointmentId,
      calendar_id: calendarId,
      calendar_name: calendarName,
      contact_id: contactId,
      contact_name: pick(payload, ["contact_name", "name", "full_name", "invitee_name"]),
      contact_phone: pick(payload, ["phone", "contact_phone"]),
      contact_email: pick(payload, ["email", "contact_email", "invitee_email"]),
      start_time: startTime ? new Date(startTime).toISOString() : null,
      end_time: endTime ? new Date(endTime).toISOString() : null,
      assigned_user_id: pick(payload, ["assigned_user_id", "user_id", "owner_id"]),
      closer_name: pick(payload, ["closer", "closer_name", "assigned_user_name", "host"]),
      status: pick(payload, ["status", "appointment_status"]),
      event_type: pick(payload, ["event_type", "type"]),
      client: clientKey,
      keyword_raw: keywordRaw ? displayKeyword(keywordRaw) : null,
      keyword_normalized: keyword,
      // The subscriber id is stashed in raw_payload under a fixed name because
      // that is exactly where the attribution SQL looks for it.
      raw_payload: { ...payload, manychat_user_id: subscriberId ?? null },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "appointment_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Record the identity bridge whenever this payload proved one.
  let linked = false;
  if (subscriberId && contactId && clientKey) {
    const { error: linkError } = await db.from("manychat_contact_links").upsert(
      {
        client: clientKey,
        subscriber_id: subscriberId,
        ghl_contact_id: contactId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client,subscriber_id" },
    );
    linked = !linkError;
  }

  return NextResponse.json({ ok: true, appointmentId, clientKey, keyword, linked });
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    endpoint: "booking webhook",
    authorized: authorized(req),
    expects: ["appointment_id", "calendar_id", "contact_id", "start_time"],
    recommended: ["manychat_user_id (ties the booking back to the DM)"],
  });
}
