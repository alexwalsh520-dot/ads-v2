import type { NextRequest } from "next/server";
import { auth } from "@/auth";

/**
 * A cron endpoint is callable two ways: by the scheduler with the shared
 * secret, or by a signed-in human who wants to force a run now.
 *
 * With no CRON_SECRET set, only the signed-in path works. That is deliberate:
 * an unauthenticated endpoint that spends money against the Meta API and
 * rewrites your numbers should never be one missing env var away from public.
 */
export async function isCronAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get("authorization")?.replace("Bearer ", "");
    if (header === secret) return true;
    if (req.headers.get("x-cron-secret") === secret) return true;
  }
  const session = await auth();
  return !!session?.user;
}
