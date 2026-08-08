// ─────────────────────────────────────────────────────────────────────────
// YOUR BUSINESS — read from adsv2.config.json.
//
// This dashboard is for ONE business: yours. There is no list of clients and
// nothing to pick between.
//
// The pipeline underneath still carries a `client_key` on every row, and the
// list below still exists as a list of one. That is deliberate rather than
// lazy: the database columns, the SQL functions and the attribution passes all
// take a set of keys, and collapsing that shape everywhere would be a large,
// risky change that buys nothing you can see.
//
// Two environment variables connect Meta:
//     META_AD_ACCOUNT     your ad account id, like act_123456789
//     META_ACCESS_TOKEN   your access token
//
// Until both exist the update records "not configured" and carries on, rather
// than failing the whole run.
// ─────────────────────────────────────────────────────────────────────────

import { loadConfig, type Business } from "./config";

export type CreatorKey = string;
export type Creator = Business;

/** Your business, as a list of one. */
export const CREATORS: readonly Creator[] = [loadConfig().business];
export const ACTIVE_CREATORS: readonly Creator[] = CREATORS;

export const BUSINESS: Creator = CREATORS[0];

export const CREATORS_BY_KEY: Record<CreatorKey, Creator> = Object.fromEntries(
  CREATORS.map((c) => [c.key, c]),
);

/** The value of the first environment variable in `names` that is set. */
export function firstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/** Makes sure a Meta ad account id carries the required `act_` prefix. */
export function normalizeAdAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** True if `value` is your business key. */
export function isCreatorKey(value: unknown): value is CreatorKey {
  return typeof value === "string" && CREATORS.some((c) => c.key === value);
}

/**
 * Which business a piece of text belongs to. With one business the answer is
 * always the same one — but incoming webhooks may still send a name, and this
 * keeps that harmless instead of rejecting it.
 */
export function creatorKeyFromText(
  ..._values: Array<string | null | undefined>
): CreatorKey | null {
  return BUSINESS.key;
}

/** Is Meta wired up yet? */
export function creatorIsConfigured(creator: Creator = BUSINESS): boolean {
  return !!firstEnv(creator.adAccountEnv) && !!firstEnv(creator.tokenEnv);
}

/** The ad account id and token, or null when Meta is not connected yet. */
export function creatorCredentials(
  creator: Creator = BUSINESS,
): { adAccountId: string; accessToken: string } | null {
  const account = firstEnv(creator.adAccountEnv);
  const token = firstEnv(creator.tokenEnv);
  if (!account || !token) return null;
  return { adAccountId: normalizeAdAccountId(account), accessToken: token };
}
