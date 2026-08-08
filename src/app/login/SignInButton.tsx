"use client";

import { signIn } from "next-auth/react";

export default function SignInButton() {
  return (
    <button className="signin-button" onClick={() => signIn("google", { callbackUrl: "/ads-v2" })}>
      Continue with Google
    </button>
  );
}
