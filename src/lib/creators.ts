// ─────────────────────────────────────────────────────────────────────────
// CREATORS — the people you run Meta ads for.
//
// This file holds NO business data. Everything comes from adsv2.config.json,
// which is the single place you describe your own setup. Adding a creator is
// one entry in that file plus two environment variables:
//
//     META_AD_ACCOUNT_<NAME>   their Meta ad account id (e.g. act_123456789)
//     META_ACCESS_TOKEN_<NAME> their Meta access token
//
// Until those env vars exist the creator is skipped gracefully — the sync
// records "not configured" rather than failing the whole run.
// ─────────────────────────────────────────────────────────────────────────

import { loadConfig } from "./config";

/**
 * A creator key is just a string here, deliberately. In a single-tenant app you
 * can enumerate your creators in the type system; in a package that anyone
 * installs, the list is data, so the type has to be open.
 */
export type CreatorKey = string;

export interface Creator {
  /** Short internal key used across the whole pipeline. Never change it. */
  key: CreatorKey;
  /** Display name shown in the UI. */
  name: string;
  /**
   * Whether you still work with this creator. Retired creators stay in the
   * list so their historical data keeps its labels and attribution, but they
   * are excluded from every picker and sync (use ACTIVE_CREATORS).
   */
  active: boolean;
  /** The ad account's REPORTING timezone — what controls day boundaries. */
  timezone: string;
  /**
   * The currency Meta bills this ad account in (ISO 4217, e.g. "AUD").
   * Omitted means USD.
   *
   * SPEND AND BUDGETS ONLY. Spend is stored raw in this currency and converted
   * to USD at read time, at the rate for the day it moved. Sales money is
   * never touched by this: the tracker is one sheet written in USD for
   * everyone. Converting it once turned a $1,200 sale into $842.
   */
  currency?: string;
  /** Env var names that may hold the ad account id, in priority order. */
  adAccountEnv: readonly string[];
  /** Env var names that may hold the access token, in priority order. */
  tokenEnv: readonly string[];
  /** GoHighLevel calendar ids whose bookings count as SALES calls. */
  salesCalendarIds: readonly string[];
  /**
   * Lowercase fragments that reliably identify this creator wherever their name
   * shows up — booking tags, calendar names, sale offer text. Used by
   * `creatorKeyFromText`. Keep them specific enough that they cannot collide.
   */
  matchTokens: readonly string[];
}

export const CREATORS: readonly Creator[] = loadConfig().creators;

/**
 * The creators you currently work with — what every picker and sync iterates.
 * CREATORS (the full list) is only for labelling historical data.
 */
export const ACTIVE_CREATORS: readonly Creator[] = CREATORS.filter((c) => c.active);

export const CREATORS_BY_KEY: Record<CreatorKey, Creator> = Object.fromEntries(
  CREATORS.map((creator) => [creator.key, creator]),
);

/** The value of the first env var in `names` that is set, else null. */
export function firstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

/** Ensures a Meta ad account id carries the required `act_` prefix. */
export function normalizeAdAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** True if `value` names a creator you have configured. */
export function isCreatorKey(value: unknown): value is CreatorKey {
  return typeof value === "string" && CREATORS.some((c) => c.key === value);
}

/**
 * Which creator a piece of text belongs to. This is the single source of truth
 * for creator detection across the attribution pipeline (booking tags, calendar
 * names, sale offer text).
 *
 * Rules, in order:
 *   1. Text that is exactly a creator key wins, so already-clean data is stable.
 *   2. Otherwise collect every creator whose tokens appear in the text.
 *   3. Exactly one match wins.
 *   4. Two or more different creators match → the text is ambiguous, so return
 *      null and let a human decide. A wrong creator is worse than no creator:
 *      it silently moves one person's revenue onto another person's ads.
 */
export function creatorKeyFromText(
  ...values: Array<string | null | undefined>
): CreatorKey | null {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return null;

  const trimmed = text.trim();
  const exact = CREATORS.find((c) => c.key === trimmed);
  if (exact) return exact.key;

  const matches = new Set<CreatorKey>();
  for (const creator of CREATORS) {
    if (creator.matchTokens.some((token) => text.includes(token))) {
      matches.add(creator.key);
    }
  }
  if (matches.size === 1) return [...matches][0];
  return null;
}

/** Is this creator wired up enough to sync? */
export function creatorIsConfigured(creator: Creator): boolean {
  return !!firstEnv(creator.adAccountEnv) && !!firstEnv(creator.tokenEnv);
}

/** The ad account id and token for a creator, or null when not yet configured. */
export function creatorCredentials(
  creator: Creator,
): { adAccountId: string; accessToken: string } | null {
  const account = firstEnv(creator.adAccountEnv);
  const token = firstEnv(creator.tokenEnv);
  if (!account || !token) return null;
  return { adAccountId: normalizeAdAccountId(account), accessToken: token };
}
