// ─────────────────────────────────────────────────────────────────────────
// KEYWORD — v2 reuses v1's proven normalization so the two views agree on
// what a keyword is. The ad's NAME is its keyword (keywordFromAdName), and
// all keys compare on the lowercase normalized form.
// ─────────────────────────────────────────────────────────────────────────

export {
  normalizeKeyword,
  displayKeyword,
  keywordFromAdName,
  normalizePersonName,
} from "@/lib/ads-tracker/normalize";
