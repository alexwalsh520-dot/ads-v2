// Authed read of the "How this app protects itself" panel. Same builder the
// public share view uses; the data is non-sensitive health status either way.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { buildProtections } from "@/lib/ads-v2/protections";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await buildProtections(getServiceSupabase());
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
