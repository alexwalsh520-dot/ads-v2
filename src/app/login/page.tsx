import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SignInButton from "./SignInButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/ads-v2");
  const { error } = await searchParams;

  return (
    <main className="signin">
      <div className="signin-card">
        <h1>Ads</h1>
        <p>Sign in with the Google account on the access list.</p>
        <SignInButton />
        {error ? (
          <p className="signin-error">
            That account is not on the access list. Add it to ALLOWED_EMAILS, or to the app_users
            table, then try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}
