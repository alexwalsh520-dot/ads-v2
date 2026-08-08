export function normalizeKeyword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function displayKeyword(value: unknown): string {
  const normalized = normalizeKeyword(value);
  return normalized ? normalized.toUpperCase() : "UNKNOWN";
}

export function keywordFromAdName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const segments = trimmed
    .split(/[|:()[\]{}_-]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const candidate = segments.at(-1) || trimmed;
  const words = candidate.match(/[a-z0-9]+/gi);
  if (!words?.length) return normalizeKeyword(candidate);

  return normalizeKeyword(words.at(-1));
}

export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized || null;
}

/**
 * Pull a non-empty `utm_content` value out of a booking-link URL's query string.
 * GHL stores the keyword on the calendar booking link as `?utm_content=KEYWORD`
 * (inside contact.attributionSource.url / lastAttributionSource.url). The mirror
 * JSON field is usually populated too, but when it isn't, the URL is the source
 * of truth — so we parse it directly. Returns null for empty `utm_content=`.
 */
export function keywordFromUrlUtmContent(value: unknown): string | null {
  if (typeof value !== "string" || !value.includes("utm_content")) return null;
  const match = value.match(/[?&]utm_content=([^&#\s]+)/i);
  if (!match) return null;
  let raw = match[1];
  try {
    raw = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    // Leave raw as-is if it isn't valid percent-encoding.
  }
  return normalizeKeyword(raw);
}

export function extractKeywordFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  const keywordKeys = new Set([
    "keyword",
    "utm_content",
    "utmContent",
    "UTM Content",
    "UTM_CONTENT",
    "ad_keyword",
    "adKeyword",
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (keywordKeys.has(key)) {
        const normalized = normalizeKeyword(value);
        if (normalized) return normalized;
      }

      // Booking-link URLs carry the keyword as a `?utm_content=` query param.
      // Parse it directly so we still capture the keyword when the mirror JSON
      // field is empty.
      const fromUrl = keywordFromUrlUtmContent(value);
      if (fromUrl) return fromUrl;

      if (
        value &&
        typeof value === "object" &&
        "name" in value &&
        "value" in value
      ) {
        const field = value as { name?: unknown; value?: unknown };
        if (
          typeof field.name === "string" &&
          keywordKeys.has(field.name)
        ) {
          const normalized = normalizeKeyword(field.value);
          if (normalized) return normalized;
        }
      }

      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

export function extractRawKeywordFromPayload(payload: unknown): string | null {
  const normalized = extractKeywordFromPayload(payload);
  return normalized ? normalized.toUpperCase() : null;
}
