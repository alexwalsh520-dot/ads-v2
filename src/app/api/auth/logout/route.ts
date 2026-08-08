import { NextRequest, NextResponse } from "next/server";
import { signOut } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  await signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
