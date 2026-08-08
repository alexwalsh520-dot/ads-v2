import { redirect } from "next/navigation";
import { isSignedIn } from "@/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  wrong: "That password is not right. Try again.",
  rate_limited: "Too many tries. Wait fifteen minutes and try again.",
  not_configured:
    "No password has been set for this dashboard yet. Set APP_PASSWORD in your hosting settings, then reload.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  if (await isSignedIn()) redirect("/ads-v2");
  const { e } = await searchParams;

  return (
    <main className="signin">
      {/* A plain form post, so signing in works with JavaScript disabled and
          there is no client-side auth code that could leak anything. */}
      <form className="signin-card" action="/api/auth/login" method="post">
        <h1>Ads</h1>
        <p>Enter your password.</p>
        <input
          className="signin-input"
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          required
        />
        <button className="signin-button" type="submit">
          Sign in
        </button>
        {e ? <p className="signin-error">{MESSAGES[e] ?? MESSAGES.wrong}</p> : null}
      </form>
    </main>
  );
}
