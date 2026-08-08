import { redirect } from "next/navigation";
import { isSignedIn } from "@/auth";
import { ACTIVE_CREATORS } from "@/lib/creators";
import "./ads-v2.css";
import AdsV2Client from "./AdsV2Client";

// Gated here as well as in every /api/ads-v2 route. The API check is the one
// that actually protects the data; this one exists so a signed-out visitor gets
// a sign-in page instead of a dashboard shell full of error messages.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ads",
};

export default async function AdsV2Page() {
  if (!(await isSignedIn())) redirect("/login");

  // The creator list is config, so it is read on the server and handed down.
  // Nothing in the UI knows any creator's name until this point.
  const creators = ACTIVE_CREATORS.map((c) => ({ key: c.key, name: c.name }));
  return <AdsV2Client creators={creators} />;
}
