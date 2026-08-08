import { NextRequest, NextResponse } from "next/server";
import { signIn } from "@/auth";

export const dynamic = "force-dynamic";

// The address a request came from, for attempt limiting. Behind a proxy the
// socket address is the proxy, so the forwarded header is what identifies the
// actual visitor. Falls back to a constant, which limits everyone together —
// stricter than letting an unknown address through unlimited.
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const result = await signIn(password, clientIp(req));

  if (result.ok) {
    return NextResponse.redirect(new URL("/ads-v2", req.url), { status: 303 });
  }
  return NextResponse.redirect(new URL(`/login?e=${result.reason}`, req.url), { status: 303 });
}
