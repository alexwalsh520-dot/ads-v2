// ─────────────────────────────────────────────────────────────────────────
// MONEY — integer cents end to end. Never floats. Format to dollars only at
// the very edge (render). v1 leaked values like 3154.1299999999987 by doing
// float math on dollars; v2 never does.
// ─────────────────────────────────────────────────────────────────────────

/** Round a possibly-fractional cent amount to a whole integer of cents. */
export function toCents(value: number): number {
  return Math.round(value);
}

/** Format integer cents as USD dollars for display, e.g. 315413 -> "$3,154". */
export function formatUsd(cents: number, opts?: { decimals?: 0 | 2 }): string {
  const decimals = opts?.decimals ?? 0;
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Format integer cents as dollars-and-cents, e.g. 315413 -> "$3,154.13". */
export function formatUsdCents(cents: number): string {
  return formatUsd(cents, { decimals: 2 });
}

/** Safe integer division for ratios; returns null when the denominator is 0. */
export function ratio(numeratorCents: number, denominator: number): number | null {
  if (!denominator) return null;
  return numeratorCents / denominator;
}

/** Cost-per-thing in cents, or null when count is 0. */
export function costPer(totalCents: number, count: number): number | null {
  if (!count) return null;
  return Math.round(totalCents / count);
}
