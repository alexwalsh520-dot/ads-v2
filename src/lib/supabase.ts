// Supabase client for CCOS
// Browser client (anon key) for reading via RLS
// Server client (service role key) for sync API writes

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy-initialized to avoid build failures when env vars are missing
let _supabase: SupabaseClient | null = null;

// Client-safe: respects RLS policies (read-only for anon)
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabase) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) {
        throw new Error("Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)");
      }
      _supabase = createClient(url, key);
    }
    return (_supabase as unknown as Record<string, unknown>)[prop as string];
  },
});

// Server-only: used in API routes for writes (bypasses RLS)
// Only call this in server-side code (API routes, server components)
//
// One shared client per process (connection discipline). The Supabase JS client
// talks to PostgREST over HTTP and is stateless and safe to reuse, so we build
// it once and hand back the same instance instead of churning a new client on
// every query. The 7/23 load incident was made worse by per-call client churn;
// a single memoized client removes that.
let _serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service env vars not configured");
  }
  _serviceClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _serviceClient;
}
