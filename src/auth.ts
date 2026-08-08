// ─────────────────────────────────────────────────────────────────────────
// SIGN-IN — one password, which you set.
//
// There is no Google login, no accounts to create, no OAuth consent screen.
// This is one person's dashboard for one business, and every minute spent
// wiring up an identity provider is a minute not spent looking at numbers.
//
// What protects your data:
//   * the password itself, compared in constant time so it cannot be guessed
//     one character at a time by timing the response;
//   * a signed cookie, so nobody can forge a session without AUTH_SECRET;
//   * an expiry, so a stolen cookie stops working;
//   * a per-address attempt limit, so it cannot be brute-forced quickly.
//
// If APP_PASSWORD is not set, NOBODY can sign in. A missing password means the
// door is shut, never that it is open — the opposite would put a live revenue
// dashboard on the public internet because of one blank config value.
// ─────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "adsv2_session";
const SESSION_DAYS = 30;

function secret(): string | null {
  return process.env.AUTH_SECRET || null;
}

function expectedPassword(): string | null {
  return process.env.APP_PASSWORD || null;
}

function sign(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Constant-time string compare that does not leak length through timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(sign(a, "compare"), "hex");
  const bb = Buffer.from(sign(b, "compare"), "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ── attempt limiting ──────────────────────────────────────────────────────
// Per-process and in-memory, so a serverless platform running several
// instances gives an attacker a few more tries than the number below suggests.
// That is fine: this exists to make guessing slow, not to be an audit control.
// The real protection is a password you did not choose in three seconds.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.first > WINDOW_MS) return false;
  return record.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip: string) {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.first > WINDOW_MS) {
    attempts.set(ip, { count: 1, first: now });
    return;
  }
  record.count += 1;
  // Keep the map from growing without bound on a long-lived instance.
  if (attempts.size > 5000) attempts.clear();
}

// ── the session ───────────────────────────────────────────────────────────

/** Is this request signed in? */
export async function isSignedIn(): Promise<boolean> {
  const key = secret();
  if (!key || !expectedPassword()) return false;

  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return false;

  const [expiry, signature] = raw.split(".");
  if (!expiry || !signature) return false;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  // The password is part of what is signed, so changing the password
  // immediately invalidates every session that already exists.
  return safeEqual(signature, sign(`${expiry}.${expectedPassword()}`, key));
}

/**
 * Check a password and start a session. Returns why it failed, so the sign-in
 * page can say something true rather than a generic shrug.
 */
export async function signIn(
  password: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; reason: "not_configured" | "rate_limited" | "wrong" }> {
  const key = secret();
  const expected = expectedPassword();
  if (!key || !expected) return { ok: false, reason: "not_configured" };
  if (tooManyAttempts(ip)) return { ok: false, reason: "rate_limited" };

  if (!safeEqual(password, expected)) {
    recordAttempt(ip);
    return { ok: false, reason: "wrong" };
  }

  const expiry = String(Date.now() + SESSION_DAYS * 86_400_000);
  const jar = await cookies();
  jar.set(COOKIE, `${expiry}.${sign(`${expiry}.${expected}`, key)}`, {
    httpOnly: true,
    // Never readable by JavaScript, never sent to another site, and over HTTPS
    // only in production (localhost has no certificate).
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
