import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getServiceSupabase } from "@/lib/supabase";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    signIn: async ({ profile }) => {
      if (!profile?.email) return false;
      const email = profile.email.toLowerCase();

      // Check ALLOWED_EMAILS env var first (always works, no DB dependency)
      const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (allowedEmails.includes(email)) return true;

      // Then check app_users table
      try {
        const sb = getServiceSupabase();
        const { data } = await sb
          .from("app_users")
          .select("is_active")
          .eq("email", email)
          .single();

        return data?.is_active === true;
      } catch {
        return false;
      }
    },
    jwt: async ({ token, profile }) => {
      // Use profile.email on first sign-in, token.email on subsequent requests
      const email = (profile?.email ?? token?.email ?? "").toString().toLowerCase();
      if (!email) return token;

      const ALL_TABS = ["/","/mozi-metrics","/sales","/coaching","/onboarding","/ads","/ads-v2","/live-ads","/studio","/studio-2","/outreach","/leads","/outreach-runs","/studio-2/auto-outreach-test","/outreach-run","/super-doc-editor","/sales-hub","/setter-response-time","/lead-magnet","/media-buyer","/accountant","/intelligence","/log","/settings","/sop","/testimonials","/partner-onboarding"];

      // Check app_users table first
      try {
        const sb = getServiceSupabase();
        const { data } = await sb
          .from("app_users")
          .select("role, allowed_tabs")
          .eq("email", email)
          .eq("is_active", true)
          .single();

        if (data) {
          token.role = data.role;
          token.allowedTabs = data.allowed_tabs;
          return token;
        }
      } catch {
        // Supabase unreachable — use cached values if available, else fall through
        if (token.role && token.allowedTabs) return token;
      }

      // Fallback: ALLOWED_EMAILS users get admin + all tabs
      const allowedEmails = (process.env.ALLOWED_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (allowedEmails.includes(email)) {
        token.role = "admin";
        token.allowedTabs = ALL_TABS;
      } else {
        token.role = "client";
        token.allowedTabs = ["/"];
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (token?.sub) {
        session.user.id = token.sub;
      }
      session.user.role = (token.role as "admin" | "client") ?? "client";
      session.user.allowedTabs = (token.allowedTabs as string[]) ?? ["/"];
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
});
